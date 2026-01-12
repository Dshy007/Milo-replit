/**
 * Holy Grail Engine - Simple Slot-Based Matching
 *
 * A driver's "slot" = soloType + startTime + tractorId
 *
 * Example: Brian owns solo1_00:30_Tractor_1
 *
 * Algorithm:
 * 1. Build slot ownership map from last week's assignments
 * 2. For each block this week, find the slot owner from last week
 * 3. Suggest that driver (direct match) or find opportunities
 */

import { db } from "./db";
import { blocks, blockAssignments, drivers } from "@shared/schema";
import { eq, and, gte, lte, inArray } from "drizzle-orm";
import { format, startOfWeek, endOfWeek, addDays } from "date-fns";

// ============================================================================
// Types
// ============================================================================

export interface SlotOwner {
  slotKey: string;           // solo1_00:30_Tractor_1
  driverId: string;
  driverName: string;
  soloType: string;
  startTime: string;
  tractorId: string;
  daysWorkedLastWeek: number;
}

export interface BlockSuggestion {
  blockId: string;
  serviceDate: string;       // YYYY-MM-DD
  dayOfWeek: string;         // Sunday, Monday, etc.
  slotKey: string;
  soloType: string;
  startTime: string;
  tractorId: string;

  // Current assignment (if any)
  currentDriverId: string | null;
  currentDriverName: string | null;

  // Suggestion
  suggestedDriverId: string | null;
  suggestedDriverName: string | null;
  matchType: "direct" | "opportunity" | "new_slot" | "already_assigned";
  reason: string;
}

export interface DriverWorkload {
  driverId: string;
  driverName: string;
  soloType: string;          // Primary type they work
  daysWorkedLastWeek: number;
  daysAssignedThisWeek: number;
  hasCapacity: boolean;
  preferredStartTimes: string[];
}

export interface HolyGrailResult {
  lastWeekStart: string;
  thisWeekStart: string;
  directMatches: BlockSuggestion[];
  opportunities: BlockSuggestion[];
  newSlots: BlockSuggestion[];
  alreadyAssigned: BlockSuggestion[];
  missingSlots: SlotOwner[];  // Slots from last week not in this week
  driverWorkloads: DriverWorkload[];
  summary: {
    totalBlocksThisWeek: number;
    directMatches: number;
    opportunities: number;
    newSlots: number;
    alreadyAssigned: number;
    missingSlots: number;
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

function getSlotKey(soloType: string, startTime: string, tractorId: string): string {
  return `${soloType}_${startTime}_${tractorId}`;
}

function getDayOfWeek(date: Date): string {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return days[date.getDay()];
}

function parseTimeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function isWithinTimeRange(time1: string, time2: string, rangeMinutes: number): boolean {
  const mins1 = parseTimeToMinutes(time1);
  const mins2 = parseTimeToMinutes(time2);
  return Math.abs(mins1 - mins2) <= rangeMinutes;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Build a map of slot ownership from last week's assignments
 */
async function buildSlotOwnership(
  tenantId: string,
  weekStart: Date
): Promise<Map<string, SlotOwner>> {
  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 0 });

  // Get all assigned blocks from last week
  const lastWeekData = await db
    .select({
      block: blocks,
      assignment: blockAssignments,
      driver: drivers
    })
    .from(blocks)
    .innerJoin(
      blockAssignments,
      and(
        eq(blockAssignments.blockId, blocks.id),
        eq(blockAssignments.isActive, true)
      )
    )
    .innerJoin(
      drivers,
      eq(drivers.id, blockAssignments.driverId)
    )
    .where(
      and(
        eq(blocks.tenantId, tenantId),
        gte(blocks.serviceDate, weekStart),
        lte(blocks.serviceDate, weekEnd)
      )
    );

  // Build slot ownership map
  // For each slot, track who worked it and how many days
  const slotDriverCounts = new Map<string, Map<string, { driver: any; count: number }>>();

  for (const row of lastWeekData) {
    const startTime = format(new Date(row.block.startTimestamp), "HH:mm");
    const slotKey = getSlotKey(row.block.soloType, startTime, row.block.tractorId);

    if (!slotDriverCounts.has(slotKey)) {
      slotDriverCounts.set(slotKey, new Map());
    }

    const driverMap = slotDriverCounts.get(slotKey)!;
    const existing = driverMap.get(row.driver.id) || { driver: row.driver, count: 0 };
    existing.count++;
    driverMap.set(row.driver.id, existing);
  }

  // For each slot, pick the driver who worked it most
  const slotOwnership = new Map<string, SlotOwner>();

  for (const [slotKey, driverMap] of slotDriverCounts) {
    let maxCount = 0;
    let owner: any = null;

    for (const [driverId, data] of driverMap) {
      if (data.count > maxCount) {
        maxCount = data.count;
        owner = data;
      }
    }

    if (owner) {
      const [soloType, startTime, ...tractorParts] = slotKey.split("_");
      slotOwnership.set(slotKey, {
        slotKey,
        driverId: owner.driver.id,
        driverName: `${owner.driver.firstName} ${owner.driver.lastName}`,
        soloType,
        startTime,
        tractorId: tractorParts.join("_"),
        daysWorkedLastWeek: owner.count
      });
    }
  }

  return slotOwnership;
}

/**
 * Get driver workloads for capacity-based suggestions
 */
async function getDriverWorkloads(
  tenantId: string,
  lastWeekStart: Date,
  thisWeekStart: Date,
  thisWeekAssignments: Map<string, number>
): Promise<DriverWorkload[]> {
  const lastWeekEnd = endOfWeek(lastWeekStart, { weekStartsOn: 0 });

  // Get all active drivers
  const allDrivers = await db
    .select()
    .from(drivers)
    .where(
      and(
        eq(drivers.tenantId, tenantId),
        eq(drivers.isActive, true)
      )
    );

  // Get last week's assignments per driver
  const lastWeekData = await db
    .select({
      driverId: blockAssignments.driverId,
      soloType: blocks.soloType,
      startTime: blocks.startTimestamp
    })
    .from(blockAssignments)
    .innerJoin(blocks, eq(blocks.id, blockAssignments.blockId))
    .where(
      and(
        eq(blockAssignments.tenantId, tenantId),
        eq(blockAssignments.isActive, true),
        gte(blocks.serviceDate, lastWeekStart),
        lte(blocks.serviceDate, lastWeekEnd)
      )
    );

  // Count per driver
  const driverStats = new Map<string, {
    days: number;
    soloTypes: Set<string>;
    startTimes: Set<string>;
  }>();

  for (const row of lastWeekData) {
    const stats = driverStats.get(row.driverId) || {
      days: 0,
      soloTypes: new Set(),
      startTimes: new Set()
    };
    stats.days++;
    stats.soloTypes.add(row.soloType);
    stats.startTimes.add(format(new Date(row.startTime), "HH:mm"));
    driverStats.set(row.driverId, stats);
  }

  // Build workload objects
  const workloads: DriverWorkload[] = [];

  for (const driver of allDrivers) {
    const stats = driverStats.get(driver.id);
    const daysLastWeek = stats?.days || 0;
    const daysThisWeek = thisWeekAssignments.get(driver.id) || 0;

    // Determine primary solo type
    let soloType = "solo1";
    if (stats?.soloTypes.has("solo2") && !stats?.soloTypes.has("solo1")) {
      soloType = "solo2";
    } else if (stats?.soloTypes.has("solo2") && stats?.soloTypes.has("solo1")) {
      soloType = "both";
    }

    workloads.push({
      driverId: driver.id,
      driverName: `${driver.firstName} ${driver.lastName}`,
      soloType,
      daysWorkedLastWeek: daysLastWeek,
      daysAssignedThisWeek: daysThisWeek,
      hasCapacity: daysThisWeek < daysLastWeek,
      preferredStartTimes: stats ? Array.from(stats.startTimes) : []
    });
  }

  return workloads.filter(w => w.daysWorkedLastWeek > 0);
}

/**
 * Main function: Generate suggestions for this week's blocks
 */
export async function generateSuggestions(
  tenantId: string,
  lastWeekStart: Date,
  thisWeekStart: Date
): Promise<HolyGrailResult> {
  const thisWeekEnd = endOfWeek(thisWeekStart, { weekStartsOn: 0 });

  // Step 1: Build slot ownership from last week
  const slotOwnership = await buildSlotOwnership(tenantId, lastWeekStart);

  // Step 2: Get this week's blocks (with any existing assignments)
  const thisWeekData = await db
    .select({
      block: blocks,
      assignment: blockAssignments,
      driver: drivers
    })
    .from(blocks)
    .leftJoin(
      blockAssignments,
      and(
        eq(blockAssignments.blockId, blocks.id),
        eq(blockAssignments.isActive, true)
      )
    )
    .leftJoin(
      drivers,
      eq(drivers.id, blockAssignments.driverId)
    )
    .where(
      and(
        eq(blocks.tenantId, tenantId),
        gte(blocks.serviceDate, thisWeekStart),
        lte(blocks.serviceDate, thisWeekEnd)
      )
    )
    .orderBy(blocks.startTimestamp);

  // Count this week's assignments per driver (for capacity calc)
  const thisWeekAssignments = new Map<string, number>();
  for (const row of thisWeekData) {
    if (row.assignment && row.driver) {
      const count = thisWeekAssignments.get(row.driver.id) || 0;
      thisWeekAssignments.set(row.driver.id, count + 1);
    }
  }

  // Step 3: Get driver workloads
  const driverWorkloads = await getDriverWorkloads(
    tenantId,
    lastWeekStart,
    thisWeekStart,
    thisWeekAssignments
  );

  // Step 4: Generate suggestions for each block
  const directMatches: BlockSuggestion[] = [];
  const opportunities: BlockSuggestion[] = [];
  const newSlots: BlockSuggestion[] = [];
  const alreadyAssigned: BlockSuggestion[] = [];
  const usedSlotKeys = new Set<string>();

  for (const row of thisWeekData) {
    const startTime = format(new Date(row.block.startTimestamp), "HH:mm");
    const slotKey = getSlotKey(row.block.soloType, startTime, row.block.tractorId);
    const serviceDate = format(new Date(row.block.serviceDate), "yyyy-MM-dd");
    const dayOfWeek = getDayOfWeek(new Date(row.block.serviceDate));

    usedSlotKeys.add(slotKey);

    const baseSuggestion: Omit<BlockSuggestion, 'suggestedDriverId' | 'suggestedDriverName' | 'matchType' | 'reason'> = {
      blockId: row.block.id,
      serviceDate,
      dayOfWeek,
      slotKey,
      soloType: row.block.soloType,
      startTime,
      tractorId: row.block.tractorId,
      currentDriverId: row.assignment?.driverId || null,
      currentDriverName: row.driver ? `${row.driver.firstName} ${row.driver.lastName}` : null
    };

    // Already assigned?
    if (row.assignment && row.driver) {
      alreadyAssigned.push({
        ...baseSuggestion,
        suggestedDriverId: row.driver.id,
        suggestedDriverName: `${row.driver.firstName} ${row.driver.lastName}`,
        matchType: "already_assigned",
        reason: "Already assigned"
      });
      continue;
    }

    // Check for direct match from slot ownership
    const owner = slotOwnership.get(slotKey);
    if (owner) {
      directMatches.push({
        ...baseSuggestion,
        suggestedDriverId: owner.driverId,
        suggestedDriverName: owner.driverName,
        matchType: "direct",
        reason: `${owner.driverName} worked this slot ${owner.daysWorkedLastWeek} day(s) last week`
      });
      continue;
    }

    // No direct match - look for opportunity suggestions
    // Find drivers who work the same solo type with capacity
    const candidates = driverWorkloads.filter(w => {
      // Must work this solo type
      if (w.soloType !== row.block.soloType && w.soloType !== "both") {
        return false;
      }
      // Must have capacity
      if (!w.hasCapacity) {
        return false;
      }
      return true;
    });

    // Sort by best fit (prefer similar start times)
    candidates.sort((a, b) => {
      // Prefer drivers with similar start times
      const aHasSimilarTime = a.preferredStartTimes.some(t => isWithinTimeRange(t, startTime, 120));
      const bHasSimilarTime = b.preferredStartTimes.some(t => isWithinTimeRange(t, startTime, 120));
      if (aHasSimilarTime && !bHasSimilarTime) return -1;
      if (!aHasSimilarTime && bHasSimilarTime) return 1;

      // Prefer drivers with more capacity
      const aCapacity = a.daysWorkedLastWeek - a.daysAssignedThisWeek;
      const bCapacity = b.daysWorkedLastWeek - b.daysAssignedThisWeek;
      return bCapacity - aCapacity;
    });

    if (candidates.length > 0) {
      const best = candidates[0];
      const capacity = best.daysWorkedLastWeek - best.daysAssignedThisWeek;
      opportunities.push({
        ...baseSuggestion,
        suggestedDriverId: best.driverId,
        suggestedDriverName: best.driverName,
        matchType: "opportunity",
        reason: `${best.driverName} worked ${best.daysWorkedLastWeek} days last week, ${best.daysAssignedThisWeek} assigned this week (capacity: ${capacity})`
      });
    } else {
      newSlots.push({
        ...baseSuggestion,
        suggestedDriverId: null,
        suggestedDriverName: null,
        matchType: "new_slot",
        reason: "New slot - no matching driver from last week"
      });
    }
  }

  // Step 5: Find missing slots (in last week but not this week)
  const missingSlots: SlotOwner[] = [];
  for (const [slotKey, owner] of slotOwnership) {
    if (!usedSlotKeys.has(slotKey)) {
      missingSlots.push(owner);
    }
  }

  return {
    lastWeekStart: format(lastWeekStart, "yyyy-MM-dd"),
    thisWeekStart: format(thisWeekStart, "yyyy-MM-dd"),
    directMatches,
    opportunities,
    newSlots,
    alreadyAssigned,
    missingSlots,
    driverWorkloads,
    summary: {
      totalBlocksThisWeek: thisWeekData.length,
      directMatches: directMatches.length,
      opportunities: opportunities.length,
      newSlots: newSlots.length,
      alreadyAssigned: alreadyAssigned.length,
      missingSlots: missingSlots.length
    }
  };
}

/**
 * Apply all direct match suggestions
 */
export async function applyDirectMatches(
  tenantId: string,
  suggestions: BlockSuggestion[],
  userId?: string
): Promise<{ applied: number; errors: string[] }> {
  let applied = 0;
  const errors: string[] = [];

  for (const suggestion of suggestions) {
    if (!suggestion.suggestedDriverId) continue;
    if (suggestion.matchType === "already_assigned") continue;

    try {
      await db.insert(blockAssignments).values({
        tenantId,
        blockId: suggestion.blockId,
        driverId: suggestion.suggestedDriverId,
        isActive: true,
        validationStatus: "valid",
        assignedBy: userId
      });
      applied++;
    } catch (error: any) {
      errors.push(`Block ${suggestion.blockId}: ${error.message}`);
    }
  }

  return { applied, errors };
}

/**
 * Apply a single suggestion
 */
export async function applySingleAssignment(
  tenantId: string,
  blockId: string,
  driverId: string,
  userId?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Deactivate any existing assignment
    await db
      .update(blockAssignments)
      .set({ isActive: false, archivedAt: new Date() })
      .where(
        and(
          eq(blockAssignments.tenantId, tenantId),
          eq(blockAssignments.blockId, blockId),
          eq(blockAssignments.isActive, true)
        )
      );

    // Create new assignment
    await db.insert(blockAssignments).values({
      tenantId,
      blockId,
      driverId,
      isActive: true,
      validationStatus: "valid",
      assignedBy: userId
    });

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
