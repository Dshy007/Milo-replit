/**
 * Schedule Engine - Auto-Assignment Algorithm & Constraint Validation
 *
 * This module handles:
 * - Auto-assignment of drivers to blocks
 * - DOT compliance validation
 * - Gap detection
 * - Swap validation
 * - Workload calculations
 */

import {
  DriverProfile,
  ReconstructedBlock,
  AssignedBlock,
  AssignmentType,
  ComplianceViolation,
  ComplianceReport,
  DriverWorkload,
  WatchItem,
  UnassignedBlock,
  ScheduleStats,
  FinalSchedule,
  SwapRequest,
  SwapValidation,
  AvailableDriver,
  DOT_RULES,
  DayOfWeek,
  BlockType,
  getDayIndex,
  getDayOfWeek,
  DAY_ORDER,
} from "./schedule-types";

// =============================================================================
// TIME UTILITIES
// =============================================================================

/**
 * Parse time string to minutes from midnight
 */
function parseTimeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + (minutes || 0);
}

/**
 * Calculate time difference in hours
 */
function getTimeDifferenceHours(time1: string, time2: string): number {
  const minutes1 = parseTimeToMinutes(time1);
  const minutes2 = parseTimeToMinutes(time2);
  return Math.abs(minutes1 - minutes2) / 60;
}

/**
 * Parse date string to Date object
 */
function parseDate(dateStr: string): Date {
  return new Date(dateStr + "T00:00:00");
}

/**
 * Get hours between two datetime combinations
 */
function getHoursBetween(
  date1: string,
  time1: string,
  date2: string,
  time2: string
): number {
  const d1 = new Date(`${date1}T${time1}:00`);
  const d2 = new Date(`${date2}T${time2}:00`);
  return Math.abs(d2.getTime() - d1.getTime()) / (1000 * 60 * 60);
}

/**
 * Add hours to a datetime
 */
function addHoursToDateTime(date: string, time: string, hours: number): Date {
  const d = new Date(`${date}T${time}:00`);
  d.setTime(d.getTime() + hours * 60 * 60 * 1000);
  return d;
}

// =============================================================================
// MATCHING SCORE CALCULATION
// =============================================================================

interface MatchScore {
  score: number;
  type: AssignmentType;
  reason: string;
}

/**
 * Calculate match score between a driver and a block
 */
function calculateMatchScore(
  driver: DriverProfile,
  block: ReconstructedBlock,
  existingAssignments: AssignedBlock[]
): MatchScore | null {
  // Check if driver can work this block type
  if (
    driver.soloType !== "both" &&
    driver.soloType !== block.blockType &&
    block.blockType !== "team"
  ) {
    return null;
  }

  // Check DOT compliance before scoring
  const violations = checkDriverCompliance(driver, block, existingAssignments);
  const hasErrors = violations.some((v) => v.severity === "error");
  if (hasErrors) {
    return null;
  }

  const dayMatches = driver.preferredDays.includes(block.dayOfWeek);
  const timeDiff = getTimeDifferenceHours(driver.canonicalTime, block.startTime);

  // Exact match: Same day + same time (±15 min)
  if (dayMatches && timeDiff <= 0.25) {
    return {
      score: 100,
      type: "exact_match",
      reason: `Exact match: ${driver.name} prefers ${block.dayOfWeek} at ${driver.canonicalTime}`,
    };
  }

  // Close match: Same day + time within ±2 hours
  if (dayMatches && timeDiff <= DOT_RULES[block.blockType].bumpTolerance) {
    return {
      score: 85 - timeDiff * 5,
      type: "close_match",
      reason: `Close match: ${timeDiff.toFixed(1)}h from preferred time`,
    };
  }

  // Pattern match: Driver's pattern day + compatible time
  if (dayMatches) {
    return {
      score: 70 - timeDiff * 2,
      type: "pattern_match",
      reason: `Pattern match: preferred day, ${timeDiff.toFixed(1)}h time difference`,
    };
  }

  // Cross-trained: Check if driver is flex (can do both types)
  if (driver.soloType === "both") {
    return {
      score: 50 - timeDiff * 2,
      type: "cross_trained",
      reason: `Cross-trained driver available`,
    };
  }

  // Standby: Any available driver
  if (driver.status === "active") {
    return {
      score: 30 - timeDiff,
      type: "standby",
      reason: `Standby assignment`,
    };
  }

  return null;
}

// =============================================================================
// DOT COMPLIANCE CHECKS
// =============================================================================

/**
 * Check all DOT compliance rules for a driver assignment
 */
function checkDriverCompliance(
  driver: DriverProfile,
  newBlock: ReconstructedBlock,
  existingAssignments: AssignedBlock[]
): ComplianceViolation[] {
  const violations: ComplianceViolation[] = [];
  const driverBlocks = existingAssignments.filter(
    (b) => b.driverId === driver.id
  );
  const rules = DOT_RULES[newBlock.blockType];

  // Count blocks this week for this driver
  const weeklyCount = driverBlocks.length;
  if (weeklyCount >= rules.maxPerWeek) {
    violations.push({
      type: "weekly_maximum",
      severity: "error",
      message: `${driver.name} already has ${weeklyCount}/${rules.maxPerWeek} ${newBlock.blockType} blocks this week`,
      details: {
        driverId: driver.id,
        blockId: newBlock.blockId,
        actualValue: weeklyCount,
        requiredValue: rules.maxPerWeek,
      },
    });
  }

  // Check Solo2 48-hour start-to-start gap
  if (newBlock.blockType === "solo2") {
    for (const existing of driverBlocks) {
      if (existing.blockType === "solo2") {
        const hoursBetween = getHoursBetween(
          existing.date,
          existing.startTime,
          newBlock.date,
          newBlock.startTime
        );
        if (hoursBetween < DOT_RULES.solo2.minStartToStartGap) {
          violations.push({
            type: "insufficient_gap",
            severity: "error",
            message: `Solo2 requires 48h between starts. ${driver.name} has only ${hoursBetween.toFixed(1)}h gap`,
            details: {
              driverId: driver.id,
              blockId: newBlock.blockId,
              actualValue: hoursBetween,
              requiredValue: DOT_RULES.solo2.minStartToStartGap,
            },
          });
        }
      }
    }
  }

  // Check Solo1 10-hour rest
  if (newBlock.blockType === "solo1") {
    for (const existing of driverBlocks) {
      // Calculate end time of existing block
      const existingEnd = addHoursToDateTime(
        existing.date,
        existing.startTime,
        DOT_RULES[existing.blockType].blockDuration
      );
      const newStart = new Date(`${newBlock.date}T${newBlock.startTime}:00`);
      const restHours =
        (newStart.getTime() - existingEnd.getTime()) / (1000 * 60 * 60);

      if (restHours > 0 && restHours < DOT_RULES.solo1.minRestBetweenShifts) {
        violations.push({
          type: "insufficient_rest",
          severity: "error",
          message: `Solo1 requires 10h rest. ${driver.name} has only ${restHours.toFixed(1)}h rest`,
          details: {
            driverId: driver.id,
            blockId: newBlock.blockId,
            actualValue: restHours,
            requiredValue: DOT_RULES.solo1.minRestBetweenShifts,
          },
        });
      }
    }
  }

  // Check consecutive days (max 6)
  const daysWorked = new Set(driverBlocks.map((b) => b.dayOfWeek));
  daysWorked.add(newBlock.dayOfWeek);

  // Calculate consecutive days by checking continuous runs
  const consecutiveDays = calculateConsecutiveDays([...daysWorked]);
  if (consecutiveDays > DOT_RULES.solo1.maxConsecutiveDays) {
    violations.push({
      type: "max_consecutive_days",
      severity: "error",
      message: `${driver.name} would work ${consecutiveDays} consecutive days (max 6)`,
      details: {
        driverId: driver.id,
        blockId: newBlock.blockId,
        actualValue: consecutiveDays,
        requiredValue: DOT_RULES.solo1.maxConsecutiveDays,
      },
    });
  }

  // Check time bump tolerance
  const timeDiff = getTimeDifferenceHours(driver.canonicalTime, newBlock.startTime);
  if (timeDiff > rules.bumpTolerance) {
    violations.push({
      type: "time_bump_exceeded",
      severity: "warning",
      message: `${newBlock.startTime} is ${timeDiff.toFixed(1)}h from ${driver.name}'s canonical time (${driver.canonicalTime})`,
      details: {
        driverId: driver.id,
        blockId: newBlock.blockId,
        actualValue: timeDiff,
        requiredValue: rules.bumpTolerance,
      },
    });
  }

  return violations;
}

/**
 * Calculate maximum consecutive days from a set of days
 */
function calculateConsecutiveDays(days: DayOfWeek[]): number {
  if (days.length === 0) return 0;
  if (days.length === 1) return 1;

  const indices = days.map(getDayIndex).sort((a, b) => a - b);
  let maxConsecutive = 1;
  let currentConsecutive = 1;

  for (let i = 1; i < indices.length; i++) {
    // Check for consecutive (including wrap from Sat to Sun)
    if (indices[i] === indices[i - 1] + 1) {
      currentConsecutive++;
      maxConsecutive = Math.max(maxConsecutive, currentConsecutive);
    } else if (indices[i] !== indices[i - 1]) {
      currentConsecutive = 1;
    }
  }

  // Check wrap-around (Saturday to Sunday)
  if (indices.includes(0) && indices.includes(6)) {
    let wrapCount = 1;
    for (let i = 1; i < 7 && indices.includes(i); i++) {
      wrapCount++;
    }
    for (let i = 5; i >= 0 && indices.includes(i); i--) {
      wrapCount++;
    }
    // Subtract 1 because we counted the connection point twice
    wrapCount--;
    maxConsecutive = Math.max(maxConsecutive, wrapCount);
  }

  return maxConsecutive;
}

// =============================================================================
// AUTO-ASSIGNMENT ALGORITHM
// =============================================================================

export interface AutoAssignResult {
  assignments: AssignedBlock[];
  unassigned: UnassignedBlock[];
  stats: ScheduleStats;
}

/**
 * Auto-assign drivers to blocks using priority matching
 */
export function autoAssignDrivers(
  blocks: ReconstructedBlock[],
  drivers: DriverProfile[]
): AutoAssignResult {
  // Sort blocks by date and time
  const sortedBlocks = [...blocks].sort((a, b) => {
    const dateCompare = a.date.localeCompare(b.date);
    if (dateCompare !== 0) return dateCompare;
    return a.startTime.localeCompare(b.startTime);
  });

  const activeDrivers = drivers.filter((d) => d.status === "active");
  const assignments: AssignedBlock[] = [];
  const unassigned: UnassignedBlock[] = [];

  for (const block of sortedBlocks) {
    // Find all eligible drivers with scores
    const candidates: { driver: DriverProfile; match: MatchScore }[] = [];

    for (const driver of activeDrivers) {
      const match = calculateMatchScore(driver, block, assignments);
      if (match) {
        candidates.push({ driver, match });
      }
    }

    // Sort by score (highest first)
    candidates.sort((a, b) => b.match.score - a.match.score);

    if (candidates.length > 0) {
      const best = candidates[0];
      const assignedBlock: AssignedBlock = {
        ...block,
        driverId: best.driver.id,
        driverName: best.driver.name,
        assignmentType: best.match.type,
        assignmentScore: best.match.score,
        conflicts: checkDriverCompliance(best.driver, block, assignments).filter(
          (v) => v.severity === "warning"
        ),
      };
      assignments.push(assignedBlock);
    } else {
      // No eligible driver found
      const suggestedDrivers = activeDrivers
        .map((driver) => {
          const violations = checkDriverCompliance(driver, block, assignments);
          return {
            driverId: driver.id,
            driverName: driver.name,
            score: violations.length === 0 ? 50 : 0,
            reason:
              violations.length > 0
                ? violations[0].message
                : "Available but not preferred match",
          };
        })
        .filter((s) => s.score > 0)
        .slice(0, 3);

      unassigned.push({
        block: block,
        reason: "No eligible driver found",
        suggestedDrivers,
      });

      // Still add to assignments as unassigned
      assignments.push({
        ...block,
        driverId: null,
        driverName: null,
        assignmentType: "unassigned",
        assignmentScore: 0,
        conflicts: [],
      });
    }
  }

  return {
    assignments,
    unassigned,
    stats: calculateStats(assignments),
  };
}

// =============================================================================
// WORKLOAD CALCULATIONS
// =============================================================================

/**
 * Calculate workload for all drivers
 */
export function calculateWorkloads(
  assignments: AssignedBlock[],
  drivers: DriverProfile[]
): DriverWorkload[] {
  return drivers
    .filter((d) => d.status === "active")
    .map((driver) => {
      const driverBlocks = assignments.filter((b) => b.driverId === driver.id);
      const daysWorked = [...new Set(driverBlocks.map((b) => b.dayOfWeek))];
      const consecutiveDays = calculateConsecutiveDays(daysWorked);
      const estimatedPay = driverBlocks.reduce((sum, b) => sum + b.estimatedPay, 0);
      const maxBlocks = driver.maxWeeklyRuns;
      const isAtMax = driverBlocks.length >= maxBlocks;

      const warnings: string[] = [];
      if (isAtMax) {
        warnings.push(`At maximum (${maxBlocks} blocks)`);
      }
      if (consecutiveDays >= 5) {
        warnings.push(`${consecutiveDays} consecutive days`);
      }
      if (driverBlocks.length >= maxBlocks - 1 && !isAtMax) {
        warnings.push(`Approaching max (${driverBlocks.length}/${maxBlocks})`);
      }

      return {
        driverId: driver.id,
        driverName: driver.name,
        soloType: driver.soloType,
        assignedBlocks: driverBlocks,
        totalBlocks: driverBlocks.length,
        maxBlocks,
        daysWorked,
        consecutiveDays,
        estimatedPay,
        isAtMax,
        warnings,
      };
    })
    .sort((a, b) => b.totalBlocks - a.totalBlocks);
}

/**
 * Generate watch list for drivers needing attention
 */
export function generateWatchList(workloads: DriverWorkload[]): WatchItem[] {
  const watchList: WatchItem[] = [];

  for (const workload of workloads) {
    if (workload.isAtMax) {
      watchList.push({
        driverId: workload.driverId,
        driverName: workload.driverName,
        type: "at_max",
        message: `${workload.totalBlocks} ${workload.soloType} blocks = MAX`,
        severity: "critical",
      });
    } else if (workload.totalBlocks >= workload.maxBlocks - 1) {
      watchList.push({
        driverId: workload.driverId,
        driverName: workload.driverName,
        type: "approaching_max",
        message: `${workload.totalBlocks}/${workload.maxBlocks} blocks`,
        severity: "warning",
      });
    }

    if (workload.consecutiveDays >= 5) {
      watchList.push({
        driverId: workload.driverId,
        driverName: workload.driverName,
        type: "consecutive_days",
        message: `${workload.consecutiveDays} days (6th = OT)`,
        severity: workload.consecutiveDays >= 6 ? "critical" : "warning",
      });
    }
  }

  return watchList.sort((a, b) => {
    const severityOrder = { critical: 0, warning: 1, info: 2 };
    return severityOrder[a.severity] - severityOrder[b.severity];
  });
}

// =============================================================================
// SCHEDULE STATS
// =============================================================================

/**
 * Calculate schedule statistics
 */
export function calculateStats(assignments: AssignedBlock[]): ScheduleStats {
  const assigned = assignments.filter((b) => b.driverId !== null);
  const solo1 = assignments.filter((b) => b.blockType === "solo1");
  const solo2 = assignments.filter((b) => b.blockType === "solo2");
  const team = assignments.filter((b) => b.blockType === "team");

  // Count by day
  const dayCount: Record<DayOfWeek, number> = {
    sunday: 0,
    monday: 0,
    tuesday: 0,
    wednesday: 0,
    thursday: 0,
    friday: 0,
    saturday: 0,
  };

  for (const block of assignments) {
    dayCount[block.dayOfWeek]++;
  }

  // Find peak and low days
  let peakDay: { day: DayOfWeek; count: number } | null = null;
  let lowDay: { day: DayOfWeek; count: number } | null = null;

  for (const day of DAY_ORDER) {
    const count = dayCount[day];
    if (count > 0) {
      if (!peakDay || count > peakDay.count) {
        peakDay = { day, count };
      }
      if (!lowDay || count < lowDay.count) {
        lowDay = { day, count };
      }
    }
  }

  return {
    totalBlocks: assignments.length,
    assignedBlocks: assigned.length,
    unassignedBlocks: assignments.length - assigned.length,
    assignmentPercentage:
      assignments.length > 0
        ? Math.round((assigned.length / assignments.length) * 100)
        : 0,
    solo1Blocks: solo1.length,
    solo2Blocks: solo2.length,
    teamBlocks: team.length,
    totalEstimatedPay: assignments.reduce((sum, b) => sum + b.estimatedPay, 0),
    peakDay,
    lowDay,
  };
}

// =============================================================================
// COMPLIANCE REPORT
// =============================================================================

/**
 * Generate full compliance report for all assignments
 */
export function generateComplianceReport(
  assignments: AssignedBlock[],
  drivers: DriverProfile[]
): ComplianceReport {
  const allViolations: ComplianceViolation[] = [];

  // Collect violations from assignments
  for (const block of assignments) {
    allViolations.push(...block.conflicts);
  }

  // Re-check all driver schedules
  const driverMap = new Map(drivers.map((d) => [d.id, d]));
  const assignedBlocks = assignments.filter((b) => b.driverId !== null);

  for (const block of assignedBlocks) {
    const driver = driverMap.get(block.driverId!);
    if (driver) {
      const otherBlocks = assignedBlocks.filter(
        (b) => b.driverId === driver.id && b.blockId !== block.blockId
      );
      const violations = checkDriverCompliance(driver, block, otherBlocks);
      allViolations.push(...violations);
    }
  }

  // Deduplicate violations
  const uniqueViolations = allViolations.filter(
    (v, i, arr) =>
      arr.findIndex(
        (x) =>
          x.type === v.type &&
          x.details.driverId === v.details.driverId &&
          x.details.blockId === v.details.blockId
      ) === i
  );

  // Calculate stats
  const errors = uniqueViolations.filter((v) => v.severity === "error");
  const warnings = uniqueViolations.filter((v) => v.severity === "warning");

  const totalChecks = assignedBlocks.length;
  const restErrors = errors.filter((v) => v.type === "insufficient_rest").length;
  const gapErrors = errors.filter((v) => v.type === "insufficient_gap").length;
  const dayErrors = errors.filter(
    (v) => v.type === "max_consecutive_days"
  ).length;
  const maxErrors = errors.filter((v) => v.type === "weekly_maximum").length;

  return {
    isCompliant: errors.length === 0,
    violations: uniqueViolations,
    stats: {
      tenHourRest: {
        passed: totalChecks - restErrors,
        failed: restErrors,
        percentage:
          totalChecks > 0
            ? Math.round(((totalChecks - restErrors) / totalChecks) * 100)
            : 100,
      },
      fortyEightHourGaps: {
        passed: totalChecks - gapErrors,
        failed: gapErrors,
        percentage:
          totalChecks > 0
            ? Math.round(((totalChecks - gapErrors) / totalChecks) * 100)
            : 100,
      },
      maxSixDays: {
        passed: totalChecks - dayErrors,
        failed: dayErrors,
        percentage:
          totalChecks > 0
            ? Math.round(((totalChecks - dayErrors) / totalChecks) * 100)
            : 100,
      },
      weeklyMaximum: {
        passed: totalChecks - maxErrors,
        failed: maxErrors,
        percentage:
          totalChecks > 0
            ? Math.round(((totalChecks - maxErrors) / totalChecks) * 100)
            : 100,
      },
    },
  };
}

// =============================================================================
// SWAP OPERATIONS
// =============================================================================

/**
 * Validate a driver swap request
 */
export function validateSwap(
  request: SwapRequest,
  assignments: AssignedBlock[],
  drivers: DriverProfile[]
): SwapValidation {
  const block = assignments.find((b) => b.blockId === request.blockId);
  if (!block) {
    return {
      isValid: false,
      violations: [
        {
          type: "insufficient_rest",
          severity: "error",
          message: "Block not found",
          details: { blockId: request.blockId },
        },
      ],
      impact: {},
    };
  }

  const newDriver = drivers.find((d) => d.id === request.newDriverId);
  if (!newDriver) {
    return {
      isValid: false,
      violations: [
        {
          type: "insufficient_rest",
          severity: "error",
          message: "Driver not found",
          details: { driverId: request.newDriverId },
        },
      ],
      impact: {},
    };
  }

  // Get other assignments excluding this block
  const otherAssignments = assignments.filter(
    (b) => b.blockId !== request.blockId
  );

  // Check compliance for new driver
  const violations = checkDriverCompliance(newDriver, block, otherAssignments);

  // Calculate impact
  const currentDriverBlocks = assignments.filter(
    (b) => b.driverId === request.currentDriverId
  ).length;
  const newDriverBlocks =
    otherAssignments.filter((b) => b.driverId === request.newDriverId).length +
    1;

  return {
    isValid: violations.filter((v) => v.severity === "error").length === 0,
    violations,
    impact: {
      currentDriver:
        request.currentDriverId !== null
          ? { workloadChange: `${currentDriverBlocks} → ${currentDriverBlocks - 1} blocks` }
          : undefined,
      newDriver: {
        workloadChange: `${newDriverBlocks - 1} → ${newDriverBlocks} blocks`,
        newTotal: newDriverBlocks,
      },
    },
  };
}

/**
 * Execute a driver swap
 */
export function executeSwap(
  request: SwapRequest,
  assignments: AssignedBlock[],
  drivers: DriverProfile[]
): AssignedBlock[] {
  const newDriver = drivers.find((d) => d.id === request.newDriverId);
  if (!newDriver) return assignments;

  return assignments.map((block) => {
    if (block.blockId === request.blockId) {
      return {
        ...block,
        driverId: newDriver.id,
        driverName: newDriver.name,
        assignmentType: "manual" as AssignmentType,
        assignmentScore: 100,
        conflicts: [],
      };
    }
    return block;
  });
}

/**
 * Get available drivers for a block
 */
export function getAvailableDrivers(
  blockId: string,
  assignments: AssignedBlock[],
  drivers: DriverProfile[]
): AvailableDriver[] {
  const block = assignments.find((b) => b.blockId === blockId);
  if (!block) return [];

  const otherAssignments = assignments.filter((b) => b.blockId !== blockId);
  const activeDrivers = drivers.filter((d) => d.status === "active");

  return activeDrivers
    .map((driver) => {
      const match = calculateMatchScore(driver, block, otherAssignments);
      const violations = checkDriverCompliance(driver, block, otherAssignments);
      const errors = violations.filter((v) => v.severity === "error");
      const warnings = violations.filter((v) => v.severity === "warning");

      if (errors.length > 0) {
        return null; // Not eligible
      }

      const workload = otherAssignments.filter(
        (b) => b.driverId === driver.id
      ).length;

      return {
        driver,
        score: match?.score ?? 30,
        reason:
          match?.reason ?? `${workload} blocks this week`,
        isRecommended: (match?.score ?? 0) >= 80,
        warnings: warnings.map((w) => w.message),
      };
    })
    .filter((d): d is AvailableDriver => d !== null)
    .sort((a, b) => b.score - a.score);
}

// =============================================================================
// FINAL SCHEDULE GENERATION
// =============================================================================

/**
 * Generate final schedule with all analysis
 */
export function generateFinalSchedule(
  assignments: AssignedBlock[],
  drivers: DriverProfile[],
  weekStart: Date
): FinalSchedule {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);

  const workloads = calculateWorkloads(assignments, drivers);
  const watchList = generateWatchList(workloads);
  const compliance = generateComplianceReport(assignments, drivers);
  const stats = calculateStats(assignments);

  const gaps: UnassignedBlock[] = assignments
    .filter((b) => b.driverId === null)
    .map((block) => ({
      block,
      reason: "No driver assigned",
      suggestedDrivers: getAvailableDrivers(block.blockId, assignments, drivers)
        .slice(0, 3)
        .map((ad) => ({
          driverId: ad.driver.id,
          driverName: ad.driver.name,
          score: ad.score,
          reason: ad.reason,
        })),
    }));

  return {
    weekStart,
    weekEnd,
    blocks: assignments,
    compliance,
    workloads,
    watchList,
    gaps,
    stats,
    generatedAt: new Date(),
  };
}
