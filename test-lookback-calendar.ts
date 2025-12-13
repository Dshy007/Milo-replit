/**
 * Test script to verify the lookback calendar works with real database data.
 *
 * This queries actual assignment history from the database to show:
 * 1. What dates the calendar should cover
 * 2. How many assignments are in that range
 * 3. Which drivers have history in that range
 *
 * Usage: npx tsx test-lookback-calendar.ts
 */

import { db } from "./server/db";
import { blockAssignments, drivers, blocks } from "./shared/schema";
import { eq, and, gte, lte, isNotNull } from "drizzle-orm";
import { format, subDays, subWeeks, startOfWeek } from "date-fns";

const TENANT_ID = "default";

async function testLookbackCalendar() {
  console.log("=" .repeat(70));
  console.log("Testing Lookback Calendar with REAL Database Data");
  console.log("=" .repeat(70));

  // Get today's date info
  const today = new Date();
  const currentWeekStart = startOfWeek(today, { weekStartsOn: 0 });

  console.log(`\nToday: ${format(today, "yyyy-MM-dd (EEEE)")}`);
  console.log(`Current week starts: ${format(currentWeekStart, "yyyy-MM-dd (EEEE)")}`);

  // Test different lookback periods
  const lookbackOptions = [
    { label: "1 week", days: 7 },
    { label: "2 weeks", days: 14 },
    { label: "4 weeks", days: 28 },
    { label: "8 weeks (default)", days: 56 },
    { label: "12 weeks", days: 84 },
  ];

  console.log("\n" + "-".repeat(70));
  console.log("Lookback Period Analysis:");
  console.log("-".repeat(70));

  for (const option of lookbackOptions) {
    const startDate = subDays(today, option.days);
    const endDate = subDays(today, 1); // Yesterday

    // Query actual assignments in this date range
    const assignments = await db
      .select({
        id: blockAssignments.id,
        driverId: blockAssignments.driverId,
        serviceDate: blocks.serviceDate,
      })
      .from(blockAssignments)
      .innerJoin(blocks, eq(blockAssignments.blockId, blocks.id))
      .where(
        and(
          eq(blockAssignments.tenantId, TENANT_ID),
          eq(blockAssignments.isActive, true),
          gte(blocks.serviceDate, startDate),
          lte(blocks.serviceDate, endDate),
          isNotNull(blockAssignments.driverId)
        )
      );

    // Count unique drivers
    const uniqueDrivers = new Set(assignments.map(a => a.driverId));

    // Get date range of actual data
    const dates = assignments.map(a => a.serviceDate).filter(Boolean).sort();
    const actualStart = dates.length > 0 ? dates[0] : "N/A";
    const actualEnd = dates.length > 0 ? dates[dates.length - 1] : "N/A";

    console.log(`\n${option.label}:`);
    console.log(`  Date range: ${format(startDate, "yyyy-MM-dd")} to ${format(endDate, "yyyy-MM-dd")}`);
    console.log(`  Assignments found: ${assignments.length}`);
    console.log(`  Unique drivers: ${uniqueDrivers.size}`);
    console.log(`  Actual data range: ${actualStart} to ${actualEnd}`);
  }

  // Show driver breakdown for 8-week lookback
  console.log("\n" + "=".repeat(70));
  console.log("Driver Breakdown (8-week lookback):");
  console.log("=".repeat(70));

  const eightWeeksAgo = subDays(today, 56);
  const yesterday = subDays(today, 1);

  const driverAssignments = await db
    .select({
      driverId: blockAssignments.driverId,
      driverName: drivers.name,
      contractType: drivers.contractType,
      serviceDate: blocks.serviceDate,
      day: blocks.day,
      time: blocks.time,
    })
    .from(blockAssignments)
    .innerJoin(blocks, eq(blockAssignments.blockId, blocks.id))
    .innerJoin(drivers, eq(blockAssignments.driverId, drivers.id))
    .where(
      and(
        eq(blockAssignments.tenantId, TENANT_ID),
        eq(blockAssignments.isActive, true),
        gte(blocks.serviceDate, eightWeeksAgo),
        lte(blocks.serviceDate, yesterday),
        isNotNull(blockAssignments.driverId)
      )
    )
    .orderBy(blocks.serviceDate);

  // Group by driver
  const byDriver: Record<string, { name: string; contractType: string; assignments: any[] }> = {};
  for (const a of driverAssignments) {
    if (!a.driverId) continue;
    if (!byDriver[a.driverId]) {
      byDriver[a.driverId] = {
        name: a.driverName || "Unknown",
        contractType: a.contractType || "unknown",
        assignments: [],
      };
    }
    byDriver[a.driverId].assignments.push({
      date: a.serviceDate,
      day: a.day,
      time: a.time,
    });
  }

  // Sort by assignment count
  const sortedDrivers = Object.entries(byDriver)
    .sort((a, b) => b[1].assignments.length - a[1].assignments.length);

  console.log(`\nFound ${sortedDrivers.length} drivers with history:\n`);

  for (const [driverId, data] of sortedDrivers.slice(0, 15)) {
    const dates = data.assignments.map(a => a.date).sort();
    const firstDate = dates[0];
    const lastDate = dates[dates.length - 1];

    // Count days worked per weekday
    const weekdayCounts: Record<string, number> = {};
    for (const a of data.assignments) {
      weekdayCounts[a.day] = (weekdayCounts[a.day] || 0) + 1;
    }
    const topDays = Object.entries(weekdayCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([day, count]) => `${day}(${count})`)
      .join(", ");

    console.log(`${data.name} (${data.contractType}): ${data.assignments.length} shifts`);
    console.log(`  Range: ${firstDate} to ${lastDate}`);
    console.log(`  Top days: ${topDays}`);
  }

  if (sortedDrivers.length > 15) {
    console.log(`  ... and ${sortedDrivers.length - 15} more drivers`);
  }

  console.log("\n" + "=".repeat(70));
  console.log("Calendar Test Complete");
  console.log("=".repeat(70));
}

testLookbackCalendar()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
