import { db } from "./db";
import { drivers, blocks, blockAssignments, protectedDriverRules, contracts } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { validateBlockAssignment } from "./rolling6-calculator";
import * as XLSX from "xlsx";
import { startOfWeek, parseISO, getDay, startOfDay, format } from "date-fns";

interface ExcelRow {
  blockId: string;
  driverName: string;
  operatorId: string;
  stop1PlannedStartDate?: number;
  stop1PlannedStartTime?: number;
  stop2PlannedArrivalDate?: number;
  stop2PlannedArrivalTime?: number;
}

/**
 * Canonical column name mapping
 * Maps various Excel column name variations to standardized internal keys
 */
const CANONICAL_COLUMN_MAP: Record<string, string> = {
  "block id": "blockId",
  "driver name": "driverName",
  "operator id": "operatorId",
  
  // Stop 1 timing (handles both "Arrival" and "Departure" variations with single/double spaces)
  "stop 1 planned arrival date": "stop1PlannedStartDate",
  "stop 1 planned departure date": "stop1PlannedStartDate",
  "stop 1 planned arrival time": "stop1PlannedStartTime",
  "stop 1 planned departure time": "stop1PlannedStartTime",
  
  // Stop 2 timing
  "stop 2 planned arrival date": "stop2PlannedArrivalDate",
  "stop 2 planned arrival time": "stop2PlannedArrivalTime",
};

/**
 * Normalize column header: trim, collapse multiple spaces, lowercase
 */
function normalizeHeader(header: string): string {
  return header.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Create a mapping from raw Excel headers to canonical property names
 */
function createColumnMap(rawHeaders: string[]): Map<string, string> {
  const map = new Map<string, string>();
  
  for (const header of rawHeaders) {
    const normalized = normalizeHeader(header);
    const canonicalKey = CANONICAL_COLUMN_MAP[normalized];
    
    if (canonicalKey) {
      map.set(header, canonicalKey); // raw header → canonical key
    }
  }
  
  return map;
}

/**
 * Normalize Excel rows to use canonical column names
 * This allows downstream logic to work with consistent property names
 * regardless of spacing variations or Arrival/Departure column naming
 */
function normalizeRows(rawRows: any[], columnMap: Map<string, string>): ExcelRow[] {
  return rawRows.map(rawRow => {
    const normalized: any = {};
    
    for (const [rawHeader, value] of Object.entries(rawRow)) {
      const canonicalKey = columnMap.get(rawHeader);
      if (canonicalKey) {
        normalized[canonicalKey] = value;
      }
    }
    
    return normalized as ExcelRow;
  });
}

/**
 * Validate that required canonical columns can be resolved from Excel headers
 */
function validateRequiredColumns(
  columnMap: Map<string, string>,
  requiredCanonicalKeys: string[]
): { valid: boolean; missing: string[] } {
  const missing: string[] = [];
  const canonicalValues = new Set(columnMap.values());
  
  for (const required of requiredCanonicalKeys) {
    if (!canonicalValues.has(required)) {
      missing.push(required);
    }
  }
  
  return {
    valid: missing.length === 0,
    missing,
  };
}

interface ImportResult {
  created: number;
  failed: number;
  skipped: number;
  errors: string[];
  warnings: string[];
  committedWithWarnings: number;
}

/**
 * Detect Amazon pattern group by finding closest canonical anchor
 * 
 * Amazon's rotating duty cycles:
 * - sunWed: Sunday-Wednesday (4 days starting Sunday at contract time)
 * - wedSat: Wednesday-Saturday (4 days starting Wednesday at contract time)
 * 
 * CRITICAL: Determines pattern by finding which canonical anchor (Sunday or Wednesday
 * at contract time) the actual start is closest to. This correctly handles edge cases
 * like Tuesday 11 PM shifts that cross midnight into Wednesday UTC.
 * 
 * Example: Tuesday 11 PM shift is closer to "Sunday at 16:30" than "Wednesday at 16:30",
 * so it's classified as sunWed pattern.
 * 
 * @param startDate - Actual block start timestamp
 * @param contractStartTime - Contract base time (HH:MM format like "16:30")
 * @returns Pattern group (sunWed or wedSat)
 */
function detectPatternGroup(startDate: Date, contractStartTime: string): "sunWed" | "wedSat" {
  const [hours, minutes] = contractStartTime.split(":").map(Number);
  
  // Amazon's 4-day cycle windows (contract-local time):
  // - sunWed: Sunday, Monday, Tuesday (all day) + Wednesday before contract time
  // - wedSat: Wednesday (at/after contract time), Thursday, Friday, Saturday
  
  const localDayOfWeek = startDate.getDay(); // 0=Sunday, 1=Monday, ..., 6=Saturday
  
  // Sunday (0), Monday (1), Tuesday (2) → sunWed
  if (localDayOfWeek >= 0 && localDayOfWeek <= 2) {
    return "sunWed";
  }
  
  // Thursday (4), Friday (5), Saturday (6) → wedSat
  if (localDayOfWeek >= 4 && localDayOfWeek <= 6) {
    return "wedSat";
  }
  
  // Wednesday (3) - special case: check if before or after contract time
  // If before contract time → sunWed (end of Sun-Wed cycle)
  // If at/after contract time → wedSat (start of Wed-Sat cycle)
  const contractHour = hours + minutes / 60;
  const actualHour = startDate.getHours() + startDate.getMinutes() / 60;
  
  return actualHour < contractHour ? "sunWed" : "wedSat";
}

/**
 * Calculate canonical start time for a block
 * 
 * The canonical start is the contract's base start time on the SAME day of week as the block.
 * This allows bump calculations to measure time-of-day variations (±2h tolerance)
 * rather than day-to-day differences within a pattern cycle.
 * 
 * Special handling for midnight crossings:
 * - If block starts early AM (00:00-04:00) and contract is late PM (20:00-23:59),
 *   the canonical start should be the previous day to avoid negative multi-day bumps
 * 
 * Example: Block starts Saturday 00:06, contract time 23:30
 * → Canonical: Friday 23:30 (0.6h bump), not Saturday 23:30 (-23.4h bump)
 * 
 * CRITICAL: Immutable calculation using local time methods to match contract timezone
 * 
 * @param startTimestamp - Actual block start time
 * @param contractStartTime - Contract base time (HH:MM format like "16:30")
 * @param patternGroup - sunWed or wedSat (used for cycle_id but not canonical calculation)
 * @returns Canonical start timestamp (same day or previous day if midnight crossing)
 */
function calculateCanonicalStart(
  startTimestamp: Date,
  contractStartTime: string,
  patternGroup: "sunWed" | "wedSat"
): Date {
  // Parse contract time (HH:MM format)
  const [hours, minutes] = contractStartTime.split(":").map(Number);
  
  // Create canonical start: same day as block, but at contract time
  const canonicalDate = new Date(startTimestamp);
  canonicalDate.setHours(hours, minutes, 0, 0);
  
  // Handle midnight crossings:
  // If canonical is in the future (more than 12 hours ahead), shift to previous day
  // This catches cases where block starts 00:06 and contract is 23:30
  const bumpMilliseconds = startTimestamp.getTime() - canonicalDate.getTime();
  const bumpHours = bumpMilliseconds / (1000 * 60 * 60);
  
  if (bumpHours < -12) {
    // Shift canonical to previous day to avoid negative multi-day bumps
    canonicalDate.setDate(canonicalDate.getDate() - 1);
  }
  
  return canonicalDate;
}

/**
 * Generate pattern-aware cycle identifier
 * 
 * Format: "${patternGroup}:${cycleStartDateISO}"
 * Examples: "sunWed:2025-11-09", "wedSat:2025-11-13"
 * 
 * The cycle start date is the Sunday (for sunWed) or Wednesday (for wedSat) when the pattern begins
 */
function generateCycleId(patternGroup: "sunWed" | "wedSat", canonicalStart: Date): string {
  const dateStr = format(canonicalStart, "yyyy-MM-dd");
  return `${patternGroup}:${dateStr}`;
}

/**
 * Parse Operator ID to extract contract type and tractor
 * Format: "FTIM_MKC_Solo1_Tractor_2_d2" → { type: "solo1", tractorId: "Tractor_2" }
 */
function parseOperatorId(operatorId: string): { type: string; tractorId: string } | null {
  const match = operatorId.match(/_(Solo1|Solo2|Team)_Tractor_(\d+)/i);
  if (!match) return null;
  
  return {
    type: match[1].toLowerCase(), // "solo1", "solo2", "team"
    tractorId: `Tractor_${match[2]}`, // "Tractor_1", "Tractor_2", etc.
  };
}

/**
 * Convert Excel serial number to JavaScript Date
 * Excel stores dates as days since Jan 1, 1900
 * Times are stored as fractions of a day (0.5 = noon)
 */
function excelDateToJSDate(excelDate: number, excelTime?: number): Date {
  // Excel epoch: January 1, 1900 (but Excel incorrectly treats 1900 as a leap year)
  const excelEpoch = new Date(1899, 11, 30); // Dec 30, 1899 to account for Excel bug
  const days = excelDate + (excelTime || 0);
  const milliseconds = days * 24 * 60 * 60 * 1000;
  return new Date(excelEpoch.getTime() + milliseconds);
}

/**
 * Parse Excel file and create block assignments
 * Expected columns:
 * - Block ID (e.g., "B-00000001")
 * - Driver Name (e.g., "John Smith")
 * - Operator ID (e.g., "FTIM_MKC_Solo1_Tractor_2_d2")
 * 
 * Follows same validation pattern as CSV import:
 * - Enforces single-driver-per-block
 * - Validates driver time overlaps
 * - Runs full DOT compliance and rolling-6 validation
 * - Checks protected driver rules
 */
export async function parseExcelSchedule(
  tenantId: string,
  fileBuffer: Buffer,
  userId: string
): Promise<ImportResult> {
  const result: ImportResult = {
    created: 0,
    failed: 0,
    skipped: 0,
    errors: [],
    warnings: [],
    committedWithWarnings: 0,
  };

  // Generate unique import batch ID for tracking this import
  const importBatchId = `import_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  try {
    // Parse Excel file
    const workbook = XLSX.read(fileBuffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      throw new Error("Excel file has no sheets");
    }

    const worksheet = workbook.Sheets[sheetName];
    
    // Extract true header row directly from worksheet (not from data rows)
    // This ensures we get all column headers even if first data row has blank cells
    const allRows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    
    if (allRows.length < 2) {
      throw new Error("Excel file is empty or has no data rows");
    }
    
    const rawHeaders: string[] = allRows[0] as string[];
    const rawRows: any[] = XLSX.utils.sheet_to_json(worksheet);

    // ========== COLUMN NORMALIZATION ==========
    const columnMap = createColumnMap(rawHeaders);
    
    // Validate required columns can be resolved
    const requiredCanonicalKeys = [
      "blockId",
      "driverName",
      "operatorId",
      "stop1PlannedStartDate",
      "stop1PlannedStartTime",
      "stop2PlannedArrivalDate",
      "stop2PlannedArrivalTime",
    ];
    
    const validation = validateRequiredColumns(columnMap, requiredCanonicalKeys);
    if (!validation.valid) {
      const friendlyNames = validation.missing.map(key => {
        return Object.entries(CANONICAL_COLUMN_MAP).find(([_, v]) => v === key)?.[0] || key;
      });
      throw new Error(
        `Missing required columns in Excel file. Could not find columns for: ${friendlyNames.join(", ")}. ` +
        `Please ensure your Excel file has columns like "Block ID", "Driver Name", "Operator ID", ` +
        `"Stop 1 Planned Arrival Date/Time", and "Stop 2 Planned Arrival Date/Time".`
      );
    }
    
    // Normalize all rows to use canonical column names
    const rows: ExcelRow[] = normalizeRows(rawRows, columnMap);

    // ========== PREPROCESSING STAGE: Auto-create missing blocks ==========
    // Group rows by Block ID to extract block metadata
    const blockGroups = new Map<string, ExcelRow[]>();
    for (const row of rows) {
      const blockId = row.blockId?.trim();
      if (!blockId) continue;
      
      if (!blockGroups.has(blockId)) {
        blockGroups.set(blockId, []);
      }
      blockGroups.get(blockId)!.push(row);
    }

    // Upsert blocks and contracts from Excel data
    for (const [blockId, blockRows] of Array.from(blockGroups.entries())) {
      const firstRow = blockRows[0];
      
      // Parse Operator ID to extract contract info
      const parsedOperator = parseOperatorId(firstRow.operatorId);
      if (!parsedOperator) {
        result.warnings.push(`Block ${blockId}: Could not parse Operator ID "${firstRow.operatorId}"`);
        continue;
      }

      // Extract start and end times from Excel date numbers
      const startDate = firstRow.stop1PlannedStartDate;
      const startTime = firstRow.stop1PlannedStartTime;
      const endDate = firstRow.stop2PlannedArrivalDate;
      const endTime = firstRow.stop2PlannedArrivalTime;

      if (!startDate || !endDate || startTime === undefined || endTime === undefined) {
        result.warnings.push(`Block ${blockId}: Missing timing data (Stop 1/2 planned times)`);
        continue;
      }

      const startTimestamp = excelDateToJSDate(startDate, startTime);
      const endTimestamp = excelDateToJSDate(endDate, endTime);

      // Find existing contract using ONLY Operator ID (type + tractorId)
      // Contract times are fixed benchmark times, not imported from Excel
      const existingContracts = await db
        .select()
        .from(contracts)
        .where(
          and(
            eq(contracts.tenantId, tenantId),
            eq(contracts.type, parsedOperator.type),
            eq(contracts.tractorId, parsedOperator.tractorId)
          )
        );

      if (existingContracts.length === 0) {
        // Contract not found - skip this block
        result.warnings.push(
          `Block ${blockId}: No contract found for ${parsedOperator.type.toUpperCase()} ${parsedOperator.tractorId}. ` +
          `Please ensure the 17 benchmark contracts are seeded before importing.`
        );
        continue;
      }

      if (existingContracts.length > 1) {
        // Multiple contracts found - data corruption, use first but warn
        result.warnings.push(
          `Block ${blockId}: Found ${existingContracts.length} contracts for ${parsedOperator.type.toUpperCase()} ${parsedOperator.tractorId}. ` +
          `This indicates data corruption. Using first match but database should be cleaned.`
        );
      }

      const contractId = existingContracts[0].id;
      const contract = existingContracts[0];

      // Upsert block (update if exists, insert if new)
      const existingBlock = await db
        .select()
        .from(blocks)
        .where(and(eq(blocks.tenantId, tenantId), eq(blocks.blockId, blockId)))
        .limit(1);

      // Calculate pattern-aware metadata (for both new and existing blocks)
      const duration = Math.round((endTimestamp.getTime() - startTimestamp.getTime()) / (1000 * 60 * 60));
      
      // CONTRACT-TIME VALIDATION: Verify block duration matches contract expectations
      // Allow ±2 hour tolerance for Amazon's bump variations
      const expectedDuration = contract.duration;
      const durationDiff = Math.abs(duration - expectedDuration);
      
      if (durationDiff > 2) {
        result.warnings.push(
          `Block ${blockId}: Duration mismatch - Expected ${expectedDuration}h (${contract.type.toUpperCase()}), got ${duration}h. ` +
          `Difference: ${durationDiff}h exceeds ±2h tolerance. Check Excel data for accuracy.`
        );
      }
      
      // Detect Amazon pattern group by finding closest canonical anchor
      // This correctly handles edge cases like Tuesday 11 PM shifts crossing into Wednesday UTC
      const patternGroup = detectPatternGroup(startTimestamp, existingContracts[0].startTime);
      
      // Calculate canonical start time for bump calculations
      const canonicalStart = calculateCanonicalStart(
        startTimestamp,
        existingContracts[0].startTime, // Contract's base start time (e.g., "16:30")
        patternGroup
      );
      
      // Generate cycle identifier for pattern grouping
      const cycleId = generateCycleId(patternGroup, canonicalStart);
      
      if (existingBlock.length === 0) {
        // Create new block with pattern-aware metadata
        await db.insert(blocks).values({
          tenantId,
          blockId,
          contractId,
          soloType: parsedOperator.type,
          startTimestamp,
          endTimestamp,
          tractorId: parsedOperator.tractorId, // From Operator ID: "Tractor_1", "Tractor_2", etc.
          duration,
          patternGroup, // sunWed or wedSat
          canonicalStart, // Canonical contract start time for this cycle
          cycleId, // Pattern-aware cycle identifier (e.g., "sunWed:2025-11-09")
        });
      } else {
        // Backfill pattern metadata for existing blocks
        await db
          .update(blocks)
          .set({
            patternGroup,
            canonicalStart,
            cycleId,
          })
          .where(and(
            eq(blocks.tenantId, tenantId),
            eq(blocks.blockId, blockId)
          ));
      }
    }

    // Fetch all data for validation (following CSV import pattern)
    const allDrivers = await db
      .select()
      .from(drivers)
      .where(eq(drivers.tenantId, tenantId));

    const allBlocks = await db
      .select()
      .from(blocks)
      .where(eq(blocks.tenantId, tenantId));

    // Fetch ALL assignments (active + archived) for rolling-6 compliance calculations
    // Rolling-6 needs historical data to calculate duty hours correctly
    // We'll filter to active-only for conflict detection later
    const allAssignments = await db
      .select()
      .from(blockAssignments)
      .where(eq(blockAssignments.tenantId, tenantId));
    
    // Separate active assignments for conflict detection
    const existingAssignments = allAssignments.filter(a => a.isActive);

    const protectedRules = await db
      .select()
      .from(protectedDriverRules)
      .where(eq(protectedDriverRules.tenantId, tenantId));

    // Track blocks assigned in this import to prevent duplicates
    const assignedBlocksInImport = new Set<string>();
    const driverBlocksInImport = new Map<string, string[]>(); // driverId -> blockIds
    const processedBlockIds = new Set<string>(); // Track which block IDs we've seen in this import
    
    // Collect all valid assignments to commit atomically
    const assignmentsToCommit: Array<{
      rowNum: number;
      blockId: string;
      driverId: string;
      validationStatus: string;
      validationSummary: string | null;
      operatorId: string;
      existingAssignmentId?: string; // Track old assignment to archive (if replacing)
    }> = [];

    // Phase 1: Validate all rows
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // Excel row number (1-indexed + header)

      // Validate required fields
      if (!row.blockId || !row.driverName || !row.operatorId) {
        result.failed++;
        result.errors.push(
          `Row ${rowNum}: Missing required fields (Block ID, Driver Name, or Operator ID)`
        );
        continue;
      }

      // Skip duplicate block IDs within this import (Amazon Excel has multiple rows per block for different stops)
      if (processedBlockIds.has(row.blockId.trim())) {
        continue; // Silently skip - not an error, just multiple stops for same block
      }
      
      processedBlockIds.add(row.blockId.trim());

      // Find block by Block ID
      const block = allBlocks.find(
        (b) => b.blockId.trim() === row.blockId.trim()
      );

      if (!block) {
        result.failed++;
        result.errors.push(
          `Row ${rowNum}: Block not found: "${row.blockId}"`
        );
        continue;
      }

      // Check if block is already assigned in DB (active assignments only)
      const existingAssignment = existingAssignments.find(
        (a) => a.blockId === block.id
      );

      // If block already assigned, we'll archive it AFTER validation passes (in Phase 2)
      // For now, just remove from in-memory array so validation doesn't see conflicts
      if (existingAssignment) {
        // CRITICAL: Remove existing assignment from in-memory array to prevent validation conflicts
        // Archive will happen in Phase 2 (commit) only if new assignment passes validation
        const assignmentIndex = existingAssignments.findIndex(a => a.id === existingAssignment.id);
        if (assignmentIndex !== -1) {
          existingAssignments.splice(assignmentIndex, 1);
        }
        
        result.warnings.push(
          `Row ${rowNum}: Block ${row.blockId} was already assigned - will replace after validation`
        );
      }

      if (assignedBlocksInImport.has(block.id)) {
        result.failed++;
        result.errors.push(
          `Row ${rowNum}: Block ${row.blockId} is assigned multiple times in this import file`
        );
        continue;
      }

      // Find driver by name (robust matching: handles "Last, First", "First Last", middle names, suffixes)
      const driverNameLower = row.driverName.trim().toLowerCase().replace(/\s+/g, " ");
      
      const driver = allDrivers.find((d) => {
        const first = d.firstName.toLowerCase();
        const last = d.lastName.toLowerCase();
        
        // Try exact match: "First Last"
        if (`${first} ${last}` === driverNameLower) return true;
        
        // Try "Last, First" format (common in Excel exports)
        if (`${last}, ${first}` === driverNameLower) return true;
        if (`${last},${first}` === driverNameLower) return true;
        
        // Try with middle names/suffixes: contains both first AND last
        const hasFirst = driverNameLower.includes(first);
        const hasLast = driverNameLower.includes(last);
        if (!hasFirst || !hasLast) return false;
        
        // Ensure proper ordering (First...Last or Last...First)
        const firstIndex = driverNameLower.indexOf(first);
        const lastIndex = driverNameLower.indexOf(last);
        return (firstIndex < lastIndex) || (driverNameLower.startsWith(last));
      });

      if (!driver) {
        result.failed++;
        result.errors.push(
          `Row ${rowNum}: Driver not found: "${row.driverName}". Check spelling and ensure driver exists in system.`
        );
        continue;
      }

      // Validate Operator ID for data integrity (secondary validation)
      try {
        const operatorId = row.operatorId;
        // Parse Operator ID: FTIM_{domicile}_{contractType}_{tractorId}_d2
        const parts = operatorId.split("_");
        if (parts.length >= 4 && parts[0] === "FTIM") {
          const contractType = parts[2].toLowerCase();
          
          // Normalize block solo type for comparison
          const blockType = block.soloType.toLowerCase().replace(/[\s-_]/g, "");
          
          // Warn if mismatch (but don't fail - blockId is authoritative)
          if (!blockType.includes(contractType.toLowerCase())) {
            result.warnings.push(
              `Row ${rowNum}: Operator ID contract type "${contractType}" doesn't match block type "${block.soloType}" - proceeding with block data`
            );
          }
        } else {
          result.warnings.push(
            `Row ${rowNum}: Operator ID "${operatorId}" doesn't match expected format FTIM_{domicile}_{contractType}_{tractorId}_d2`
          );
        }
      } catch (error) {
        result.warnings.push(
          `Row ${rowNum}: Could not validate Operator ID format`
        );
      }

      // Get driver's existing assignments for overlap checking
      const driverExistingAssignmentRows = existingAssignments.filter(
        (a) => a.driverId === driver.id
      );

      // Also check blocks assigned to this driver in this import
      const driverImportBlockIds = driverBlocksInImport.get(driver.id) || [];
      const driverImportBlocks = allBlocks.filter((b) =>
        driverImportBlockIds.includes(b.id)
      );

      // Fetch blocks for existing assignments
      const assignmentBlockIds = driverExistingAssignmentRows.map((a) => a.blockId);
      const assignmentBlocks = assignmentBlockIds.length > 0
        ? await db.select().from(blocks).where(inArray(blocks.id, assignmentBlockIds))
        : [];

      // Create map for fast lookup
      const blockMap = new Map(assignmentBlocks.map((b) => [b.id, b]));

      // Combine existing + import blocks
      const allDriverBlocks = [
        ...assignmentBlocks,
        ...driverImportBlocks,
      ];

      // Check for time overlaps
      let hasOverlap = false;
      for (const existingBlock of allDriverBlocks) {
        const overlap =
          new Date(block.startTimestamp) < new Date(existingBlock.endTimestamp) &&
          new Date(block.endTimestamp) > new Date(existingBlock.startTimestamp);

        if (overlap) {
          result.failed++;
          result.errors.push(
            `Row ${rowNum}: Time overlap - Driver "${row.driverName}" already assigned to block ${existingBlock.blockId} during this time`
          );
          hasOverlap = true;
          break;
        }
      }

      if (hasOverlap) {
        continue;
      }

      // Run full validation (DOT compliance, rolling-6, protected rules)
      // IMPORTANT: Include archived assignments for rolling-6 compliance calculations
      // Rolling-6 needs historical duty hours to validate DOT compliance correctly
      // CRITICAL: Exclude the soon-to-be-archived assignment to prevent double-counting
      const driverAllAssignmentRows = allAssignments.filter(
        (a) => a.driverId === driver.id && a.id !== existingAssignment?.id
      );
      const driverAllAssignments = driverAllAssignmentRows.map((assignment) => ({
        ...assignment,
        block: blockMap.get(assignment.blockId) || block,
      }));

      // TODO: Refactor validateBlockAssignment to accept explicit activeAssignments and historicalAssignments
      // parameters instead of relying on single existingAssignments array. This will make the distinction
      // clear for all callers and prevent confusion. Update all 7 callers: excel-import, auto-assignment,
      // routes, auto-build-engine, csv-import, workload-calculator, rolling6-calculator itself.
      
      const validation = await validateBlockAssignment(
        driver,
        block,
        driverAllAssignments, // Historical (active + archived) for rolling-6, excluding soon-to-be-archived
        protectedRules,
        existingAssignments // Active-only for conflict detection
      );

      // Check for hard-stop issues: protected rules, conflicts, or DOT violations
      if (!validation.canAssign || validation.validationResult.validationStatus === "violation") {
        result.failed++;
        const errorMessages = [];

        if (validation.protectedRuleViolations.length > 0) {
          errorMessages.push(...validation.protectedRuleViolations);
        }
        if (validation.conflictingAssignments.length > 0) {
          errorMessages.push("Conflicting assignments exist");
        }
        if (validation.validationResult.validationStatus === "violation") {
          errorMessages.push(`DOT violation: ${validation.validationResult.messages.join(", ")}`);
        }

        result.errors.push(`Row ${rowNum}: ${errorMessages.join("; ")}`);
        
        // CRITICAL: Restore existing assignment to array if validation fails
        // This ensures later rows in the same import can still see this active assignment
        if (existingAssignment) {
          existingAssignments.push(existingAssignment);
        }
        
        continue;
      }

      // Track warnings
      if (validation.validationResult.validationStatus === "warning") {
        result.warnings.push(
          `Row ${rowNum}: Warning - ${validation.validationResult.messages.join(", ")}`
        );
      }

      // Queue assignment for atomic commit
      assignmentsToCommit.push({
        rowNum,
        blockId: block.id,
        driverId: driver.id,
        validationStatus: validation.validationResult.validationStatus,
        validationSummary: validation.validationResult.metrics
          ? JSON.stringify(validation.validationResult.metrics)
          : null,
        operatorId: row.operatorId,
        existingAssignmentId: existingAssignment?.id, // Track old assignment to archive after validation
      });

      // Track this assignment
      assignedBlocksInImport.add(block.id);
      if (!driverBlocksInImport.has(driver.id)) {
        driverBlocksInImport.set(driver.id, []);
      }
      driverBlocksInImport.get(driver.id)!.push(block.id);
    }

    // Phase 2: Atomically commit all valid assignments
    // CRITICAL: Wrap in transaction to prevent data loss if insert fails after archive
    try {
      await db.transaction(async (tx) => {
        for (const assignment of assignmentsToCommit) {
          // Archive old assignment AFTER validation but BEFORE inserting new one
          // Transaction ensures all-or-nothing: if insert fails, archive rolls back
          if (assignment.existingAssignmentId) {
            await tx
              .update(blockAssignments)
              .set({
                isActive: false,
                archivedAt: new Date(),
              })
              .where(eq(blockAssignments.id, assignment.existingAssignmentId));
          }
          
          await tx.insert(blockAssignments).values({
            tenantId,
            blockId: assignment.blockId,
            driverId: assignment.driverId,
            assignedBy: userId,
            validationStatus: assignment.validationStatus,
            validationSummary: assignment.validationSummary,
            notes: `Imported from Excel: ${assignment.operatorId}`,
            importBatchId: importBatchId, // Track which import created this assignment
            isActive: true, // Explicitly mark as active (new import)
          });

          // Update block status to assigned
          await tx
            .update(blocks)
            .set({ status: "assigned" })
            .where(eq(blocks.id, assignment.blockId));

          result.created++;
          
          if (assignment.validationStatus === "warning") {
            result.committedWithWarnings++;
          }
        }
      });
    } catch (error: any) {
      // Transaction rolled back - no data loss
      result.errors.push(`Database commit failed (transaction rolled back): ${error.message}`);
      result.failed = assignmentsToCommit.length - result.created;
    }

    return result;
  } catch (error: any) {
    // Return error details instead of throwing
    result.errors.push(`Import failed: ${error.message}`);
    return result;
  }
}
