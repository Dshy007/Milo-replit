import { startOfWeek, endOfWeek, isSameDay, eachDayOfInterval } from "date-fns";
import type { Block, BlockAssignment, Driver, ProtectedDriverRule } from "@shared/schema";
import { validateBlockAssignment } from "./rolling6-calculator";

export interface WorkloadSummary {
  driverId: string;
  driverName: string;
  daysWorked: number;
  workloadLevel: "ideal" | "warning" | "critical" | "underutilized"; // 4=ideal, 5=warning, 6=critical, <4=underutilized
  totalHours: number;
  blocksThisWeek: string[]; // Block IDs
}

export interface SwapCandidate {
  driver: Driver;
  workload: WorkloadSummary;
  complianceStatus: "valid" | "warning" | "violation";
  complianceMessages: string[];
  complianceMetrics: Record<string, any>;
}

/**
 * Calculate days worked in a specific week (Sunday-Saturday) for a driver
 */
export async function calculateDaysWorkedInWeek(
  driverId: string,
  weekDate: Date, // Any date in the week
  assignments: Array<BlockAssignment & { block: Block }>
): Promise<number> {
  const weekStart = startOfWeek(weekDate, { weekStartsOn: 0 }); // Sunday
  const weekEnd = endOfWeek(weekDate, { weekStartsOn: 0 }); // Saturday
  
  // Get all days in the week
  const daysInWeek = eachDayOfInterval({ start: weekStart, end: weekEnd });
  
  // Find assignments for this driver in this week
  const driverAssignments = assignments.filter(a => a.driverId === driverId);
  
  // Count unique days where driver has blocks
  const workedDays = new Set<string>();
  
  for (const assignment of driverAssignments) {
    // startTimestamp is already a Date object from Drizzle
    const blockStart = new Date(assignment.block.startTimestamp);
    
    // Check if block starts within this week
    for (const day of daysInWeek) {
      if (isSameDay(blockStart, day)) {
        workedDays.add(day.toISOString().split('T')[0]); // Use date string as unique key
        break;
      }
    }
  }
  
  return workedDays.size;
}

/**
 * Calculate total hours worked in a specific week for a driver
 */
export async function calculateHoursWorkedInWeek(
  driverId: string,
  weekDate: Date,
  assignments: Array<BlockAssignment & { block: Block }>
): Promise<number> {
  const weekStart = startOfWeek(weekDate, { weekStartsOn: 0 });
  const weekEnd = endOfWeek(weekDate, { weekStartsOn: 0 });
  
  const driverAssignments = assignments.filter(a => a.driverId === driverId);
  
  let totalHours = 0;
  
  for (const assignment of driverAssignments) {
    // startTimestamp is already a Date object from Drizzle
    const blockStart = new Date(assignment.block.startTimestamp);
    
    // Only count blocks that start within this week
    if (blockStart >= weekStart && blockStart <= weekEnd) {
      totalHours += assignment.block.duration;
    }
  }
  
  return totalHours;
}

/**
 * Get workload summary for a driver for a specific week
 */
export async function getDriverWorkloadForWeek(
  driver: Driver,
  weekDate: Date,
  assignments: Array<BlockAssignment & { block: Block }>
): Promise<WorkloadSummary> {
  const daysWorked = await calculateDaysWorkedInWeek(driver.id, weekDate, assignments);
  const totalHours = await calculateHoursWorkedInWeek(driver.id, weekDate, assignments);
  
  // Determine workload level based on days worked
  let workloadLevel: WorkloadSummary["workloadLevel"];
  if (daysWorked === 4) {
    workloadLevel = "ideal";
  } else if (daysWorked === 5) {
    workloadLevel = "warning";
  } else if (daysWorked >= 6) {
    workloadLevel = "critical";
  } else {
    workloadLevel = "underutilized";
  }
  
  // Get block IDs for this week
  const weekStart = startOfWeek(weekDate, { weekStartsOn: 0 });
  const weekEnd = endOfWeek(weekDate, { weekStartsOn: 0 });
  const blocksThisWeek = assignments
    .filter(a => {
      if (a.driverId !== driver.id) return false;
      // startTimestamp is already a Date object from Drizzle
      const blockStart = new Date(a.block.startTimestamp);
      return blockStart >= weekStart && blockStart <= weekEnd;
    })
    .map(a => a.block.id);
  
  return {
    driverId: driver.id,
    driverName: `${driver.firstName} ${driver.lastName}`,
    daysWorked,
    workloadLevel,
    totalHours,
    blocksThisWeek,
  };
}

/**
 * Find eligible swap candidates for a specific block
 * Returns drivers who:
 * 1. Are NOT already assigned on that date
 * 2. Pass rolling-6 compliance validation
 * 3. Don't violate protected driver rules
 * 4. Ranked by workload (prioritize underutilized drivers)
 */
export async function findSwapCandidates(
  proposedBlock: Block,
  allDrivers: Driver[],
  allAssignments: Array<BlockAssignment & { block: Block }>,
  protectedRules: ProtectedDriverRule[]
): Promise<SwapCandidate[]> {
  // startTimestamp is already a Date object from Drizzle
  const blockDate = new Date(proposedBlock.startTimestamp);
  const candidates: SwapCandidate[] = [];
  
  for (const driver of allDrivers) {
    // Skip if driver is inactive or on leave
    if (driver.status !== "active") continue;
    
    // Check if driver is already assigned on this date
    const hasAssignmentOnDate = allAssignments.some(a => {
      if (a.driverId !== driver.id) return false;
      // startTimestamp is already a Date object from Drizzle
      const assignmentDate = new Date(a.block.startTimestamp);
      return isSameDay(assignmentDate, blockDate);
    });
    
    if (hasAssignmentOnDate) continue; // Skip - already working that day
    
    // Get driver's assignments for compliance checking
    const driverAssignments = allAssignments.filter(a => a.driverId === driver.id);
    
    // Get driver's protected rules
    const driverRules = protectedRules.filter(r => r.driverId === driver.id);
    
    // Validate compliance and protected rules
    const validationResult = await validateBlockAssignment(
      driver,
      proposedBlock,
      driverAssignments,
      driverRules,
      allAssignments
    );
    
    // Calculate workload for ranking
    const workload = await getDriverWorkloadForWeek(driver, blockDate, allAssignments);
    
    candidates.push({
      driver,
      workload,
      complianceStatus: validationResult.validationResult.validationStatus,
      complianceMessages: [
        ...validationResult.validationResult.messages,
        ...validationResult.protectedRuleViolations
      ],
      complianceMetrics: validationResult.validationResult.metrics,
    });
  }
  
  // Sort candidates by:
  // 1. Compliance status (valid > warning > violation)
  // 2. Workload level (underutilized > ideal > warning > critical)
  // 3. Days worked (ascending - prioritize drivers with fewer days)
  candidates.sort((a, b) => {
    // First by compliance
    const complianceOrder = { valid: 0, warning: 1, violation: 2 };
    const complianceDiff = complianceOrder[a.complianceStatus] - complianceOrder[b.complianceStatus];
    if (complianceDiff !== 0) return complianceDiff;
    
    // Then by workload level
    const workloadOrder = { underutilized: 0, ideal: 1, warning: 2, critical: 3 };
    const workloadDiff = workloadOrder[a.workload.workloadLevel] - workloadOrder[b.workload.workloadLevel];
    if (workloadDiff !== 0) return workloadDiff;
    
    // Finally by days worked (ascending)
    return a.workload.daysWorked - b.workload.daysWorked;
  });
  
  return candidates;
}

/**
 * Get workload summaries for all drivers for a specific week
 */
export async function getAllDriverWorkloads(
  drivers: Driver[],
  weekDate: Date,
  assignments: Array<BlockAssignment & { block: Block }>
): Promise<WorkloadSummary[]> {
  const workloads: WorkloadSummary[] = [];
  
  for (const driver of drivers) {
    const workload = await getDriverWorkloadForWeek(driver, weekDate, assignments);
    workloads.push(workload);
  }
  
  // Sort by workload level (critical first, then warning, ideal, underutilized)
  const workloadOrder = { critical: 0, warning: 1, ideal: 2, underutilized: 3 };
  workloads.sort((a, b) => workloadOrder[a.workloadLevel] - workloadOrder[b.workloadLevel]);
  
  return workloads;
}
