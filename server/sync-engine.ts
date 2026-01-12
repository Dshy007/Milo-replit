/**
 * Weekly Sync Engine
 *
 * Compares last week's schedule to this week's incoming blocks,
 * identifying exact matches, time bumps, and exceptions that need attention.
 *
 * Core concept: "Time Slots" - unique combinations of:
 *   - soloType (solo1, solo2)
 *   - startTime (HH:MM)
 *   - tractorId (Tractor_1, Tractor_2, etc.)
 *
 * Each slot runs Sun-Wed (sunWed pattern) or Wed-Sat (wedSat pattern).
 */

import { db } from "./db";
import { blocks, blockAssignments, drivers } from "@shared/schema";
import { eq, and, gte, lte, inArray, sql, isNull, desc } from "drizzle-orm";
import { format, startOfWeek, endOfWeek, addDays, subWeeks, parseISO, isSameDay } from "date-fns";
import { matchDeterministic } from "./deterministic-matcher";

// ============================================================================
// Types
// ============================================================================

export interface TimeSlot {
  key: string;              // Unique key: "solo1_16:30_Tractor_1"
  soloType: string;         // solo1, solo2, team
  startTime: string;        // HH:MM format
  tractorId: string;        // Tractor identifier
  patternGroup?: string;    // sunWed or wedSat
}

export interface SlotDay {
  date: string;             // YYYY-MM-DD
  dayOfWeek: string;        // "sunday", "monday", etc.
  blockId: string | null;   // Block ID if exists
  driverId: string | null;  // Assigned driver ID
  driverName: string | null; // Assigned driver name
  status: "assigned" | "unassigned" | "no_block";
  startTimestamp?: Date;    // Actual start time (may differ from slot time due to bumps)
  bumpMinutes?: number;     // Difference from expected start time
}

export interface SlotWeekData {
  slot: TimeSlot;
  days: SlotDay[];          // 7 days Sun-Sat
  assignedDriver: string | null;  // Primary driver for this slot (most common)
  assignedDriverId: string | null;
}

export interface WeekData {
  weekStart: string;        // YYYY-MM-DD (Sunday)
  weekEnd: string;          // YYYY-MM-DD (Saturday)
  slots: SlotWeekData[];
  totalBlocks: number;
  assignedBlocks: number;
  unassignedBlocks: number;
}

export interface SlotMatch {
  slot: TimeSlot;
  lastWeek: SlotWeekData;
  thisWeek: SlotWeekData;
  matchType: "exact" | "time_bump" | "driver_unavailable" | "new_slot" | "removed_slot";
  suggestedDriverId?: string | null;
  suggestedDriverName?: string | null;
  confidence?: number;
  bumpMinutes?: number;     // For time_bump type
  reason?: string;          // Human-readable explanation
}

export interface WeekComparison {
  lastWeekStart: string;
  thisWeekStart: string;
  exactMatches: SlotMatch[];
  timeBumps: SlotMatch[];
  driverUnavailable: SlotMatch[];
  newSlots: SlotMatch[];
  removedSlots: SlotMatch[];
  summary: {
    totalSlots: number;
    exactMatches: number;
    timeBumps: number;
    needsAttention: number;
    newSlots: number;
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

function getSlotKey(soloType: string, startTime: string, tractorId: string): string {
  return `${soloType}_${startTime}_${tractorId}`;
}

function parseSlotKey(key: string): TimeSlot {
  const [soloType, startTime, ...tractorParts] = key.split("_");
  return {
    key,
    soloType,
    startTime,
    tractorId: tractorParts.join("_") // Handle "Tractor_1" format
  };
}

function getDayOfWeek(date: Date): string {
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  return days[date.getDay()];
}

function getWeekDates(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Get all blocks and assignments for a given week, grouped by time slot
 */
export async function getWeekData(tenantId: string, weekStartDate: Date): Promise<WeekData> {
  const weekStart = startOfWeek(weekStartDate, { weekStartsOn: 0 }); // Sunday
  const weekEnd = endOfWeek(weekStartDate, { weekStartsOn: 0 }); // Saturday

  // Fetch all blocks for the week
  const weekBlocks = await db
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
        gte(blocks.serviceDate, weekStart),
        lte(blocks.serviceDate, weekEnd)
      )
    )
    .orderBy(blocks.startTimestamp);

  // Group by time slot
  const slotMap = new Map<string, Map<string, { block: any; assignment: any; driver: any }>>();

  for (const row of weekBlocks) {
    const startTime = format(new Date(row.block.startTimestamp), "HH:mm");
    const slotKey = getSlotKey(row.block.soloType, startTime, row.block.tractorId);
    const dateKey = format(new Date(row.block.serviceDate), "yyyy-MM-dd");

    if (!slotMap.has(slotKey)) {
      slotMap.set(slotKey, new Map());
    }
    slotMap.get(slotKey)!.set(dateKey, row);
  }

  // Build slot week data
  const weekDates = getWeekDates(weekStart);
  const slots: SlotWeekData[] = [];
  let totalBlocks = 0;
  let assignedBlocks = 0;

  for (const [slotKey, dateMap] of slotMap) {
    const slot = parseSlotKey(slotKey);
    const days: SlotDay[] = [];
    const driverCounts = new Map<string, { count: number; name: string }>();

    for (const date of weekDates) {
      const dateKey = format(date, "yyyy-MM-dd");
      const row = dateMap.get(dateKey);

      if (row) {
        totalBlocks++;
        const hasDriver = row.assignment && row.driver;
        if (hasDriver) {
          assignedBlocks++;
          const driverName = `${row.driver.firstName} ${row.driver.lastName}`;
          const existing = driverCounts.get(row.assignment.driverId) || { count: 0, name: driverName };
          driverCounts.set(row.assignment.driverId, { count: existing.count + 1, name: driverName });
        }

        // Calculate bump from expected start time
        const expectedStart = new Date(date);
        const [hours, minutes] = slot.startTime.split(":").map(Number);
        expectedStart.setHours(hours, minutes, 0, 0);
        const actualStart = new Date(row.block.startTimestamp);
        const bumpMinutes = Math.round((actualStart.getTime() - expectedStart.getTime()) / (1000 * 60));

        days.push({
          date: dateKey,
          dayOfWeek: getDayOfWeek(date),
          blockId: row.block.id,
          driverId: hasDriver ? row.assignment.driverId : null,
          driverName: hasDriver ? `${row.driver.firstName} ${row.driver.lastName}` : null,
          status: hasDriver ? "assigned" : "unassigned",
          startTimestamp: actualStart,
          bumpMinutes: bumpMinutes !== 0 ? bumpMinutes : undefined
        });
      } else {
        days.push({
          date: dateKey,
          dayOfWeek: getDayOfWeek(date),
          blockId: null,
          driverId: null,
          driverName: null,
          status: "no_block"
        });
      }
    }

    // Find primary driver (most common)
    let primaryDriverId: string | null = null;
    let primaryDriverName: string | null = null;
    let maxCount = 0;
    for (const [driverId, data] of driverCounts) {
      if (data.count > maxCount) {
        maxCount = data.count;
        primaryDriverId = driverId;
        primaryDriverName = data.name;
      }
    }

    // Get pattern group from first block with one
    const firstBlockWithPattern = Array.from(dateMap.values()).find(r => r.block.patternGroup);
    if (firstBlockWithPattern) {
      slot.patternGroup = firstBlockWithPattern.block.patternGroup;
    }

    slots.push({
      slot,
      days,
      assignedDriver: primaryDriverName,
      assignedDriverId: primaryDriverId
    });
  }

  // Sort slots by start time, then by solo type
  slots.sort((a, b) => {
    const timeCompare = a.slot.startTime.localeCompare(b.slot.startTime);
    if (timeCompare !== 0) return timeCompare;
    return a.slot.soloType.localeCompare(b.slot.soloType);
  });

  return {
    weekStart: format(weekStart, "yyyy-MM-dd"),
    weekEnd: format(weekEnd, "yyyy-MM-dd"),
    slots,
    totalBlocks,
    assignedBlocks,
    unassignedBlocks: totalBlocks - assignedBlocks
  };
}

/**
 * Compare two weeks and identify matches, bumps, and exceptions
 */
export async function compareWeeks(
  tenantId: string,
  lastWeekStart: Date,
  thisWeekStart: Date
): Promise<WeekComparison> {
  const [lastWeekData, thisWeekData] = await Promise.all([
    getWeekData(tenantId, lastWeekStart),
    getWeekData(tenantId, thisWeekStart)
  ]);

  const exactMatches: SlotMatch[] = [];
  const timeBumps: SlotMatch[] = [];
  const driverUnavailable: SlotMatch[] = [];
  const newSlots: SlotMatch[] = [];
  const removedSlots: SlotMatch[] = [];

  // Create maps for easy lookup
  const lastWeekSlots = new Map(lastWeekData.slots.map(s => [s.slot.key, s]));
  const thisWeekSlots = new Map(thisWeekData.slots.map(s => [s.slot.key, s]));

  // Check each slot in this week
  for (const [slotKey, thisWeekSlot] of thisWeekSlots) {
    const lastWeekSlot = lastWeekSlots.get(slotKey);

    if (!lastWeekSlot) {
      // New slot that didn't exist last week
      newSlots.push({
        slot: thisWeekSlot.slot,
        lastWeek: createEmptySlotWeekData(thisWeekSlot.slot, lastWeekData.weekStart),
        thisWeek: thisWeekSlot,
        matchType: "new_slot",
        reason: "This time slot is new - it wasn't in last week's schedule"
      });
      continue;
    }

    // Check if same driver and same times
    const lastDriver = lastWeekSlot.assignedDriverId;
    const thisWeekUnassignedDays = thisWeekSlot.days.filter(d => d.status === "unassigned");

    if (lastDriver && thisWeekUnassignedDays.length === 0) {
      // Check if times are the same or bumped
      const bumps = thisWeekSlot.days
        .filter(d => d.bumpMinutes && Math.abs(d.bumpMinutes) > 15)
        .map(d => d.bumpMinutes!);

      if (bumps.length > 0) {
        const avgBump = Math.round(bumps.reduce((a, b) => a + b, 0) / bumps.length);
        timeBumps.push({
          slot: thisWeekSlot.slot,
          lastWeek: lastWeekSlot,
          thisWeek: thisWeekSlot,
          matchType: "time_bump",
          bumpMinutes: avgBump,
          reason: `Time shifted ${avgBump > 0 ? "+" : ""}${avgBump} minutes from last week`
        });
      } else {
        // Exact match - same driver, same times
        exactMatches.push({
          slot: thisWeekSlot.slot,
          lastWeek: lastWeekSlot,
          thisWeek: thisWeekSlot,
          matchType: "exact",
          reason: `${lastWeekSlot.assignedDriver} continues in this slot`
        });
      }
    } else if (lastDriver && thisWeekUnassignedDays.length > 0) {
      // Driver from last week exists but this week has unassigned days
      // Need to check if the driver is available
      driverUnavailable.push({
        slot: thisWeekSlot.slot,
        lastWeek: lastWeekSlot,
        thisWeek: thisWeekSlot,
        matchType: "driver_unavailable",
        suggestedDriverId: lastDriver,
        suggestedDriverName: lastWeekSlot.assignedDriver,
        reason: `${lastWeekSlot.assignedDriver} worked this slot last week - ${thisWeekUnassignedDays.length} day(s) need assignment`
      });
    } else {
      // No driver last week either, still needs attention
      driverUnavailable.push({
        slot: thisWeekSlot.slot,
        lastWeek: lastWeekSlot,
        thisWeek: thisWeekSlot,
        matchType: "driver_unavailable",
        reason: "Slot was also unassigned last week"
      });
    }
  }

  // Check for removed slots (in last week but not this week)
  for (const [slotKey, lastWeekSlot] of lastWeekSlots) {
    if (!thisWeekSlots.has(slotKey)) {
      removedSlots.push({
        slot: lastWeekSlot.slot,
        lastWeek: lastWeekSlot,
        thisWeek: createEmptySlotWeekData(lastWeekSlot.slot, thisWeekData.weekStart),
        matchType: "removed_slot",
        reason: "This slot is not in this week's schedule"
      });
    }
  }

  return {
    lastWeekStart: lastWeekData.weekStart,
    thisWeekStart: thisWeekData.weekStart,
    exactMatches,
    timeBumps,
    driverUnavailable,
    newSlots,
    removedSlots,
    summary: {
      totalSlots: thisWeekSlots.size,
      exactMatches: exactMatches.length,
      timeBumps: timeBumps.length,
      needsAttention: driverUnavailable.length + newSlots.length,
      newSlots: newSlots.length
    }
  };
}

function createEmptySlotWeekData(slot: TimeSlot, weekStart: string): SlotWeekData {
  const startDate = parseISO(weekStart);
  const weekDates = getWeekDates(startDate);

  return {
    slot,
    days: weekDates.map(date => ({
      date: format(date, "yyyy-MM-dd"),
      dayOfWeek: getDayOfWeek(date),
      blockId: null,
      driverId: null,
      driverName: null,
      status: "no_block" as const
    })),
    assignedDriver: null,
    assignedDriverId: null
  };
}

/**
 * Apply assignments from last week to this week's unassigned blocks
 * This is the "one-click" apply that uses the same driver from last week
 */
export async function applyLastWeekAssignments(
  tenantId: string,
  thisWeekStart: Date,
  slotKeys?: string[] // Optional: only apply to specific slots
): Promise<{ applied: number; skipped: number; errors: string[] }> {
  const lastWeekStart = subWeeks(thisWeekStart, 1);
  const comparison = await compareWeeks(tenantId, lastWeekStart, thisWeekStart);

  let applied = 0;
  let skipped = 0;
  const errors: string[] = [];

  // Get blocks that need assignments from exact matches and driver_unavailable
  const slotsToApply = [
    ...comparison.exactMatches,
    ...comparison.timeBumps,
    ...comparison.driverUnavailable.filter(m => m.suggestedDriverId)
  ].filter(m => !slotKeys || slotKeys.includes(m.slot.key));

  for (const match of slotsToApply) {
    const driverId = match.suggestedDriverId || match.lastWeek.assignedDriverId;
    if (!driverId) {
      skipped++;
      continue;
    }

    // Find unassigned blocks in this week's slot
    const unassignedDays = match.thisWeek.days.filter(d => d.status === "unassigned" && d.blockId);

    for (const day of unassignedDays) {
      try {
        // Create assignment
        await db.insert(blockAssignments).values({
          tenantId,
          blockId: day.blockId!,
          driverId,
          isActive: true,
          validationStatus: "valid"
        });
        applied++;
      } catch (error: any) {
        errors.push(`Failed to assign ${day.date}: ${error.message}`);
      }
    }
  }

  return { applied, skipped, errors };
}

/**
 * Run the ML-based deterministic matcher on unassigned blocks for a week
 */
export async function autoMatchWeek(
  tenantId: string,
  weekStart: Date
): Promise<{ matches: any[]; errors: string[] }> {
  try {
    const result = await matchDeterministic(tenantId, weekStart);
    return { matches: result.suggestions || [], errors: [] };
  } catch (error: any) {
    return { matches: [], errors: [error.message] };
  }
}

/**
 * Get the current day mode for UI display
 */
export function getDayMode(targetWeekStart: Date): {
  mode: "planning" | "review" | "urgent" | "locked" | "readonly";
  message: string;
  canEdit: boolean;
} {
  const now = new Date();
  const weekStart = startOfWeek(targetWeekStart, { weekStartsOn: 0 });
  const weekEnd = endOfWeek(targetWeekStart, { weekStartsOn: 0 });

  // If we're looking at a past week
  if (now > weekEnd) {
    return {
      mode: "readonly",
      message: "Viewing past week",
      canEdit: false
    };
  }

  // If we're in the target week
  if (now >= weekStart && now <= weekEnd) {
    const dayOfWeek = now.getDay();

    if (dayOfWeek === 6) { // Saturday
      return {
        mode: "readonly",
        message: "Week almost complete",
        canEdit: false
      };
    }

    if (dayOfWeek === 5) { // Friday
      return {
        mode: "locked",
        message: "Week in progress - emergency changes only",
        canEdit: true
      };
    }

    if (dayOfWeek === 4) { // Thursday
      return {
        mode: "urgent",
        message: "Finalize schedule today!",
        canEdit: true
      };
    }

    return {
      mode: "review",
      message: "Review and finalize schedule",
      canEdit: true
    };
  }

  // Future week - full planning mode
  return {
    mode: "planning",
    message: "Planning mode - full editing available",
    canEdit: true
  };
}
