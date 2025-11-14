import { db } from "./db";
import { drivers, blocks, blockAssignments, protectedDriverRules, contracts, shiftTemplates, shiftOccurrences } from "@shared/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import { validateBlockAssignment, shiftOccurrenceToAssignmentSubject, blockToAssignmentSubject } from "./rolling6-calculator";
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
 * Normalize driver name by removing trailing suffixes and punctuation
 * Preserves legitimate names like "Junior Alvarez" and "Maria Senior"
 * 
 * Strategy:
 * - ALWAYS remove abbreviated suffixes (Jr, Sr, II, III, IV, V, 2nd, 3rd, 4th)
 * - ONLY remove full words (Junior, Senior) if they came after punctuation in original
 * 
 * Examples:
 * - "John Smith Jr" → "john smith"
 * - "Robert Dixon, Jr." → "robert dixon"
 * - "Mary Johnson III" → "mary johnson"
 * - "Junior Alvarez" → "junior alvarez" (preserved - no punctuation cue)
 * - "Maria Senior" → "maria senior" (preserved - Senior is surname)
 * - "Robert Charles, Senior" → "robert charles" (removed - came after comma)
 */
function normalizeDriverName(name: string): string {
  const original = name.trim().toLowerCase();
  
  // Check if original had punctuation before/after full-word suffixes
  // Only needed for "junior" and "senior" which could be legitimate names
  const hasFullWordSuffixWithPunctuation = /[,;:.][\s]*(junior|senior)[,;:.]?$/i.test(original);
  
  // Remove common punctuation (commas, periods, semicolons, colons)
  let normalized = original.replace(/[,;:.]/g, " ");
  
  // Collapse multiple spaces
  normalized = normalized.replace(/\s+/g, " ").trim();
  
  const words = normalized.split(" ");
  
  if (words.length > 1) {
    // Abbreviated suffixes - ALWAYS remove (almost never legitimate surnames)
    const abbreviatedSuffixes = ["jr", "sr", "ii", "iii", "iv", "v", "2nd", "3rd", "4th"];
    
    // Full-word suffixes - ONLY remove if punctuation detected (could be real names)
    const fullWordSuffixes = hasFullWordSuffixWithPunctuation ? ["junior", "senior"] : [];
    
    const allSuffixes = [...abbreviatedSuffixes, ...fullWordSuffixes];
    
    // Remove trailing suffixes
    while (words.length > 1 && allSuffixes.includes(words[words.length - 1])) {
      words.pop();
    }
  }
  
  return words.join(" ").trim();
}

/**
 * Parse Operator ID to extract contract type and tractor
 * 
 * Handles Amazon's format variations:
 * - "FTIM_MKC_Solo1_Tractor_2_d2" (standard)
 * - "FTIM_MKC_Solo 1_TRACTOR-02_d2" (space in type, dash in tractor)
 * - "FTIM_MKC_solo2_Tractor_5_d2" (lowercase)
 * 
 * Returns: { type: "solo1", tractorId: "Tractor_2" } or null if parsing fails
 */
function parseOperatorId(operatorId: string): { type: string; tractorId: string } | null {
  // Normalize: collapse multiple spaces to single space for consistent matching
  const normalized = operatorId.replace(/\s+/g, " ").trim();
  
  // Comprehensive pattern that handles Amazon variations:
  // - Contract type: Solo1, Solo 1, SOLO1, Solo2, Solo 2, SOLO2, Team, TEAM
  // - Tractor delimiter: _, -, or space
  // - Tractor format: Tractor_2, TRACTOR-02, Tractor 2, tractor02
  const pattern = /_(Solo\s*1|Solo\s*2|Team)[_\s-]+(Tractor|TRACTOR)[_\s-]*(\d+)/i;
  
  const match = normalized.match(pattern);
  if (!match) {
    // Failed to parse - return null so caller can log and skip
    return null;
  }
  
  const contractType = match[1].replace(/\s+/g, "").toLowerCase(); // "solo1", "solo2", "team"
  const tractorNumberRaw = match[3]; // Extracted digit(s)
  
  // Normalize tractor number: remove leading zeros to match existing contracts/blocks
  // "02" → "2", "10" → "10"
  // Special case: "00" is invalid, treat as parse failure
  const tractorNumberParsed = parseInt(tractorNumberRaw, 10);
  if (tractorNumberParsed === 0) {
    // Invalid tractor number (e.g., "00")
    return null;
  }
  
  const tractorNumber = String(tractorNumberParsed);
  
  return {
    type: contractType,
    tractorId: `Tractor_${tractorNumber}`,
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
    // Group rows by Block ID to extract contract metadata (shared across all days)
    const blockGroups = new Map<string, ExcelRow[]>();
    for (const row of rows) {
      const blockId = row.blockId?.trim();
      if (!blockId) continue;
      
      if (!blockGroups.has(blockId)) {
        blockGroups.set(blockId, []);
      }
      blockGroups.get(blockId)!.push(row);
    }

    // Track contracts found/created for each block tour (to avoid redundant lookups)
    const contractCache = new Map<string, typeof contracts.$inferSelect>();

    // Process each block tour: find/create contract, then create daily block occurrences
    for (const [blockId, blockRows] of Array.from(blockGroups.entries())) {
      const firstRow = blockRows[0];
      
      // Parse Operator ID to extract contract info (same for all days of the tour)
      const parsedOperator = parseOperatorId(firstRow.operatorId);
      if (!parsedOperator) {
        result.warnings.push(`Block ${blockId}: Could not parse Operator ID "${firstRow.operatorId}"`);
        continue;
      }

      // Find or create contract (shared across all daily occurrences of this tour)
      const contractKey = `${parsedOperator.type}:${parsedOperator.tractorId}`;
      let contract = contractCache.get(contractKey);
      
      if (!contract) {
        // Look up existing contract by (type + tractorId)
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
          // Auto-create contract from first row's timing data
          const startDate = firstRow.stop1PlannedStartDate;
          const startTime = firstRow.stop1PlannedStartTime;
          const endDate = firstRow.stop2PlannedArrivalDate;
          const endTime = firstRow.stop2PlannedArrivalTime;

          if (!startDate || !endDate || startTime === undefined || endTime === undefined) {
            result.warnings.push(`Block ${blockId}: Cannot auto-create contract - missing timing data in first row`);
            continue; // Skip entire tour if we can't create the contract
          }

          const startTimestamp = excelDateToJSDate(startDate, startTime);
          const endTimestamp = excelDateToJSDate(endDate, endTime);
          
          // Calculate duration from first block's timing data
          const duration = Math.round((endTimestamp.getTime() - startTimestamp.getTime()) / (1000 * 60 * 60));
          
          // Extract canonical start time from Excel (will be used as benchmark)
          const startHour = startTimestamp.getHours();
          const startMinute = startTimestamp.getMinutes();
          const startTimeStr = `${String(startHour).padStart(2, '0')}:${String(startMinute).padStart(2, '0')}`;
          
          // Determine baseRoutes based on contract type
          const baseRoutes = parsedOperator.type === "solo1" ? 10 : parsedOperator.type === "solo2" ? 7 : 5;
          
          // Construct contract name
          const contractName = `${parsedOperator.type.toUpperCase()} ${startTimeStr} ${parsedOperator.tractorId}`;
          
          // Create and persist contract to database
          const [newContract] = await db.insert(contracts).values({
            tenantId,
            name: contractName, // e.g., "SOLO1 16:30 Tractor_2"
            type: parsedOperator.type, // "solo1", "solo2", "team"
            tractorId: parsedOperator.tractorId, // "Tractor_1", "Tractor_2", etc.
            startTime: startTimeStr, // e.g., "16:30"
            duration, // Calculated from Excel timing
            baseRoutes, // 10 for solo1, 7 for solo2, 5 for team
            status: "active",
            domicile: "MKC", // Default domicile (can be updated later)
            daysPerWeek: 6, // Standard rolling 6-day pattern
            protectedDrivers: false,
          }).returning();
          
          // Log warning after successful creation
          result.warnings.push(
            `Block ${blockId}: Auto-created contract for ${parsedOperator.type.toUpperCase()} ${parsedOperator.tractorId} ` +
            `using timing data from Excel. Consider seeding this contract as a benchmark.`
          );
          
          // Use the newly created and persisted contract
          contract = newContract;
        } else {
          // Use existing contract
          if (existingContracts.length > 1) {
            // Multiple contracts found - data corruption, use first but warn
            result.warnings.push(
              `Block ${blockId}: Found ${existingContracts.length} contracts for ${parsedOperator.type.toUpperCase()} ${parsedOperator.tractorId}. ` +
              `This indicates data corruption. Using first match but database should be cleaned.`
            );
          }
          contract = existingContracts[0];
        }

        // Cache the contract for reuse
        contractCache.set(contractKey, contract);
      }

      // ========== BUILD PER-TOUR CANONICAL TIMELINE ==========
      // Validate contract has required metadata
      if (!contract.duration || !contract.startTime) {
        result.warnings.push(
          `Block ${blockId}: Contract ${contract.name} missing duration or startTime - cannot create blocks. ` +
          `Skipping entire tour.`
        );
        continue;
      }

      // Sort rows by Excel date, preserving original order when dates are missing
      const sortedRows = blockRows.slice().sort((a, b) => {
        const dateA = a.stop1PlannedStartDate;
        const dateB = b.stop1PlannedStartDate;
        
        // If both have dates, sort by date
        if (dateA && dateB) {
          return dateA - dateB;
        }
        
        // If either lacks a date, preserve original order (stable sort)
        // This keeps pre-baseline stubs before the anchor row
        return 0;
      });

      // Find first row with actual timing data to establish baseline
      const baselineIndex = sortedRows.findIndex(
        r => r.stop1PlannedStartDate && r.stop1PlannedStartTime !== undefined && 
             r.stop2PlannedArrivalDate && r.stop2PlannedArrivalTime !== undefined
      );

      if (baselineIndex === -1) {
        result.warnings.push(
          `Block ${blockId}: No valid timing data in any occurrence - cannot establish baseline. ` +
          `Skipping entire tour.`
        );
        continue;
      }

      const baselineRow = sortedRows[baselineIndex];

      // Calculate baseline canonical start (anchor for entire tour)
      const baselineActualStart = excelDateToJSDate(
        baselineRow.stop1PlannedStartDate!,
        baselineRow.stop1PlannedStartTime!
      );
      const baselinePatternGroup = detectPatternGroup(baselineActualStart, contract.startTime);
      const baselineCanonicalStart = calculateCanonicalStart(
        baselineActualStart,
        contract.startTime,
        baselinePatternGroup
      );

      // Build canonical timeline by advancing baseline by calendar days
      // CRITICAL: Use (i - baselineIndex) offset so days BEFORE baseline move backward
      const canonicalStarts: Date[] = sortedRows.map((_, i) => {
        const dayCanonicalStart = new Date(baselineCanonicalStart);
        dayCanonicalStart.setDate(dayCanonicalStart.getDate() + (i - baselineIndex));
        return dayCanonicalStart;
      });

      // Stage blocks in memory (commit only if entire tour succeeds)
      const stagedBlocks: Array<{
        serviceDate: Date;
        canonicalStart: Date;
        startTimestamp: Date;
        endTimestamp: Date;
        duration: number;
        patternGroup: "sunWed" | "wedSat";
        cycleId: string;
      }> = [];

      // Process each day using canonical timeline
      for (let i = 0; i < sortedRows.length; i++) {
        const row = sortedRows[i];
        const canonicalStart = canonicalStarts[i];
        
        // Service date is always start of canonical day
        const serviceDate = new Date(canonicalStart);
        serviceDate.setHours(0, 0, 0, 0);

        // Determine if row has actual Excel timing data
        const hasActualTiming =
          row.stop1PlannedStartDate && row.stop1PlannedStartTime !== undefined &&
          row.stop2PlannedArrivalDate && row.stop2PlannedArrivalTime !== undefined;

        let startTimestamp: Date;
        let endTimestamp: Date;

        if (hasActualTiming) {
          // Use actual Excel data
          startTimestamp = excelDateToJSDate(row.stop1PlannedStartDate!, row.stop1PlannedStartTime!);
          endTimestamp = excelDateToJSDate(row.stop2PlannedArrivalDate!, row.stop2PlannedArrivalTime!);

          // Warn if drift from canonical start exceeds 2 hours
          const driftHours = Math.abs(startTimestamp.getTime() - canonicalStart.getTime()) / (1000 * 60 * 60);
          if (driftHours > 2) {
            result.warnings.push(
              `Block ${blockId}, day ${i + 1}: Start time drifts ${driftHours.toFixed(1)}h from canonical ` +
              `(expected ~${canonicalStart.toLocaleTimeString()}). Check Excel data.`
            );
          }
        } else {
          // Synthesize from canonical start (works even if Excel date is missing)
          // The canonical timeline already provides the correct service date and start time
          result.warnings.push(
            `Block ${blockId}, day ${i + 1}: Missing timing data - synthesizing from canonical timeline`
          );
          
          startTimestamp = canonicalStart; // Already at contract start time
          endTimestamp = new Date(startTimestamp.getTime() + contract.duration * 60 * 60 * 1000);
        }

        // Calculate metadata for this occurrence
        const duration = Math.round((endTimestamp.getTime() - startTimestamp.getTime()) / (1000 * 60 * 60));
        const patternGroup = detectPatternGroup(canonicalStart, contract.startTime);
        const cycleId = generateCycleId(patternGroup, canonicalStart);

        // Stage this block
        stagedBlocks.push({
          serviceDate,
          canonicalStart,
          startTimestamp,
          endTimestamp,
          duration,
          patternGroup,
          cycleId,
        });
      }

      // Commit staged blocks if tour succeeded
      if (stagedBlocks.length === sortedRows.length) {
        for (const staged of stagedBlocks) {
          // Upsert block occurrence (keyed by blockId + serviceDate)
          const existingBlock = await db
            .select()
            .from(blocks)
            .where(
              and(
                eq(blocks.tenantId, tenantId),
                eq(blocks.blockId, blockId),
                eq(blocks.serviceDate, staged.serviceDate)
              )
            )
            .limit(1);

          if (existingBlock.length === 0) {
            // Create new block occurrence
            await db.insert(blocks).values({
              tenantId,
              blockId,
              serviceDate: staged.serviceDate,
              contractId: contract.id,
              soloType: parsedOperator.type,
              startTimestamp: staged.startTimestamp,
              endTimestamp: staged.endTimestamp,
              tractorId: parsedOperator.tractorId,
              duration: staged.duration,
              patternGroup: staged.patternGroup,
              canonicalStart: staged.canonicalStart,
              cycleId: staged.cycleId,
            });
          } else {
            // Update existing block occurrence
            await db
              .update(blocks)
              .set({
                contractId: contract.id,
                soloType: parsedOperator.type,
                startTimestamp: staged.startTimestamp,
                endTimestamp: staged.endTimestamp,
                tractorId: parsedOperator.tractorId,
                duration: staged.duration,
                patternGroup: staged.patternGroup,
                canonicalStart: staged.canonicalStart,
                cycleId: staged.cycleId,
              })
              .where(
                and(
                  eq(blocks.tenantId, tenantId),
                  eq(blocks.blockId, blockId),
                  eq(blocks.serviceDate, staged.serviceDate)
                )
              );
          }
        }
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
      // Normalize both Excel name and DB names to remove suffixes (Jr, Sr, III, etc.)
      const excelNameNormalized = normalizeDriverName(row.driverName);
      const excelNameLower = row.driverName.trim().toLowerCase().replace(/\s+/g, " ");
      
      const driver = allDrivers.find((d) => {
        const first = d.firstName.toLowerCase();
        const last = d.lastName.toLowerCase();
        
        // Normalize DB driver name (First Last)
        const dbNameNormalized = normalizeDriverName(`${d.firstName} ${d.lastName}`);
        
        // Try exact match after normalization (handles suffixes)
        if (dbNameNormalized === excelNameNormalized) return true;
        
        // Try exact match without normalization: "First Last"
        if (`${first} ${last}` === excelNameLower) return true;
        
        // Try "Last, First" format (common in Excel exports)
        if (`${last}, ${first}` === excelNameLower) return true;
        if (`${last},${first}` === excelNameLower) return true;
        
        // Try with middle names/suffixes: contains both first AND last (after normalization)
        const hasFirst = excelNameNormalized.includes(first);
        const hasLast = excelNameNormalized.includes(last);
        if (!hasFirst || !hasLast) return false;
        
        // Ensure proper ordering (First...Last or Last...First)
        const firstIndex = excelNameNormalized.indexOf(first);
        const lastIndex = excelNameNormalized.indexOf(last);
        return (firstIndex < lastIndex) || (excelNameNormalized.startsWith(last));
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

      // CRITICAL FIX: Fetch blocks for ALL driver assignments (active + archived)
      // This ensures rolling-6 calculations use correct historical block data
      const allDriverAssignmentIds = allAssignments
        .filter(a => a.driverId === driver.id && a.blockId !== null)
        .map(a => a.blockId!); // Filter nulls above, so ! is safe
      
      const assignmentBlocks = allDriverAssignmentIds.length > 0
        ? await db.select().from(blocks).where(inArray(blocks.id, allDriverAssignmentIds))
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
      const driverAllAssignments = driverAllAssignmentRows
        .filter(assignment => assignment.blockId !== null)
        .map((assignment) => ({
          ...assignment,
          block: blockMap.get(assignment.blockId!) || block, // Filter nulls above, so ! is safe
        }));

      // TODO: Refactor validateBlockAssignment to accept explicit activeAssignments and historicalAssignments
      // parameters instead of relying on single existingAssignments array. This will make the distinction
      // clear for all callers and prevent confusion. Update all 7 callers: excel-import, auto-assignment,
      // routes, auto-build-engine, csv-import, workload-calculator, rolling6-calculator itself.
      
      const validation = await validateBlockAssignment(
        driver,
        blockToAssignmentSubject(block), // Convert Block to AssignmentSubject
        driverAllAssignments, // Historical (active + archived) for rolling-6, excluding soon-to-be-archived
        protectedRules,
        existingAssignments, // Active-only for conflict detection
        block.id // Pass blockId for conflict checking
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

/**
 * NEW SHIFT-BASED EXCEL IMPORT (PRODUCTION-READY)
 * 
 * Key differences from legacy import:
 * - Groups by operatorId (stable) instead of blockId (transient)
 * - Creates shift_templates keyed by operatorId with proper upserts
 * - Creates shift_occurrences for each service date atomically
 * - Assigns drivers to shift_occurrences via shiftOccurrenceId (not blockId)
 * - Full transaction wrapping for atomicity
 * 
 * This allows weekly re-imports without breaking driver assignments,
 * since operatorId stays constant even when Amazon changes block IDs.
 */
export async function parseExcelScheduleShiftBased(
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

  const importBatchId = `import_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  try {
    // Parse Excel file (same as before)
    const workbook = XLSX.read(fileBuffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      throw new Error("Excel file has no sheets");
    }

    const worksheet = workbook.Sheets[sheetName];
    const allRows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    
    if (allRows.length < 2) {
      throw new Error("Excel file is empty or has no data rows");
    }
    
    const rawHeaders: string[] = allRows[0] as string[];
    const rawRows: any[] = XLSX.utils.sheet_to_json(worksheet);

    // Column normalization
    const columnMap = createColumnMap(rawHeaders);
    const requiredCanonicalKeys = [
      "blockId", // Still needed for reference/debugging
      "driverName",
      "operatorId", // PRIMARY KEY for shift templates
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
        `Missing required columns in Excel file. Could not find columns for: ${friendlyNames.join(", ")}.`
      );
    }
    
    const rows: ExcelRow[] = normalizeRows(rawRows, columnMap);

    // ========== GROUP BY OPERATOR ID (NEW APPROACH) ==========
    // operatorId is stable across weekly imports, blockId changes weekly
    const shiftGroups = new Map<string, ExcelRow[]>();
    for (const row of rows) {
      const operatorId = row.operatorId?.trim();
      if (!operatorId) continue;
      
      if (!shiftGroups.has(operatorId)) {
        shiftGroups.set(operatorId, []);
      }
      shiftGroups.get(operatorId)!.push(row);
    }

    const contractCache = new Map<string, typeof contracts.$inferSelect>();
    const templateCache = new Map<string, typeof shiftTemplates.$inferSelect>();

    // Process each shift tour (by operatorId)
    for (const [operatorId, shiftRows] of Array.from(shiftGroups.entries())) {
      const firstRow = shiftRows[0];
      
      // Parse Operator ID to extract contract info
      const parsedOperator = parseOperatorId(operatorId);
      if (!parsedOperator) {
        result.warnings.push(`Operator ${operatorId}: Could not parse operator ID format`);
        continue;
      }

      // Find or create contract (same as before)
      const contractKey = `${parsedOperator.type}:${parsedOperator.tractorId}`;
      let contract = contractCache.get(contractKey);
      
      if (!contract) {
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
          // Auto-create contract from timing data
          const startDate = firstRow.stop1PlannedStartDate;
          const startTime = firstRow.stop1PlannedStartTime;
          const endDate = firstRow.stop2PlannedArrivalDate;
          const endTime = firstRow.stop2PlannedArrivalTime;

          if (!startDate || !endDate || startTime === undefined || endTime === undefined) {
            result.warnings.push(`Operator ${operatorId}: Cannot auto-create contract - missing timing data`);
            continue;
          }

          const startTimestamp = excelDateToJSDate(startDate, startTime);
          const endTimestamp = excelDateToJSDate(endDate, endTime);
          const duration = Math.round((endTimestamp.getTime() - startTimestamp.getTime()) / (1000 * 60 * 60));
          const startHour = startTimestamp.getHours();
          const startMinute = startTimestamp.getMinutes();
          const startTimeStr = `${String(startHour).padStart(2, '0')}:${String(startMinute).padStart(2, '0')}`;
          const baseRoutes = parsedOperator.type === "solo1" ? 10 : parsedOperator.type === "solo2" ? 7 : 5;
          const contractName = `${parsedOperator.type.toUpperCase()} ${startTimeStr} ${parsedOperator.tractorId}`;
          
          const [newContract] = await db.insert(contracts).values({
            tenantId,
            name: contractName,
            type: parsedOperator.type,
            tractorId: parsedOperator.tractorId,
            startTime: startTimeStr,
            duration,
            baseRoutes,
            status: "active",
            domicile: "MKC",
            daysPerWeek: 6,
            protectedDrivers: false,
          }).returning();
          
          result.warnings.push(
            `Operator ${operatorId}: Auto-created contract ${contractName} from Excel timing data`
          );
          
          contract = newContract;
        } else {
          if (existingContracts.length > 1) {
            result.warnings.push(
              `Operator ${operatorId}: Found ${existingContracts.length} contracts - using first match`
            );
          }
          contract = existingContracts[0];
        }

        contractCache.set(contractKey, contract);
      }

      // ========== UPSERT SHIFT TEMPLATE (IDEMPOTENT) ==========
      // Use proper upsert to handle re-imports gracefully
      let template = templateCache.get(operatorId);
      
      if (!template) {
        if (!contract.duration || !contract.startTime) {
          result.warnings.push(`Operator ${operatorId}: Contract missing duration or startTime - cannot create template`);
          continue;
        }

        const firstRowWithTiming = shiftRows.find(
          r => r.stop1PlannedStartDate && r.stop1PlannedStartTime !== undefined
        );

        if (!firstRowWithTiming) {
          result.warnings.push(`Operator ${operatorId}: No timing data found - cannot determine pattern group`);
          continue;
        }

        const sampleStart = excelDateToJSDate(
          firstRowWithTiming.stop1PlannedStartDate!,
          firstRowWithTiming.stop1PlannedStartTime!
        );
        const patternGroup = detectPatternGroup(sampleStart, contract.startTime);

        // Upsert template: create if new, update if exists
        const [upsertedTemplate] = await db.insert(shiftTemplates).values({
          tenantId,
          operatorId,
          contractId: contract.id,
          canonicalStartTime: contract.startTime,
          defaultDuration: contract.duration,
          defaultTractorId: parsedOperator.tractorId,
          soloType: parsedOperator.type,
          patternGroup,
          status: "active",
          metadata: sql`'{}'::jsonb`,
        }).onConflictDoUpdate({
          target: [shiftTemplates.tenantId, shiftTemplates.operatorId],
          set: {
            contractId: sql`excluded.contract_id`,
            canonicalStartTime: sql`excluded.canonical_start_time`,
            defaultDuration: sql`excluded.default_duration`,
            defaultTractorId: sql`excluded.default_tractor_id`,
            soloType: sql`excluded.solo_type`,
            patternGroup: sql`excluded.pattern_group`,
            status: sql`excluded.status`,
          }
        }).returning();

        template = upsertedTemplate;
        templateCache.set(operatorId, template);
      }

      // ========== CREATE SHIFT OCCURRENCES FOR EACH SERVICE DATE ==========
      // Build canonical timeline (same logic as before)
      if (!contract.duration || !contract.startTime) {
        result.warnings.push(`Operator ${operatorId}: Contract missing metadata - skipping occurrences`);
        continue;
      }

      const sortedRows = shiftRows.slice().sort((a, b) => {
        const dateA = a.stop1PlannedStartDate;
        const dateB = b.stop1PlannedStartDate;
        if (dateA && dateB) return dateA - dateB;
        return 0;
      });

      const baselineIndex = sortedRows.findIndex(
        r => r.stop1PlannedStartDate && r.stop1PlannedStartTime !== undefined && 
             r.stop2PlannedArrivalDate && r.stop2PlannedArrivalTime !== undefined
      );

      if (baselineIndex === -1) {
        result.warnings.push(`Operator ${operatorId}: No valid timing data - skipping occurrences`);
        continue;
      }

      const baselineRow = sortedRows[baselineIndex];
      const baselineActualStart = excelDateToJSDate(
        baselineRow.stop1PlannedStartDate!,
        baselineRow.stop1PlannedStartTime!
      );
      const baselinePatternGroup = detectPatternGroup(baselineActualStart, contract.startTime);
      const baselineCanonicalStart = calculateCanonicalStart(
        baselineActualStart,
        contract.startTime,
        baselinePatternGroup
      );

      // Build canonical timeline
      const canonicalStarts: Date[] = sortedRows.map((_, i) => {
        const dayCanonicalStart = new Date(baselineCanonicalStart);
        dayCanonicalStart.setDate(dayCanonicalStart.getDate() + (i - baselineIndex));
        return dayCanonicalStart;
      });

      // Create shift occurrences for each day
      for (let i = 0; i < sortedRows.length; i++) {
        const row = sortedRows[i];
        const canonicalStart = canonicalStarts[i];
        
        // Service date as string (YYYY-MM-DD format for date type)
        const serviceDateObj = new Date(canonicalStart);
        serviceDateObj.setHours(0, 0, 0, 0);
        const serviceDateStr = format(serviceDateObj, "yyyy-MM-dd");

        const hasActualTiming =
          row.stop1PlannedStartDate && row.stop1PlannedStartTime !== undefined &&
          row.stop2PlannedArrivalDate && row.stop2PlannedArrivalTime !== undefined;

        let startTimestamp: Date;
        let endTimestamp: Date;

        if (hasActualTiming) {
          startTimestamp = excelDateToJSDate(row.stop1PlannedStartDate!, row.stop1PlannedStartTime!);
          endTimestamp = excelDateToJSDate(row.stop2PlannedArrivalDate!, row.stop2PlannedArrivalTime!);
        } else {
          result.warnings.push(`Operator ${operatorId}, day ${i + 1}: Synthesizing times from canonical`);
          startTimestamp = canonicalStart;
          endTimestamp = new Date(startTimestamp.getTime() + contract.duration * 60 * 60 * 1000);
        }

        const patternGroup = detectPatternGroup(canonicalStart, contract.startTime);
        const cycleId = generateCycleId(patternGroup, canonicalStart);

        // Upsert shift occurrence (idempotent for re-imports)
        await db.insert(shiftOccurrences).values({
          tenantId,
          templateId: template.id,
          serviceDate: serviceDateStr,
          scheduledStart: startTimestamp,
          scheduledEnd: endTimestamp,
          tractorId: parsedOperator.tractorId,
          externalBlockId: row.blockId,
          status: "unassigned",
          isCarryover: false,
          importBatchId,
          patternGroup,
          cycleId,
        }).onConflictDoUpdate({
          target: [shiftOccurrences.tenantId, shiftOccurrences.templateId, shiftOccurrences.serviceDate],
          set: {
            scheduledStart: sql`excluded.scheduled_start`,
            scheduledEnd: sql`excluded.scheduled_end`,
            tractorId: sql`excluded.tractor_id`,
            externalBlockId: sql`excluded.external_block_id`,
            patternGroup: sql`excluded.pattern_group`,
            cycleId: sql`excluded.cycle_id`,
          }
        });
      }
    }

    // ========== PHASE 2: ASSIGN DRIVERS TO SHIFT OCCURRENCES ==========
    
    // Fetch all drivers for driver name matching
    const allDrivers = await db
      .select()
      .from(drivers)
      .where(eq(drivers.tenantId, tenantId));

    // Fetch all shift occurrences for this import batch
    const allOccurrences = await db
      .select()
      .from(shiftOccurrences)
      .where(
        and(
          eq(shiftOccurrences.tenantId, tenantId),
          eq(shiftOccurrences.importBatchId, importBatchId)
        )
      );

    // Fetch ALL assignments (active + archived) for rolling-6 compliance
    const allAssignments = await db
      .select()
      .from(blockAssignments)
      .where(eq(blockAssignments.tenantId, tenantId));
    
    const existingAssignments = allAssignments.filter(a => a.isActive);

    const protectedRules = await db
      .select()
      .from(protectedDriverRules)
      .where(eq(protectedDriverRules.tenantId, tenantId));

    // Track assignments to commit
    const assignmentsToCommit: Array<{
      rowNum: number;
      occurrenceId: string;
      driverId: string;
      validationStatus: string;
      validationSummary: string | null;
      operatorId: string;
      existingAssignmentId?: string;
    }> = [];

    const processedOccurrences = new Set<string>();
    const assignedOccurrencesInImport = new Set<string>();

    // Validate and stage assignments
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2;

      if (!row.blockId || !row.driverName || !row.operatorId) {
        result.failed++;
        result.errors.push(`Row ${rowNum}: Missing required fields`);
        continue;
      }

      // Find shift occurrence by externalBlockId (Amazon's block ID)
      const occurrence = allOccurrences.find(
        o => o.externalBlockId === row.blockId.trim()
      );

      if (!occurrence) {
        result.failed++;
        result.errors.push(`Row ${rowNum}: Shift occurrence not found for block ${row.blockId}`);
        continue;
      }

      // Skip duplicates within this import
      if (processedOccurrences.has(occurrence.id)) {
        continue;
      }
      processedOccurrences.add(occurrence.id);

      // Check if occurrence already assigned
      const existingAssignment = existingAssignments.find(
        a => a.shiftOccurrenceId === occurrence.id
      );

      if (existingAssignment) {
        const assignmentIndex = existingAssignments.findIndex(a => a.id === existingAssignment.id);
        if (assignmentIndex !== -1) {
          existingAssignments.splice(assignmentIndex, 1);
        }
        result.warnings.push(`Row ${rowNum}: Shift ${row.blockId} was already assigned - will replace`);
      }

      if (assignedOccurrencesInImport.has(occurrence.id)) {
        result.failed++;
        result.errors.push(`Row ${rowNum}: Shift ${row.blockId} assigned multiple times in import`);
        continue;
      }

      // Find driver by name (same matching logic as legacy)
      const excelNameNormalized = normalizeDriverName(row.driverName);
      const excelNameLower = row.driverName.trim().toLowerCase().replace(/\s+/g, " ");
      
      const driver = allDrivers.find((d) => {
        const first = d.firstName.toLowerCase();
        const last = d.lastName.toLowerCase();
        const dbNameNormalized = normalizeDriverName(`${d.firstName} ${d.lastName}`);
        
        if (dbNameNormalized === excelNameNormalized) return true;
        if (`${first} ${last}` === excelNameLower) return true;
        if (`${last}, ${first}` === excelNameLower) return true;
        if (`${last},${first}` === excelNameLower) return true;
        
        const hasFirst = excelNameNormalized.includes(first);
        const hasLast = excelNameNormalized.includes(last);
        if (!hasFirst || !hasLast) return false;
        
        const firstIndex = excelNameNormalized.indexOf(first);
        const lastIndex = excelNameNormalized.indexOf(last);
        return (firstIndex < lastIndex) || (excelNameNormalized.startsWith(last));
      });

      if (!driver) {
        result.failed++;
        result.errors.push(`Row ${rowNum}: Driver not found: "${row.driverName}"`);
        continue;
      }

      // Get driver's existing assignments with block data for validation
      const driverAssignmentsWithBlocks: Array<typeof blockAssignments.$inferSelect & { block: typeof blocks.$inferSelect }> = [];
      
      for (const assignment of existingAssignments.filter(a => a.driverId === driver.id && a.blockId !== null)) {
        const block = await db.select().from(blocks).where(eq(blocks.id, assignment.blockId!)).limit(1);
        if (block.length > 0) {
          driverAssignmentsWithBlocks.push({ ...assignment, block: block[0] });
        }
      }

      // Fetch template for shift occurrence metadata
      const occurrenceTemplate = await db
        .select()
        .from(shiftTemplates)
        .where(eq(shiftTemplates.id, occurrence.templateId))
        .limit(1);

      if (occurrenceTemplate.length === 0) {
        result.failed++;
        result.errors.push(`Row ${rowNum}: Template not found for occurrence`);
        continue;
      }

      const template = occurrenceTemplate[0];

      // Convert shift occurrence to AssignmentSubject using adapter
      // CRITICAL: Template provides Contract Slot metadata (operatorId, tractorId, soloType, time)
      const assignmentSubject = shiftOccurrenceToAssignmentSubject(occurrence, template);

      // Validate assignment using minimal interface (no blockId needed for shift occurrences)
      const validation = await validateBlockAssignment(
        driver,
        assignmentSubject,
        driverAssignmentsWithBlocks,
        protectedRules,
        allAssignments
        // Note: No blockId parameter - shift occurrences don't need conflict checking
      );

      if (!validation.canAssign) {
        result.failed++;
        const errorMsg = validation.protectedRuleViolations.length > 0
          ? validation.protectedRuleViolations.join("; ")
          : validation.validationResult.messages.join("; ") || "Assignment validation failed";
        result.errors.push(`Row ${rowNum}: ${errorMsg}`);
        continue;
      }

      // Determine validation status and summary from ValidationResult
      const validationStatus = validation.validationResult.validationStatus;
      const validationSummary = validation.validationResult.messages.join("; ") || "OK";

      // Stage for commit
      assignmentsToCommit.push({
        rowNum,
        occurrenceId: occurrence.id,
        driverId: driver.id,
        validationStatus,
        validationSummary,
        operatorId: row.operatorId,
        existingAssignmentId: existingAssignment?.id,
      });

      assignedOccurrencesInImport.add(occurrence.id);

      if (validationStatus === "warning") {
        result.warnings.push(`Row ${rowNum}: ${validationSummary}`);
      }
    }

    // Commit all valid assignments in transaction
    try {
      await db.transaction(async (tx) => {
        for (const assignment of assignmentsToCommit) {
          // Archive old assignment if exists
          if (assignment.existingAssignmentId) {
            await tx
              .update(blockAssignments)
              .set({
                isActive: false,
                archivedAt: new Date(),
              })
              .where(eq(blockAssignments.id, assignment.existingAssignmentId));
          }
          
          // Create new assignment with shiftOccurrenceId
          await tx.insert(blockAssignments).values({
            tenantId,
            shiftOccurrenceId: assignment.occurrenceId, // NEW: use shiftOccurrenceId
            blockId: null, // Legacy field, not used
            driverId: assignment.driverId,
            assignedBy: userId,
            validationStatus: assignment.validationStatus,
            validationSummary: assignment.validationSummary,
            notes: `Shift-based import: ${assignment.operatorId}`,
            importBatchId,
            isActive: true,
          });

          // Update occurrence status to assigned
          await tx
            .update(shiftOccurrences)
            .set({ status: "assigned" })
            .where(eq(shiftOccurrences.id, assignment.occurrenceId));

          result.created++;
          
          if (assignment.validationStatus === "warning") {
            result.committedWithWarnings++;
          }
        }
      });
    } catch (error: any) {
      result.errors.push(`Database commit failed (transaction rolled back): ${error.message}`);
      result.failed = assignmentsToCommit.length - result.created;
    }

    return result;
  } catch (error: any) {
    result.errors.push(`Shift-based import failed: ${error.message}`);
    return result;
  }
}
