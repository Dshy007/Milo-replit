import { eq, and, gte, lte } from "drizzle-orm";
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
  
  // 1. Fetch the source assignment with all related data
  const sourceAssignmentData = await db.query.blockAssignments.findFirst({
    where: and(
      eq(blockAssignments.id, assignmentId),
      eq(blockAssignments.tenantId, tenantId),
    ),
    with: {
      block: true,
      driver: true,
    },
  });
  
  if (!sourceAssignmentData || !sourceAssignmentData.block || !sourceAssignmentData.driver) {
    throw new Error("Assignment not found or missing related data");
  }
  
  const sourceDriver = sourceAssignmentData.driver;
  const sourceBlock = sourceAssignmentData.block;
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
  
  const allBlocks = await db.query.blocks.findMany({
    where: and(
      eq(blocks.tenantId, tenantId),
      gte(blocks.startTimestamp, windowStart),
      lte(blocks.startTimestamp, windowEnd),
    ),
  });
  
  const allAssignments = await db.query.blockAssignments.findMany({
    where: eq(blockAssignments.tenantId, tenantId),
    with: {
      block: true,
      driver: true,
    },
  });
  
  // Filter to only assignments in our window with their blocks
  const relevantAssignments = allAssignments
    .filter(a => a.block && allBlocks.some(b => b.id === a.blockId))
    .map(a => a as BlockAssignment & { block: Block });
  
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
