import { Block, Driver, AssignmentHistory } from "@shared/schema";

/**
 * Bump tolerance rules for Amazon's dynamic shift assignments
 * 
 * Standard: ±2 hours from canonical contract time
 * Last Day: ±3 hours (extended flexibility on 6th consecutive duty day)
 * 
 * Bumps are allowed WITHIN the same pattern group (sunWed → sunWed or wedSat → wedSat)
 * Cross-pattern assignments require manual review
 */

export interface BumpValidationResult {
  isValid: boolean;
  bumpMinutes: number;
  bumpHours: number;
  withinTolerance: boolean;
  requiresReview: boolean;
  reason: string;
  tolerance: {
    min: number; // minutes
    max: number; // minutes
  };
}

/**
 * Validate if a driver assignment respects bump tolerance rules
 * 
 * @param block - The block being assigned
 * @param driverHistory - Driver's assignment history for pattern matching
 * @param isLastDay - Whether this is the driver's 6th consecutive duty day (±3h tolerance)
 * @returns Validation result with bump calculation
 */
export function validateBumpTolerance(
  block: Block,
  driverHistory: AssignmentHistory[],
  isLastDay: boolean = false
): BumpValidationResult {
  // Calculate bump (time difference between actual start and canonical start)
  if (!block.canonicalStart || !block.patternGroup) {
    return {
      isValid: false,
      bumpMinutes: 0,
      bumpHours: 0,
      withinTolerance: false,
      requiresReview: true,
      reason: "Block missing pattern metadata (canonicalStart or patternGroup)",
      tolerance: { min: 0, max: 0 },
    };
  }

  const blockStart = new Date(block.startTimestamp);
  const canonical = new Date(block.canonicalStart);
  const bumpMinutes = Math.round((blockStart.getTime() - canonical.getTime()) / (1000 * 60));
  const bumpHours = bumpMinutes / 60;

  // Determine tolerance based on last day status
  const toleranceHours = isLastDay ? 3 : 2;
  const toleranceMinutes = toleranceHours * 60;

  // Check if within bump tolerance
  const withinTolerance = Math.abs(bumpMinutes) <= toleranceMinutes;

  // Check pattern consistency
  const driverPatternHistory = driverHistory.filter(
    (h) => h.patternGroup === block.patternGroup
  );

  const hasSamePatternHistory = driverPatternHistory.length > 0;
  const hasCrossPatternHistory = driverHistory.some(
    (h) => h.patternGroup !== block.patternGroup
  );

  let requiresReview = false;
  let reason = "";

  if (!withinTolerance) {
    requiresReview = true;
    reason = `Bump of ${bumpHours.toFixed(1)}h exceeds ±${toleranceHours}h tolerance`;
  } else if (!hasSamePatternHistory && hasCrossPatternHistory) {
    requiresReview = true;
    reason = `Cross-pattern assignment (driver worked ${driverHistory[0]?.patternGroup} pattern, block is ${block.patternGroup})`;
  } else if (Math.abs(bumpMinutes) > 0) {
    reason = `Bump of ${bumpMinutes > 0 ? '+' : ''}${bumpHours.toFixed(1)}h within ±${toleranceHours}h tolerance`;
  } else {
    reason = "Exact match - no bump";
  }

  return {
    isValid: withinTolerance && (!hasCrossPatternHistory || hasSamePatternHistory),
    bumpMinutes,
    bumpHours: parseFloat(bumpHours.toFixed(1)),
    withinTolerance,
    requiresReview,
    reason,
    tolerance: {
      min: -toleranceMinutes,
      max: toleranceMinutes,
    },
  };
}

/**
 * Calculate bump minutes for historical tracking
 * Used when creating assignment history records
 */
export function calculateBumpMinutes(
  blockStartTimestamp: Date,
  canonicalStart: Date
): number {
  return Math.round((blockStartTimestamp.getTime() - canonicalStart.getTime()) / (1000 * 60));
}

/**
 * Validate 10-hour rest requirement between consecutive shifts
 * Part of bump validation - ensures driver has adequate rest even with bumped times
 */
export function validateRestPeriod(
  previousShiftEnd: Date,
  nextShiftStart: Date,
  minimumRestHours: number = 10
): { isValid: boolean; actualRestHours: number; reason: string } {
  const restMilliseconds = nextShiftStart.getTime() - previousShiftEnd.getTime();
  const actualRestHours = restMilliseconds / (1000 * 60 * 60);

  return {
    isValid: actualRestHours >= minimumRestHours,
    actualRestHours: parseFloat(actualRestHours.toFixed(1)),
    reason:
      actualRestHours >= minimumRestHours
        ? `${actualRestHours.toFixed(1)}h rest meets ${minimumRestHours}h requirement`
        : `Only ${actualRestHours.toFixed(1)}h rest (requires ${minimumRestHours}h)`,
  };
}
