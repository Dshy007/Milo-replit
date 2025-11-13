import { eq, and, gte, lte, inArray, sql as drizzleSql } from "drizzle-orm";
import { db } from "./db";
import { blocks, blockAssignments, drivers, contracts } from "@shared/schema";
import type { Block, BlockAssignment, Driver } from "@shared/schema";
import { validateRolling6Compliance, calculateDutyHours } from "./rolling6-calculator";
import { subDays, addDays, format } from "date-fns";

export interface CascadeAnalysisRequest {
  assignmentId: string; // The assignment we want to modify
  action: "swap" | "unassign" | "reassign";
  targetDriverId?: string; // Required for swap/reassign
}

export interface DriverWorkload {
  driverId: string;
  driver: Driver;
  totalHours24h: number;
  totalHours48h: number;
  assignmentCount: number;
  complianceStatus: "valid" | "warning" | "violation";
  complianceMessages: string[];
}

export interface CascadeAnalysisResult {
  canProceed: boolean;
  action: string;
  
  // The original assignment being modified
  sourceAssignment: BlockAssignment & { block: Block; driver: Driver };
  targetDriver?: Driver; // For swap/reassign actions
  targetAssignmentId?: string; // For swap actions - ID of the assignment to swap with
  
  // Before state
  before: {
    sourceDriverWorkload: DriverWorkload;
    targetDriverWorkload?: DriverWorkload;
  };
  
  // After state (proposed changes)
  after: {
    sourceDriverWorkload: DriverWorkload;
    targetDriverWorkload?: DriverWorkload;
  };
  
  // Overall compliance
  hasViolations: boolean;
  hasWarnings: boolean;
  blockingIssues: string[];
  warnings: string[];
}

/**
 * Calculate driver workload for a given time window
 */
async function calculateDriverWorkload(
  driver: Driver,
  centerDate: Date,
  assignments: Array<BlockAssignment & { block: Block }>,
  primaryBlockType?: string, // The block type we're analyzing (e.g., from the assignment being modified)
): Promise<DriverWorkload> {
  // Calculate 24h and 48h windows
  const start24h = subDays(centerDate, 1);
  const end24h = addDays(centerDate, 1);
  const start48h = subDays(centerDate, 2);
  const end48h = addDays(centerDate, 2);
  
  const totalHours24h = await calculateDutyHours(driver.id, start24h, end24h, assignments);
  const totalHours48h = await calculateDutyHours(driver.id, start48h, end48h, assignments);
  
  // Determine compliance status based on block type
  // Use the most recent assignment's type, or the provided primaryBlockType
  const driverType = primaryBlockType || 
    (assignments.length > 0 ? assignments[0].block.soloType : 'solo1');
  const normalizedType = driverType.toLowerCase().replace(/\s+/g, "");
  let complianceStatus: "valid" | "warning" | "violation" = "valid";
  const complianceMessages: string[] = [];
  
  if (normalizedType === "solo1") {
    if (totalHours24h > 14) {
      complianceStatus = "violation";
      complianceMessages.push(`VIOLATION: ${totalHours24h.toFixed(1)}h in 24h window (limit: 14h)`);
    } else if (totalHours24h >= 14 * 0.9) {
      complianceStatus = "warning";
      complianceMessages.push(`WARNING: ${totalHours24h.toFixed(1)}h in 24h window (approaching 14h limit)`);
    }
  } else if (normalizedType === "solo2") {
    if (totalHours48h > 20) {
      complianceStatus = "violation";
      complianceMessages.push(`VIOLATION: ${totalHours48h.toFixed(1)}h in 48h window (limit: 20h)`);
    } else if (totalHours48h >= 20 * 0.9) {
      complianceStatus = "warning";
      complianceMessages.push(`WARNING: ${totalHours48h.toFixed(1)}h in 48h window (approaching 20h limit)`);
    }
  }
  
  return {
    driverId: driver.id,
    driver,
    totalHours24h,
    totalHours48h,
    assignmentCount: assignments.length,
    complianceStatus,
    complianceMessages,
  };
}

/**
 * Analyze the cascade effects of a schedule change
 */
export async function analyzeCascadeEffect(
  tenantId: string,
  request: CascadeAnalysisRequest,
): Promise<CascadeAnalysisResult> {
  const { assignmentId, action, targetDriverId } = request;
  
  // 1. Fetch the source assignment (manually join block and driver since we don't have relations defined)
  const sourceAssignment = await db.query.blockAssignments.findFirst({
    where: and(
      eq(blockAssignments.id, assignmentId),
      eq(blockAssignments.tenantId, tenantId),
    ),
  });
  
  if (!sourceAssignment) {
    throw new Error("Assignment not found");
  }
  
  // Fetch the block and driver separately
  const sourceBlock = await db.query.blocks.findFirst({
    where: and(
      eq(blocks.id, sourceAssignment.blockId),
      eq(blocks.tenantId, tenantId),
    ),
  });
  
  const sourceDriver = await db.query.drivers.findFirst({
    where: and(
      eq(drivers.id, sourceAssignment.driverId),
      eq(drivers.tenantId, tenantId),
    ),
  });
  
  if (!sourceBlock || !sourceDriver) {
    throw new Error("Assignment block or driver not found");
  }
  
  const sourceAssignmentData = {
    ...sourceAssignment,
    block: sourceBlock,
    driver: sourceDriver,
  };
  
  const centerDate = new Date(sourceBlock.startTimestamp);
  
  // 2. Fetch target driver if needed
  let targetDriver: Driver | undefined;
  if ((action === "swap" || action === "reassign") && targetDriverId) {
    const targetDriverData = await db.query.drivers.findFirst({
      where: and(
        eq(drivers.id, targetDriverId),
        eq(drivers.tenantId, tenantId),
      ),
    });
    
    if (!targetDriverData) {
      throw new Error("Target driver not found");
    }
    
    targetDriver = targetDriverData;
  }
  
  // 3. Get all assignments in the relevant time window for both drivers
  const windowStart = subDays(centerDate, 3); // Wide window for analysis
  const windowEnd = addDays(centerDate, 3);
  
  // Fetch blocks in the time window
  const allBlocks = await db.query.blocks.findMany({
    where: and(
      eq(blocks.tenantId, tenantId),
      gte(blocks.startTimestamp, windowStart),
      lte(blocks.startTimestamp, windowEnd),
    ),
  });
  
  const blockIds = allBlocks.map(b => b.id);
  
  // Fetch assignments for these blocks (skip if no blocks in window)
  if (blockIds.length === 0) {
    return {
      canProceed: true,
      action,
      sourceAssignment: { ...sourceAssignmentData, block: sourceBlock, driver: sourceDriver },
      before: {
        sourceDriverWorkload: await calculateDriverWorkload(sourceDriver, centerDate, [], sourceBlock.soloType),
      },
      after: {
        sourceDriverWorkload: await calculateDriverWorkload(sourceDriver, centerDate, [], sourceBlock.soloType),
      },
      hasViolations: false,
      hasWarnings: false,
      blockingIssues: [],
      warnings: [],
    };
  }
  
  const allAssignments = await db.query.blockAssignments.findMany({
    where: and(
      eq(blockAssignments.tenantId, tenantId),
      inArray(blockAssignments.blockId, blockIds)
    ),
  });
  
  // Create a map of blocks by ID for fast lookup
  const blocksMap = new Map(allBlocks.map(b => [b.id, b]));
  
  // Manually join assignments with blocks
  const relevantAssignments = allAssignments
    .filter(a => blocksMap.has(a.blockId))
    .map(a => ({
      ...a,
      block: blocksMap.get(a.blockId)!,
    })) as Array<BlockAssignment & { block: Block }>;
  
  const sourceDriverAssignments = relevantAssignments.filter(
    a => a.driverId === sourceDriver.id
  );
  
  const targetDriverAssignments = targetDriver
    ? relevantAssignments.filter(a => a.driverId === targetDriver.id)
    : [];
  
  // 4. Calculate BEFORE state
  const beforeSource = await calculateDriverWorkload(sourceDriver, centerDate, sourceDriverAssignments, sourceBlock.soloType);
  const beforeTarget = targetDriver
    ? await calculateDriverWorkload(targetDriver, centerDate, targetDriverAssignments)
    : undefined;
  
  // 5. Simulate AFTER state based on action
  let afterSourceAssignments = [...sourceDriverAssignments];
  let afterTargetAssignments = targetDriver ? [...targetDriverAssignments] : [];
  
  const blockingIssues: string[] = [];
  const warnings: string[] = [];
  let swapTargetAssignmentId: string | undefined = undefined; // Track for swap actions
  
  if (action === "unassign") {
    // Remove the assignment from source driver
    afterSourceAssignments = afterSourceAssignments.filter(a => a.id !== assignmentId);
    warnings.push(`Block ${sourceBlock.blockId} will become unassigned`);
    
  } else if (action === "reassign" && targetDriver) {
    // Move assignment from source to target
    afterSourceAssignments = afterSourceAssignments.filter(a => a.id !== assignmentId);
    afterTargetAssignments.push({
      ...sourceAssignmentData,
      driverId: targetDriver.id,
      block: sourceBlock,
    } as BlockAssignment & { block: Block });
    
    // Validate target driver can take this assignment
    const validationResult = await validateRolling6Compliance(
      targetDriver,
      sourceBlock,
      afterTargetAssignments,
    );
    
    if (validationResult.validationStatus === "violation") {
      blockingIssues.push(...validationResult.messages);
    } else if (validationResult.validationStatus === "warning") {
      warnings.push(...validationResult.messages);
    }
    
  } else if (action === "swap" && targetDriver) {
    // Find target driver's assignment on the same day/time
    // For swap, we need to find a block that the target driver is working
    // This is simplified - in reality you'd select which specific assignment to swap
    const targetAssignment = targetDriverAssignments.find(a => {
      const blockStart = new Date(a.block.startTimestamp);
      return Math.abs(blockStart.getTime() - centerDate.getTime()) < 24 * 60 * 60 * 1000; // Same day
    });
    
    if (!targetAssignment) {
      blockingIssues.push(`Target driver ${targetDriver.firstName} ${targetDriver.lastName} has no assignment to swap on this date`);
    } else {
      // Track the target assignment ID for drift detection
      swapTargetAssignmentId = targetAssignment.id;
      // Swap: remove each driver's current assignment and add the other's
      afterSourceAssignments = afterSourceAssignments.filter(a => a.id !== assignmentId);
      afterSourceAssignments.push({
        ...targetAssignment,
        driverId: sourceDriver.id,
        block: targetAssignment.block,
      } as BlockAssignment & { block: Block });
      
      afterTargetAssignments = afterTargetAssignments.filter(a => a.id !== targetAssignment.id);
      afterTargetAssignments.push({
        ...sourceAssignmentData,
        driverId: targetDriver.id,
        block: sourceBlock,
      } as BlockAssignment & { block: Block });
      
      // Validate both drivers
      const sourceValidation = await validateRolling6Compliance(
        sourceDriver,
        targetAssignment.block,
        afterSourceAssignments,
      );
      
      const targetValidation = await validateRolling6Compliance(
        targetDriver,
        sourceBlock,
        afterTargetAssignments,
      );
      
      if (sourceValidation.validationStatus === "violation") {
        blockingIssues.push(...sourceValidation.messages);
      } else if (sourceValidation.validationStatus === "warning") {
        warnings.push(...sourceValidation.messages);
      }
      
      if (targetValidation.validationStatus === "violation") {
        blockingIssues.push(...targetValidation.messages);
      } else if (targetValidation.validationStatus === "warning") {
        warnings.push(...targetValidation.messages);
      }
    }
  }
  
  // 6. Calculate AFTER workloads
  const afterSource = await calculateDriverWorkload(sourceDriver, centerDate, afterSourceAssignments, sourceBlock.soloType);
  const afterTarget = targetDriver
    ? await calculateDriverWorkload(targetDriver, centerDate, afterTargetAssignments, sourceBlock.soloType)
    : undefined;
  
  // 7. Determine if we can proceed
  const hasViolations = blockingIssues.length > 0 ||
    afterSource.complianceStatus === "violation" ||
    (afterTarget?.complianceStatus === "violation");
  
  const hasWarnings = warnings.length > 0 ||
    afterSource.complianceStatus === "warning" ||
    (afterTarget?.complianceStatus === "warning");
  
  return {
    canProceed: !hasViolations,
    action,
    sourceAssignment: sourceAssignmentData as BlockAssignment & { block: Block; driver: Driver },
    targetDriver,
    targetAssignmentId: swapTargetAssignmentId, // Include for swap actions
    before: {
      sourceDriverWorkload: beforeSource,
      targetDriverWorkload: beforeTarget,
    },
    after: {
      sourceDriverWorkload: afterSource,
      targetDriverWorkload: afterTarget,
    },
    hasViolations,
    hasWarnings,
    blockingIssues,
    warnings,
  };
}

/**
 * Helper: Find a swap partner assignment for a given driver on the same day
 */
async function findSwapPartnerAssignment(
  tenantId: string,
  targetDriverId: string,
  centerDate: Date,
): Promise<(BlockAssignment & { block: Block }) | null> {
  const windowStart = subDays(centerDate, 1);
  const windowEnd = addDays(centerDate, 1);
  
  // Find blocks in the same day window
  const nearbyBlocks = await db.query.blocks.findMany({
    where: and(
      eq(blocks.tenantId, tenantId),
      gte(blocks.startTimestamp, windowStart),
      lte(blocks.startTimestamp, windowEnd),
    ),
  });
  
  if (nearbyBlocks.length === 0) return null;
  
  const blockIds = nearbyBlocks.map(b => b.id);
  
  // Find target driver's assignments for these blocks
  const targetAssignments = await db.query.blockAssignments.findMany({
    where: and(
      eq(blockAssignments.tenantId, tenantId),
      eq(blockAssignments.driverId, targetDriverId),
      inArray(blockAssignments.blockId, blockIds)
    ),
  });
  
  if (targetAssignments.length === 0) return null;
  
  // Join with blocks and find the closest one to centerDate
  const blocksMap = new Map(nearbyBlocks.map(b => [b.id, b]));
  
  const assignmentsWithBlocks = targetAssignments
    .filter(a => blocksMap.has(a.blockId))
    .map(a => ({
      ...a,
      block: blocksMap.get(a.blockId)!,
    }));
  
  if (assignmentsWithBlocks.length === 0) return null;
  
  // Find the assignment closest to centerDate
  const sorted = assignmentsWithBlocks.sort((a, b) => {
    const aDiff = Math.abs(new Date(a.block.startTimestamp).getTime() - centerDate.getTime());
    const bDiff = Math.abs(new Date(b.block.startTimestamp).getTime() - centerDate.getTime());
    return aDiff - bDiff;
  });
  
  return sorted[0] as BlockAssignment & { block: Block };
}

/**
 * Execute a cascade effect change (unassign, reassign, or swap)
 */
export async function executeCascadeChange(
  tenantId: string,
  request: CascadeAnalysisRequest & { expectedTargetAssignmentId?: string },
): Promise<{ success: boolean; message: string; updatedAssignments: string[] }> {
  const { assignmentId, action, targetDriverId, expectedTargetAssignmentId } = request;
  
  // Fetch the source assignment
  const sourceAssignment = await db.query.blockAssignments.findFirst({
    where: and(
      eq(blockAssignments.id, assignmentId),
      eq(blockAssignments.tenantId, tenantId),
    ),
  });
  
  if (!sourceAssignment) {
    throw new Error("Assignment not found");
  }
  
  // Fetch the block
  const sourceBlock = await db.query.blocks.findFirst({
    where: and(
      eq(blocks.id, sourceAssignment.blockId),
      eq(blocks.tenantId, tenantId),
    ),
  });
  
  if (!sourceBlock) {
    throw new Error("Block not found");
  }
  
  if (action === "unassign") {
    // Delete the assignment
    await db.delete(blockAssignments)
      .where(and(
        eq(blockAssignments.id, assignmentId),
        eq(blockAssignments.tenantId, tenantId),
      ));
    
    return {
      success: true,
      message: `Block ${sourceBlock.blockId} unassigned successfully`,
      updatedAssignments: [assignmentId],
    };
    
  } else if (action === "reassign" && targetDriverId) {
    // Update the assignment to the new driver
    await db.update(blockAssignments)
      .set({ driverId: targetDriverId })
      .where(and(
        eq(blockAssignments.id, assignmentId),
        eq(blockAssignments.tenantId, tenantId),
      ));
    
    return {
      success: true,
      message: `Block ${sourceBlock.blockId} reassigned successfully`,
      updatedAssignments: [assignmentId],
    };
    
  } else if (action === "swap" && targetDriverId) {
    // Find the target assignment to swap with
    const centerDate = new Date(sourceBlock.startTimestamp);
    const targetAssignment = await findSwapPartnerAssignment(tenantId, targetDriverId, centerDate);
    
    if (!targetAssignment) {
      throw new Error(`No assignment found for target driver on the same day`);
    }
    
    // Verify expected target assignment if provided (detect drift)
    if (expectedTargetAssignmentId && targetAssignment.id !== expectedTargetAssignmentId) {
      throw new Error(`Target assignment has changed since analysis. Please re-analyze.`);
    }
    
    // Execute swap in a transaction
    // Note: Drizzle doesn't have explicit transactions in query API, so we'll do sequential updates
    // In production, you'd want to use db.transaction() from drizzle-orm/pg-core
    
    await db.update(blockAssignments)
      .set({ driverId: targetDriverId })
      .where(and(
        eq(blockAssignments.id, sourceAssignment.id),
        eq(blockAssignments.tenantId, tenantId),
      ));
    
    await db.update(blockAssignments)
      .set({ driverId: sourceAssignment.driverId })
      .where(and(
        eq(blockAssignments.id, targetAssignment.id),
        eq(blockAssignments.tenantId, tenantId),
      ));
    
    return {
      success: true,
      message: `Assignments swapped successfully`,
      updatedAssignments: [sourceAssignment.id, targetAssignment.id],
    };
    
  } else {
    throw new Error(`Invalid action or missing targetDriverId`);
  }
}
