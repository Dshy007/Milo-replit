/**
 * OR-Tools Schedule Optimizer Wrapper
 *
 * Calls the Python OR-Tools CP-SAT solver to match drivers to blocks.
 * Converts output to website's expected format.
 */

import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { db } from "./db";
import { blocks, drivers, blockAssignments } from "@shared/schema";
import { eq, and, gte, lte } from "drizzle-orm";
import { format, endOfWeek } from "date-fns";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * CANONICAL_START_TIMES - The Holy Grail lookup table
 * Maps {solo_type}_{tractor_id} to the canonical start time
 * Source: contracts table in database
 */
const CANONICAL_START_TIMES: Record<string, string> = {
  // Solo1
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
  // Solo2
  "solo2_Tractor_1": "18:30",
  "solo2_Tractor_2": "23:30",
  "solo2_Tractor_3": "21:30",
  "solo2_Tractor_4": "08:30",
  "solo2_Tractor_5": "15:30",
  "solo2_Tractor_6": "11:30",
  "solo2_Tractor_7": "16:30",
};

interface DriverInput {
  id: string;
  name: string;
  preferredDays: string[];
  preferredTime: string;
  contractType: string;
}

interface BlockInput {
  id: string;
  day: string;
  time: string;
  contractType: string;
  serviceDate: string;
}

interface ORToolsAssignment {
  blockId: string;
  driverId: string;
  driverName: string;
  matchType: string;
  preferredTime: string;
  actualTime: string;
  serviceDate: string;
  day: string;
  historyCount?: number;
  mlScore?: number | null;
  patternGroup?: string | null;
}

interface DriverHistoryEntry {
  day: string;
  time: string;
}

/**
 * Complete driver profile derived from actual work history
 * This is THE source of truth - no DNA profiles!
 */
interface DriverProfile {
  contractType: string;           // Derived from majority of assignments
  primaryTime: string;            // Most frequent time worked
  preferredTimes: string[];       // All times worked, sorted by frequency
  preferredDays: string[];        // Days worked, sorted by frequency
  slotHistory: Record<string, number>;  // "monday_16:30" -> count
  totalAssignments: number;
}

/**
 * Raw history row from single database query
 */
interface RawHistoryRow {
  driverId: string;
  serviceDate: Date;
  soloType: string;
  tractorId: string;
}

interface ORToolsResult {
  assignments: ORToolsAssignment[];
  unassigned: string[];
  stats: {
    totalBlocks: number;
    totalDrivers: number;
    assigned: number;
    unassigned: number;
    solverStatus: string;
  };
}

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/**
 * Convert ML match type to confidence score for UI display
 */
function getConfidenceFromMatchType(matchType: string, mlScore?: number | null): number {
  // If we have an ML score, use it directly (already 0-1)
  if (mlScore !== null && mlScore !== undefined) {
    return mlScore;
  }

  // Fallback: convert match type to confidence
  switch (matchType) {
    case "ml_excellent": return 0.95;
    case "ml_good": return 0.75;
    case "ml_fair": return 0.55;
    case "ml_assigned": return 0.35;
    case "optimal": return 0.8;  // Legacy: had history match
    case "assigned": return 0.5; // Legacy: no history
    default: return 0.5;
  }
}

/**
 * Call Python OR-Tools solver
 */
async function callORToolsSolver(
  drivers: DriverInput[],
  blocks: BlockInput[],
  slotHistory: Record<string, Record<string, number>> = {},
  minDays: number = 3,
  driverHistories: Record<string, DriverHistoryEntry[]> = {}
): Promise<ORToolsResult> {
  return new Promise((resolve, reject) => {
    const pythonPath = process.env.PYTHON_PATH || "python";
    const scriptPath = path.join(__dirname, "../python/schedule_optimizer.py");

    const input = JSON.stringify({
      action: "optimize",
      drivers,
      blocks,
      slotHistory,
      minDays,
      driverHistories  // NEW: for ML pattern analysis
    });

    // Pass data via stdin instead of command line args (avoids ENAMETOOLONG error)
    const python = spawn(pythonPath, [scriptPath]);

    let stdout = "";
    let stderr = "";

    python.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    python.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    python.on("close", (code) => {
      // Always log Python stderr for debugging
      if (stderr) {
        console.log("[OR-Tools Python]", stderr);
      }

      if (code !== 0) {
        console.error("[OR-Tools] Python script error:", stderr);
        reject(new Error(`Python script exited with code ${code}: ${stderr}`));
        return;
      }

      try {
        const result = JSON.parse(stdout);
        if (result.error) {
          reject(new Error(result.error));
        } else {
          resolve(result);
        }
      } catch (e) {
        reject(new Error(`Failed to parse OR-Tools output: ${stdout}`));
      }
    });

    python.on("error", (err) => {
      reject(new Error(`Failed to start Python: ${err.message}`));
    });

    // Write input to stdin and close
    python.stdin.write(input);
    python.stdin.end();
  });
}

/**
 * ============================================================================
 * SINGLE SOURCE OF TRUTH: getAllDriverProfiles()
 * ============================================================================
 * ONE database query to get ALL history data, then derive EVERYTHING in memory:
 * - Contract type per driver (from solo type frequency)
 * - Primary time (most frequent time worked)
 * - Preferred days (days worked, sorted by frequency)
 * - Slot history (day_time -> count)
 *
 * This replaces the old separate functions that each queried the DB.
 * ============================================================================
 */
async function getAllDriverProfiles(
  tenantId: string,
  historyStartDate: Date,
  historyEndDate: Date
): Promise<{
  profiles: Record<string, DriverProfile>;
  slotHistory: Record<string, Record<string, number>>;
  driverHistories: Record<string, DriverHistoryEntry[]>;
  totalAssignments: number;
}> {
  const daysDiff = Math.ceil((historyEndDate.getTime() - historyStartDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  console.log(`[History] Fetching ALL driver history from ${format(historyStartDate, "yyyy-MM-dd")} to ${format(historyEndDate, "yyyy-MM-dd")} (${daysDiff} days)`);

  // ============ ONE QUERY TO RULE THEM ALL ============
  const rawHistory = await db
    .select({
      driverId: blockAssignments.driverId,
      serviceDate: blocks.serviceDate,
      soloType: blocks.soloType,
      tractorId: blocks.tractorId,
    })
    .from(blockAssignments)
    .innerJoin(blocks, eq(blockAssignments.blockId, blocks.id))
    .where(
      and(
        eq(blocks.tenantId, tenantId),
        eq(blockAssignments.isActive, true),
        gte(blocks.serviceDate, historyStartDate),
        lte(blocks.serviceDate, historyEndDate)
      )
    );

  console.log(`[History] Found ${rawHistory.length} total assignments in history window`);

  // ============ BUILD EVERYTHING IN MEMORY ============

  // Intermediate structures for counting
  const driverSoloCounts: Record<string, { solo1: number; solo2: number; team: number }> = {};
  const driverTimeCounts: Record<string, Record<string, number>> = {};  // driverId -> { "16:30": 5, "23:30": 3 }
  const driverDayCounts: Record<string, Record<string, number>> = {};   // driverId -> { "monday": 4, "tuesday": 2 }
  const driverSlotCounts: Record<string, Record<string, number>> = {};  // driverId -> { "monday_16:30": 3 }
  const globalSlotHistory: Record<string, Record<string, number>> = {}; // "monday_16:30" -> { driverId: count }
  const driverHistoryEntries: Record<string, DriverHistoryEntry[]> = {};

  for (const row of rawHistory) {
    if (!row.driverId) continue;

    const driverId = row.driverId;
    const serviceDate = new Date(row.serviceDate);
    const dayIndex = serviceDate.getDay();
    const dayName = DAY_NAMES[dayIndex];
    const soloType = (row.soloType || "solo1").toLowerCase();
    const tractorId = row.tractorId || "Tractor_1";
    const lookupKey = `${soloType}_${tractorId}`;
    const time = CANONICAL_START_TIMES[lookupKey] || "00:00";
    const slot = `${dayName}_${time}`;

    // 1. Count solo types
    if (!driverSoloCounts[driverId]) {
      driverSoloCounts[driverId] = { solo1: 0, solo2: 0, team: 0 };
    }
    if (soloType === "solo1") driverSoloCounts[driverId].solo1++;
    else if (soloType === "solo2") driverSoloCounts[driverId].solo2++;
    else if (soloType === "team") driverSoloCounts[driverId].team++;

    // 2. Count times per driver
    if (!driverTimeCounts[driverId]) driverTimeCounts[driverId] = {};
    driverTimeCounts[driverId][time] = (driverTimeCounts[driverId][time] || 0) + 1;

    // 3. Count days per driver
    if (!driverDayCounts[driverId]) driverDayCounts[driverId] = {};
    driverDayCounts[driverId][dayName] = (driverDayCounts[driverId][dayName] || 0) + 1;

    // 4. Count slots per driver
    if (!driverSlotCounts[driverId]) driverSlotCounts[driverId] = {};
    driverSlotCounts[driverId][slot] = (driverSlotCounts[driverId][slot] || 0) + 1;

    // 5. Global slot history (for Python)
    if (!globalSlotHistory[slot]) globalSlotHistory[slot] = {};
    globalSlotHistory[slot][driverId] = (globalSlotHistory[slot][driverId] || 0) + 1;

    // 6. Driver history entries (for Python ML)
    if (!driverHistoryEntries[driverId]) driverHistoryEntries[driverId] = [];
    driverHistoryEntries[driverId].push({ day: dayName, time });
  }

  // ============ BUILD FINAL PROFILES ============
  const profiles: Record<string, DriverProfile> = {};

  for (const [driverId, soloCounts] of Object.entries(driverSoloCounts)) {
    const total = soloCounts.solo1 + soloCounts.solo2 + soloCounts.team;

    // Determine contract type (60% threshold, then majority)
    let contractType: string;
    if (soloCounts.solo2 / total >= 0.6) {
      contractType = "solo2";
    } else if (soloCounts.solo1 / total >= 0.6) {
      contractType = "solo1";
    } else if (soloCounts.team / total >= 0.6) {
      contractType = "team";
    } else if (soloCounts.solo2 >= soloCounts.solo1 && soloCounts.solo2 >= soloCounts.team) {
      contractType = "solo2";
    } else if (soloCounts.solo1 >= soloCounts.team) {
      contractType = "solo1";
    } else {
      contractType = "team";
    }

    // Sort times by frequency (most frequent first)
    const timeCounts = driverTimeCounts[driverId] || {};
    const preferredTimes = Object.entries(timeCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([time]) => time);
    const primaryTime = preferredTimes[0] || "";

    // Sort days by frequency
    const dayCounts = driverDayCounts[driverId] || {};
    const preferredDays = Object.entries(dayCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([day]) => day);

    profiles[driverId] = {
      contractType,
      primaryTime,
      preferredTimes,
      preferredDays,
      slotHistory: driverSlotCounts[driverId] || {},
      totalAssignments: total
    };
  }

  // Log summary
  const solo1Count = Object.values(profiles).filter(p => p.contractType === "solo1").length;
  const solo2Count = Object.values(profiles).filter(p => p.contractType === "solo2").length;
  console.log(`[History] Built profiles for ${Object.keys(profiles).length} drivers: ${solo1Count} solo1, ${solo2Count} solo2`);

  // Log sample profiles
  const sampleDrivers = Object.entries(profiles).slice(0, 3);
  for (const [driverId, profile] of sampleDrivers) {
    console.log(`[History]   ${driverId.slice(0, 8)}...: ${profile.contractType}, primary=${profile.primaryTime}, days=${profile.preferredDays.slice(0, 3).join(",")}`);
  }

  return {
    profiles,
    slotHistory: globalSlotHistory,
    driverHistories: driverHistoryEntries,
    totalAssignments: rawHistory.length
  };
}

/**
 * Get ALL active drivers with their data DERIVED FROM HISTORY profiles
 */
async function getDriversForOptimization(
  tenantId: string,
  profiles: Record<string, DriverProfile>,
  contractTypeFilter?: string
): Promise<DriverInput[]> {
  console.log("[OR-Tools] Getting active drivers with history-derived profiles");

  // Get all active drivers (no DNA profile join!)
  const allDrivers = await db
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

  const result: DriverInput[] = allDrivers.map(driver => {
    const profile = profiles[driver.id];
    return {
      id: driver.id,
      name: `${driver.firstName} ${driver.lastName}`,
      // Use profile data if available, otherwise defaults for new drivers
      preferredDays: profile?.preferredDays || [],
      preferredTime: profile?.primaryTime || "",
      contractType: profile?.contractType || "solo1",
    };
  });

  // Filter by contract type if specified (skip if "all" or undefined)
  const filtered = (contractTypeFilter && contractTypeFilter.toLowerCase() !== "all")
    ? result.filter(d => d.contractType === contractTypeFilter.toLowerCase())
    : result;

  // Count by contract type
  const byCT: Record<string, number> = {};
  for (const d of filtered) {
    byCT[d.contractType] = (byCT[d.contractType] || 0) + 1;
  }
  console.log(`[OR-Tools] Found ${filtered.length} drivers (from ${result.length} total):`, byCT);

  return filtered;
}

/**
 * Get unassigned blocks for a week
 */
async function getUnassignedBlocks(tenantId: string, weekStart: Date, weekEnd: Date, contractTypeFilter?: string): Promise<BlockInput[]> {
  // Ensure weekEnd includes the full last day (database stores dates with 12:00:00 timestamp)
  // Add 1 day to weekEnd and use < instead of <= to include all of the last day
  const weekEndPlusOne = new Date(weekEnd);
  weekEndPlusOne.setDate(weekEndPlusOne.getDate() + 1);
  weekEndPlusOne.setHours(0, 0, 0, 0);

  console.log(`[OR-Tools] Getting blocks from ${format(weekStart, "yyyy-MM-dd")} to < ${format(weekEndPlusOne, "yyyy-MM-dd")}`);

  // Get all blocks in the date range
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

  // Get assigned block IDs
  const assignments = await db
    .select({ blockId: blockAssignments.blockId })
    .from(blockAssignments)
    .where(eq(blockAssignments.isActive, true));

  const assignedBlockIds = new Set(assignments.map(a => a.blockId));

  // Filter to unassigned blocks
  return allBlocks
    .filter(b => !assignedBlockIds.has(b.id))
    .filter(b => {
      if (!contractTypeFilter || contractTypeFilter.toLowerCase() === "all") return true;
      return b.soloType?.toLowerCase() === contractTypeFilter.toLowerCase();
    })
    .map(b => {
      const serviceDate = new Date(b.serviceDate);
      const dayIndex = serviceDate.getDay();
      const dayName = DAY_NAMES[dayIndex];

      // Use CANONICAL_START_TIMES lookup (Holy Grail) instead of startTimestamp
      const soloType = (b.soloType || "solo1").toLowerCase();
      const tractorId = b.tractorId || "Tractor_1";
      const lookupKey = `${soloType}_${tractorId}`;
      const time = CANONICAL_START_TIMES[lookupKey] || "00:00";

      return {
        id: b.id,
        day: dayName,
        time,
        contractType: b.soloType || "solo1",
        serviceDate: format(serviceDate, "yyyy-MM-dd"),
        tractorId: tractorId
      };
    });
}

/**
 * Main optimization function - matches drivers to blocks using OR-Tools
 *
 * @param minDays - Minimum days per week a driver should work (3, 4, or 5)
 *                  Slider: 3 = part-time OK, 4 = prefer full-time, 5 = full-time only
 * @param historyStartDate - Custom start date for history lookback
 * @param historyEndDate - Custom end date for history lookback
 */
export async function optimizeWeekSchedule(
  tenantId: string,
  weekStart: Date,
  contractTypeFilter?: "solo1" | "solo2" | "team",
  minDays: number = 3,
  historyStartDate?: Date,
  historyEndDate?: Date
): Promise<{
  suggestions: Array<{
    blockId: string;
    driverId: string;
    driverName: string;
    confidence: number;
    matchType: string;
    preferredTime: string;
    actualTime: string;
    serviceDate: string;
    day: string;
    mlScore?: number | null;
    patternGroup?: string | null;
  }>;
  unassigned: string[];
  stats: {
    totalBlocks: number;
    totalDrivers: number;
    assigned: number;
    unassigned: number;
    solverStatus: string;
  };
  historyRange: {
    start: string;
    end: string;
    days: number;
    totalAssignments: number;
  };
}> {
  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 0 });

  // Default history range if not provided: 8 weeks back
  const historyEnd = historyEndDate || new Date(weekStart.getTime() - 24 * 60 * 60 * 1000); // day before weekStart
  const historyStart = historyStartDate || new Date(weekStart.getTime() - 56 * 24 * 60 * 60 * 1000); // 8 weeks back

  const daysDiff = Math.ceil((historyEnd.getTime() - historyStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;

  console.log(`[OR-Tools] Optimizing schedule for ${format(weekStart, "yyyy-MM-dd")} to ${format(weekEnd, "yyyy-MM-dd")} (lookback: ${daysDiff} days from ${format(historyStart, "yyyy-MM-dd")} to ${format(historyEnd, "yyyy-MM-dd")})`);

  // ============ SINGLE SOURCE OF TRUTH ============
  // ONE query to get ALL history, then derive EVERYTHING from it
  const { profiles, slotHistory, driverHistories, totalAssignments: totalHistoryAssignments } =
    await getAllDriverProfiles(tenantId, historyStart, historyEnd);

  // Get drivers with history-derived profiles, and unassigned blocks
  const driverInputs = await getDriversForOptimization(tenantId, profiles, contractTypeFilter);
  const blockInputs = await getUnassignedBlocks(tenantId, weekStart, weekEnd, contractTypeFilter);

  console.log(`[OR-Tools] Found ${driverInputs.length} drivers and ${blockInputs.length} unassigned blocks`);

  if (driverInputs.length === 0 || blockInputs.length === 0) {
    return {
      suggestions: [],
      unassigned: blockInputs.map(b => b.id),
      stats: {
        totalBlocks: blockInputs.length,
        totalDrivers: driverInputs.length,
        assigned: 0,
        unassigned: blockInputs.length,
        solverStatus: "NO_DATA"
      },
      historyRange: {
        start: format(historyStart, "yyyy-MM-dd"),
        end: format(historyEnd, "yyyy-MM-dd"),
        days: daysDiff,
        totalAssignments: totalHistoryAssignments
      }
    };
  }

  // Call OR-Tools solver with historical data + ML histories
  console.log("[OR-Tools] Calling Python with:", {
    driversCount: driverInputs.length,
    blocksCount: blockInputs.length,
    slotHistoryCount: Object.keys(slotHistory).length,
    driverHistoriesCount: Object.keys(driverHistories).length,
    minDays,
    historyDays: daysDiff,
  });
  const result = await callORToolsSolver(driverInputs, blockInputs, slotHistory, minDays, driverHistories);

  // Convert to website format with ML info
  const suggestions = result.assignments.map(a => ({
    blockId: a.blockId,
    driverId: a.driverId,
    driverName: a.driverName,
    confidence: getConfidenceFromMatchType(a.matchType, a.mlScore),
    matchType: a.matchType,
    preferredTime: a.preferredTime,
    actualTime: a.actualTime,
    serviceDate: a.serviceDate,
    day: a.day,
    mlScore: a.mlScore,
    patternGroup: a.patternGroup
  }));

  return {
    suggestions,
    unassigned: result.unassigned,
    stats: result.stats,
    historyRange: {
      start: format(historyStart, "yyyy-MM-dd"),
      end: format(historyEnd, "yyyy-MM-dd"),
      days: daysDiff,
      totalAssignments: totalHistoryAssignments
    }
  };
}

/**
 * Apply optimized assignments to the database
 */
export async function applyOptimizedSchedule(
  tenantId: string,
  assignments: Array<{ blockId: string; driverId: string }>
): Promise<{ applied: number; errors: string[] }> {
  let applied = 0;
  const errors: string[] = [];

  console.log(`[Apply] Starting to apply ${assignments.length} assignments for tenant ${tenantId}`);

  for (const assignment of assignments) {
    try {
      // Check if already assigned
      const existing = await db
        .select()
        .from(blockAssignments)
        .where(
          and(
            eq(blockAssignments.blockId, assignment.blockId),
            eq(blockAssignments.isActive, true)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        console.log(`[Apply] Block ${assignment.blockId} already has active assignment`);
        errors.push(`Block ${assignment.blockId} already assigned`);
        continue;
      }

      // Create assignment
      console.log(`[Apply] Creating assignment: block=${assignment.blockId}, driver=${assignment.driverId}`);
      await db.insert(blockAssignments).values({
        tenantId,
        blockId: assignment.blockId,
        driverId: assignment.driverId,
        isActive: true,
        assignedAt: new Date(),
        assignedBy: null  // System-generated assignment (no user ID)
      });

      applied++;
      console.log(`[Apply] Successfully assigned block ${assignment.blockId}`);
    } catch (e: any) {
      console.error(`[Apply] Failed to assign ${assignment.blockId}:`, e.message);
      errors.push(`Failed to assign ${assignment.blockId}: ${e.message}`);
    }
  }

  console.log(`[Apply] Completed: ${applied} applied, ${errors.length} errors`);
  return { applied, errors };
}
