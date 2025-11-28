/**
 * Schedule Builder Types & DOT Compliance Rules
 *
 * This module defines the core types for the ScheduleBuilder component
 * and the federal DOT compliance rules for driver scheduling.
 */

// =============================================================================
// DRIVER TYPES
// =============================================================================

export type SoloType = "solo1" | "solo2" | "both";
export type DriverStatus = "active" | "standby" | "inactive" | "on_leave";
export type BlockType = "solo1" | "solo2" | "team";
export type DayOfWeek = "sunday" | "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday";

export interface DriverProfile {
  id: number;
  name: string;
  firstName: string;
  lastName: string;
  soloType: SoloType;
  preferredDays: DayOfWeek[];
  canonicalTime: string;          // "21:30" - most frequent start time
  maxWeeklyRuns: number;          // 3 for Solo2, 6 for Solo1
  reliabilityRating: number;      // 1-5 scale
  status: DriverStatus;
  domicile?: string;
  loadEligible?: boolean;
}

export interface DriverAvailabilityPreference {
  driverId: number;
  blockType: BlockType;
  startTime: string;              // "16:30", "20:30"
  dayOfWeek: DayOfWeek;
  isAvailable: boolean;
}

// =============================================================================
// BLOCK TYPES
// =============================================================================

export interface ReconstructedBlock {
  blockId: string;
  date: string;                   // "2025-11-30"
  dayOfWeek: DayOfWeek;
  startTime: string;              // "21:30"
  blockType: BlockType;
  duration: number;               // hours
  estimatedPay: number;
  stops: number;
  trips: string[];                // Trip IDs
  source: "csv" | "manual";
}

export interface AssignedBlock extends ReconstructedBlock {
  driverId: number | null;
  driverName: string | null;
  assignmentType: AssignmentType;
  assignmentScore: number;        // 0-100 confidence score
  conflicts: ComplianceViolation[];
}

export type AssignmentType =
  | "exact_match"      // Same day + same time (±15 min)
  | "close_match"      // Same day + time within ±2 hours
  | "pattern_match"    // Driver's pattern day + compatible time
  | "cross_trained"    // Flex driver assignment
  | "standby"          // Activated from standby list
  | "manual"           // User assigned manually
  | "unassigned";      // Needs coverage

// =============================================================================
// DOT COMPLIANCE RULES (Federal Regulations)
// =============================================================================

export const DOT_RULES = {
  solo1: {
    blockDuration: 14,            // hours
    minRestBetweenShifts: 10,     // hours - rest after shift ends
    maxConsecutiveDays: 6,
    weeklyReset: 34,              // hours required for weekly reset
    bumpTolerance: 2,             // hours (±2h from canonical time)
    maxPerWeek: 6,
    estimatedPay: 498,            // dollars
  },
  solo2: {
    blockDuration: 38,            // hours
    minStartToStartGap: 48,       // hours - THE KEY RULE for Solo2
    maxConsecutiveDays: 6,
    weeklyReset: 34,              // hours
    bumpTolerance: 2,             // hours
    maxPerWeek: 3,
    estimatedPay: 980,            // dollars
  },
  team: {
    blockDuration: 48,            // hours
    minRestBetweenShifts: 10,     // hours
    maxConsecutiveDays: 6,
    weeklyReset: 34,              // hours
    bumpTolerance: 2,             // hours
    maxPerWeek: 3,
    estimatedPay: 1200,           // dollars
  }
} as const;

// Work week boundaries
export const WORK_WEEK = {
  start: "sunday",
  startHour: 0,                   // 00:00
  end: "saturday",
  endHour: 23,                    // 23:59
} as const;

// =============================================================================
// COMPLIANCE TYPES
// =============================================================================

export type ViolationType =
  | "insufficient_rest"           // Solo1: Less than 10h rest
  | "insufficient_gap"            // Solo2: Less than 48h start-to-start
  | "max_consecutive_days"        // 7th consecutive day
  | "weekly_maximum"              // Over max blocks per week
  | "needs_weekly_reset"          // 34h reset not available
  | "time_bump_exceeded";         // More than ±2h from canonical

export interface ComplianceViolation {
  type: ViolationType;
  severity: "error" | "warning";
  message: string;
  details: {
    driverId?: number;
    blockId?: string;
    actualValue?: number;
    requiredValue?: number;
  };
}

export interface ComplianceReport {
  isCompliant: boolean;
  violations: ComplianceViolation[];
  stats: {
    tenHourRest: { passed: number; failed: number; percentage: number };
    fortyEightHourGaps: { passed: number; failed: number; percentage: number };
    maxSixDays: { passed: number; failed: number; percentage: number };
    weeklyMaximum: { passed: number; failed: number; percentage: number };
  };
}

// =============================================================================
// SCHEDULE BUILDER TYPES
// =============================================================================

export interface DriverWorkload {
  driverId: number;
  driverName: string;
  soloType: SoloType;
  assignedBlocks: AssignedBlock[];
  totalBlocks: number;
  maxBlocks: number;
  daysWorked: DayOfWeek[];
  consecutiveDays: number;
  estimatedPay: number;
  isAtMax: boolean;
  warnings: string[];
}

export interface WatchItem {
  driverId: number;
  driverName: string;
  type: "at_max" | "approaching_max" | "consecutive_days" | "needs_reset";
  message: string;
  severity: "info" | "warning" | "critical";
}

export interface UnassignedBlock {
  block: ReconstructedBlock;
  reason: string;
  suggestedDrivers: {
    driverId: number;
    driverName: string;
    score: number;
    reason: string;
  }[];
}

export interface ScheduleStats {
  totalBlocks: number;
  assignedBlocks: number;
  unassignedBlocks: number;
  assignmentPercentage: number;
  solo1Blocks: number;
  solo2Blocks: number;
  teamBlocks: number;
  totalEstimatedPay: number;
  peakDay: { day: DayOfWeek; count: number } | null;
  lowDay: { day: DayOfWeek; count: number } | null;
}

// =============================================================================
// SCHEDULE BUILDER INPUT/OUTPUT
// =============================================================================

export interface ScheduleBuilderProps {
  blocks: ReconstructedBlock[];
  weekStart: Date;
  tenantId: number;
  onComplete: (schedule: FinalSchedule) => void;
  onCancel: () => void;
}

export interface FinalSchedule {
  weekStart: Date;
  weekEnd: Date;
  blocks: AssignedBlock[];
  compliance: ComplianceReport;
  workloads: DriverWorkload[];
  watchList: WatchItem[];
  gaps: UnassignedBlock[];
  stats: ScheduleStats;
  generatedAt: Date;
}

// =============================================================================
// UTILITY TYPES
// =============================================================================

export interface SwapRequest {
  blockId: string;
  currentDriverId: number | null;
  newDriverId: number;
}

export interface SwapValidation {
  isValid: boolean;
  violations: ComplianceViolation[];
  impact: {
    currentDriver?: { workloadChange: string };
    newDriver?: { workloadChange: string; newTotal: number };
  };
}

export interface AvailableDriver {
  driver: DriverProfile;
  score: number;
  reason: string;
  isRecommended: boolean;
  warnings: string[];
}

// Day abbreviation mapping
export const DAY_ABBREVIATIONS: Record<DayOfWeek, string> = {
  sunday: "Sun",
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  saturday: "Sat",
};

export const DAY_ORDER: DayOfWeek[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

// Helper to get day index (0 = Sunday)
export function getDayIndex(day: DayOfWeek): number {
  return DAY_ORDER.indexOf(day);
}

// Helper to get day from date
export function getDayOfWeek(date: Date): DayOfWeek {
  return DAY_ORDER[date.getDay()];
}
