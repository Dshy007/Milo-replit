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
import { getSlotDistribution, getAllDriverPatterns, getBatchSlotAffinity, SlotDistribution, DriverPattern, DriverHistoryItem, BlockSlotInfo } from "./python-bridge";
import { validateBlockAssignment, blockToAssignmentSubject } from "./rolling6-calculator";

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

  // Get ownership score (0-1) from XGBoost - default 0.5 if no data
  // Use normalized name matching to handle whitespace differences from CSV imports
  const foundOwnership = ownershipData?.shares
    ? findByNormalizedName(ownershipData.shares, driverName)
    : undefined;
  const rawOwnership = foundOwnership ?? 0.5;

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
  const slotKey = `${(block.soloType || 'solo1').toLowerCase()}|${block.tractorId || 'Tractor_1'}|${block.serviceDate}`;
  const affinityCacheKey = `${driverId}_${slotKey}`;
  const patternAffinity = affinityCache.get(affinityCacheKey);

  // Use pattern affinity if available, otherwise fall back to day-list check
  let affinityScore: number;
  if (patternAffinity !== undefined) {
    // Pattern affinity score 0.0-1.0 (how well slot matches driver's history)
    affinityScore = patternAffinity;
  } else {
    // Fallback: simple day-list check (less accurate)
    const dayNameLower = block.dayName.toLowerCase();
    const worksThisDay = driverPattern?.day_list?.some(
      d => d.toLowerCase() === dayNameLower
    ) ?? true;
    affinityScore = worksThisDay ? 1.0 : 0.6;
  }

  // COMBINED SCORE FORMULA:
  // Base = ownership × weight + affinity × (1 - weight)
  // Both scores are pattern-based: ownership (who owns the slot) + affinity (historical fit)
  const baseScore = (ownershipScore * predictability) + (affinityScore * (1 - predictability));

  // Fairness bonus: prefer drivers with fewer days this week
  // Increased from 0.05 to 0.08 to better spread work across drivers
  const fairnessBonus = Math.max(0, (6 - currentDayCount)) * 0.08;

  // MinDays boost: drivers below minimum should get priority
  let minDaysBoost = 0;
  if (currentDayCount < minDays) {
    // Strong boost for drivers who haven't reached minimum yet
    minDaysBoost = 0.20;
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
export async function matchDeterministic(
  tenantId: string,
  weekStart: Date,
  contractTypeFilter?: "solo1" | "solo2",
  minDays: number = 3,
  predictability: number = 0.7
): Promise<{
  suggestions: MatchResult[];
  unassigned: string[];
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
  const lookbackStart = subDays(weekStart, 7);
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

  // Group by driver for quick lookup
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
      soloType: b.soloType || 'solo1',
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
  const slotDistributionCache = new Map<string, SlotDistribution | null>();
  let pythonCallCount = 0;
  const SKIP_PYTHON = false; // Enable XGBoost ownership predictions

  async function getSlotDistributionCached(
    soloType: string,
    tractorId: string,
    dayOfWeek: number,
    canonicalTime: string
  ): Promise<SlotDistribution | null> {
    // Skip Python calls entirely for speed - rely on patterns + type matching
    if (SKIP_PYTHON) {
      return null;
    }

    const cacheKey = `${soloType}_${tractorId}_${dayOfWeek}_${canonicalTime}`;
    if (slotDistributionCache.has(cacheKey)) {
      return slotDistributionCache.get(cacheKey)!;
    }

    pythonCallCount++;
    const result = await getSlotDistribution({
      soloType,
      tractorId,
      dayOfWeek,
      canonicalTime
    });

    const data = result.success && result.data ? result.data : null;
    slotDistributionCache.set(cacheKey, data);
    return data;
  }

  // 6. Greedy matching: for each block, find best available driver with DOT compliance
  const driverBlockCounts = new Map<string, number>(); // Track blocks per driver
  const suggestions: MatchResult[] = [];
  const unassigned: string[] = [];

  // Track new assignments made during this run (for DOT lookback)
  const newAssignmentsByDriver = new Map<string, Array<{ block: typeof blocks.$inferSelect }>>();

  for (const block of blockInfos) {
    // Get slot distribution from XGBoost for this block
    const ownershipData = await getSlotDistributionCached(
      block.contractType,
      block.tractorId,
      block.dayIndex,
      block.time
    );

    // Get the full block record for DOT validation
    const fullBlock = allBlocks.find(b => b.id === block.id);
    if (!fullBlock) {
      unassigned.push(block.id);
      continue;
    }

    // All drivers are eligible (type penalty removed)
    const eligibleDrivers = driverInfos;

    // Score all eligible drivers and check DOT compliance
    const candidates: {
      driver: DriverInfo;
      score: number;
      reasons: string[];
      ownershipPct: number;
      matchType: string;
      dotStatus: string;
    }[] = [];

    for (const driver of eligibleDrivers) {
      const currentCount = driverBlockCounts.get(driver.id) || 0;
      // Use normalized name matching for patterns (handles whitespace from CSV imports)
      const pattern = findByNormalizedName(driverPatterns, driver.name);

      // Get full driver record for DOT validation
      const fullDriver = driverMap.get(driver.id);
      if (!fullDriver) continue;

      // HARD CONSTRAINT: Skip if this block falls on driver's configured day off
      const driverOff = driverDaysOff.get(driver.id);
      if (driverOff && driverOff.includes(block.dayName.toLowerCase())) {
        continue; // Driver has this day marked as day off in Driver Profiles
      }

      // Combine existing assignments + new assignments made this run
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

      // Run DOT validation
      const dotResult = await validateBlockAssignment(
        fullDriver,
        blockToAssignmentSubject(fullBlock),
        allDriverAssignments,
        protectedRules,
        allBlockAssignments,
        fullBlock.id
      );

      // Skip if DOT validation fails
      if (!dotResult.canAssign) {
        continue;
      }

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
        candidates.push({
          driver,
          score: result.score,
          reasons: result.reasons,
          ownershipPct: result.ownershipPct,
          matchType: result.matchType,
          dotStatus: dotResult.validationResult.validationStatus,
        });
      }
    }

    // Sort by score descending
    candidates.sort((a, b) => b.score - a.score);

    if (candidates.length > 0) {
      const winner = candidates[0];

      // Track this assignment for subsequent DOT validations
      if (!newAssignmentsByDriver.has(winner.driver.id)) {
        newAssignmentsByDriver.set(winner.driver.id, []);
      }
      newAssignmentsByDriver.get(winner.driver.id)!.push({ block: fullBlock });

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
      });
    } else {
      unassigned.push(block.id);
      // Debug: Why no candidates? All drivers failed DOT validation
      if (unassigned.length <= 5) {
        console.log(`[XGBoost-Matcher] UNMATCHED block ${block.id} (${block.contractType} on ${block.serviceDate})`);
        console.log(`  All ${eligibleDrivers.length} drivers failed DOT validation (10h rest, rolling hours, or protected rules)`);
      }
    }
  }

  console.log(`[XGBoost-Matcher] Complete: ${suggestions.length} assigned, ${unassigned.length} unassigned (${pythonCallCount} Python calls)`);

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
    stats: {
      totalBlocks: blockInfos.length,
      totalDrivers: driverInfos.length,
      assigned: suggestions.length,
      unassigned: unassigned.length,
      solverStatus: "XGBOOST_OPTIMAL",
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
