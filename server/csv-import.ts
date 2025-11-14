import { db } from "./db";
import { drivers, contracts, blocks, blockAssignments, protectedDriverRules } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { validateBlockAssignment, blockToAssignmentSubject } from "./rolling6-calculator";
import { format, getDay, startOfDay } from "date-fns";

interface CSVRow {
  "Driver Name": string;
  "Contract Name": string;
  "Solo Type": string;
  "Day of Week": string;
  "Start Time": string;
  "End Time": string;
}

interface ValidationResult {
  rowIndex: number;
  originalRow: CSVRow;
  status: "valid" | "warning" | "error";
  errors: string[];
  warnings: string[];
  driverId?: string;
  blockId?: string;
  contractName?: string;
  blockDisplayId?: string;
}

interface CommitResult {
  created: number;
  failed: number;
  errors: string[];
  warnings: string[];
  committedWithWarnings: number;
}

/**
 * Validate CSV rows for import
 * Expected CSV columns:
 * - Driver Name (e.g., "John Smith")
 * - Contract Name (e.g., "Freedom Transportation #1")
 * - Solo Type (e.g., "Solo1", "Solo2")
 * - Day of Week (e.g., "Monday", "Tuesday")
 * - Start Time (e.g., "08:00", "14:00")
 * - End Time (e.g., "16:00", "22:00")
 */
export async function validateCSVImport(
  tenantId: string,
  csvRows: CSVRow[]
): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];

  // Fetch all drivers and contracts for this tenant once (use select to avoid relation errors)
  const allDrivers = await db
    .select()
    .from(drivers)
    .where(eq(drivers.tenantId, tenantId));

  const allContracts = await db
    .select()
    .from(contracts)
    .where(eq(contracts.tenantId, tenantId));

  const allBlocks = await db
    .select()
    .from(blocks)
    .where(eq(blocks.tenantId, tenantId));

  // Get existing assignments for overlap checking
  const existingAssignments = await db
    .select()
    .from(blockAssignments)
    .where(eq(blockAssignments.tenantId, tenantId));

  for (let i = 0; i < csvRows.length; i++) {
    const row = csvRows[i];
    const result: ValidationResult = {
      rowIndex: i + 1,
      originalRow: row,
      status: "valid",
      errors: [],
      warnings: [],
    };

    // Validate required fields
    if (!row["Driver Name"]) {
      result.errors.push("Driver Name is required");
    }
    if (!row["Contract Name"]) {
      result.errors.push("Contract Name is required");
    }
    if (!row["Solo Type"]) {
      result.errors.push("Solo Type is required");
    }
    if (!row["Day of Week"]) {
      result.errors.push("Day of Week is required");
    }
    if (!row["Start Time"]) {
      result.errors.push("Start Time is required");
    }

    if (result.errors.length > 0) {
      result.status = "error";
      results.push(result);
      continue;
    }

    // Find driver by name (fuzzy match: firstName + lastName)
    const nameParts = row["Driver Name"].trim().split(" ");
    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(" ");

    const driver = allDrivers.find(
      (d) =>
        d.firstName.toLowerCase() === firstName.toLowerCase() &&
        d.lastName.toLowerCase() === lastName.toLowerCase()
    );

    if (!driver) {
      result.errors.push(
        `Driver not found: "${row["Driver Name"]}". Available drivers: ${allDrivers
          .map((d) => `${d.firstName} ${d.lastName}`)
          .slice(0, 5)
          .join(", ")}...`
      );
      result.status = "error";
      results.push(result);
      continue;
    }

    result.driverId = driver.id;

    // Find contract by name
    const contract = allContracts.find(
      (c) => c.name.toLowerCase() === row["Contract Name"].toLowerCase()
    );

    if (!contract) {
      result.errors.push(
        `Contract not found: "${row["Contract Name"]}". Available contracts: ${allContracts
          .map((c) => c.name)
          .slice(0, 5)
          .join(", ")}...`
      );
      result.status = "error";
      results.push(result);
      continue;
    }

    result.contractName = contract.name;

    // Normalize solo type
    const soloType = row["Solo Type"].toLowerCase().replace(/[\s-_]/g, "");

    // Parse day of week to number (0 = Sunday, 1 = Monday, etc.)
    const dayMap: Record<string, number> = {
      sunday: 0,
      monday: 1,
      tuesday: 2,
      wednesday: 3,
      thursday: 4,
      friday: 5,
      saturday: 6,
    };

    const dayOfWeek = dayMap[row["Day of Week"].toLowerCase()];
    if (dayOfWeek === undefined) {
      result.errors.push(
        `Invalid day of week: "${row["Day of Week"]}". Must be Sunday-Saturday`
      );
      result.status = "error";
      results.push(result);
      continue;
    }

    // Parse start time (HH:MM format)
    const timeMatch = row["Start Time"].match(/^(\d{1,2}):(\d{2})$/);
    if (!timeMatch) {
      result.errors.push(
        `Invalid start time format: "${row["Start Time"]}". Use HH:MM (e.g., 08:00, 14:00)`
      );
      result.status = "error";
      results.push(result);
      continue;
    }

    const startHour = parseInt(timeMatch[1]);
    const startMinute = parseInt(timeMatch[2]);

    // Find matching block
    const matchingBlock = allBlocks.find((b) => {
      if (b.contractId !== contract.id) return false;

      // Match solo type (normalize both sides)
      const blockSoloType = b.soloType.toLowerCase().replace(/[\s-_]/g, "");
      if (blockSoloType !== soloType) return false;

      // Match day of week
      const blockDayOfWeek = getDay(new Date(b.startTimestamp));
      if (blockDayOfWeek !== dayOfWeek) return false;

      // Match start time (hour:minute)
      const blockStart = new Date(b.startTimestamp);
      const blockHour = blockStart.getHours();
      const blockMinute = blockStart.getMinutes();

      return blockHour === startHour && blockMinute === startMinute;
    });

    if (!matchingBlock) {
      result.errors.push(
        `No matching block found for: ${row["Contract Name"]}, ${row["Solo Type"]}, ${row["Day of Week"]}, ${row["Start Time"]}`
      );
      result.status = "error";
      results.push(result);
      continue;
    }

    result.blockId = matchingBlock.id;
    result.blockDisplayId = matchingBlock.blockId;

    // Check if block is already assigned
    const existingAssignment = existingAssignments.find(
      (a) => a.blockId === matchingBlock.id
    );

    if (existingAssignment) {
      result.errors.push(
        `Block ${matchingBlock.blockId} is already assigned to another driver`
      );
      result.status = "error";
      results.push(result);
      continue;
    }

    // Check for driver overlaps (within this CSV and existing assignments)
    const driverAssignmentIds = existingAssignments
      .filter((a) => a.driverId === driver.id)
      .map((a) => a.blockId);
    
    const driverAssignmentBlocks = allBlocks.filter((b) =>
      driverAssignmentIds.includes(b.id)
    );

    // Also check within this CSV batch for overlaps
    const csvDriverAssignments = results
      .filter((r) => r.driverId === driver.id && r.blockId)
      .map((r) => {
        const block = allBlocks.find((b) => b.id === r.blockId);
        return block;
      })
      .filter((b): b is typeof allBlocks[0] => !!b);

    const allDriverBlocks = [
      ...driverAssignmentBlocks,
      ...csvDriverAssignments,
    ];

    for (const existingBlock of allDriverBlocks) {
      const overlap =
        new Date(matchingBlock.startTimestamp) <
          new Date(existingBlock.endTimestamp) &&
        new Date(matchingBlock.endTimestamp) >
          new Date(existingBlock.startTimestamp);

      if (overlap) {
        result.errors.push(
          `Time overlap: Driver already assigned to block ${existingBlock.blockId} (${format(
            new Date(existingBlock.startTimestamp),
            "MMM d, h:mma"
          )} - ${format(new Date(existingBlock.endTimestamp), "h:mma")})`
        );
        result.status = "error";
        continue;
      }
    }

    // Validate DOT compliance - need to fetch data for full validation (use select to avoid relation errors)
    const driverResults = await db
      .select()
      .from(drivers)
      .where(eq(drivers.id, driver.id))
      .limit(1);
    const driverObj = driverResults[0];

    if (!driverObj) {
      result.errors.push("Driver not found in database");
      result.status = "error";
      results.push(result);
      continue;
    }

    // Get protected rules for this tenant (use select instead of query to avoid relation errors)
    const fetchedProtectedRules = await db
      .select()
      .from(protectedDriverRules)
      .where(eq(protectedDriverRules.tenantId, tenantId));

    // Get existing assignments for this driver (without relations to avoid errors)
    const driverExistingAssignmentRows = await db
      .select()
      .from(blockAssignments)
      .where(and(
        eq(blockAssignments.tenantId, tenantId),
        eq(blockAssignments.driverId, driver.id)
      ));
    
    // Manually fetch blocks for these assignments
    const assignmentBlockIds = driverExistingAssignmentRows.map(a => a.blockId);
    const assignmentBlocks = assignmentBlockIds.length > 0
      ? await db.select().from(blocks).where(inArray(blocks.id, assignmentBlockIds))
      : [];
    
    // Create a map for fast lookup
    const blockMap = new Map(assignmentBlocks.map(b => [b.id, b]));
    
    // Create the combined structure manually
    const driverExistingAssignments = driverExistingAssignmentRows.map((assignment) => ({
      ...assignment,
      block: blockMap.get(assignment.blockId) || matchingBlock, // Use matching block as fallback
    }));

    // Get all block assignments for checking duplicates (use select to avoid relation errors)
    const allTenantAssignments = await db
      .select()
      .from(blockAssignments)
      .where(eq(blockAssignments.tenantId, tenantId));

    const validation = await validateBlockAssignment(
      driverObj,
      blockToAssignmentSubject(matchingBlock),
      driverExistingAssignments,
      fetchedProtectedRules,
      allTenantAssignments,
      matchingBlock.id
    );

    // Check for hard-stop issues: protected rules or conflicts
    if (!validation.canAssign) {
      if (validation.protectedRuleViolations.length > 0) {
        result.errors.push(...validation.protectedRuleViolations);
        result.status = "error";
      }
      if (validation.conflictingAssignments.length > 0) {
        result.errors.push(`Conflicting assignments exist`);
        result.status = "error";
      }
    }

    // Check DOT compliance - violations block, warnings allow with notice
    if (validation.validationResult.validationStatus === "violation") {
      result.errors.push(`DOT violation: ${validation.validationResult.messages.join(", ")}`);
      result.status = "error";
    } else if (validation.validationResult.validationStatus === "warning") {
      result.warnings.push(...validation.validationResult.messages);
      if (result.status !== "error") {
        result.status = "warning";
      }
    }

    results.push(result);
  }

  return results;
}

/**
 * Commit validated CSV rows to create block assignments
 */
export async function commitCSVImport(
  tenantId: string,
  validatedRows: ValidationResult[],
  userId?: string
): Promise<CommitResult> {
  const result: CommitResult = {
    created: 0,
    failed: 0,
    errors: [],
    warnings: [],
    committedWithWarnings: 0,
  };

  // Only commit rows with status "valid" or "warning"
  const rowsToCommit = validatedRows.filter(
    (r) => r.status === "valid" || r.status === "warning"
  );

  for (const row of rowsToCommit) {
    if (!row.driverId || !row.blockId) {
      result.failed++;
      result.errors.push(
        `Row ${row.rowIndex}: Missing driver or block ID`
      );
      continue;
    }

    try {
      // Re-validate before committing (in case data changed)
      const blockResults = await db
        .select()
        .from(blocks)
        .where(eq(blocks.id, row.blockId))
        .limit(1);
      const block = blockResults[0];

      if (!block) {
        result.failed++;
        result.errors.push(`Row ${row.rowIndex}: Block not found`);
        continue;
      }

      // Re-validate with full parameters (use select to avoid relation errors)
      const driverResults = await db
        .select()
        .from(drivers)
        .where(eq(drivers.id, row.driverId))
        .limit(1);
      const driverObj = driverResults[0];

      if (!driverObj) {
        result.failed++;
        result.errors.push(`Row ${row.rowIndex}: Driver not found`);
        continue;
      }

      const fetchedProtectedRules = await db
        .select()
        .from(protectedDriverRules)
        .where(eq(protectedDriverRules.tenantId, tenantId));

      // Get existing assignments for this driver (use select to avoid relation errors)
      const driverExistingAssignmentRows = await db
        .select()
        .from(blockAssignments)
        .where(and(
          eq(blockAssignments.tenantId, tenantId),
          eq(blockAssignments.driverId, row.driverId)
        ));
      
      // Manually fetch blocks for these assignments
      const assignmentBlockIds = driverExistingAssignmentRows.map(a => a.blockId);
      const assignmentBlocks = assignmentBlockIds.length > 0
        ? await db.select().from(blocks).where(inArray(blocks.id, assignmentBlockIds))
        : [];
      
      // Create a map for fast lookup
      const blockMap = new Map(assignmentBlocks.map(b => [b.id, b]));
      
      const driverExistingAssignments = driverExistingAssignmentRows.map((assignment) => ({
        ...assignment,
        block: blockMap.get(assignment.blockId) || block,
      }));

      const allTenantAssignments = await db
        .select()
        .from(blockAssignments)
        .where(eq(blockAssignments.tenantId, tenantId));

      const validation = await validateBlockAssignment(
        driverObj,
        blockToAssignmentSubject(block),
        driverExistingAssignments,
        fetchedProtectedRules,
        allTenantAssignments,
        block.id
      );

      // Block on hard-stops: protected rules, conflicts, or DOT violations
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
        
        result.errors.push(`Row ${row.rowIndex}: ${errorMessages.join("; ")}`);
        continue;
      }

      // Track warnings for committed rows
      if (validation.validationResult.validationStatus === "warning") {
        result.committedWithWarnings++;
        result.warnings.push(
          `Row ${row.rowIndex}: Committed with warning - ${validation.validationResult.messages.join(", ")}`
        );
      }

      await db.insert(blockAssignments).values({
        tenantId,
        blockId: row.blockId,
        driverId: row.driverId,
        assignedBy: userId,
        validationStatus: validation.validationResult.validationStatus,
        validationSummary: validation.validationResult.metrics
          ? JSON.stringify(validation.validationResult.metrics)
          : null,
        notes: `Imported from CSV`,
      });

      // Update block status to assigned
      await db
        .update(blocks)
        .set({ status: "assigned" })
        .where(eq(blocks.id, row.blockId));

      result.created++;
    } catch (error: any) {
      result.failed++;
      result.errors.push(
        `Row ${row.rowIndex}: ${error.message || "Unknown error"}`
      );
    }
  }

  return result;
}
