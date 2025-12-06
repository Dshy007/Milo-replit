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
import { eq, and, gte, lte, isNull } from "drizzle-orm";
import { format, startOfWeek, endOfWeek } from "date-fns";

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
  matchType: "exact" | "close" | "fallback" | "default";
  preferredTime: string;
  actualTime: string;
  serviceDate: string;
  day: string;
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
 * Call Python OR-Tools solver
 */
async function callORToolsSolver(
  drivers: DriverInput[],
  blocks: BlockInput[],
  slotHistory: Record<string, Record<string, number>> = {}
): Promise<ORToolsResult> {
  return new Promise((resolve, reject) => {
    const pythonPath = process.env.PYTHON_PATH || "python";
    const scriptPath = path.join(__dirname, "../python/schedule_optimizer.py");

    const input = JSON.stringify({
      action: "optimize",
      drivers,
      blocks,
      slotHistory
    });

    const python = spawn(pythonPath, [scriptPath, input]);

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
  });
}

/**
 * Get ALL active drivers - no filtering, just need id and name for copy last week
 */
async function getDriversForOptimization(tenantId: string, contractTypeFilter?: string): Promise<DriverInput[]> {
  console.log("[OR-Tools] COPY LAST WEEK MODE: Getting all active drivers");

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

  const result: DriverInput[] = allDrivers.map(driver => ({
    id: driver.id,
    name: `${driver.firstName} ${driver.lastName}`,
    preferredDays: [],
    preferredTime: "",
    contractType: "solo1",
  }));

  console.log(`[OR-Tools] Found ${result.length} active drivers`);
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
 * Get 8-week slot history for historical pattern matching
 * Maps SLOT (dayOfWeek_canonicalTime) -> { driverId: count }
 * Example: "monday_16:30" -> { "driver-123": 5, "driver-456": 3 }
 *
 * This allows matching based on who has historically worked each slot
 * A driver who worked monday_16:30 five times in 8 weeks gets priority
 */
async function get8WeekSlotHistory(tenantId: string, currentWeekStart: Date): Promise<Record<string, Record<string, number>>> {
  // Calculate 8 weeks ago
  const eightWeeksAgo = new Date(currentWeekStart);
  eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 56); // 8 weeks = 56 days

  // End at the day before current week starts
  const historyEnd = new Date(currentWeekStart);
  historyEnd.setDate(historyEnd.getDate() - 1);

  console.log(`[OR-Tools] Getting 8-week history from ${format(eightWeeksAgo, "yyyy-MM-dd")} to ${format(historyEnd, "yyyy-MM-dd")}`);

  // Get all blocks from the 8-week history period
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
        gte(blocks.serviceDate, eightWeeksAgo),
        lte(blocks.serviceDate, historyEnd)
      )
    );

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

  return slotHistory;
}

/**
 * Main optimization function - matches drivers to blocks using OR-Tools
 */
export async function optimizeWeekSchedule(
  tenantId: string,
  weekStart: Date,
  contractTypeFilter?: "solo1" | "solo2" | "team"
): Promise<{
  suggestions: Array<{
    blockId: string;
    driverId: string;
    driverName: string;
    confidence: number;
    matchType: string;
    preferredTime: string;
    actualTime: string;
  }>;
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

  console.log(`[OR-Tools] Optimizing schedule for ${format(weekStart, "yyyy-MM-dd")} to ${format(weekEnd, "yyyy-MM-dd")}`);

  // Get drivers and blocks
  const driverInputs = await getDriversForOptimization(tenantId, contractTypeFilter);
  const blockInputs = await getUnassignedBlocks(tenantId, weekStart, weekEnd, contractTypeFilter);

  // Get 8-week slot history for pattern matching
  const slotHistory = await get8WeekSlotHistory(tenantId, weekStart);

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
      }
    };
  }

  // Call OR-Tools solver with historical data
  console.log("[OR-Tools] Calling Python with:", {
    driversCount: driverInputs.length,
    blocksCount: blockInputs.length,
    slotHistoryCount: Object.keys(slotHistory).length,
  });
  const result = await callORToolsSolver(driverInputs, blockInputs, slotHistory);

  // Convert to website format
  const suggestions = result.assignments.map(a => ({
    blockId: a.blockId,
    driverId: a.driverId,
    driverName: a.driverName,
    confidence: a.matchType === "exact" ? 1.0 : a.matchType === "close" ? 0.8 : 0.5,
    matchType: a.matchType,
    preferredTime: a.preferredTime,
    actualTime: a.actualTime
  }));

  return {
    suggestions,
    unassigned: result.unassigned,
    stats: result.stats
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
        assignedBy: "ortools-optimizer"
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
