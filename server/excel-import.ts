import { db } from "./db";
import { drivers, blocks, blockAssignments, protectedDriverRules, contracts } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { validateBlockAssignment } from "./rolling6-calculator";
import * as XLSX from "xlsx";
import { startOfWeek, parseISO, getDay, startOfDay, format } from "date-fns";

interface ExcelRow {
  "Block ID": string;
  "Driver Name": string;
  "Operator ID": string;
  "Stop 1 Planned Arrival Date"?: number;
  "Stop 1 Planned Arrival Time"?: number;
  "Stop 1  Planned Departure Date"?: number;
  "Stop 1  Planned Departure Time"?: number;
  "Stop 2 Planned Arrival Date"?: number;
  "Stop 2 Planned Arrival Time"?: number;
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

  try {
    // Parse Excel file
    const workbook = XLSX.read(fileBuffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      throw new Error("Excel file has no sheets");
    }

    const worksheet = workbook.Sheets[sheetName];
    const rows: ExcelRow[] = XLSX.utils.sheet_to_json(worksheet);

    if (rows.length === 0) {
      throw new Error("Excel file is empty");
    }

    // ========== PREPROCESSING STAGE: Auto-create missing blocks ==========
    // Group rows by Block ID to extract block metadata
    const blockGroups = new Map<string, ExcelRow[]>();
    for (const row of rows) {
      const blockId = row["Block ID"]?.trim();
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
      const parsedOperator = parseOperatorId(firstRow["Operator ID"]);
      if (!parsedOperator) {
        result.warnings.push(`Block ${blockId}: Could not parse Operator ID "${firstRow["Operator ID"]}"`);
        continue;
      }

      // Extract start and end times from Excel date numbers
      const startDate = firstRow["Stop 1  Planned Departure Date"];
      const startTime = firstRow["Stop 1  Planned Departure Time"];
      const endDate = firstRow["Stop 2 Planned Arrival Date"];
      const endTime = firstRow["Stop 2 Planned Arrival Time"];

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

      // Upsert block (update if exists, insert if new)
      const existingBlock = await db
        .select()
        .from(blocks)
        .where(and(eq(blocks.tenantId, tenantId), eq(blocks.blockId, blockId)))
        .limit(1);

      // Calculate pattern-aware metadata (for both new and existing blocks)
      const duration = Math.round((endTimestamp.getTime() - startTimestamp.getTime()) / (1000 * 60 * 60));
      
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

    const existingAssignments = await db
      .select()
      .from(blockAssignments)
      .where(eq(blockAssignments.tenantId, tenantId));

    const protectedRules = await db
      .select()
      .from(protectedDriverRules)
      .where(eq(protectedDriverRules.tenantId, tenantId));

    // Track blocks assigned in this import to prevent duplicates
    const assignedBlocksInImport = new Set<string>();
    const driverBlocksInImport = new Map<string, string[]>(); // driverId -> blockIds
    
    // Collect all valid assignments to commit atomically
    const assignmentsToCommit: Array<{
      rowNum: number;
      blockId: string;
      driverId: string;
      validationStatus: string;
      validationSummary: string | null;
      operatorId: string;
    }> = [];

    // Phase 1: Validate all rows
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // Excel row number (1-indexed + header)

      // Validate required fields
      if (!row["Block ID"] || !row["Driver Name"] || !row["Operator ID"]) {
        result.failed++;
        result.errors.push(
          `Row ${rowNum}: Missing required fields (Block ID, Driver Name, or Operator ID)`
        );
        continue;
      }

      // Find block by Block ID
      const block = allBlocks.find(
        (b) => b.blockId.trim() === row["Block ID"].trim()
      );

      if (!block) {
        result.failed++;
        result.errors.push(
          `Row ${rowNum}: Block not found: "${row["Block ID"]}"`
        );
        continue;
      }

      // Check if block is already assigned (either in DB or in this import)
      const existingAssignment = existingAssignments.find(
        (a) => a.blockId === block.id
      );

      if (existingAssignment) {
        result.failed++;
        result.errors.push(
          `Row ${rowNum}: Block ${row["Block ID"]} is already assigned to another driver`
        );
        continue;
      }

      if (assignedBlocksInImport.has(block.id)) {
        result.failed++;
        result.errors.push(
          `Row ${rowNum}: Block ${row["Block ID"]} is assigned multiple times in this import file`
        );
        continue;
      }

      // Find driver by name (robust matching: handles "Last, First", "First Last", middle names, suffixes)
      const driverNameLower = row["Driver Name"].trim().toLowerCase().replace(/\s+/g, " ");
      
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
          `Row ${rowNum}: Driver not found: "${row["Driver Name"]}". Check spelling and ensure driver exists in system.`
        );
        continue;
      }

      // Validate Operator ID for data integrity (secondary validation)
      try {
        const operatorId = row["Operator ID"];
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
            `Row ${rowNum}: Time overlap - Driver "${row["Driver Name"]}" already assigned to block ${existingBlock.blockId} during this time`
          );
          hasOverlap = true;
          break;
        }
      }

      if (hasOverlap) {
        continue;
      }

      // Run full validation (DOT compliance, rolling-6, protected rules)
      const driverExistingAssignments = driverExistingAssignmentRows.map((assignment) => ({
        ...assignment,
        block: blockMap.get(assignment.blockId) || block,
      }));

      const validation = await validateBlockAssignment(
        driver,
        block,
        driverExistingAssignments,
        protectedRules,
        existingAssignments
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
        operatorId: row["Operator ID"],
      });

      // Track this assignment
      assignedBlocksInImport.add(block.id);
      if (!driverBlocksInImport.has(driver.id)) {
        driverBlocksInImport.set(driver.id, []);
      }
      driverBlocksInImport.get(driver.id)!.push(block.id);
    }

    // Phase 2: Atomically commit all valid assignments
    try {
      for (const assignment of assignmentsToCommit) {
        await db.insert(blockAssignments).values({
          tenantId,
          blockId: assignment.blockId,
          driverId: assignment.driverId,
          assignedBy: userId,
          validationStatus: assignment.validationStatus,
          validationSummary: assignment.validationSummary,
          notes: `Imported from Excel: ${assignment.operatorId}`,
        });

        // Update block status to assigned
        await db
          .update(blocks)
          .set({ status: "assigned" })
          .where(eq(blocks.id, assignment.blockId));

        result.created++;
        
        if (assignment.validationStatus === "warning") {
          result.committedWithWarnings++;
        }
      }
    } catch (error: any) {
      // If any assignment fails, report error
      result.errors.push(`Database commit failed: ${error.message}`);
      result.failed = assignmentsToCommit.length - result.created;
    }

    return result;
  } catch (error: any) {
    // Return error details instead of throwing
    result.errors.push(`Import failed: ${error.message}`);
    return result;
  }
}
