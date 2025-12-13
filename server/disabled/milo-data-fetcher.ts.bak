/**
 * MILO Data Fetcher - Cascading Lookback History
 *
 * Implements the 12/8/3/2/1 week lookback windows with validation at each level.
 * Separates data fetching from prompt building for cleaner architecture.
 */

import { db } from "./db";
import { blocks, drivers, driverDnaProfiles, blockAssignments } from "@shared/schema";
import { eq, and, gte, lte } from "drizzle-orm";
import { format, subWeeks, startOfWeek, endOfWeek } from "date-fns";
import {
  LOOKBACK_WINDOWS,
  validateDriverData,
  type MiloDriverSummary,
  type MiloBlockSummary,
  type ValidationResult
} from "./milo-system-prompt";

// Canonical start times - same as claude-scheduler.ts
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

interface SlotHistoryByWindow {
  [driverId: string]: {
    [weeks: number]: { // 12, 8, 3, 2, 1
      slots: Record<string, number>; // slot -> count
      totalAssignments: number;
    };
  };
}

interface CascadingHistoryResult {
  historyByWindow: SlotHistoryByWindow;
  validationResults: Record<string, ValidationResult>;
  stats: {
    [weeks: number]: {
      driversWithData: number;
      totalAssignments: number;
    };
  };
}

/**
 * Fetch history for all lookback windows (12, 8, 3, 2, 1 weeks)
 * Each window is validated independently
 */
export async function getCascadingHistory(
  tenantId: string,
  currentWeekStart: Date
): Promise<CascadingHistoryResult> {

  const historyByWindow: SlotHistoryByWindow = {};
  const stats: CascadingHistoryResult["stats"] = {};

  // Fetch all drivers first
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

  // Initialize history structure for all drivers
  for (const driver of allDrivers) {
    historyByWindow[driver.id] = {};
    for (const window of LOOKBACK_WINDOWS) {
      historyByWindow[driver.id][window.weeks] = {
        slots: {},
        totalAssignments: 0
      };
    }
  }

  // Fetch all blocks for the maximum lookback period (12 weeks)
  const maxWeeksAgo = subWeeks(currentWeekStart, 12);
  const historyEnd = new Date(currentWeekStart);
  historyEnd.setDate(historyEnd.getDate() - 1);

  console.log(`[MiloDataFetcher] Fetching history from ${format(maxWeeksAgo, "yyyy-MM-dd")} to ${format(historyEnd, "yyyy-MM-dd")}`);

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
        gte(blocks.serviceDate, maxWeeksAgo),
        lte(blocks.serviceDate, historyEnd)
      )
    );

  // Build block ID to slot mapping with date
  const blockIdToInfo: Record<string, { slot: string; date: Date }> = {};
  for (const b of historyBlocks) {
    const serviceDate = new Date(b.serviceDate);
    const dayIndex = serviceDate.getDay();
    const dayName = DAY_NAMES[dayIndex];
    const soloType = (b.soloType || "solo1").toLowerCase();
    const tractorId = b.tractorId || "Tractor_1";
    const lookupKey = `${soloType}_${tractorId}`;
    const canonicalTime = CANONICAL_START_TIMES[lookupKey] || "00:00";
    const slot = `${dayName}_${canonicalTime}`;
    blockIdToInfo[b.id] = { slot, date: serviceDate };
  }

  // Get all assignments for these blocks
  const blockIds = Object.keys(blockIdToInfo);
  if (blockIds.length === 0) {
    console.log("[MiloDataFetcher] No historical blocks found");
    return {
      historyByWindow,
      validationResults: {},
      stats: {}
    };
  }

  const assignmentsData = await db
    .select({
      blockId: blockAssignments.blockId,
      driverId: blockAssignments.driverId
    })
    .from(blockAssignments)
    .where(eq(blockAssignments.isActive, true));

  // Process assignments into windows
  for (const a of assignmentsData) {
    if (!a.blockId) continue;
    const blockInfo = blockIdToInfo[a.blockId];
    if (!blockInfo) continue;

    const { slot, date: blockDate } = blockInfo;
    const driverId = a.driverId;

    if (!historyByWindow[driverId]) continue;

    // Calculate weeks ago for this assignment
    const weeksAgo = Math.floor(
      (currentWeekStart.getTime() - blockDate.getTime()) / (7 * 24 * 60 * 60 * 1000)
    );

    // Add to appropriate windows (cumulative - 12 week includes all)
    for (const window of LOOKBACK_WINDOWS) {
      if (weeksAgo <= window.weeks && weeksAgo > 0) {
        if (!historyByWindow[driverId][window.weeks].slots[slot]) {
          historyByWindow[driverId][window.weeks].slots[slot] = 0;
        }
        historyByWindow[driverId][window.weeks].slots[slot]++;
        historyByWindow[driverId][window.weeks].totalAssignments++;
      }
    }
  }

  // Calculate stats per window
  for (const window of LOOKBACK_WINDOWS) {
    let driversWithData = 0;
    let totalAssignments = 0;

    for (const driverId of Object.keys(historyByWindow)) {
      const driverWindow = historyByWindow[driverId][window.weeks];
      if (driverWindow.totalAssignments > 0) {
        driversWithData++;
        totalAssignments += driverWindow.totalAssignments;
      }
    }

    stats[window.weeks] = { driversWithData, totalAssignments };
    console.log(`[MiloDataFetcher] ${window.weeks}-week window: ${driversWithData} drivers with ${totalAssignments} assignments`);
  }

  return {
    historyByWindow,
    validationResults: {},
    stats
  };
}

/**
 * Format slot history for display in prompt
 */
function formatSlotHistory(slots: Record<string, number>, maxSlots: number = 5): string {
  const entries = Object.entries(slots)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxSlots);

  if (entries.length === 0) return "none";

  return entries.map(([slot, count]) => `${slot}(${count}x)`).join(", ");
}

/**
 * Main export - get all data needed for MILO prompt with validation
 */
export async function getMiloData(
  tenantId: string,
  weekStart: Date,
  contractTypeFilter?: "solo1" | "solo2"
): Promise<{
  drivers: MiloDriverSummary[];
  blocks: MiloBlockSummary[];
  validationSummary: {
    totalDrivers: number;
    established: number;
    new: number;
    unknown: number;
    errors: string[];
    warnings: string[];
  };
}> {

  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 0 });
  console.log(`[MiloDataFetcher] Preparing MILO data for ${format(weekStart, "yyyy-MM-dd")} to ${format(weekEnd, "yyyy-MM-dd")}`);

  // Step 1: Fetch cascading history
  const { historyByWindow, stats } = await getCascadingHistory(tenantId, weekStart);

  // Step 2: Fetch drivers with DNA profiles
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

  // Step 3: Validate each driver and build summaries
  const driverSummaries: MiloDriverSummary[] = [];
  const allErrors: string[] = [];
  const allWarnings: string[] = [];
  let established = 0, newDrivers = 0, unknown = 0;

  for (const d of allDrivers) {
    const driverContractType = (d.contractType || "solo1").toLowerCase();

    // Filter by contract type if specified
    if (contractTypeFilter && driverContractType !== contractTypeFilter) {
      continue;
    }

    const driverName = `${d.firstName} ${d.lastName}`;
    const preferredDays = (d.preferredDays as string[]) || [];
    const preferredStartTimes = (d.preferredStartTimes as string[]) || [];

    // Build history count by window for validation
    const historyByWindowCount: Record<number, number> = {};
    if (historyByWindow[d.id]) {
      for (const weeks of [12, 8, 3, 2, 1]) {
        historyByWindowCount[weeks] = historyByWindow[d.id][weeks]?.totalAssignments || 0;
      }
    }

    // Step 3: Validate driver data
    const validation = validateDriverData(
      d.id,
      driverName,
      preferredDays.length > 0 ? preferredDays : null,
      preferredStartTimes.length > 0 ? preferredStartTimes : null,
      historyByWindowCount
    );

    allErrors.push(...validation.errors);
    allWarnings.push(...validation.warnings);

    // Count categories
    if (validation.driverCategory === "established") established++;
    else if (validation.driverCategory === "new") newDrivers++;
    else unknown++;

    // Build summary
    const driverHistory = historyByWindow[d.id] || {};

    driverSummaries.push({
      id: d.id,
      name: driverName,
      contractType: driverContractType,
      preferredDays: preferredDays.length > 0 ? preferredDays.join(", ") : "none specified",
      preferredTime: preferredStartTimes[0] || "none specified",
      category: validation.driverCategory,
      history12Week: formatSlotHistory(driverHistory[12]?.slots || {}),
      history8Week: formatSlotHistory(driverHistory[8]?.slots || {}),
      history3Week: formatSlotHistory(driverHistory[3]?.slots || {}),
      history1Week: formatSlotHistory(driverHistory[1]?.slots || {}, 3),
      validationWarnings: validation.warnings
    });
  }

  // Step 4: Fetch unassigned blocks
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

  const assignments = await db
    .select({ blockId: blockAssignments.blockId })
    .from(blockAssignments)
    .where(eq(blockAssignments.isActive, true));

  const assignedBlockIds = new Set(assignments.map(a => a.blockId));

  const blockSummaries: MiloBlockSummary[] = allBlocks
    .filter(b => !assignedBlockIds.has(b.id))
    .filter(b => {
      if (!contractTypeFilter) return true;
      return b.soloType?.toLowerCase() === contractTypeFilter;
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
        serviceDate: format(serviceDate, "yyyy-MM-dd"),
        tractorId,
        contractType: soloType
      };
    });

  console.log(`[MiloDataFetcher] Prepared ${driverSummaries.length} drivers, ${blockSummaries.length} blocks`);
  console.log(`[MiloDataFetcher] Driver categories: ${established} established, ${newDrivers} new, ${unknown} unknown`);

  if (allErrors.length > 0) {
    console.warn(`[MiloDataFetcher] ${allErrors.length} validation errors found`);
  }

  return {
    drivers: driverSummaries,
    blocks: blockSummaries,
    validationSummary: {
      totalDrivers: driverSummaries.length,
      established,
      new: newDrivers,
      unknown,
      errors: allErrors,
      warnings: allWarnings
    }
  };
}
