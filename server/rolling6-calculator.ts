import type { Block, BlockAssignment, Driver, ProtectedDriverRule, shiftOccurrences, shiftTemplates } from "@shared/schema";
import { subDays, format, getDay, addHours } from "date-fns";

type ShiftOccurrence = typeof shiftOccurrences.$inferSelect;
type ShiftTemplate = typeof shiftTemplates.$inferSelect;

/**
 * DOT Rolling-6 Compliance Calculator
 *
 * CRITICAL RULES:
 * - All drivers: 10 hours minimum rest between shifts
 * - All drivers: 34 hours off after 6 consecutive work days
 * - Solo1: Maximum 14 hours duty time in any 1 duty day (24-hour period)
 * - Solo2: Maximum 38 hours duty time in any 2 duty days (48-hour period)
 * - Team: Different rules (not implemented yet)
 *
 * A "duty day" is a rolling 24-hour window, not calendar day.
 * Must look back from the proposed block start time.
 */

export interface ValidationResult {
  isValid: boolean;
  validationStatus: "valid" | "warning" | "violation";
  messages: string[];
  metrics: {
    totalHoursIn24h?: number;
    totalHoursIn48h?: number;
    proposedBlockHours?: number;
    limitHours?: number;
    lookbackPeriodHours?: number;
    restHoursSinceLast?: number;
    minRestRequired?: number;
  };
}

export interface AssignmentGuardResult {
  canAssign: boolean;
  validationResult: ValidationResult;
  protectedRuleViolations: string[];
  conflictingAssignments: BlockAssignment[];
}

/**
 * Minimal interface for assignment subjects (blocks or shift occurrences)
 * Contains only the fields needed for DOT validation, decoupling validation
 * logic from specific storage schemas.
 */
export interface AssignmentSubject {
  startTimestamp: Date;
  endTimestamp: Date;
  duration: number;
  soloType: string;
  cycleId: string | null;
  patternGroup: "sunWed" | "wedSat";
}

/**
 * Adapter: Convert Block to AssignmentSubject
 * Allows legacy block-based assignments to work with new validation logic
 */
export function blockToAssignmentSubject(block: Block): AssignmentSubject {
  return {
    startTimestamp: new Date(block.startTimestamp),
    endTimestamp: new Date(block.endTimestamp),
    // Normalize to 4 decimal places to eliminate floating-point residue
    duration: Number.parseFloat(block.duration.toFixed(4)),
    soloType: block.soloType,
    cycleId: block.cycleId,
    patternGroup: block.patternGroup as "sunWed" | "wedSat",
  };
}

/**
 * Adapter: Convert ShiftOccurrence + ShiftTemplate to AssignmentSubject
 * Allows new shift-based assignments to work with validation logic
 * CRITICAL: Template provides the Contract Slot metadata (operatorId, tractorId, soloType, time)
 */
export function shiftOccurrenceToAssignmentSubject(
  occurrence: ShiftOccurrence,
  template: ShiftTemplate
): AssignmentSubject {
  const durationHours = (new Date(occurrence.scheduledEnd).getTime() - new Date(occurrence.scheduledStart).getTime()) /
    (1000 * 60 * 60);

  return {
    startTimestamp: new Date(occurrence.scheduledStart),
    endTimestamp: new Date(occurrence.scheduledEnd),
    // Normalize to 4 decimal places to eliminate floating-point residue
    // Prevents false DOT violations from accumulated precision errors
    duration: Number.parseFloat(durationHours.toFixed(4)),
    soloType: template.soloType,
    cycleId: occurrence.cycleId,
    patternGroup: (occurrence.patternGroup || template.patternGroup) as "sunWed" | "wedSat",
  };
}

/**
 * Calculate total duty hours for a driver in a time window
 * 
 * CRITICAL: Only count the portion of each block that overlaps the window
 * A block that started before the window but runs into it should only
 * contribute its overlapping hours, not the full duration.
 */
export async function calculateDutyHours(
  driverId: string,
  windowStartTime: Date,
  windowEndTime: Date,
  existingAssignments: Array<BlockAssignment & { block: Block }>,
): Promise<number> {
  let totalHours = 0;

  for (const assignment of existingAssignments) {
    const block = assignment.block;
    
    const blockStart = new Date(block.startTimestamp);
    const blockEnd = new Date(block.endTimestamp);
    
    // Calculate only the overlapping portion of the block
    // Overlap interval = [max(blockStart, windowStart), min(blockEnd, windowEnd)]
    const overlapStart = blockStart > windowStartTime ? blockStart : windowStartTime;
    const overlapEnd = blockEnd < windowEndTime ? blockEnd : windowEndTime;
    
    // If there's overlap, calculate hours in the overlapping interval
    if (overlapStart < overlapEnd) {
      const overlapMilliseconds = overlapEnd.getTime() - overlapStart.getTime();
      const overlapHours = overlapMilliseconds / (1000 * 60 * 60); // Convert ms to hours
      totalHours += overlapHours;
    }
  }

  // Round to 4 decimal places to eliminate floating-point precision errors
  return Number(totalHours.toFixed(4));
}

/**
 * Validate DOT 10-hour rest rule between shifts
 * Drivers must have minimum 10 hours off-duty between the end of one shift
 * and the start of their next shift.
 */
export function validate10HourRestRule(
  proposedStart: Date,
  existingAssignments: Array<BlockAssignment & { block: Block }>,
  driverName: string,
): ValidationResult {
  const MIN_REST_HOURS = 10;

  if (existingAssignments.length === 0) {
    return {
      isValid: true,
      validationStatus: "valid",
      messages: ["✓ 10-hour rest rule: No previous assignments to check"],
      metrics: { minRestRequired: MIN_REST_HOURS },
    };
  }

  // Find the most recent assignment that ends BEFORE the proposed start
  let mostRecentEndTime: Date | null = null;

  for (const assignment of existingAssignments) {
    const blockEnd = new Date(assignment.block.endTimestamp);

    // Only consider assignments that end before the proposed start
    if (blockEnd <= proposedStart) {
      if (!mostRecentEndTime || blockEnd > mostRecentEndTime) {
        mostRecentEndTime = blockEnd;
      }
    }
  }

  // If no previous assignment ends before proposed start, check is passed
  if (!mostRecentEndTime) {
    return {
      isValid: true,
      validationStatus: "valid",
      messages: ["✓ 10-hour rest rule: No applicable previous assignments"],
      metrics: { minRestRequired: MIN_REST_HOURS },
    };
  }

  // Calculate rest hours between most recent end and proposed start
  const restMilliseconds = proposedStart.getTime() - mostRecentEndTime.getTime();
  const restHours = restMilliseconds / (1000 * 60 * 60);
  const restHoursRounded = Number(restHours.toFixed(2));

  if (restHours < MIN_REST_HOURS) {
    return {
      isValid: false,
      validationStatus: "violation",
      messages: [
        `DOT 10-HOUR REST VIOLATION: ${driverName} would have only ${restHoursRounded}h rest`,
        `Last shift ended: ${format(mostRecentEndTime, "MMM d 'at' h:mm a")}`,
        `Proposed start: ${format(proposedStart, "MMM d 'at' h:mm a")}`,
        `Rest period: ${restHoursRounded}h (minimum required: ${MIN_REST_HOURS}h)`,
        `Violation: ${(MIN_REST_HOURS - restHoursRounded).toFixed(2)}h short of required rest`,
      ],
      metrics: {
        restHoursSinceLast: restHoursRounded,
        minRestRequired: MIN_REST_HOURS,
      },
    };
  }

  // Warning if close to minimum (within 1 hour of limit)
  if (restHours < MIN_REST_HOURS + 1) {
    return {
      isValid: true,
      validationStatus: "warning",
      messages: [
        `WARNING: ${driverName} has minimal rest (${restHoursRounded}h)`,
        `Last shift ended: ${format(mostRecentEndTime, "MMM d 'at' h:mm a")}`,
        `Proposed start: ${format(proposedStart, "MMM d 'at' h:mm a")}`,
        `Rest period: ${restHoursRounded}h (minimum required: ${MIN_REST_HOURS}h)`,
      ],
      metrics: {
        restHoursSinceLast: restHoursRounded,
        minRestRequired: MIN_REST_HOURS,
      },
    };
  }

  return {
    isValid: true,
    validationStatus: "valid",
    messages: [
      `✓ 10-hour rest rule compliant`,
      `Rest since last shift: ${restHoursRounded}h (minimum: ${MIN_REST_HOURS}h)`,
    ],
    metrics: {
      restHoursSinceLast: restHoursRounded,
      minRestRequired: MIN_REST_HOURS,
    },
  };
}

/**
 * Validate Rolling-6 compliance for a proposed block assignment
 */
/**
 * Normalize solo type string to handle variants (Solo 2, SOLO1, solo1, etc.)
 * Export this so routes can use it for lookback calculation
 */
export function normalizeSoloType(soloType: string): string {
  return soloType.toLowerCase().replace(/\s+/g, ""); // Remove spaces, lowercase
}

export async function validateRolling6Compliance(
  driver: Driver,
  proposedSubject: AssignmentSubject,
  existingAssignments: Array<BlockAssignment & { block: Block }>,
): Promise<ValidationResult> {
  const soloType = normalizeSoloType(proposedSubject.soloType);
  const proposedStart = new Date(proposedSubject.startTimestamp);
  const proposedDuration = proposedSubject.duration;

  // Validate solo type
  if (soloType !== "solo1" && soloType !== "solo2") {
    return {
      isValid: false,
      validationStatus: "violation",
      messages: [`Unsupported solo type: ${proposedSubject.soloType}. Only Solo1 and Solo2 are supported.`],
      metrics: {},
    };
  }

  // Solo1: 14 hours max in 1 duty day (24-hour rolling window)
  if (soloType === "solo1") {
    const lookbackStart = subDays(proposedStart, 1); // 24 hours back
    const totalHoursIn24h = await calculateDutyHours(
      driver.id,
      lookbackStart,
      proposedStart,
      existingAssignments,
    );

    const newTotal = totalHoursIn24h + proposedDuration;
    const limit = 14;

    if (newTotal > limit) {
      return {
        isValid: false,
        validationStatus: "violation",
        messages: [
          `Rolling-6 VIOLATION: Driver ${driver.firstName} ${driver.lastName} would exceed 14-hour limit for Solo1.`,
          `Current duty hours in past 24h: ${Number(totalHoursIn24h.toFixed(2))}h`,
          `Proposed block duration: ${Number(proposedDuration.toFixed(2))}h`,
          `Total would be: ${Number(newTotal.toFixed(2))}h (limit: ${limit}h)`,
          `Violation amount: ${Number((newTotal - limit).toFixed(2))}h over limit`,
        ],
        metrics: {
          totalHoursIn24h,
          proposedBlockHours: proposedDuration,
          limitHours: limit,
          lookbackPeriodHours: 24,
        },
      };
    }

    // Warning if approaching limit (90% threshold)
    if (newTotal >= limit * 0.9) {
      return {
        isValid: true,
        validationStatus: "warning",
        messages: [
          `WARNING: Driver ${driver.firstName} ${driver.lastName} approaching 14-hour limit for Solo1.`,
          `Current duty hours in past 24h: ${Number(totalHoursIn24h.toFixed(2))}h`,
          `Proposed block duration: ${Number(proposedDuration.toFixed(2))}h`,
          `Total would be: ${Number(newTotal.toFixed(2))}h (limit: ${limit}h)`,
          `Remaining capacity: ${Number((limit - newTotal).toFixed(2))}h`,
        ],
        metrics: {
          totalHoursIn24h,
          proposedBlockHours: proposedDuration,
          limitHours: limit,
          lookbackPeriodHours: 24,
        },
      };
    }

    // Valid
    return {
      isValid: true,
      validationStatus: "valid",
      messages: [
        `✓ Rolling-6 compliant for Solo1`,
        `Duty hours in past 24h: ${Number(totalHoursIn24h.toFixed(2))}h`,
        `Proposed block: ${Number(proposedDuration.toFixed(2))}h`,
        `Total: ${Number(newTotal.toFixed(2))}h / ${limit}h`,
      ],
      metrics: {
        totalHoursIn24h,
        proposedBlockHours: proposedDuration,
        limitHours: limit,
        lookbackPeriodHours: 24,
      },
    };
  }

  // Solo2: 38 hours max in 2 duty days (48-hour rolling window)
  if (soloType === "solo2") {
    const lookbackStart = subDays(proposedStart, 2); // 48 hours back
    const totalHoursIn48h = await calculateDutyHours(
      driver.id,
      lookbackStart,
      proposedStart,
      existingAssignments,
    );

    const newTotal = totalHoursIn48h + proposedDuration;
    const limit = 38;

    if (newTotal > limit) {
      return {
        isValid: false,
        validationStatus: "violation",
        messages: [
          `Rolling-6 VIOLATION: Driver ${driver.firstName} ${driver.lastName} would exceed 38-hour limit for Solo2.`,
          `Current duty hours in past 48h: ${Number(totalHoursIn48h.toFixed(2))}h`,
          `Proposed block duration: ${Number(proposedDuration.toFixed(2))}h`,
          `Total would be: ${Number(newTotal.toFixed(2))}h (limit: ${limit}h)`,
          `Violation amount: ${Number((newTotal - limit).toFixed(2))}h over limit`,
        ],
        metrics: {
          totalHoursIn48h,
          proposedBlockHours: proposedDuration,
          limitHours: limit,
          lookbackPeriodHours: 48,
        },
      };
    }

    // Warning if approaching limit (90% threshold)
    if (newTotal >= limit * 0.9) {
      return {
        isValid: true,
        validationStatus: "warning",
        messages: [
          `WARNING: Driver ${driver.firstName} ${driver.lastName} approaching 38-hour limit for Solo2.`,
          `Current duty hours in past 48h: ${Number(totalHoursIn48h.toFixed(2))}h`,
          `Proposed block duration: ${Number(proposedDuration.toFixed(2))}h`,
          `Total would be: ${Number(newTotal.toFixed(2))}h (limit: ${limit}h)`,
          `Remaining capacity: ${Number((limit - newTotal).toFixed(2))}h`,
        ],
        metrics: {
          totalHoursIn48h,
          proposedBlockHours: proposedDuration,
          limitHours: limit,
          lookbackPeriodHours: 48,
        },
      };
    }

    // Valid
    return {
      isValid: true,
      validationStatus: "valid",
      messages: [
        `✓ Rolling-6 compliant for Solo2`,
        `Duty hours in past 48h: ${Number(totalHoursIn48h.toFixed(2))}h`,
        `Proposed block: ${Number(proposedDuration.toFixed(2))}h`,
        `Total: ${Number(newTotal.toFixed(2))}h / ${limit}h`,
      ],
      metrics: {
        totalHoursIn48h,
        proposedBlockHours: proposedDuration,
        limitHours: limit,
        lookbackPeriodHours: 48,
      },
    };
  }

  // Should never reach here
  return {
    isValid: false,
    validationStatus: "violation",
    messages: ["Unknown error in rolling-6 validation"],
    metrics: {},
  };
}

/**
 * Check if driver violates any protected rules for this block
 */
export function validateProtectedDriverRules(
  driver: Driver,
  proposedSubject: AssignmentSubject,
  protectedRules: ProtectedDriverRule[],
): string[] {
  const violations: string[] = [];
  const blockStart = new Date(proposedSubject.startTimestamp);
  const dayOfWeek = format(blockStart, "EEEE"); // e.g., "Friday"
  const startTime = format(blockStart, "HH:mm"); // e.g., "16:30"
  const soloType = normalizeSoloType(proposedSubject.soloType);

  const driverName = `${driver.firstName} ${driver.lastName}`;

  // Filter rules to only those that apply to this specific driver
  const driverRules = protectedRules.filter(rule => rule.driverId === driver.id);

  for (const rule of driverRules) {
    // Check if rule is currently active (effective date range)
    if (rule.effectiveFrom && blockStart < new Date(rule.effectiveFrom)) {
      continue; // Rule not yet active
    }
    if (rule.effectiveTo && blockStart > new Date(rule.effectiveTo)) {
      continue; // Rule expired
    }

    // Check blocked days
    if (rule.blockedDays && rule.blockedDays.length > 0) {
      if (rule.blockedDays.includes(dayOfWeek)) {
        violations.push(
          `Rule "${rule.ruleName}": Driver ${driverName} is blocked from working on ${dayOfWeek}s`
        );
      }
    }

    // Check allowed days (if specified, driver can ONLY work these days)
    if (rule.allowedDays && rule.allowedDays.length > 0) {
      if (!rule.allowedDays.includes(dayOfWeek)) {
        violations.push(
          `Rule "${rule.ruleName}": Driver ${driverName} can only work on ${rule.allowedDays.join(", ")}, not ${dayOfWeek}`
        );
      }
    }

    // Check allowed solo types
    if (rule.allowedSoloTypes && rule.allowedSoloTypes.length > 0) {
      const allowedNormalized = rule.allowedSoloTypes.map(s => normalizeSoloType(s));
      if (!allowedNormalized.includes(soloType)) {
        violations.push(
          `Rule "${rule.ruleName}": Driver ${driverName} can only work ${rule.allowedSoloTypes.join(", ")} types, not ${proposedSubject.soloType}`
        );
      }
    }

    // Check allowed start times
    if (rule.allowedStartTimes && rule.allowedStartTimes.length > 0) {
      if (!rule.allowedStartTimes.includes(startTime)) {
        violations.push(
          `Rule "${rule.ruleName}": Driver ${driverName} can only start at ${rule.allowedStartTimes.join(", ")}, not ${startTime}`
        );
      }
    }

    // Check max start time
    if (rule.maxStartTime) {
      if (startTime > rule.maxStartTime) {
        violations.push(
          `Rule "${rule.ruleName}": Driver ${driverName} cannot start after ${rule.maxStartTime} (block starts at ${startTime})`
        );
      }
    }
  }

  return violations;
}

/**
 * Comprehensive assignment guard - checks everything before allowing assignment
 */
export async function validateBlockAssignment(
  driver: Driver,
  proposedSubject: AssignmentSubject,
  existingAssignments: Array<BlockAssignment & { block: Block }>,
  protectedRules: ProtectedDriverRule[],
  allBlockAssignments: BlockAssignment[], // All assignments across all drivers
  blockId?: string, // Optional: for legacy block-based assignments to check conflicts
): Promise<AssignmentGuardResult> {
  // 1. Check if block is already assigned (only for legacy block-based assignments)
  let conflictingAssignments: BlockAssignment[] = [];
  
  if (blockId) {
    const existingAssignment = allBlockAssignments.find(
      (a) => a.blockId === blockId
    );
    conflictingAssignments = existingAssignment ? [existingAssignment] : [];

    if (existingAssignment) {
      return {
        canAssign: false,
        validationResult: {
          isValid: false,
          validationStatus: "violation",
          messages: [
            `Block is already assigned to another driver`,
          ],
          metrics: {},
        },
        protectedRuleViolations: [],
        conflictingAssignments,
      };
    }
  }

  // 2. Check protected driver rules
  const ruleViolations = validateProtectedDriverRules(
    driver,
    proposedSubject,
    protectedRules,
  );

  if (ruleViolations.length > 0) {
    return {
      canAssign: false,
      validationResult: {
        isValid: false,
        validationStatus: "violation",
        messages: ruleViolations,
        metrics: {},
      },
      protectedRuleViolations: ruleViolations,
      conflictingAssignments: [],
    };
  }

  // 3. Check 10-hour rest rule (DOT minimum rest between shifts)
  const driverName = `${driver.firstName} ${driver.lastName}`;
  const restRuleResult = validate10HourRestRule(
    new Date(proposedSubject.startTimestamp),
    existingAssignments,
    driverName,
  );

  if (!restRuleResult.isValid) {
    return {
      canAssign: false,
      validationResult: restRuleResult,
      protectedRuleViolations: [],
      conflictingAssignments: [],
    };
  }

  // 4. Check rolling-6 compliance (max hours in rolling window)
  const rolling6Result = await validateRolling6Compliance(
    driver,
    proposedSubject,
    existingAssignments,
  );

  // If rolling-6 passes but rest rule had a warning, include the warning
  if (rolling6Result.isValid && restRuleResult.validationStatus === "warning") {
    return {
      canAssign: true,
      validationResult: {
        ...rolling6Result,
        validationStatus: "warning",
        messages: [...restRuleResult.messages, ...rolling6Result.messages],
        metrics: {
          ...rolling6Result.metrics,
          ...restRuleResult.metrics,
        },
      },
      protectedRuleViolations: [],
      conflictingAssignments: [],
    };
  }

  return {
    canAssign: rolling6Result.isValid,
    validationResult: rolling6Result,
    protectedRuleViolations: [],
    conflictingAssignments: [],
  };
}
