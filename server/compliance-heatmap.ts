import { db } from "./db";
import { drivers, blocks, blockAssignments } from "@shared/schema";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { startOfDay, endOfDay, eachDayOfInterval, format, parseISO } from "date-fns";

export interface HeatmapCell {
  driverId: string;
  driverName: string;
  date: string; // YYYY-MM-DD
  status: "safe" | "warning" | "violation" | "none";
  totalHours: number;
  assignmentCount: number;
  details: string[];
}

export interface DriverSummary {
  driverId: string;
  driverName: string;
  totalViolations: number;
  totalWarnings: number;
}

export interface HeatmapResponse {
  drivers: DriverSummary[];
  cells: HeatmapCell[];
  dateRange: string[];
}

interface NormalizedAssignment {
  driverId: string;
  blockId: string;
  startTime: Date;
  endTime: Date;
  durationHours: number;
  soloType: string;
  blockDisplayId: string;
}

/**
 * Calculate duty hours for a driver within a time window
 */
function calculateDutyHoursInWindow(
  assignments: NormalizedAssignment[],
  windowStart: Date,
  windowEnd: Date
): number {
  let totalHours = 0;

  for (const assignment of assignments) {
    const overlapStart = new Date(Math.max(assignment.startTime.getTime(), windowStart.getTime()));
    const overlapEnd = new Date(Math.min(assignment.endTime.getTime(), windowEnd.getTime()));

    if (overlapStart < overlapEnd) {
      const overlapMs = overlapEnd.getTime() - overlapStart.getTime();
      totalHours += overlapMs / (1000 * 60 * 60);
    }
  }

  return totalHours;
}

/**
 * Determine compliance status based on solo type and hours worked
 */
function getComplianceStatus(
  soloType: string,
  hoursIn24h: number,
  hoursIn48h: number
): { status: "safe" | "warning" | "violation"; messages: string[] } {
  const messages: string[] = [];
  
  if (soloType === "Solo1") {
    const limit = 10;
    const warningThreshold = limit * 0.9; // 9 hours
    
    if (hoursIn24h > limit) {
      messages.push(`Solo1 violation: ${hoursIn24h.toFixed(1)}h in 24h (limit: ${limit}h)`);
      return { status: "violation", messages };
    } else if (hoursIn24h > warningThreshold) {
      messages.push(`Solo1 warning: ${hoursIn24h.toFixed(1)}h in 24h (approaching ${limit}h limit)`);
      return { status: "warning", messages };
    }
  } else if (soloType === "Solo2") {
    const limit = 20;
    const warningThreshold = limit * 0.9; // 18 hours
    
    if (hoursIn48h > limit) {
      messages.push(`Solo2 violation: ${hoursIn48h.toFixed(1)}h in 48h (limit: ${limit}h)`);
      return { status: "violation", messages };
    } else if (hoursIn48h > warningThreshold) {
      messages.push(`Solo2 warning: ${hoursIn48h.toFixed(1)}h in 48h (approaching ${limit}h limit)`);
      return { status: "warning", messages };
    }
  }

  return { status: "safe", messages: [] };
}

/**
 * Generate compliance heatmap data for all drivers across a date range
 */
export async function generateComplianceHeatmap(
  tenantId: string,
  startDate: string, // YYYY-MM-DD
  endDate: string // YYYY-MM-DD
): Promise<HeatmapResponse> {
  // Validate date range (max 31 days)
  const start = parseISO(startDate);
  const end = parseISO(endDate);
  const daysDiff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  
  if (daysDiff > 31) {
    throw new Error("Date range cannot exceed 31 days");
  }

  // Generate date range array
  const dateRange = eachDayOfInterval({ start, end }).map(d => format(d, 'yyyy-MM-dd'));

  // Fetch all drivers
  const allDrivers = await db
    .select()
    .from(drivers)
    .where(eq(drivers.tenantId, tenantId));

  if (allDrivers.length === 0) {
    return { drivers: [], cells: [], dateRange };
  }

  // Fetch all block assignments in the date range (with buffer for rolling windows)
  const bufferStart = new Date(start);
  bufferStart.setDate(bufferStart.getDate() - 2); // 48h buffer for Solo2
  
  const assignments = await db
    .select({
      assignment: blockAssignments,
      block: blocks,
    })
    .from(blockAssignments)
    .innerJoin(blocks, eq(blockAssignments.blockId, blocks.id))
    .where(
      and(
        eq(blockAssignments.tenantId, tenantId),
        gte(blocks.startTimestamp, bufferStart),
        lte(blocks.startTimestamp, endOfDay(end))
      )
    );

  // Normalize assignments
  const normalizedAssignments: NormalizedAssignment[] = assignments.map(a => ({
    driverId: a.assignment.driverId,
    blockId: a.block.id,
    startTime: new Date(a.block.startTimestamp),
    endTime: new Date(a.block.endTimestamp),
    durationHours: (new Date(a.block.endTimestamp).getTime() - new Date(a.block.startTimestamp).getTime()) / (1000 * 60 * 60),
    soloType: a.block.soloType,
    blockDisplayId: a.block.blockId,
  }));

  // Group assignments by driver
  const assignmentsByDriver = new Map<string, NormalizedAssignment[]>();
  for (const assignment of normalizedAssignments) {
    if (!assignmentsByDriver.has(assignment.driverId)) {
      assignmentsByDriver.set(assignment.driverId, []);
    }
    assignmentsByDriver.get(assignment.driverId)!.push(assignment);
  }

  // Sort assignments by start time for each driver
  for (const assignments of Array.from(assignmentsByDriver.values())) {
    assignments.sort((a: NormalizedAssignment, b: NormalizedAssignment) => 
      a.startTime.getTime() - b.startTime.getTime()
    );
  }

  const cells: HeatmapCell[] = [];
  const driverSummaries: DriverSummary[] = [];

  // Process each driver
  for (const driver of allDrivers) {
    const driverAssignments = assignmentsByDriver.get(driver.id) || [];
    let totalViolations = 0;
    let totalWarnings = 0;

    // Process each day in the range
    for (const dateStr of dateRange) {
      const dayStart = startOfDay(parseISO(dateStr));
      const dayEnd = endOfDay(parseISO(dateStr));

      // Find assignments that overlap with this day
      const dayAssignments = driverAssignments.filter(a =>
        a.startTime < dayEnd && a.endTime > dayStart
      );

      if (dayAssignments.length === 0) {
        cells.push({
          driverId: driver.id,
          driverName: `${driver.firstName} ${driver.lastName}`,
          date: dateStr,
          status: "none",
          totalHours: 0,
          assignmentCount: 0,
          details: [],
        });
        continue;
      }

      // Calculate total hours for this day
      const totalHours = calculateDutyHoursInWindow(dayAssignments, dayStart, dayEnd);

      // Get the solo type from the most recent assignment
      const soloType = dayAssignments[dayAssignments.length - 1].soloType;
      
      // Calculate worst-case compliance across ALL sliding windows that overlap this day
      // We need to check every assignment boundary plus derived critical points
      let worstStatus: "safe" | "warning" | "violation" = "safe";
      let worstMessages: string[] = [];

      // Collect ALL relevant time points where windows should be evaluated
      const criticalPoints = new Set<number>();
      
      // For each assignment that could affect this day (within 48h buffer)
      const dayEndPlusBuffer = new Date(dayEnd.getTime() + 48 * 60 * 60 * 1000);
      const dayStartMinusBuffer = new Date(dayStart.getTime() - 48 * 60 * 60 * 1000);
      
      const relevantAssignments = driverAssignments.filter(a =>
        a.startTime < dayEndPlusBuffer && a.endTime > dayStartMinusBuffer
      );

      for (const assignment of relevantAssignments) {
        // Add assignment start and end as critical points
        criticalPoints.add(assignment.startTime.getTime());
        criticalPoints.add(assignment.endTime.getTime());
        
        // Add points 24h and 48h before/after each boundary (for window calculations)
        criticalPoints.add(assignment.startTime.getTime() + 24 * 60 * 60 * 1000);
        criticalPoints.add(assignment.startTime.getTime() + 48 * 60 * 60 * 1000);
        criticalPoints.add(assignment.endTime.getTime() + 24 * 60 * 60 * 1000);
        criticalPoints.add(assignment.endTime.getTime() + 48 * 60 * 60 * 1000);
        criticalPoints.add(assignment.startTime.getTime() - 24 * 60 * 60 * 1000);
        criticalPoints.add(assignment.startTime.getTime() - 48 * 60 * 60 * 1000);
        criticalPoints.add(assignment.endTime.getTime() - 24 * 60 * 60 * 1000);
        criticalPoints.add(assignment.endTime.getTime() - 48 * 60 * 60 * 1000);
      }
      
      // Add day boundaries
      criticalPoints.add(dayStart.getTime());
      criticalPoints.add(dayEnd.getTime());

      // Filter points to those that overlap the current day
      // A window ending at point P affects this day if:
      // - P >= dayStart (window ends during or after this day starts)
      // - P - 48h <= dayEnd (window starts before or during this day)
      const relevantPoints = Array.from(criticalPoints)
        .map(t => new Date(t))
        .filter(point => {
          const window48Start = new Date(point.getTime() - 48 * 60 * 60 * 1000);
          return point >= dayStart && window48Start <= dayEnd;
        })
        .sort((a, b) => a.getTime() - b.getTime());

      // Evaluate compliance at each critical point
      for (const point of relevantPoints) {
        const window24Start = new Date(point.getTime() - 24 * 60 * 60 * 1000);
        const window48Start = new Date(point.getTime() - 48 * 60 * 60 * 1000);

        const hoursIn24h = calculateDutyHoursInWindow(driverAssignments, window24Start, point);
        const hoursIn48h = calculateDutyHoursInWindow(driverAssignments, window48Start, point);

        const { status, messages } = getComplianceStatus(soloType, hoursIn24h, hoursIn48h);

        // Track worst status (violation > warning > safe)
        if (status === "violation" && worstStatus !== "violation") {
          worstStatus = "violation";
          worstMessages = messages;
        } else if (status === "warning" && worstStatus === "safe") {
          worstStatus = "warning";
          worstMessages = messages;
        }
      }

      if (worstStatus === "violation") totalViolations++;
      if (worstStatus === "warning") totalWarnings++;

      cells.push({
        driverId: driver.id,
        driverName: `${driver.firstName} ${driver.lastName}`,
        date: dateStr,
        status: worstStatus,
        totalHours: Math.round(totalHours * 10) / 10, // Round to 1 decimal
        assignmentCount: dayAssignments.length,
        details: worstMessages,
      });
    }

    driverSummaries.push({
      driverId: driver.id,
      driverName: `${driver.firstName} ${driver.lastName}`,
      totalViolations,
      totalWarnings,
    });
  }

  // Sort drivers by violations (descending), then warnings, then name
  driverSummaries.sort((a, b) => {
    if (b.totalViolations !== a.totalViolations) {
      return b.totalViolations - a.totalViolations;
    }
    if (b.totalWarnings !== a.totalWarnings) {
      return b.totalWarnings - a.totalWarnings;
    }
    return a.driverName.localeCompare(b.driverName);
  });

  return {
    drivers: driverSummaries,
    cells,
    dateRange,
  };
}
