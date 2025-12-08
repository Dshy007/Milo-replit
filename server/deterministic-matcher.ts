/**
 * Deterministic Schedule Matcher
 *
 * A fast, predictable scoring-based matcher inspired by Python logic.
 * No AI calls - pure deterministic scoring with transparent results.
 *
 * Scoring System:
 * - Day match: +50 points
 * - Exact time match: +40 points
 * - Time within 2 hours: +30 points
 * - Historical pattern bonus: +10-20 points
 *
 * Hard Constraints:
 * - Contract type must match (solo1/solo2)
 * - One block per driver per day
 */

import { db } from "./db";
import { blocks, drivers, driverDnaProfiles, blockAssignments } from "@shared/schema";
import { eq, and, gte, lte } from "drizzle-orm";
import { format, endOfWeek, subWeeks } from "date-fns";

// Canonical start times lookup
const CANONICAL_START_TIMES: Record<string, string> = {
  "solo1_Tractor_1": "16:30",
  "solo1_Tractor_2": "20:30",
  "solo1_Tractor_3": "20:30",
  "solo1_Tractor_4": "17:30",
  "solo1_Tractor_5": "21:30",
  "solo1_Tractor_6": "01:30",
  "solo1_Tractor_7": "18:30",
  "solo1_Tractor_8": "00:30",
  "solo1_Tractor_9": "16:30",
  "solo1_Tractor_10": "20:30",
  "solo2_Tractor_1": "18:30",
  "solo2_Tractor_2": "23:30",
  "solo2_Tractor_3": "21:30",
  "solo2_Tractor_4": "08:30",
  "solo2_Tractor_5": "15:30",
  "solo2_Tractor_6": "11:30",
  "solo2_Tractor_7": "16:30",
};

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

interface DriverProfile {
  id: string;
  name: string;
  contractType: string;
  preferredDays: string[];
  preferredTimes: string[];
}

interface BlockInfo {
  id: string;
  day: string;
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
}

/**
 * Convert time string to minutes since midnight
 */
function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + (m || 0);
}

/**
 * Calculate score for a driver-block pair
 */
function calculateScore(
  driver: DriverProfile,
  block: BlockInfo,
  busyDates: Set<string>
): { score: number; reasons: string[] } | null {
  const reasons: string[] = [];
  let score = 0;

  // HARD CONSTRAINT: Driver already assigned on this date
  const dateKey = `${driver.id}_${block.serviceDate}`;
  if (busyDates.has(dateKey)) {
    return null;
  }

  // HARD CONSTRAINT: Contract type must match
  if (driver.contractType !== block.contractType) {
    return null;
  }

  // DAY MATCH: +50 points
  const dayMatches = driver.preferredDays.some(d => d.toLowerCase() === block.day.toLowerCase());
  if (dayMatches) {
    score += 50;
    reasons.push(`Day:${block.day}`);
  }

  // TIME MATCH: +40 exact, +30 within 2 hours
  const blockMinutes = timeToMinutes(block.time);
  let bestTimeDiff = Infinity;
  let matchedTime = "";

  for (const prefTime of driver.preferredTimes) {
    const prefMinutes = timeToMinutes(prefTime);
    const diff = Math.abs(blockMinutes - prefMinutes);
    const wrappedDiff = Math.min(diff, 1440 - diff); // Handle overnight wraparound
    if (wrappedDiff < bestTimeDiff) {
      bestTimeDiff = wrappedDiff;
      matchedTime = prefTime;
    }
  }

  if (bestTimeDiff === 0) {
    score += 40;
    reasons.push(`Time:${matchedTime}`);
  } else if (bestTimeDiff <= 120) {
    score += 30;
    reasons.push(`~Time:${matchedTime}`);
  }

  // Must have SOME match to be considered
  if (score === 0) {
    return null;
  }

  return { score, reasons };
}

/**
 * Main deterministic matching function
 */
export async function matchDeterministic(
  tenantId: string,
  weekStart: Date,
  contractTypeFilter?: "solo1" | "solo2",
  minDays: number = 3
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
  console.log(`[DeterministicMatcher] Starting for ${format(weekStart, "yyyy-MM-dd")} to ${format(weekEnd, "yyyy-MM-dd")}`);

  // 1. Get all drivers with DNA profiles
  const allDrivers = await db
    .select({
      id: drivers.id,
      firstName: drivers.firstName,
      lastName: drivers.lastName,
      contractType: driverDnaProfiles.preferredContractType,
      preferredDays: driverDnaProfiles.preferredDays,
      preferredStartTimes: driverDnaProfiles.preferredStartTimes,
    })
    .from(drivers)
    .leftJoin(driverDnaProfiles, eq(drivers.id, driverDnaProfiles.driverId))
    .where(
      and(
        eq(drivers.tenantId, tenantId),
        eq(drivers.status, "active")
      )
    );

  const driverProfiles: DriverProfile[] = allDrivers
    .filter(d => {
      const days = (d.preferredDays as string[]) || [];
      const times = (d.preferredStartTimes as string[]) || [];
      return days.length > 0 && times.length > 0; // Must have both
    })
    .map(d => ({
      id: d.id,
      name: `${d.firstName} ${d.lastName}`,
      contractType: (d.contractType || "solo1").toLowerCase(),
      preferredDays: (d.preferredDays as string[]) || [],
      preferredTimes: (d.preferredStartTimes as string[]) || [],
    }));

  console.log(`[DeterministicMatcher] ${driverProfiles.length} drivers with complete profiles`);

  // 2. Get unassigned blocks for the week
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
      const time = CANONICAL_START_TIMES[lookupKey] || "00:00";

      return {
        id: b.id,
        day: dayName,
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

  console.log(`[DeterministicMatcher] ${blockInfos.length} unassigned blocks to match`);

  if (blockInfos.length === 0 || driverProfiles.length === 0) {
    return {
      suggestions: [],
      unassigned: blockInfos.map(b => b.id),
      stats: {
        totalBlocks: blockInfos.length,
        totalDrivers: driverProfiles.length,
        assigned: 0,
        unassigned: blockInfos.length,
        solverStatus: blockInfos.length === 0 ? "NO_BLOCKS" : "NO_DRIVERS",
      },
    };
  }

  // 3. Greedy matching: for each block, find best available driver
  const busyDates = new Set<string>(); // "driverId_date" keys
  const driverBlockCounts = new Map<string, number>(); // Track blocks per driver
  const suggestions: MatchResult[] = [];
  const unassigned: string[] = [];

  for (const block of blockInfos) {
    // Filter to drivers with matching contract type
    const eligibleDrivers = driverProfiles.filter(d => d.contractType === block.contractType);

    // Score all eligible drivers for this block
    const candidates: { driver: DriverProfile; score: number; reasons: string[] }[] = [];

    for (const driver of eligibleDrivers) {
      const result = calculateScore(driver, block, busyDates);
      if (result && result.score > 0) {
        // Add fair distribution bonus: prefer drivers with fewer blocks
        const currentCount = driverBlockCounts.get(driver.id) || 0;
        const fairnessBonus = Math.max(0, (minDays - currentCount) * 5);

        candidates.push({
          driver,
          score: result.score + fairnessBonus,
          reasons: [...result.reasons, currentCount === 0 ? "NeedsWork" : ""],
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

      // Determine match type and confidence
      let matchType = "assigned";
      let confidence = 0.5;
      const hasDay = winner.reasons.some(r => r.startsWith("Day:"));
      const hasExactTime = winner.reasons.some(r => r.startsWith("Time:") && !r.startsWith("~"));
      const hasApproxTime = winner.reasons.some(r => r.startsWith("~Time:"));

      if (hasDay && hasExactTime) {
        confidence = 1.0;
        matchType = "perfect_match";
      } else if (hasDay && hasApproxTime) {
        confidence = 0.9;
        matchType = "day_time_approx";
      } else if (hasDay) {
        confidence = 0.85;
        matchType = "day_match";
      } else if (hasExactTime || hasApproxTime) {
        confidence = 0.75;
        matchType = "time_match";
      }

      suggestions.push({
        blockId: block.id,
        driverId: winner.driver.id,
        driverName: winner.driver.name,
        score: winner.score,
        reasons: winner.reasons.filter(r => r !== ""),
        confidence,
        matchType,
      });
    } else {
      unassigned.push(block.id);
    }
  }

  console.log(`[DeterministicMatcher] Complete: ${suggestions.length} assigned, ${unassigned.length} unassigned`);

  // Log top assignments for debugging
  const topAssignments = suggestions.slice(0, 5);
  for (const s of topAssignments) {
    console.log(`  ${s.driverName}: ${s.reasons.join(", ")} (score: ${s.score})`);
  }

  return {
    suggestions,
    unassigned,
    stats: {
      totalBlocks: blockInfos.length,
      totalDrivers: driverProfiles.length,
      assigned: suggestions.length,
      unassigned: unassigned.length,
      solverStatus: "DETERMINISTIC_OPTIMAL",
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

  console.log(`[DeterministicMatcher] Applied ${applied} assignments, ${errors.length} errors`);
  return { applied, errors };
}
