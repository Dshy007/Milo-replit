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
import { blocks, drivers, driverDnaProfiles, blockAssignments } from "@shared/schema";
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
 * Get ALL active drivers with their contract types from DNA profiles
 */
async function getDriversForOptimization(tenantId: string, contractTypeFilter?: string): Promise<DriverInput[]> {
  console.log("[OR-Tools] Getting active drivers with contract types");

  // Get drivers with their DNA profiles (for contract type)
  const allDrivers = await db
    .select({
      id: drivers.id,
      firstName: drivers.firstName,
      lastName: drivers.lastName,
      contractType: driverDnaProfiles.preferredContractType,
    })
    .from(drivers)
    .leftJoin(driverDnaProfiles, eq(drivers.id, driverDnaProfiles.driverId))
    .where(
      and(
        eq(drivers.tenantId, tenantId),
        eq(drivers.status, "active")
      )
    );

  const result: DriverInput[] = allDrivers.map(driver => ({
    id: driver.id,
    name: `${driver.firstName} ${driver.lastName}`,
    preferredDays: [],
    preferredTime: "",
    contractType: (driver.contractType || "solo1").toLowerCase(),
  }));

  // Count by contract type
  const byCT: Record<string, number> = {};
  for (const d of result) {
    byCT[d.contractType] = (byCT[d.contractType] || 0) + 1;
  }
  console.log(`[OR-Tools] Found ${result.length} drivers:`, byCT);

  return result;
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
      if (!contractTypeFilter) return true;
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
 * Get slot history for historical pattern matching
 * Maps SLOT (dayOfWeek_canonicalTime) -> { driverId: count }
 * Example: "monday_16:30" -> { "driver-123": 5, "driver-456": 3 }
 *
 * This allows matching based on who has historically worked each slot
 * A driver who worked monday_16:30 five times gets priority
 *
 * @param lookbackWeeks - How many weeks to look back (1, 2, 4, or 8)
 */
async function getSlotHistory(
  tenantId: string,
  currentWeekStart: Date,
  lookbackWeeks: number = 8
): Promise<{ slotHistory: Record<string, Record<string, number>>; historyStart: Date; historyEnd: Date }> {
  // Calculate lookback period
  const lookbackDays = lookbackWeeks * 7;
  const historyStart = new Date(currentWeekStart);
  historyStart.setDate(historyStart.getDate() - lookbackDays);

  // End at the day before current week starts
  const historyEnd = new Date(currentWeekStart);
  historyEnd.setDate(historyEnd.getDate() - 1);

  console.log(`[OR-Tools] Getting ${lookbackWeeks}-week history from ${format(historyStart, "yyyy-MM-dd")} to ${format(historyEnd, "yyyy-MM-dd")}`);

  // Get all blocks from the history period
  const historyBlocks = await db
    .select({
      id: blocks.id,
      serviceDate: blocks.serviceDate,
      soloType: blocks.soloType,
      tractorId: blocks.tractorId
    })
    .from(blocks)
    .where(
      and(
        eq(blocks.tenantId, tenantId),
        gte(blocks.serviceDate, historyStart),
        lte(blocks.serviceDate, historyEnd)
      )
    );

  // DEBUG: Show first and last blocks in the query window
  if (historyBlocks.length > 0) {
    const sortedByDate = [...historyBlocks].sort((a, b) =>
      new Date(a.serviceDate).getTime() - new Date(b.serviceDate).getTime()
    );
    const firstBlock = sortedByDate[0];
    const lastBlock = sortedByDate[sortedByDate.length - 1];
    console.log(`[OR-Tools DEBUG] Total blocks in ${lookbackWeeks}-week window: ${historyBlocks.length}`);
    console.log(`[OR-Tools DEBUG] First block: ${firstBlock.id} on ${format(new Date(firstBlock.serviceDate), "yyyy-MM-dd (EEEE)")}`);
    console.log(`[OR-Tools DEBUG] Last block: ${lastBlock.id} on ${format(new Date(lastBlock.serviceDate), "yyyy-MM-dd (EEEE)")}`);
  } else {
    console.log(`[OR-Tools DEBUG] No blocks found in ${lookbackWeeks}-week window`);
  }

  // Build a map of blockId -> SLOT
  const blockIdToSlot: Record<string, string> = {};
  for (const b of historyBlocks) {
    const serviceDate = new Date(b.serviceDate);
    const dayIndex = serviceDate.getDay();
    const dayName = DAY_NAMES[dayIndex];

    // Use canonical time from Holy Grail lookup
    const soloType = (b.soloType || "solo1").toLowerCase();
    const tractorId = b.tractorId || "Tractor_1";
    const lookupKey = `${soloType}_${tractorId}`;
    const canonicalTime = CANONICAL_START_TIMES[lookupKey] || "00:00";

    // SLOT = dayOfWeek_canonicalTime (e.g., "monday_16:30")
    const slot = `${dayName}_${canonicalTime}`;
    blockIdToSlot[b.id] = slot;
  }

  // Get all active assignments
  const assignments = await db
    .select({
      blockId: blockAssignments.blockId,
      driverId: blockAssignments.driverId
    })
    .from(blockAssignments)
    .where(eq(blockAssignments.isActive, true));

  // Build slot history: SLOT -> { driverId: count }
  const slotHistory: Record<string, Record<string, number>> = {};

  for (const a of assignments) {
    if (!a.blockId) continue;
    const slot = blockIdToSlot[a.blockId];
    if (slot) {
      if (!slotHistory[slot]) {
        slotHistory[slot] = {};
      }
      slotHistory[slot][a.driverId] = (slotHistory[slot][a.driverId] || 0) + 1;
    }
  }

  // Log summary
  const totalSlots = Object.keys(slotHistory).length;
  const totalAssignments = Object.values(slotHistory).reduce(
    (sum, drivers) => sum + Object.values(drivers).reduce((s, c) => s + c, 0),
    0
  );
  console.log(`[OR-Tools] Built history: ${totalSlots} slots, ${totalAssignments} total assignments`);

  // Log sample
  const sampleSlots = Object.entries(slotHistory).slice(0, 3);
  for (const [slot, drivers] of sampleSlots) {
    const topDriver = Object.entries(drivers).sort((a, b) => b[1] - a[1])[0];
    console.log(`[OR-Tools]   ${slot}: ${Object.keys(drivers).length} drivers (top: ${topDriver?.[1] || 0} times)`);
  }

  return { slotHistory, historyStart, historyEnd };
}

/**
 * Get driver assignment histories for ML pattern analysis
 * Returns: { driverId: [{day, time}, ...] } for the specified lookback period
 *
 * @param lookbackWeeks - How many weeks to look back (1, 2, 4, or 8)
 */
async function getDriverHistories(
  tenantId: string,
  currentWeekStart: Date,
  lookbackWeeks: number = 8
): Promise<Record<string, DriverHistoryEntry[]>> {
  // Calculate lookback period
  const lookbackDays = lookbackWeeks * 7;
  const historyStart = new Date(currentWeekStart);
  historyStart.setDate(historyStart.getDate() - lookbackDays);

  const historyEnd = new Date(currentWeekStart);
  historyEnd.setDate(historyEnd.getDate() - 1);

  console.log(`[OR-Tools] Getting driver histories for ML from ${format(historyStart, "yyyy-MM-dd")} to ${format(historyEnd, "yyyy-MM-dd")} (${lookbackWeeks} weeks)`);

  // Get all blocks with their assignments from the history period
  const historyData = await db
    .select({
      blockId: blocks.id,
      serviceDate: blocks.serviceDate,
      soloType: blocks.soloType,
      tractorId: blocks.tractorId,
      driverId: blockAssignments.driverId
    })
    .from(blocks)
    .innerJoin(blockAssignments, eq(blocks.id, blockAssignments.blockId))
    .where(
      and(
        eq(blocks.tenantId, tenantId),
        eq(blockAssignments.isActive, true),
        gte(blocks.serviceDate, historyStart),
        lte(blocks.serviceDate, historyEnd)
      )
    );

  // DEBUG: Show first and last assignments in the ML history window
  if (historyData.length > 0) {
    const sortedByDate = [...historyData].sort((a, b) =>
      new Date(a.serviceDate).getTime() - new Date(b.serviceDate).getTime()
    );
    const firstEntry = sortedByDate[0];
    const lastEntry = sortedByDate[sortedByDate.length - 1];
    console.log(`[OR-Tools DEBUG] Total assignments in ${lookbackWeeks}-week ML window: ${historyData.length}`);
    console.log(`[OR-Tools DEBUG] First assignment: block ${firstEntry.blockId} on ${format(new Date(firstEntry.serviceDate), "yyyy-MM-dd (EEEE)")} to driver ${firstEntry.driverId}`);
    console.log(`[OR-Tools DEBUG] Last assignment: block ${lastEntry.blockId} on ${format(new Date(lastEntry.serviceDate), "yyyy-MM-dd (EEEE)")} to driver ${lastEntry.driverId}`);
  } else {
    console.log(`[OR-Tools DEBUG] No assignments found in ${lookbackWeeks}-week ML history window`);
  }

  // Build driver histories: { driverId: [{day, time}, ...] }
  const driverHistories: Record<string, DriverHistoryEntry[]> = {};

  for (const row of historyData) {
    if (!row.driverId) continue;

    const serviceDate = new Date(row.serviceDate);
    const dayIndex = serviceDate.getDay();
    const dayName = DAY_NAMES[dayIndex];

    // Use canonical time from lookup
    const soloType = (row.soloType || "solo1").toLowerCase();
    const tractorId = row.tractorId || "Tractor_1";
    const lookupKey = `${soloType}_${tractorId}`;
    const time = CANONICAL_START_TIMES[lookupKey] || "00:00";

    if (!driverHistories[row.driverId]) {
      driverHistories[row.driverId] = [];
    }
    driverHistories[row.driverId].push({ day: dayName, time });
  }

  const driverCount = Object.keys(driverHistories).length;
  const totalEntries = Object.values(driverHistories).reduce((sum, h) => sum + h.length, 0);
  console.log(`[OR-Tools] Built ML histories: ${driverCount} drivers, ${totalEntries} total assignments`);

  // DEBUG: Show day distribution for K-Means
  const dayDistribution: Record<string, number> = {
    sunday: 0, monday: 0, tuesday: 0, wednesday: 0, thursday: 0, friday: 0, saturday: 0
  };
  for (const entries of Object.values(driverHistories)) {
    for (const entry of entries) {
      const dayLower = entry.day.toLowerCase();
      if (dayDistribution[dayLower] !== undefined) {
        dayDistribution[dayLower]++;
      }
    }
  }
  console.log(`[K-Means Data] Day distribution from ${lookbackWeeks}-week history:`);
  console.log(`  Sun: ${dayDistribution.sunday} | Mon: ${dayDistribution.monday} | Tue: ${dayDistribution.tuesday} | Wed: ${dayDistribution.wednesday}`);
  console.log(`  Thu: ${dayDistribution.thursday} | Fri: ${dayDistribution.friday} | Sat: ${dayDistribution.saturday}`);

  const sunWedTotal = dayDistribution.sunday + dayDistribution.monday + dayDistribution.tuesday + dayDistribution.wednesday;
  const wedSatTotal = dayDistribution.wednesday + dayDistribution.thursday + dayDistribution.friday + dayDistribution.saturday;
  console.log(`[K-Means Data] Sun-Wed total: ${sunWedTotal} | Wed-Sat total: ${wedSatTotal}`);

  return driverHistories;
}

/**
 * Main optimization function - matches drivers to blocks using OR-Tools
 *
 * @param minDays - Minimum days per week a driver should work (3, 4, or 5)
 *                  Slider: 3 = part-time OK, 4 = prefer full-time, 5 = full-time only
 * @param lookbackWeeks - How many weeks to look back for pattern matching (1, 2, 4, or 8)
 */
export async function optimizeWeekSchedule(
  tenantId: string,
  weekStart: Date,
  contractTypeFilter?: "solo1" | "solo2" | "team",
  minDays: number = 3,
  lookbackWeeks: number = 8
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
    weeks: number;
    totalAssignments: number;
  };
}> {
  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 0 });

  console.log(`[OR-Tools] Optimizing schedule for ${format(weekStart, "yyyy-MM-dd")} to ${format(weekEnd, "yyyy-MM-dd")} (lookback: ${lookbackWeeks} weeks)`);

  // Get drivers and blocks
  const driverInputs = await getDriversForOptimization(tenantId, contractTypeFilter);
  const blockInputs = await getUnassignedBlocks(tenantId, weekStart, weekEnd, contractTypeFilter);

  // Get slot history for pattern matching (with variable lookback)
  const { slotHistory, historyStart, historyEnd } = await getSlotHistory(tenantId, weekStart, lookbackWeeks);

  // Get driver histories for ML pattern analysis (with variable lookback)
  const driverHistories = await getDriverHistories(tenantId, weekStart, lookbackWeeks);

  // Count total assignments in history
  const totalHistoryAssignments = Object.values(driverHistories).reduce((sum, h) => sum + h.length, 0);

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
        weeks: lookbackWeeks,
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
    lookbackWeeks,
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
      weeks: lookbackWeeks,
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
