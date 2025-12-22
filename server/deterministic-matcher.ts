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
import { blocks, drivers, blockAssignments, contracts } from "@shared/schema";
import { eq, and, gte, lte } from "drizzle-orm";
import { format, endOfWeek } from "date-fns";
import { getSlotDistribution, getAllDriverPatterns, SlotDistribution, DriverPattern } from "./python-bridge";

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const DAY_NAMES_UPPER = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface DriverInfo {
  id: string;
  name: string;
  contractType: string;
}

interface BlockInfo {
  id: string;
  dayIndex: number;
  dayName: string;
  time: string;
  contractType: string;
  serviceDate: string;
  tractorId: string;
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
 */
function calculateXGBoostScore(
  driverName: string,
  driverId: string,
  block: BlockInfo,
  ownershipData: SlotDistribution | null,
  driverPattern: DriverPattern | undefined,
  currentDayCount: number,
  busyDates: Set<string>,
  predictability: number = 0.7
): { score: number; reasons: string[]; ownershipPct: number; matchType: string } | null {

  // HARD CONSTRAINT: Driver already assigned on this date
  const dateKey = `${driverId}_${block.serviceDate}`;
  if (busyDates.has(dateKey)) {
    return null;
  }

  // HARD CONSTRAINT: Don't exceed driver's typical days pattern
  const maxDays = driverPattern?.typical_days ?? 6;
  if (currentDayCount >= maxDays) {
    return null;
  }

  const reasons: string[] = [];

  // Get ownership score (0-1) from XGBoost
  const ownershipScore = ownershipData?.shares?.[driverName] ?? 0;
  const ownershipPct = Math.round(ownershipScore * 100);

  // Get availability score (does driver work this day?)
  const dayNameLower = block.dayName.toLowerCase();
  const worksThisDay = driverPattern?.day_list?.some(
    d => d.toLowerCase() === dayNameLower
  ) ?? false;
  const availabilityScore = worksThisDay ? 1.0 : 0.5;

  // COMBINED SCORE FORMULA:
  // combined = ownership × predictability + availability × (1 - predictability)
  const baseScore = (ownershipScore * predictability) + (availabilityScore * (1 - predictability));

  // Fairness bonus: prefer drivers with fewer days this week (max +0.30)
  const fairnessBonus = Math.max(0, (6 - currentDayCount)) * 0.05;

  const finalScore = baseScore + fairnessBonus;

  // Build reasons and match type
  let matchType: string;

  if (ownershipScore >= 0.70) {
    reasons.push(`★ Owns slot (${ownershipPct}%)`);
    matchType = 'owner';
  } else if (ownershipScore >= 0.30) {
    reasons.push(`◐ Shares slot (${ownershipPct}%)`);
    matchType = 'shared';
  } else if (worksThisDay) {
    reasons.push(`○ Works ${DAY_NAMES_UPPER[block.dayIndex]}s`);
    matchType = 'available';
  } else {
    reasons.push(`△ Available`);
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

  // 1. Get all active drivers (no DNA join needed)
  // Note: soloType is NOT on drivers table - we get it from DNA profiles or XGBoost patterns
  const allDriversRaw = await db
    .select({
      id: drivers.id,
      firstName: drivers.firstName,
      lastName: drivers.lastName,
    })
    .from(drivers)
    .where(
      and(
        eq(drivers.tenantId, tenantId),
        eq(drivers.status, "active")
      )
    );

  // Build driver infos - contract type will be determined from XGBoost patterns below
  const driverInfos: DriverInfo[] = allDriversRaw.map(d => ({
    id: d.id,
    name: `${d.firstName} ${d.lastName}`.trim(),
    contractType: "solo1", // Default, will be updated from XGBoost patterns
  }));

  console.log(`[XGBoost-Matcher] ${driverInfos.length} active drivers`);

  // 2. Load ALL driver patterns from XGBoost (single call)
  console.log(`[XGBoost-Matcher] Loading driver patterns from XGBoost...`);
  const patternsResult = await getAllDriverPatterns();
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

  // 4. Get unassigned blocks for the week
  const weekEndPlusOne = new Date(weekEnd);
  weekEndPlusOne.setDate(weekEndPlusOne.getDate() + 1);

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

  const existingAssignments = await db
    .select({ blockId: blockAssignments.blockId })
    .from(blockAssignments)
    .where(eq(blockAssignments.isActive, true));

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
      };
    });

  // Sort blocks by date then time for consistent processing
  blockInfos.sort((a, b) => {
    if (a.serviceDate !== b.serviceDate) return a.serviceDate.localeCompare(b.serviceDate);
    return a.time.localeCompare(b.time);
  });

  console.log(`[XGBoost-Matcher] ${blockInfos.length} unassigned blocks to match`);

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

  // 5. Cache slot distributions to avoid redundant XGBoost calls
  const slotDistributionCache = new Map<string, SlotDistribution | null>();

  async function getSlotDistributionCached(
    soloType: string,
    tractorId: string,
    dayOfWeek: number,
    canonicalTime: string
  ): Promise<SlotDistribution | null> {
    const cacheKey = `${soloType}_${tractorId}_${dayOfWeek}_${canonicalTime}`;
    if (slotDistributionCache.has(cacheKey)) {
      return slotDistributionCache.get(cacheKey)!;
    }

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

  // 6. Greedy matching: for each block, find best available driver
  const busyDates = new Set<string>(); // "driverId_date" keys
  const driverBlockCounts = new Map<string, number>(); // Track blocks per driver
  const suggestions: MatchResult[] = [];
  const unassigned: string[] = [];

  for (const block of blockInfos) {
    // Get slot distribution from XGBoost for this block
    const ownershipData = await getSlotDistributionCached(
      block.contractType,
      block.tractorId,
      block.dayIndex,
      block.time
    );

    // Filter to drivers with matching contract type
    const eligibleDrivers = driverInfos.filter(d => d.contractType === block.contractType);

    // Score all eligible drivers for this block
    const candidates: {
      driver: DriverInfo;
      score: number;
      reasons: string[];
      ownershipPct: number;
      matchType: string;
    }[] = [];

    for (const driver of eligibleDrivers) {
      const currentCount = driverBlockCounts.get(driver.id) || 0;
      const pattern = driverPatterns[driver.name];

      const result = calculateXGBoostScore(
        driver.name,
        driver.id,
        block,
        ownershipData,
        pattern,
        currentCount,
        busyDates,
        predictability
      );

      if (result && result.score > 0) {
        candidates.push({
          driver,
          score: result.score,
          reasons: result.reasons,
          ownershipPct: result.ownershipPct,
          matchType: result.matchType,
        });
      }
    }

    // Sort by score descending
    candidates.sort((a, b) => b.score - a.score);

    if (candidates.length > 0) {
      const winner = candidates[0];
      const dateKey = `${winner.driver.id}_${block.serviceDate}`;
      busyDates.add(dateKey);
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
    }
  }

  console.log(`[XGBoost-Matcher] Complete: ${suggestions.length} assigned, ${unassigned.length} unassigned`);

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
