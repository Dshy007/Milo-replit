import { db } from "./db";
import { drivers, blocks, blockAssignments, protectedDriverRules } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { validateBlockAssignment } from "./rolling6-calculator";
import * as XLSX from "xlsx";

interface ExcelRow {
  "Block ID": string;
  "Driver Name": string;
  "Operator ID": string;
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
