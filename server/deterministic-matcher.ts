/**
 * Deterministic Schedule Matcher (XGBoost Edition)
 *
 * A fast, predictable scoring-based matcher using XGBoost ownership model.
 * No AI calls - pure deterministic scoring with transparent results.
 *
 * Scoring System (XGBoost-based):
 * - Ownership score: 0-1.0 (from XGBoost slot distribution)
 * - Availability score: 1.0 if driver works this day, 0.5 otherwise
 * - Combined: ownership × predictability + availability × (1 - predictability)
 * - Fairness bonus: prefer drivers with fewer blocks this week
 *
 * Hard Constraints:
 * - Contract type must match (solo1/solo2)
 * - One block per driver per day
 * - Don't exceed driver's typical_days pattern
 */

import { db } from "./db";
import { blocks, drivers, blockAssignments, contracts, specialRequests, protectedDriverRules, type Block, type Driver, type BlockAssignment } from "@shared/schema";
import { eq, and, gte, lte, or, isNull, sql } from "drizzle-orm";
import { format, endOfWeek, subWeeks, subDays, eachDayOfInterval, isWithinInterval, parseISO } from "date-fns";
import { getSlotDistribution, getBatchSlotDistributions, getAllDriverPatterns, getBatchSlotAffinity, SlotDistribution, DriverPattern, DriverHistoryItem, BlockSlotInfo } from "./python-bridge";
import { validateBlockAssignment, blockToAssignmentSubject } from "./rolling6-calculator";

/**
 * Learn driver's dominant TIME SLOT from their 12-week assignment history.
 * Uses the 70% rule: if 70%+ of assignments are at one start time, that's their locked slot.
 *
 * This is the KEY insight: Brian always works 00:30, Richard always works 01:30.
 * They should ONLY be matched to blocks at their respective times.
 */
async function getDriverTimeSlots(
  tenantId: string
): Promise<Map<string, { dominantTime: string | null; confidence: number }>> {
  const driverTimeSlots = new Map<string, { dominantTime: string | null; confidence: number }>();

  // Look back 12 weeks
  const cutoffDate = subWeeks(new Date(), 12);

  // Query all assignments with block start times for the last 12 weeks
  const historicalAssignments = await db
    .select({
      driverId: blockAssignments.driverId,
      startTimestamp: blocks.startTimestamp,
    })
    .from(blockAssignments)
    .innerJoin(blocks, eq(blockAssignments.blockId, blocks.id))
    .where(
      and(
        eq(blockAssignments.tenantId, tenantId),
        eq(blockAssignments.isActive, true),
        gte(blocks.serviceDate, cutoffDate)
      )
    );

  // Count time slots per driver (normalize to HH:MM format)
  const driverTimeCounts = new Map<string, Map<string, number>>();

  for (const a of historicalAssignments) {
    const startTime = new Date(a.startTimestamp);
    // Extract HH:MM in local time
    const timeStr = format(startTime, "HH:mm");

    if (!driverTimeCounts.has(a.driverId)) {
      driverTimeCounts.set(a.driverId, new Map());
    }
    const timeCounts = driverTimeCounts.get(a.driverId)!;
    timeCounts.set(timeStr, (timeCounts.get(timeStr) || 0) + 1);
  }

  // Apply 70% rule to determine dominant time slot
  for (const [driverId, timeCounts] of driverTimeCounts) {
    const total = Array.from(timeCounts.values()).reduce((a, b) => a + b, 0);
    if (total === 0) {
      driverTimeSlots.set(driverId, { dominantTime: null, confidence: 0 });
      continue;
    }

    // Find the most common time slot
    let maxTime = "";
    let maxCount = 0;
    for (const [time, count] of timeCounts) {
      if (count > maxCount) {
        maxCount = count;
        maxTime = time;
      }
    }

    const confidence = maxCount / total;

    // Only lock to a time slot if 70%+ confidence
    if (confidence >= 0.70) {
      driverTimeSlots.set(driverId, { dominantTime: maxTime, confidence });
    } else {
      // Driver works varied times - don't lock them
      driverTimeSlots.set(driverId, { dominantTime: null, confidence });
    }
  }

  console.log(`[XGBoost-Matcher] Learned time slots for ${driverTimeSlots.size} drivers from 12-week history`);

  // Log some examples of locked drivers
  let lockedCount = 0;
  for (const [driverId, slot] of driverTimeSlots) {
    if (slot.dominantTime) {
      lockedCount++;
      if (lockedCount <= 5) {
        console.log(`  ${driverId.slice(0, 8)}... locked to ${slot.dominantTime} (${Math.round(slot.confidence * 100)}%)`);
      }
    }
  }
  console.log(`[XGBoost-Matcher] ${lockedCount} drivers locked to specific time slots`);

  return driverTimeSlots;
}

/**
 * Learn driver's primary contract type from their 12-week assignment history.
 * Uses the 80% rule: if 80%+ of assignments are one type, that's their type.
 * Otherwise they work "both" types.
 */
async function getDriverTypesFromHistory(
  tenantId: string
): Promise<Map<string, "solo1" | "solo2" | "both">> {
  const driverTypes = new Map<string, "solo1" | "solo2" | "both">();

  // Look back 12 weeks
  const cutoffDate = subWeeks(new Date(), 12);

  // Query all assignments with block info for the last 12 weeks
  const historicalAssignments = await db
    .select({
      driverId: blockAssignments.driverId,
      soloType: blocks.soloType,
    })
    .from(blockAssignments)
    .innerJoin(blocks, eq(blockAssignments.blockId, blocks.id))
    .where(
      and(
        eq(blockAssignments.tenantId, tenantId),
        eq(blockAssignments.isActive, true),
        gte(blocks.serviceDate, cutoffDate)
      )
    );

  // Count Solo1 vs Solo2 per driver
  const driverCounts = new Map<string, { solo1: number; solo2: number }>();

  for (const a of historicalAssignments) {
    const type = (a.soloType || "solo1").toLowerCase();
    const counts = driverCounts.get(a.driverId) || { solo1: 0, solo2: 0 };

    if (type === "solo1") {
      counts.solo1++;
    } else if (type === "solo2") {
      counts.solo2++;
    }

    driverCounts.set(a.driverId, counts);
  }

  // Apply 80% rule to determine primary type
  for (const [driverId, counts] of driverCounts) {
    const total = counts.solo1 + counts.solo2;
    if (total === 0) {
      driverTypes.set(driverId, "both"); // No history, can do either
      continue;
    }

    const solo1Pct = counts.solo1 / total;
    const solo2Pct = counts.solo2 / total;

    if (solo1Pct >= 0.80) {
      driverTypes.set(driverId, "solo1");
    } else if (solo2Pct >= 0.80) {
      driverTypes.set(driverId, "solo2");
    } else {
      driverTypes.set(driverId, "both"); // Mixed history
    }
  }

  console.log(`[XGBoost-Matcher] Learned types for ${driverTypes.size} drivers from 12-week history`);
  return driverTypes;
}

/**
 * Load approved special requests for a date range.
 * Returns unavailability map and priority drivers map.
 */
async function loadSpecialRequests(
  tenantId: string,
  weekStart: Date,
  weekEnd: Date
): Promise<{
  unavailableDates: Map<string, Set<string>>; // driverId → Set of "yyyy-MM-dd" dates
  priorityDrivers: Map<string, number>; // driverId → target days
}> {
  const unavailableDates = new Map<string, Set<string>>();
  const priorityDrivers = new Map<string, number>();

  // Query approved requests that overlap with the week
  const approvedRequests = await db
    .select()
    .from(specialRequests)
    .where(
      and(
        eq(specialRequests.tenantId, tenantId),
        eq(specialRequests.status, "approved"),
        or(
          // Request starts before/during the week
          lte(specialRequests.startDate, weekEnd),
          isNull(specialRequests.startDate)
        )
      )
    );

  for (const req of approvedRequests) {
    if (!req.startDate) continue;

    const reqStart = new Date(req.startDate);
    const reqEnd = req.endDate ? new Date(req.endDate) : reqStart;

    // Check if request overlaps with the week
    if (reqEnd < weekStart || reqStart > weekEnd) continue;

    if (req.availabilityType === "unavailable") {
      // Add all dates in range to unavailable set
      const dates = eachDayOfInterval({
        start: reqStart < weekStart ? weekStart : reqStart,
        end: reqEnd > weekEnd ? weekEnd : reqEnd,
      });

      let driverUnavail = unavailableDates.get(req.driverId);
      if (!driverUnavail) {
        driverUnavail = new Set();
        unavailableDates.set(req.driverId, driverUnavail);
      }

      for (const d of dates) {
        driverUnavail.add(format(d, "yyyy-MM-dd"));
      }
    } else if (req.availabilityType === "available") {
      // This is a "give me more work" request
      // Count days in the request that fall within the week
      const dates = eachDayOfInterval({
        start: reqStart < weekStart ? weekStart : reqStart,
        end: reqEnd > weekEnd ? weekEnd : reqEnd,
      });

      const currentTarget = priorityDrivers.get(req.driverId) || 0;
      priorityDrivers.set(req.driverId, currentTarget + dates.length);
    }
  }

  console.log(`[XGBoost-Matcher] Loaded ${unavailableDates.size} drivers with unavailability, ${priorityDrivers.size} priority drivers`);
  return { unavailableDates, priorityDrivers };
}

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const DAY_NAMES_UPPER = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * FAST Pre-pass eligibility check (SYNCHRONOUS - no DOT validation)
 *
 * Used in pre-pass to quickly estimate constraint tightness.
 * DOT validation is expensive (async), so we skip it here and do it
 * during the main assignment loop where we can parallelize.
 *
 * This catches ~80% of ineligible drivers without any async overhead.
 */
function checkFastConstraints(
  driver: { id: string; name: string; contractType: "solo1" | "solo2" | "both" },
  block: BlockInfo,
  busyDates: Set<string>,
  unavailableDates: Map<string, Set<string>>,
  driverDaysOff: Map<string, string[]>,
  driverPatterns: Record<string, DriverPattern>,
  driverTimeSlots: Map<string, { dominantTime: string | null; confidence: number }>
): boolean {
  const driverId = driver.id;

  // 0. TIME SLOT GATE (NEW!) - Most important constraint
  // If driver is locked to a specific time slot, they can ONLY work that slot
  // This is the fix for Brian (00:30) and Richard (01:30) being assigned wrong times
  const timeSlot = driverTimeSlots.get(driverId);
  if (timeSlot?.dominantTime) {
    // Driver is locked to a specific time - check if block matches
    // Block time is already in HH:mm format
    if (block.time !== timeSlot.dominantTime) {
      return false; // HARD EXCLUDE - driver's time slot doesn't match block
    }
  }

  // 1. Already busy on any day this block covers?
  const startDay = new Date(block.startTimestamp);
  const endDay = new Date(block.endTimestamp);
  let checkDay = new Date(startDay);
  checkDay.setHours(0, 0, 0, 0);
  while (checkDay <= endDay) {
    const dateStr = format(checkDay, "yyyy-MM-dd");
    if (busyDates.has(`${driverId}_${dateStr}`)) {
      return false;
    }
    checkDay.setDate(checkDay.getDate() + 1);
  }

  // 2. Time-off request on any day this block covers?
  const driverUnavail = unavailableDates.get(driverId);
  if (driverUnavail) {
    checkDay = new Date(startDay);
    checkDay.setHours(0, 0, 0, 0);
    while (checkDay <= endDay) {
      const dateStr = format(checkDay, "yyyy-MM-dd");
      if (driverUnavail.has(dateStr)) {
        return false;
      }
      checkDay.setDate(checkDay.getDate() + 1);
    }
  }

  // 3. Configured day off?
  const driverOff = driverDaysOff.get(driverId);
  if (driverOff && driverOff.includes(block.dayName.toLowerCase())) {
    return false;
  }

  // 4. Contract type mismatch?
  if (driver.contractType === "solo1" && block.contractType === "solo2") {
    return false;
  }
  if (driver.contractType === "solo2" && block.contractType === "solo1") {
    return false;
  }

  // 5. Pattern confidence too low?
  const pattern = findByNormalizedName(driverPatterns, driver.name);
  const patternConfidence = pattern?.confidence ?? 0;
  if (patternConfidence < 0.1) {
    return false;
  }

  // NOTE: DOT validation (10-hour rest, rolling hours) is SKIPPED here for performance.
  // It will be checked during the main assignment loop with parallelization.
  // This may over-estimate eligibility by ~10-20%, but the main loop will catch it.

  return true;
}

/**
 * Block difficulty entry for Smart Greedy sorting
 */
interface BlockDifficulty {
  block: BlockInfo;
  fullBlock: Block;
  eligibleDriverIds: Set<string>;
  eligibleCount: number;
}

/**
 * Normalize a name for matching (handles whitespace differences from CSV imports)
 */
function normalizeName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Find a value in a dictionary using normalized name matching
 */
function findByNormalizedName<T>(dict: Record<string, T>, name: string): T | undefined {
  const normalizedName = normalizeName(name);
  for (const [key, value] of Object.entries(dict)) {
    if (normalizeName(key) === normalizedName) {
      return value;
    }
  }
  return undefined;
}

interface DriverInfo {
  id: string;
  name: string;
  contractType: "solo1" | "solo2" | "both";
}

interface BlockInfo {
  id: string;
  dayIndex: number;
  dayName: string;
  time: string;
  contractType: string;
  serviceDate: string;
  tractorId: string;
  startTimestamp: Date;
  endTimestamp: Date;
}

interface MatchResult {
  blockId: string;
  driverId: string;
  driverName: string;
  score: number;
  reasons: string[];
  confidence: number;
  matchType: string;
  ownershipPct: number;
  slotType: string;
  // Block info for display
  blockInfo: {
    serviceDate: string;
    startTime: string;
    tractorId: string;
    contractType: string;
    dayName: string;
  };
}

/**
 * Calculate XGBoost-based score for a driver-block pair
 *
 * NEW: Includes unavailability check, priority boost, rotation penalty, and type matching
 */
function calculateXGBoostScore(
  driverName: string,
  driverId: string,
  driverType: "solo1" | "solo2" | "both",
  block: BlockInfo,
  ownershipData: SlotDistribution | null,
  driverPattern: DriverPattern | undefined,
  currentDayCount: number,
  busyDates: Set<string>,
  unavailableDates: Map<string, Set<string>>,
  priorityDrivers: Map<string, number>,
  affinityCache: Map<string, number>, // Pattern affinity scores: "driverId_slotKey" -> score (0.0-1.0)
  predictability: number = 0.7,
  minDays: number = 3
): { score: number; reasons: string[]; ownershipPct: number; matchType: string } | null {

  // HARD CONSTRAINT: Driver already assigned on ANY day this block covers
  // Solo2 blocks span 38h = 2+ days, so check all days
  const startDay = new Date(block.startTimestamp);
  const endDay = new Date(block.endTimestamp);
  let checkDay = new Date(startDay);
  checkDay.setHours(0, 0, 0, 0);

  while (checkDay <= endDay) {
    const dateStr = format(checkDay, "yyyy-MM-dd");
    if (busyDates.has(`${driverId}_${dateStr}`)) {
      return null; // Driver busy on one of the days this block covers
    }
    checkDay.setDate(checkDay.getDate() + 1);
  }

  // HARD CONSTRAINT: Driver has approved time-off on ANY day this block covers
  const driverUnavail = unavailableDates.get(driverId);
  if (driverUnavail) {
    checkDay = new Date(startDay);
    checkDay.setHours(0, 0, 0, 0);
    while (checkDay <= endDay) {
      const dateStr = format(checkDay, "yyyy-MM-dd");
      if (driverUnavail.has(dateStr)) {
        return null; // Driver has time-off on one of the days
      }
      checkDay.setDate(checkDay.getDate() + 1);
    }
  }

  // SOFT CONSTRAINT: Don't exceed driver's typical days pattern
  const maxDays = driverPattern?.typical_days ?? 6;
  if (currentDayCount >= maxDays) {
    return null;
  }

  const reasons: string[] = [];

  // TYPE MATCHING: Disabled - drivers work BOTH Solo1 and Solo2
  // Typical schedule: 4-5 Solo1 blocks + 2 Solo2 blocks per driver
  const typeBonus: number = 0;

  // Get ownership score (0-1) from XGBoost
  // FIX: Default to 0.0 (not 0.5) if driver has no ownership of this slot
  // A driver with NO history of working a slot should score 0%, not 50%
  // Use normalized name matching to handle whitespace differences from CSV imports
  const foundOwnership = ownershipData?.shares
    ? findByNormalizedName(ownershipData.shares, driverName)
    : undefined;
  const rawOwnership = foundOwnership ?? 0.0;

  // Debug: Log when we find vs miss (only first few to avoid spam)
  if (ownershipData?.shares && Object.keys(ownershipData.shares).length > 0) {
    const shareKeys = Object.keys(ownershipData.shares).slice(0, 3).join(', ');
    if (foundOwnership !== undefined) {
      console.log(`[XGBoost] MATCH: "${driverName}" -> ${Math.round(foundOwnership * 100)}%`);
    } else {
      console.log(`[XGBoost] MISS: "${driverName}" not in [${shareKeys}...]`);
    }
  }

  // Clamp to 0-1 range to prevent display issues
  const ownershipScore = Math.max(0, Math.min(1.0, rawOwnership));
  const ownershipPct = Math.round(ownershipScore * 100);

  // Get PATTERN AFFINITY score from XGBoost (how well does this slot match driver's history?)
  // This is pattern matching, not prediction. 1.0 = strong historical match, 0.0 = no match.
  // Cache key: "driverId_soloType|tractorId|date" -> affinity score (0.0 to 1.0)
  const slotKey = `${(block.contractType || 'solo1').toLowerCase()}|${block.tractorId || 'Tractor_1'}|${block.serviceDate}`;
  const affinityCacheKey = `${driverId}_${slotKey}`;
  const patternAffinity = affinityCache.get(affinityCacheKey);

  // Use pattern affinity if available, otherwise fall back to day-list check
  let affinityScore: number;
  if (patternAffinity !== undefined) {
    // Pattern affinity score 0.0-1.0 (how well slot matches driver's history)
    affinityScore = patternAffinity;
  } else {
    // Fallback: day-list check with proper handling of empty/missing patterns
    // FIX #2: Empty day_list should NOT default to "works any day"
    const hasDayList = driverPattern?.day_list && driverPattern.day_list.length > 0;

    if (!hasDayList) {
      // No pattern data = low affinity (driver has insufficient history)
      affinityScore = 0.3;
    } else {
      const dayNameLower = block.dayName.toLowerCase();
      const worksThisDay = driverPattern.day_list.some(
        d => d.toLowerCase() === dayNameLower
      );
      affinityScore = worksThisDay ? 1.0 : 0.6;
    }
  }

  // COMBINED SCORE FORMULA:
  // Base = ownership × weight + affinity × (1 - weight)
  // Both scores are pattern-based: ownership (who owns the slot) + affinity (historical fit)
  const baseScore = (ownershipScore * predictability) + (affinityScore * (1 - predictability));

  // FIX #5: Cap fairness/minDays bonuses for drivers with weak patterns
  // Drivers with low confidence patterns should NOT get full bonuses
  // This prevents inactive drivers from scoring higher than active regulars
  const patternConfidence = driverPattern?.confidence ?? 0;
  const confidenceMultiplier = patternConfidence < 0.5 ? 0.5 : 1.0;

  // Fairness bonus: prefer drivers with fewer days this week
  // Increased from 0.05 to 0.08 to better spread work across drivers
  // Reduced by 50% for drivers with weak patterns (confidence < 0.5)
  const fairnessBonus = Math.max(0, (6 - currentDayCount)) * 0.08 * confidenceMultiplier;

  // MinDays boost: drivers below minimum should get priority
  // Reduced by 50% for drivers with weak patterns (confidence < 0.5)
  let minDaysBoost = 0;
  if (currentDayCount < minDays) {
    // Strong boost for drivers who haven't reached minimum yet
    minDaysBoost = 0.20 * confidenceMultiplier;
    reasons.push(`📊 Below min (${currentDayCount}/${minDays})`);
  }

  // Priority boost: boost drivers with special "give me more work" requests
  let priorityBoost = 0;
  const targetDays = priorityDrivers.get(driverId);
  if (targetDays && currentDayCount < targetDays) {
    priorityBoost = 0.15; // Boost for priority drivers
    reasons.push(`⭐ Priority: ${targetDays}d target`);
  }

  const rawScore = baseScore + typeBonus + fairnessBonus + minDaysBoost + priorityBoost;
  // Cap final score at 1.0 to prevent display issues
  const finalScore = Math.min(1.0, rawScore);

  // Build reasons and match type
  let matchType: string;

  if (ownershipScore >= 0.70) {
    reasons.push(`★ Owns slot (${ownershipPct}%)`);
    matchType = 'owner';
  } else if (ownershipScore >= 0.30) {
    reasons.push(`◐ Shares slot (${ownershipPct}%)`);
    matchType = 'shared';
  } else if (affinityScore >= 0.70) {
    reasons.push(`○ Pattern ${Math.round(affinityScore * 100)}%`);
    matchType = 'pattern';
  } else {
    reasons.push(`△ Weak ${Math.round(affinityScore * 100)}%`);
    matchType = 'fallback';
  }

  // Add pattern info
  const typicalDays = driverPattern?.typical_days ?? 6;
  reasons.push(`${typicalDays}d pattern`);

  if (currentDayCount === 0) {
    reasons.push('NeedsWork');
  }

  // Must have minimum score to be considered
  if (finalScore < 0.1) {
    return null;
  }

  return {
    score: Math.round(finalScore * 100) / 100,
    reasons,
    ownershipPct,
    matchType
  };
}

/**
 * Main deterministic matching function using XGBoost
 */
// Type for excluded driver information (for graceful error handling)
export interface ExcludedDriver {
  id: string;
  name: string;
  reason: 'insufficient_history' | 'low_confidence' | 'new_driver';
  assignmentCount?: number;
  patternConfidence?: number;
}

export async function matchDeterministic(
  tenantId: string,
  weekStart: Date,
  contractTypeFilter?: "solo1" | "solo2",
  minDays: number = 3,
  predictability: number = 0.7
): Promise<{
  suggestions: MatchResult[];
  unassigned: string[];
  unassignedWithReasons: Array<{
    blockId: string;
    reason: string;
    details: string[];
    blockInfo: {
      serviceDate: string;
      startTime: string;
      tractorId: string;
      contractType: string;
    };
  }>;
  excludedDrivers: ExcludedDriver[];
  stats: {
    totalBlocks: number;
    totalDrivers: number;
    assigned: number;
    unassigned: number;
    solverStatus: string;
  };
}> {
  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 0 });
  console.log(`[XGBoost-Matcher] Starting for ${format(weekStart, "yyyy-MM-dd")} to ${format(weekEnd, "yyyy-MM-dd")}`);

  // 1. Get all active drivers (no soloType field - will learn from history)
  const allDriversRaw = await db
    .select({
      id: drivers.id,
      firstName: drivers.firstName,
      lastName: drivers.lastName,
      isActive: drivers.isActive,
      daysOff: drivers.daysOff,
    })
    .from(drivers)
    .where(
      and(
        eq(drivers.tenantId, tenantId),
        eq(drivers.status, "active"),
        // Filter out drivers marked as inactive in Driver Profiles page
        or(isNull(drivers.isActive), eq(drivers.isActive, true))
      )
    );

  // 2. Learn driver types from 12-week assignment history
  console.log(`[XGBoost-Matcher] Learning driver types from 12-week history...`);
  const learnedTypes = await getDriverTypesFromHistory(tenantId);

  // 2b. Learn driver TIME SLOTS from 12-week assignment history (NEW!)
  // This is the key fix: drivers like Brian (00:30) and Richard (01:30)
  // should ONLY be matched to blocks at their respective times
  console.log(`[XGBoost-Matcher] Learning driver time slots from 12-week history...`);
  const driverTimeSlots = await getDriverTimeSlots(tenantId);

  // 3. Load approved special requests (unavailability + priority)
  console.log(`[XGBoost-Matcher] Loading special requests...`);
  const { unavailableDates, priorityDrivers } = await loadSpecialRequests(tenantId, weekStart, weekEnd);

  // Build driver info with learned types
  const driverInfos: DriverInfo[] = allDriversRaw.map(d => ({
    id: d.id,
    name: `${d.firstName} ${d.lastName}`.trim(),
    // Use learned type from history, default to "both" if no history
    contractType: learnedTypes.get(d.id) || "both",
  }));

  // Build map of driver ID to days off (from Driver Profiles page settings)
  const driverDaysOff = new Map<string, string[]>();
  for (const d of allDriversRaw) {
    if (d.daysOff && d.daysOff.length > 0) {
      // Normalize to lowercase for comparison
      driverDaysOff.set(d.id, d.daysOff.map(day => day.toLowerCase()));
    }
  }
  console.log(`[XGBoost-Matcher] ${driverDaysOff.size} drivers have days off configured`);

  console.log(`[XGBoost-Matcher] ${driverInfos.length} active drivers`);

  // Log driver type breakdown
  const solo1Count = driverInfos.filter(d => d.contractType === "solo1").length;
  const solo2Count = driverInfos.filter(d => d.contractType === "solo2").length;
  const bothCount = driverInfos.filter(d => d.contractType === "both").length;
  console.log(`[XGBoost-Matcher] Types: ${solo1Count} Solo1, ${solo2Count} Solo2, ${bothCount} Both`);

  // 2. Load ALL driver patterns from XGBoost (single call)
  // If patterns are stale or missing, this will use the trained model from "Re-analyze" button
  console.log(`[XGBoost-Matcher] Loading driver patterns from XGBoost...`);
  let patternsResult = await getAllDriverPatterns();

  // If no patterns found, the model may not be trained - warn user
  if (!patternsResult.success || !patternsResult.data?.patterns || Object.keys(patternsResult.data.patterns).length === 0) {
    console.log(`[XGBoost-Matcher] WARNING: No driver patterns found. User should click "Re-analyze Driver Patterns" first.`);
  }

  const driverPatterns: Record<string, DriverPattern> =
    patternsResult.success && patternsResult.data?.patterns
      ? patternsResult.data.patterns
      : {};
  console.log(`[XGBoost-Matcher] Loaded ${Object.keys(driverPatterns).length} driver patterns`);

  // 3. Load canonical start times from contracts table
  const allContracts = await db
    .select({
      type: contracts.type,
      tractorId: contracts.tractorId,
      startTime: contracts.startTime,
    })
    .from(contracts)
    .where(eq(contracts.tenantId, tenantId));

  const canonicalStartTimes: Record<string, string> = {};
  for (const c of allContracts) {
    const key = `${c.type.toLowerCase()}_${c.tractorId}`;
    canonicalStartTimes[key] = c.startTime;
  }
  console.log(`[XGBoost-Matcher] Loaded ${Object.keys(canonicalStartTimes).length} canonical times from contracts`);

  // 4. Load full driver records for DOT validation (also filter inactive)
  const fullDrivers = await db
    .select()
    .from(drivers)
    .where(
      and(
        eq(drivers.tenantId, tenantId),
        eq(drivers.status, "active"),
        // Filter out drivers marked as inactive in Driver Profiles page
        or(isNull(drivers.isActive), eq(drivers.isActive, true))
      )
    );
  const driverMap = new Map(fullDrivers.map(d => [d.id, d]));

  // 5. Load protected driver rules
  const protectedRules = await db
    .select()
    .from(protectedDriverRules)
    .where(eq(protectedDriverRules.tenantId, tenantId));
  console.log(`[XGBoost-Matcher] Loaded ${protectedRules.length} protected driver rules`);

  // 6. Load existing assignments WITH blocks for DOT lookback (past 7 days + this week)
  const dotLookbackStart = subDays(weekStart, 7);
  const existingAssignmentsWithBlocks = await db
    .select({
      assignment: blockAssignments,
      block: blocks,
    })
    .from(blockAssignments)
    .innerJoin(blocks, eq(blockAssignments.blockId, blocks.id))
    .where(
      and(
        eq(blockAssignments.tenantId, tenantId),
        eq(blockAssignments.isActive, true),
        gte(blocks.serviceDate, dotLookbackStart)
      )
    );

  // Group by driver for quick lookup (DOT validation)
  const assignmentsByDriver = new Map<string, Array<typeof blockAssignments.$inferSelect & { block: typeof blocks.$inferSelect }>>();
  for (const row of existingAssignmentsWithBlocks) {
    const driverId = row.assignment.driverId;
    if (!assignmentsByDriver.has(driverId)) {
      assignmentsByDriver.set(driverId, []);
    }
    assignmentsByDriver.get(driverId)!.push({
      ...row.assignment,
      block: row.block,
    });
  }
  console.log(`[XGBoost-Matcher] Loaded ${existingAssignmentsWithBlocks.length} existing assignments for DOT validation`);

  // 6b. Load 12-week assignment history for driver filtering
  // This is separate from DOT lookback because we need full 12 weeks for pattern analysis
  const historyLookbackStart = subWeeks(new Date(), 12);
  const historicalAssignmentCounts = await db
    .select({
      driverId: blockAssignments.driverId,
      count: sql<number>`count(*)::int`,
    })
    .from(blockAssignments)
    .innerJoin(blocks, eq(blockAssignments.blockId, blocks.id))
    .where(
      and(
        eq(blockAssignments.tenantId, tenantId),
        eq(blockAssignments.isActive, true),
        gte(blocks.serviceDate, historyLookbackStart)
      )
    )
    .groupBy(blockAssignments.driverId);

  // Create map of driver ID to 12-week assignment count
  const driverHistoryCounts = new Map<string, number>();
  for (const row of historicalAssignmentCounts) {
    driverHistoryCounts.set(row.driverId, row.count);
  }
  console.log(`[XGBoost-Matcher] 12-week history: ${historicalAssignmentCounts.length} drivers with assignments`);

  // FIX #1: Filter out drivers with insufficient history (< 12 assignments in 12 weeks)
  // This excludes part-time/on-call drivers who only work occasionally
  // NOTE: Lowered threshold from 12 to 4 to be more lenient for new deployments
  const MIN_ASSIGNMENTS_12_WEEKS = 4; // Minimum ~1 assignment per 3 weeks
  const driversBeforeFilter = driverInfos.length;

  // Track excluded drivers for graceful error handling (Pillar 4: Resilience)
  const excludedDrivers: ExcludedDriver[] = [];

  // Filter driverInfos to only include drivers with sufficient history
  // Use the 12-week historical count, not the 7-day DOT lookback
  const reliableDriverInfos = driverInfos.filter(driver => {
    const assignmentCount = driverHistoryCounts.get(driver.id) || 0;

    if (assignmentCount < MIN_ASSIGNMENTS_12_WEEKS) {
      console.log(`[XGBoost-Matcher] Excluding ${driver.name}: only ${assignmentCount} assignments in 12 weeks (need ${MIN_ASSIGNMENTS_12_WEEKS})`);
      excludedDrivers.push({
        id: driver.id,
        name: driver.name,
        reason: assignmentCount === 0 ? 'new_driver' : 'insufficient_history',
        assignmentCount,
      });
      return false;
    }

    return true;
  });

  console.log(`[XGBoost-Matcher] ${reliableDriverInfos.length}/${driversBeforeFilter} drivers meet minimum assignment threshold (${MIN_ASSIGNMENTS_12_WEEKS}+ in 12 weeks)`);

  // Also check for low-confidence patterns among reliable drivers and track them
  const MIN_PATTERN_CONFIDENCE = 0.1;
  for (const driver of reliableDriverInfos) {
    const pattern = findByNormalizedName(driverPatterns, driver.name);
    const patternConfidence = pattern?.confidence ?? 0;
    if (patternConfidence < MIN_PATTERN_CONFIDENCE) {
      // Don't exclude yet, but track for user notification
      // The per-block loop will skip them, but we want to inform the user
      excludedDrivers.push({
        id: driver.id,
        name: driver.name,
        reason: 'low_confidence',
        patternConfidence,
      });
    }
  }

  if (excludedDrivers.length > 0) {
    console.log(`[XGBoost-Matcher] ${excludedDrivers.length} drivers excluded (will notify user for graceful handling)`);
  }

  // 7. Get all block assignments for conflict checking
  const allBlockAssignments = await db
    .select()
    .from(blockAssignments)
    .where(
      and(
        eq(blockAssignments.tenantId, tenantId),
        eq(blockAssignments.isActive, true)
      )
    );

  // 8. Get unassigned blocks for the week
  const weekEndPlusOne = new Date(weekEnd);
  weekEndPlusOne.setDate(weekEndPlusOne.getDate() + 1);

  console.log(`[XGBoost-Matcher] DEBUG: Looking for blocks between ${format(weekStart, "yyyy-MM-dd")} and ${format(weekEndPlusOne, "yyyy-MM-dd")}`);
  console.log(`[XGBoost-Matcher] DEBUG: Tenant ID: ${tenantId}`);

  const allBlocks = await db
    .select()
    .from(blocks)
    .where(
      and(
        eq(blocks.tenantId, tenantId),
        gte(blocks.serviceDate, weekStart),
        lte(blocks.serviceDate, weekEndPlusOne)
      )
    );

  console.log(`[XGBoost-Matcher] DEBUG: Found ${allBlocks.length} total blocks in date range`);

  const existingAssignments = await db
    .select({ blockId: blockAssignments.blockId })
    .from(blockAssignments)
    .where(
      and(
        eq(blockAssignments.tenantId, tenantId),
        eq(blockAssignments.isActive, true)
      )
    );

  const assignedBlockIds = new Set(existingAssignments.map(a => a.blockId));

  const blockInfos: BlockInfo[] = allBlocks
    .filter(b => !assignedBlockIds.has(b.id))
    .filter(b => {
      if (!contractTypeFilter) return true;
      return b.soloType?.toLowerCase() === contractTypeFilter.toLowerCase();
    })
    .map(b => {
      const serviceDate = new Date(b.serviceDate);
      const dayIndex = serviceDate.getDay();
      const dayName = DAY_NAMES[dayIndex];
      const soloType = (b.soloType || "solo1").toLowerCase();
      const tractorId = b.tractorId || "Tractor_1";
      const lookupKey = `${soloType}_${tractorId}`;
      const time = canonicalStartTimes[lookupKey] || "00:00";

      return {
        id: b.id,
        dayIndex,
        dayName,
        time,
        contractType: soloType,
        serviceDate: format(serviceDate, "yyyy-MM-dd"),
        tractorId,
        startTimestamp: new Date(b.startTimestamp),
        endTimestamp: new Date(b.endTimestamp),
      };
    });

  // Sort blocks by date then time for consistent processing
  blockInfos.sort((a, b) => {
    if (a.serviceDate !== b.serviceDate) return a.serviceDate.localeCompare(b.serviceDate);
    return a.time.localeCompare(b.time);
  });

  console.log(`[XGBoost-Matcher] ${blockInfos.length} unassigned blocks to match`);

  // 9. Score Slot Pattern Affinity - ONE batch call for ALL drivers × ALL blocks
  // This is PATTERN MATCHING, not prediction. We score how well each slot matches each driver's history.
  // Cache key: "driverId_soloType|tractorId|date" -> affinity score (0.0-1.0)
  const affinityCache = new Map<string, number>();

  if (blockInfos.length > 0 && driverInfos.length > 0) {
    // Build unique block slot info (date + soloType + tractorId combinations)
    const blockSlots: BlockSlotInfo[] = blockInfos.map(b => ({
      date: b.serviceDate,
      soloType: b.contractType || 'solo1',
      tractorId: b.tractorId || 'Tractor_1',
    }));

    // Build driver history from existing assignments (last 12 weeks)
    const driversWithHistory = driverInfos.map(driver => {
      const driverAssignments = assignmentsByDriver.get(driver.id) || [];
      const history: DriverHistoryItem[] = driverAssignments.map(a => ({
        serviceDate: format(new Date(a.block.serviceDate), "yyyy-MM-dd"),
        soloType: a.block.soloType || undefined,
        tractorId: a.block.tractorId || undefined,
      }));

      return {
        id: driver.id,
        name: driver.name,
        history,
      };
    });

    console.log(`[XGBoost-Matcher] Scoring pattern affinity: ${driversWithHistory.length} drivers × ${blockSlots.length} slots`);

    const affinityResult = await getBatchSlotAffinity(driversWithHistory, blockSlots);

    if (affinityResult.success && affinityResult.data?.predictions) {
      // Cache affinity scores: "driverId_soloType|tractorId|date" -> score
      for (const [driverId, slotScores] of Object.entries(affinityResult.data.predictions)) {
        for (const [slotKey, score] of Object.entries(slotScores as Record<string, number>)) {
          // slotKey is "soloType|tractorId|date"
          affinityCache.set(`${driverId}_${slotKey}`, score);
        }
      }
      console.log(`[XGBoost-Matcher] Pattern affinity scored ${affinityCache.size} driver-slot pairs`);
    } else {
      console.log(`[XGBoost-Matcher] Pattern scoring failed, using fallback: ${affinityResult.error || 'unknown error'}`);
    }
  }

  if (blockInfos.length === 0 || driverInfos.length === 0) {
    return {
      suggestions: [],
      unassigned: blockInfos.map(b => b.id),
      unassignedWithReasons: blockInfos.map(b => ({
        blockId: b.id,
        reason: driverInfos.length === 0 ? "No eligible drivers available" : "Block data error",
        details: [driverInfos.length === 0 ? "No active drivers found for this tenant" : "Block information incomplete"],
        blockInfo: {
          serviceDate: b.serviceDate,
          startTime: format(new Date(b.startTimestamp), "HH:mm"),
          tractorId: b.tractorId,
          contractType: b.contractType,
        },
      })),
      excludedDrivers,
      stats: {
        totalBlocks: blockInfos.length,
        totalDrivers: driverInfos.length,
        assigned: 0,
        unassigned: blockInfos.length,
        solverStatus: blockInfos.length === 0 ? "NO_BLOCKS" : "NO_DRIVERS",
      },
    };
  }

  // 5. Cache slot distributions from XGBoost ownership model
  // PRE-LOAD all unique slots in parallel for performance (avoids per-block Python calls)
  const slotDistributionCache = new Map<string, SlotDistribution | null>();
  let pythonCallCount = 0;
  const SKIP_PYTHON = false; // Enable XGBoost ownership predictions

  if (!SKIP_PYTHON && blockInfos.length > 0) {
    // Collect unique slot combinations
    const uniqueSlots = new Map<string, { soloType: string; tractorId: string; dayOfWeek: number; time: string }>();
    for (const block of blockInfos) {
      const cacheKey = `${block.contractType}_${block.tractorId}_${block.dayIndex}_${block.time}`;
      if (!uniqueSlots.has(cacheKey)) {
        uniqueSlots.set(cacheKey, {
          soloType: block.contractType,
          tractorId: block.tractorId,
          dayOfWeek: block.dayIndex,
          time: block.time,
        });
      }
    }

    console.log(`[XGBoost-Matcher] Pre-loading ${uniqueSlots.size} unique slot distributions...`);

    // PERFORMANCE: Single Python call for ALL slots (loads model once)
    const slotEntries = Array.from(uniqueSlots.entries());
    const slotsForBatch = slotEntries.map(([cacheKey, slot]) => ({
      soloType: slot.soloType,
      tractorId: slot.tractorId,
      dayOfWeek: slot.dayOfWeek,
      canonicalTime: slot.time,
    }));

    pythonCallCount++; // Just 1 call now!
    const batchResult = await getBatchSlotDistributions(slotsForBatch);

    if (batchResult.success && batchResult.data?.distributions) {
      // Populate cache from batch result
      for (const [cacheKey, dist] of Object.entries(batchResult.data.distributions)) {
        slotDistributionCache.set(cacheKey, dist);
      }
    }

    console.log(`[XGBoost-Matcher] Pre-loaded ${slotDistributionCache.size} slot distributions (${pythonCallCount} Python call)`);
  }

  function getSlotDistributionCached(
    soloType: string,
    tractorId: string,
    dayOfWeek: number,
    canonicalTime: string
  ): SlotDistribution | null {
    if (SKIP_PYTHON) {
      return null;
    }
    const cacheKey = `${soloType}_${tractorId}_${dayOfWeek}_${canonicalTime}`;
    return slotDistributionCache.get(cacheKey) || null;
  }

  // ============================================================================
  // SMART GREEDY: Pre-pass to calculate constraint tightness
  // ============================================================================
  // Instead of processing blocks in date order (which assigns "easy" blocks first
  // and leaves hard blocks unassignable), we:
  // 1. PRE-PASS: Count eligible drivers for every block
  // 2. SORT: Process hardest blocks first (fewest eligible drivers)
  // 3. EXECUTE: Use XGBoost scores as tie-breaker among eligible drivers
  // ============================================================================

  console.log(`[Smart Greedy] Starting pre-pass: calculating eligible drivers for ${blockInfos.length} blocks...`);

  // Build busyDates set from existing assignments (for constraint checking)
  const busyDates = new Set<string>();
  for (const [driverId, assignments] of assignmentsByDriver) {
    for (const a of assignments) {
      const serviceDate = format(new Date(a.block.serviceDate), "yyyy-MM-dd");
      busyDates.add(`${driverId}_${serviceDate}`);
    }
  }

  // PRE-PASS: Calculate eligible drivers for each block
  const blockDifficultyList: BlockDifficulty[] = [];

  for (const block of blockInfos) {
    const fullBlock = allBlocks.find(b => b.id === block.id);
    if (!fullBlock) continue;

    const eligibleDriverIds = new Set<string>();

    // Check each driver against FAST constraints (no DOT validation - done in main loop)
    for (const driver of reliableDriverInfos) {
      // Use synchronous fast constraint check (no async DOT validation)
      const isEligible = checkFastConstraints(
        driver,
        block,
        busyDates,
        unavailableDates,
        driverDaysOff,
        driverPatterns,
        driverTimeSlots  // NEW: Time slot gate - locks drivers to their dominant time
      );

      if (isEligible) {
        eligibleDriverIds.add(driver.id);
      }
    }

    blockDifficultyList.push({
      block,
      fullBlock,
      eligibleDriverIds,
      eligibleCount: eligibleDriverIds.size,
    });
  }

  // SORT: Hardest blocks first (fewest eligible drivers)
  // Secondary sort by date/time for stability
  blockDifficultyList.sort((a, b) => {
    if (a.eligibleCount !== b.eligibleCount) {
      return a.eligibleCount - b.eligibleCount; // Fewest first (hardest)
    }
    // Tie-breaker: earlier date/time first
    return new Date(a.block.startTimestamp).getTime() -
           new Date(b.block.startTimestamp).getTime();
  });

  // Log difficulty distribution
  const zeroEligible = blockDifficultyList.filter(b => b.eligibleCount === 0).length;
  const oneEligible = blockDifficultyList.filter(b => b.eligibleCount === 1).length;
  const twoThreeEligible = blockDifficultyList.filter(b => b.eligibleCount >= 2 && b.eligibleCount <= 3).length;
  const fourPlusEligible = blockDifficultyList.filter(b => b.eligibleCount >= 4).length;

  console.log(`[Smart Greedy] Block difficulty distribution:`);
  console.log(`  0 eligible (impossible): ${zeroEligible}`);
  console.log(`  1 eligible (bottleneck): ${oneEligible}`);
  console.log(`  2-3 eligible (tight): ${twoThreeEligible}`);
  console.log(`  4+ eligible (flexible): ${fourPlusEligible}`);

  // ============================================================================
  // EXECUTE: Process sorted worklist, XGBoost as tie-breaker
  // ============================================================================

  const driverBlockCounts = new Map<string, number>(); // Track blocks per driver
  const suggestions: MatchResult[] = [];
  const unassigned: string[] = [];
  // Enhanced conflict tracking with reasons for UI
  const unassignedWithReasons: Array<{
    blockId: string;
    reason: string;
    details: string[];
    blockInfo: {
      serviceDate: string;
      startTime: string;
      tractorId: string;
      contractType: string;
    };
  }> = [];

  // Track new assignments made during this run (for DOT lookback)
  const newAssignmentsByDriver = new Map<string, Array<{ block: typeof blocks.$inferSelect }>>();

  // Track which drivers become busy as we assign
  const assignedBusyDates = new Set<string>();

  for (const { block, fullBlock, eligibleDriverIds, eligibleCount } of blockDifficultyList) {
    // Handle impossible blocks (0 eligible drivers from pre-pass)
    if (eligibleCount === 0) {
      unassigned.push(block.id);
      unassignedWithReasons.push({
        blockId: block.id,
        reason: 'No eligible drivers',
        details: [
          'Pre-pass constraint check failed for all drivers',
          'Check: contract type, days off, time-off requests, pattern confidence'
        ],
        blockInfo: {
          serviceDate: block.serviceDate,
          startTime: block.time,
          tractorId: block.tractorId,
          contractType: block.contractType,
        },
      });
      console.log(`[Smart Greedy] IMPOSSIBLE: ${block.contractType} on ${block.serviceDate} - no eligible drivers`);
      continue;
    }

    // Get slot distribution from XGBoost for this block (pre-loaded, no await needed)
    const ownershipData = getSlotDistributionCached(
      block.contractType,
      block.tractorId,
      block.dayIndex,
      block.time
    );

    // Re-check eligible drivers (some may have become busy from prior assignments in this run)
    const stillEligibleDrivers = reliableDriverInfos.filter(driver => {
      if (!eligibleDriverIds.has(driver.id)) return false; // Not in pre-pass eligible set

      // Check if driver became busy from assignments made earlier in this loop
      const startDay = new Date(block.startTimestamp);
      const endDay = new Date(block.endTimestamp);
      let checkDay = new Date(startDay);
      checkDay.setHours(0, 0, 0, 0);
      while (checkDay <= endDay) {
        const dateStr = format(checkDay, "yyyy-MM-dd");
        if (assignedBusyDates.has(`${driver.id}_${dateStr}`)) {
          return false; // Driver was assigned to another block on this day
        }
        checkDay.setDate(checkDay.getDate() + 1);
      }

      // Check typical_days constraint (dynamic - depends on how many we've assigned)
      const currentCount = driverBlockCounts.get(driver.id) || 0;
      const pattern = findByNormalizedName(driverPatterns, driver.name);
      const maxDays = pattern?.typical_days ?? 6;
      if (currentCount >= maxDays) {
        return false; // Would exceed typical days
      }

      return true;
    });

    // Score all still-eligible drivers using XGBoost as tie-breaker
    // PARALLELIZED: All DOT validations run concurrently with Promise.all()
    const candidatePromises = stillEligibleDrivers.map(async (driver) => {
      const currentCount = driverBlockCounts.get(driver.id) || 0;
      const pattern = findByNormalizedName(driverPatterns, driver.name);
      const fullDriver = driverMap.get(driver.id);
      if (!fullDriver) return null;

      // Re-run DOT validation with NEW assignments from this run
      const driverExistingAssignments = assignmentsByDriver.get(driver.id) || [];
      const driverNewAssignments = newAssignmentsByDriver.get(driver.id) || [];
      const allDriverAssignments = [
        ...driverExistingAssignments,
        ...driverNewAssignments.map(a => ({
          ...blockAssignments.$inferInsert,
          id: 'pending',
          blockId: a.block.id,
          driverId: driver.id,
          tenantId,
          isActive: true,
          assignmentSource: 'auto' as const,
          block: a.block,
        })),
      ] as Array<typeof blockAssignments.$inferSelect & { block: typeof blocks.$inferSelect }>;

      const dotResult = await validateBlockAssignment(
        fullDriver,
        blockToAssignmentSubject(fullBlock),
        allDriverAssignments,
        protectedRules,
        allBlockAssignments,
        fullBlock.id
      );

      if (!dotResult.canAssign) return null;

      // XGBoost score as TIE-BREAKER (not primary driver)
      const result = calculateXGBoostScore(
        driver.name,
        driver.id,
        driver.contractType,
        block,
        ownershipData,
        pattern,
        currentCount,
        new Set(), // busyDates no longer needed - DOT validation handles it
        unavailableDates,
        priorityDrivers,
        affinityCache, // Pattern affinity scores (historical fit)
        predictability,
        minDays
      );

      if (result && result.score > 0) {
        return {
          driver,
          score: result.score,
          reasons: result.reasons,
          ownershipPct: result.ownershipPct,
          matchType: result.matchType,
          dotStatus: dotResult.validationResult.validationStatus,
        };
      }
      return null;
    });

    // Wait for all DOT validations in parallel
    const candidateResults = await Promise.all(candidatePromises);
    const candidates = candidateResults.filter((c): c is NonNullable<typeof c> => c !== null);

    // Sort by score descending
    candidates.sort((a, b) => b.score - a.score);

    if (candidates.length > 0) {
      const winner = candidates[0];

      // Track this assignment for subsequent DOT validations
      if (!newAssignmentsByDriver.has(winner.driver.id)) {
        newAssignmentsByDriver.set(winner.driver.id, []);
      }
      newAssignmentsByDriver.get(winner.driver.id)!.push({ block: fullBlock });

      // Track busy dates for this assignment (prevents double-booking in this run)
      const startDay = new Date(block.startTimestamp);
      const endDay = new Date(block.endTimestamp);
      let markDay = new Date(startDay);
      markDay.setHours(0, 0, 0, 0);
      while (markDay <= endDay) {
        const dateStr = format(markDay, "yyyy-MM-dd");
        assignedBusyDates.add(`${winner.driver.id}_${dateStr}`);
        markDay.setDate(markDay.getDate() + 1);
      }

      driverBlockCounts.set(winner.driver.id, (driverBlockCounts.get(winner.driver.id) || 0) + 1);

      // Determine confidence based on match type
      let confidence: number;
      switch (winner.matchType) {
        case 'owner':
          confidence = 1.0;
          break;
        case 'shared':
          confidence = 0.85;
          break;
        case 'available':
          confidence = 0.70;
          break;
        default:
          confidence = 0.50;
      }

      suggestions.push({
        blockId: block.id,
        driverId: winner.driver.id,
        driverName: winner.driver.name,
        score: winner.score,
        reasons: winner.reasons.filter(r => r !== ""),
        confidence,
        matchType: winner.matchType,
        ownershipPct: winner.ownershipPct,
        slotType: ownershipData?.slot_type || 'unknown',
        blockInfo: {
          serviceDate: block.serviceDate,
          startTime: block.time,
          tractorId: block.tractorId,
          contractType: block.contractType,
          dayName: block.dayName,
        },
      });
    } else {
      unassigned.push(block.id);
      unassignedWithReasons.push({
        blockId: block.id,
        reason: 'DOT compliance or capacity limits',
        details: [
          `Pre-pass: ${eligibleCount} eligible drivers`,
          'All became ineligible due to:',
          '• Assigned to another block this day',
          '• DOT 10-hour rest rule violation',
          '• Rolling-6 hours limit exceeded',
          '• Exceeded typical_days pattern'
        ],
        blockInfo: {
          serviceDate: block.serviceDate,
          startTime: block.time,
          tractorId: block.tractorId,
          contractType: block.contractType,
        },
      });
      // Debug: Why no candidates after pre-pass said there were eligible drivers?
      if (unassigned.length <= 5) {
        console.log(`[Smart Greedy] UNMATCHED: ${block.contractType} on ${block.serviceDate}`);
        console.log(`  Pre-pass: ${eligibleCount} eligible, but all became ineligible (assigned elsewhere or DOT limits)`);
      }
    }
  }

  console.log(`[Smart Greedy] Complete: ${suggestions.length} assigned, ${unassigned.length} unassigned (${pythonCallCount} Python calls)`);

  // Log match quality breakdown
  const ownerMatches = suggestions.filter(s => s.matchType === 'owner').length;
  const sharedMatches = suggestions.filter(s => s.matchType === 'shared').length;
  const availableMatches = suggestions.filter(s => s.matchType === 'available').length;
  const fallbackMatches = suggestions.filter(s => s.matchType === 'fallback').length;

  console.log(`[XGBoost-Matcher] Quality: ${ownerMatches} owner, ${sharedMatches} shared, ${availableMatches} available, ${fallbackMatches} fallback`);

  // Log top assignments for debugging
  const topAssignments = suggestions.slice(0, 5);
  for (const s of topAssignments) {
    console.log(`  ${s.driverName}: ${s.reasons.join(" · ")} (score: ${s.score})`);
  }

  // Log driver utilization summary
  const utilizationCounts = [0, 0, 0, 0, 0, 0, 0]; // 0-6 days
  for (const [, count] of driverBlockCounts) {
    if (count <= 6) utilizationCounts[count]++;
  }
  const driversWithZero = driverInfos.length - driverBlockCounts.size;
  console.log(`[XGBoost-Matcher] Driver utilization: ${driversWithZero} with 0d, ${utilizationCounts[1]} with 1d, ${utilizationCounts[2]} with 2d, ${utilizationCounts[3]} with 3d, ${utilizationCounts[4]} with 4d, ${utilizationCounts[5]} with 5d, ${utilizationCounts[6]} with 6d`);

  return {
    suggestions,
    unassigned,
    unassignedWithReasons, // Enhanced conflict data for UI
    excludedDrivers,
    stats: {
      totalBlocks: blockInfos.length,
      totalDrivers: driverInfos.length,
      assigned: suggestions.length,
      unassigned: unassigned.length,
      solverStatus: "SMART_GREEDY_OPTIMAL",
    },
  };
}

/**
 * Apply deterministic matches to the database
 */
export async function applyDeterministicMatches(
  tenantId: string,
  assignments: { blockId: string; driverId: string }[]
): Promise<{ applied: number; errors: string[] }> {
  const errors: string[] = [];
  let applied = 0;

  for (const assignment of assignments) {
    try {
      // Check if assignment already exists
      const existing = await db
        .select()
        .from(blockAssignments)
        .where(
          and(
            eq(blockAssignments.blockId, assignment.blockId),
            eq(blockAssignments.isActive, true)
          )
        );

      if (existing.length > 0) {
        // Update existing assignment
        await db
          .update(blockAssignments)
          .set({
            driverId: assignment.driverId,
            assignedAt: new Date(),
          })
          .where(eq(blockAssignments.id, existing[0].id));
      } else {
        // Create new assignment
        await db.insert(blockAssignments).values({
          tenantId,
          blockId: assignment.blockId,
          driverId: assignment.driverId,
          isActive: true,
          assignedAt: new Date(),
        });
      }
      applied++;
    } catch (error: any) {
      errors.push(`Block ${assignment.blockId}: ${error.message}`);
    }
  }

  console.log(`[XGBoost-Matcher] Applied ${applied} assignments, ${errors.length} errors`);
  return { applied, errors };
}

/**
 * Get top driver matches for a single block
 * Used by the Intelligent Match Assistant panel
 */
export async function getTopMatchesForBlock(
  tenantId: string,
  blockDbId: string,
  limit: number = 10
): Promise<{
  success: boolean;
  blockId: string;
  blockInfo: {
    serviceDate: string;
    startTime: string;
    contractType: string;
    tractorId: string;
    dayName: string;
  };
  matches: Array<{
    driverId: string;
    driverName: string;
    score: number;
    ownershipPct: number;
    matchType: string;
    reasons: string[];
    patternConfidence: number;
    typicalDays: number;
    dayList: string[];
  }>;
  totalCandidates: number;
}> {
  console.log(`[XGBoost-Matcher] Getting top matches for block ${blockDbId}`);

  // 1. Get the block details
  const blockResult = await db
    .select()
    .from(blocks)
    .where(and(
      eq(blocks.id, blockDbId),
      eq(blocks.tenantId, tenantId)
    ));

  if (blockResult.length === 0) {
    throw new Error(`Block ${blockDbId} not found`);
  }

  const block = blockResult[0];
  const serviceDate = new Date(block.serviceDate);
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayName = dayNames[serviceDate.getDay()];
  const dayIndex = serviceDate.getDay();

  // Get start time from timestamp
  const startTime = block.startTimestamp
    ? format(new Date(block.startTimestamp), 'HH:mm')
    : '00:00';

  const blockInfo = {
    serviceDate: format(serviceDate, 'yyyy-MM-dd'),
    startTime,
    contractType: (block.soloType || 'solo1').toLowerCase(),
    tractorId: block.tractorId || 'Tractor_1',
    dayName,
  };

  console.log(`[XGBoost-Matcher] Block info: ${JSON.stringify(blockInfo)}`);

  // 2. Get all active drivers
  const allDriversRaw = await db
    .select({
      id: drivers.id,
      firstName: drivers.firstName,
      lastName: drivers.lastName,
      daysOff: drivers.daysOff,
    })
    .from(drivers)
    .where(
      and(
        eq(drivers.tenantId, tenantId),
        eq(drivers.status, "active"),
        or(isNull(drivers.isActive), eq(drivers.isActive, true))
      )
    );

  // 3. Get driver patterns from XGBoost
  const { getAllDriverPatterns, getSlotDistribution, getBatchSlotAffinity } = await import("./python-bridge");
  const patternsResult = await getAllDriverPatterns();
  const driverPatterns: Record<string, DriverPattern> =
    patternsResult.success && patternsResult.data?.patterns
      ? patternsResult.data.patterns
      : {};

  // 4. Get slot ownership distribution
  const ownershipData = await getSlotDistribution({
    soloType: blockInfo.contractType,
    tractorId: blockInfo.tractorId,
    dayOfWeek: dayIndex,
    canonicalTime: startTime,
  });

  const slotDistribution = ownershipData.success && ownershipData.data ? ownershipData.data : null;

  // 5. Get 12-week historical assignments for filtering
  const lookbackStart = subWeeks(new Date(), 12);
  const existingAssignmentsWithBlocks = await db
    .select({
      assignment: blockAssignments,
      block: blocks,
    })
    .from(blockAssignments)
    .innerJoin(blocks, eq(blockAssignments.blockId, blocks.id))
    .where(
      and(
        eq(blockAssignments.tenantId, tenantId),
        eq(blockAssignments.isActive, true),
        gte(blocks.serviceDate, lookbackStart)
      )
    );

  // Group assignments by driver (count) and by type (solo1/solo2)
  const assignmentsByDriver = new Map<string, number>();
  const driverTypeCounts = new Map<string, { solo1: number; solo2: number }>();
  for (const row of existingAssignmentsWithBlocks) {
    const driverId = row.assignment.driverId;
    assignmentsByDriver.set(driverId, (assignmentsByDriver.get(driverId) || 0) + 1);

    // Track solo type counts for 80% rule
    const soloType = (row.block.soloType || "solo1").toLowerCase();
    const counts = driverTypeCounts.get(driverId) || { solo1: 0, solo2: 0 };
    if (soloType === "solo1") counts.solo1++;
    else if (soloType === "solo2") counts.solo2++;
    driverTypeCounts.set(driverId, counts);
  }

  // Learn driver types using 80% rule
  const learnedDriverTypes = new Map<string, "solo1" | "solo2" | "both">();
  for (const [driverId, counts] of driverTypeCounts) {
    const total = counts.solo1 + counts.solo2;
    if (total === 0) {
      learnedDriverTypes.set(driverId, "both");
      continue;
    }
    const solo1Pct = counts.solo1 / total;
    const solo2Pct = counts.solo2 / total;
    if (solo1Pct >= 0.80) {
      learnedDriverTypes.set(driverId, "solo1");
    } else if (solo2Pct >= 0.80) {
      learnedDriverTypes.set(driverId, "solo2");
    } else {
      learnedDriverTypes.set(driverId, "both");
    }
  }

  // 6. Get batch affinity scores for this block
  const blockSlots = [{
    date: blockInfo.serviceDate,
    soloType: blockInfo.contractType,
    tractorId: blockInfo.tractorId,
  }];

  const driversWithHistory = allDriversRaw.map(driver => {
    const driverAssignments = existingAssignmentsWithBlocks.filter(
      a => a.assignment.driverId === driver.id
    );
    return {
      id: driver.id,
      name: `${driver.firstName} ${driver.lastName}`.trim(),
      history: driverAssignments.map(a => ({
        serviceDate: format(new Date(a.block.serviceDate), "yyyy-MM-dd"),
        soloType: a.block.soloType || undefined,
        tractorId: a.block.tractorId || undefined,
      })),
    };
  });

  // Get affinity scores
  const affinityResult = await getBatchSlotAffinity(blockSlots, driversWithHistory);
  const affinityCache = new Map<string, number>();

  if (affinityResult.success && affinityResult.data?.scores) {
    for (const [key, score] of Object.entries(affinityResult.data.scores)) {
      affinityCache.set(key, score as number);
    }
  }

  // 7. Score each driver
  const MIN_ASSIGNMENTS_12_WEEKS = 12;
  const candidates: Array<{
    driverId: string;
    driverName: string;
    score: number;
    ownershipPct: number;
    matchType: string;
    reasons: string[];
    patternConfidence: number;
    typicalDays: number;
    dayList: string[];
  }> = [];

  for (const driver of allDriversRaw) {
    const driverName = `${driver.firstName} ${driver.lastName}`.trim();
    const assignmentCount = assignmentsByDriver.get(driver.id) || 0;

    // Skip drivers with insufficient history
    if (assignmentCount < MIN_ASSIGNMENTS_12_WEEKS) {
      continue;
    }

    // HARD CONSTRAINT: Driver type must match block type
    const driverType = learnedDriverTypes.get(driver.id) || "both";
    if (driverType === "solo1" && blockInfo.contractType === "solo2") {
      continue; // Solo1-only driver cannot work Solo2 block
    }
    if (driverType === "solo2" && blockInfo.contractType === "solo1") {
      continue; // Solo2-only driver cannot work Solo1 block
    }

    // Get driver pattern
    const pattern = findByNormalizedName(driverPatterns, driverName);
    const patternConfidence = pattern?.confidence ?? 0;

    // Skip drivers with zero-confidence patterns
    if (patternConfidence < 0.1) {
      continue;
    }

    // Check if driver has this day off
    if (driver.daysOff && driver.daysOff.includes(dayName.toLowerCase())) {
      continue;
    }

    // Get ownership score
    const foundOwnership = slotDistribution?.shares
      ? findByNormalizedName(slotDistribution.shares, driverName)
      : undefined;
    const ownershipScore = foundOwnership ?? 0.0;
    const ownershipPct = Math.round(ownershipScore * 100);

    // Get affinity score
    const slotKey = `${blockInfo.contractType}|${blockInfo.tractorId}|${blockInfo.serviceDate}`;
    const affinityCacheKey = `${driver.id}_${slotKey}`;
    let affinityScore = affinityCache.get(affinityCacheKey);

    if (affinityScore === undefined) {
      // Fallback: day-list check
      const hasDayList = pattern?.day_list && pattern.day_list.length > 0;
      if (!hasDayList) {
        affinityScore = 0.3;
      } else {
        const worksThisDay = pattern.day_list.some(
          d => d.toLowerCase() === dayName.toLowerCase()
        );
        affinityScore = worksThisDay ? 1.0 : 0.6;
      }
    }

    // Calculate combined score
    const predictability = 0.7;
    const baseScore = (ownershipScore * predictability) + (affinityScore * (1 - predictability));

    // Apply confidence multiplier to bonuses
    const confidenceMultiplier = patternConfidence < 0.5 ? 0.5 : 1.0;
    const fairnessBonus = 0; // No fairness bonus for single-block matching
    const minDaysBoost = 0;

    const finalScore = Math.min(1.0, baseScore + fairnessBonus + minDaysBoost);

    // Determine match type
    let matchType: string;
    const reasons: string[] = [];

    if (ownershipScore >= 0.70) {
      matchType = 'owner';
      reasons.push(`★ Owns slot (${ownershipPct}%)`);
    } else if (ownershipScore >= 0.30) {
      matchType = 'shared';
      reasons.push(`◐ Shares slot (${ownershipPct}%)`);
    } else if (affinityScore >= 0.70) {
      matchType = 'pattern';
      reasons.push(`○ Pattern ${Math.round(affinityScore * 100)}%`);
    } else {
      matchType = 'fallback';
      reasons.push(`△ Weak ${Math.round(affinityScore * 100)}%`);
    }

    // Add pattern info
    reasons.push(`${pattern?.typical_days ?? 6}d pattern`);

    // Skip very low scores
    if (finalScore < 0.1) {
      continue;
    }

    candidates.push({
      driverId: driver.id,
      driverName,
      score: Math.round(finalScore * 100) / 100,
      ownershipPct,
      matchType,
      reasons,
      patternConfidence,
      typicalDays: pattern?.typical_days ?? 0,
      dayList: pattern?.day_list ?? [],
    });
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);

  // Return top matches
  const topMatches = candidates.slice(0, limit);

  console.log(`[XGBoost-Matcher] Found ${candidates.length} candidates, returning top ${topMatches.length}`);

  return {
    success: true,
    blockId: blockDbId,
    blockInfo,
    matches: topMatches,
    totalCandidates: candidates.length,
  };
}
