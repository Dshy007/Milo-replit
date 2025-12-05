/**
 * OR-Tools Schedule Optimizer Wrapper
 *
 * Calls the Python OR-Tools CP-SAT solver to match drivers to blocks.
 * Converts output to website's expected format.
 */

import { spawn } from "child_process";
import path from "path";
import { db } from "./db";
import { blocks, drivers, driverDnaProfiles, blockAssignments } from "@shared/schema";
import { eq, and, gte, lte, isNull } from "drizzle-orm";
import { format, startOfWeek, endOfWeek } from "date-fns";

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
async function callORToolsSolver(drivers: DriverInput[], blocks: BlockInput[]): Promise<ORToolsResult> {
  return new Promise((resolve, reject) => {
    const pythonPath = process.env.PYTHON_PATH || "python";
    const scriptPath = path.join(__dirname, "../python/schedule_optimizer.py");

    const input = JSON.stringify({
      action: "optimize",
      drivers,
      blocks
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
 * Get drivers with DNA profiles for optimization
 */
async function getDriversForOptimization(tenantId: string, contractTypeFilter?: string): Promise<DriverInput[]> {
  const driversWithDNA = await db
    .select({
      id: drivers.id,
      firstName: drivers.firstName,
      lastName: drivers.lastName,
      preferredDays: driverDnaProfiles.preferredDays,
      preferredStartTimes: driverDnaProfiles.preferredStartTimes,
      preferredContractType: driverDnaProfiles.preferredContractType,
    })
    .from(drivers)
    .innerJoin(driverDnaProfiles, eq(drivers.id, driverDnaProfiles.driverId))
    .where(
      and(
        eq(drivers.tenantId, tenantId),
        eq(drivers.status, "active")
      )
    );

  return driversWithDNA
    .filter(d => {
      if (!contractTypeFilter) return true;
      return d.preferredContractType?.toLowerCase() === contractTypeFilter.toLowerCase();
    })
    .map(d => ({
      id: d.id,
      name: `${d.firstName} ${d.lastName}`,
      preferredDays: (d.preferredDays as string[]) || [],
      preferredTime: ((d.preferredStartTimes as string[]) || [])[0] || "",
      contractType: d.preferredContractType || "solo1"
    }));
}

/**
 * Get unassigned blocks for a week
 */
async function getUnassignedBlocks(tenantId: string, weekStart: Date, weekEnd: Date, contractTypeFilter?: string): Promise<BlockInput[]> {
  // Get all blocks in the date range
  const allBlocks = await db
    .select()
    .from(blocks)
    .where(
      and(
        eq(blocks.tenantId, tenantId),
        gte(blocks.serviceDate, weekStart),
        lte(blocks.serviceDate, weekEnd)
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

      // Extract time from startTimestamp
      let time = "00:00";
      if (b.startTimestamp) {
        const ts = new Date(b.startTimestamp);
        time = format(ts, "HH:mm");
      }

      return {
        id: b.id,
        day: dayName,
        time,
        contractType: b.soloType || "solo1",
        serviceDate: format(serviceDate, "yyyy-MM-dd")
      };
    });
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

  // Call OR-Tools solver
  const result = await callORToolsSolver(driverInputs, blockInputs);

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
        errors.push(`Block ${assignment.blockId} already assigned`);
        continue;
      }

      // Create assignment
      await db.insert(blockAssignments).values({
        tenantId,
        blockId: assignment.blockId,
        driverId: assignment.driverId,
        isActive: true,
        assignedAt: new Date(),
        assignedBy: "ortools-optimizer"
      });

      applied++;
    } catch (e: any) {
      errors.push(`Failed to assign ${assignment.blockId}: ${e.message}`);
    }
  }

  return { applied, errors };
}
