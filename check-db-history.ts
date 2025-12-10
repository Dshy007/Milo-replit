import { db } from "./server/db";
import { blocks, blockAssignments, drivers } from "./shared/schema";
import { eq, and, gte, lte, sql, count } from "drizzle-orm";

async function checkHistory() {
  console.log("=== CHECKING DATABASE HISTORY FOR K-MEANS ===\n");

  // Total assignments
  const totalResult = await db
    .select({ count: count() })
    .from(blockAssignments)
    .where(eq(blockAssignments.isActive, true));

  console.log("Total active assignments:", totalResult[0]?.count || 0);

  // Date range
  const dateRange = await db
    .select({
      minDate: sql<string>`MIN(${blocks.serviceDate})`,
      maxDate: sql<string>`MAX(${blocks.serviceDate})`,
    })
    .from(blocks)
    .innerJoin(blockAssignments, eq(blocks.id, blockAssignments.blockId))
    .where(eq(blockAssignments.isActive, true));

  console.log("Date range:", dateRange[0]?.minDate, "to", dateRange[0]?.maxDate);

  // Unique drivers with assignments
  const driverCount = await db
    .select({ count: sql<number>`COUNT(DISTINCT ${blockAssignments.driverId})` })
    .from(blockAssignments)
    .where(eq(blockAssignments.isActive, true));

  console.log("Unique drivers with assignments:", driverCount[0]?.count || 0);

  // Day distribution (Postgres syntax)
  console.log("\n=== DAY DISTRIBUTION ===");
  const dayDist = await db
    .select({
      dayOfWeek: sql<number>`EXTRACT(DOW FROM ${blocks.serviceDate})`,
      count: count(),
    })
    .from(blocks)
    .innerJoin(blockAssignments, eq(blocks.id, blockAssignments.blockId))
    .where(eq(blockAssignments.isActive, true))
    .groupBy(sql`EXTRACT(DOW FROM ${blocks.serviceDate})`);

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dayCounts: Record<string, number> = { Sun: 0, Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0 };
  for (const row of dayDist) {
    const dayIdx = Number(row.dayOfWeek);
    dayCounts[dayNames[dayIdx]] = row.count;
  }
  console.log("  ", Object.entries(dayCounts).map(([d, c]) => `${d}: ${c}`).join(" | "));

  // Last 8 weeks (what K-Means actually sees)
  const eightWeeksAgo = new Date();
  eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 56);

  console.log("\n=== LAST 8 WEEKS (K-Means window) ===");
  console.log("Looking from:", eightWeeksAgo.toISOString().split("T")[0]);

  const recentResult = await db
    .select({ count: count() })
    .from(blocks)
    .innerJoin(blockAssignments, eq(blocks.id, blockAssignments.blockId))
    .where(
      and(
        eq(blockAssignments.isActive, true),
        gte(blocks.serviceDate, eightWeeksAgo)
      )
    );

  console.log("Assignments in last 8 weeks:", recentResult[0]?.count || 0);

  // Day distribution for last 8 weeks
  const recentDayDist = await db
    .select({
      dayOfWeek: sql<number>`EXTRACT(DOW FROM ${blocks.serviceDate})`,
      count: count(),
    })
    .from(blocks)
    .innerJoin(blockAssignments, eq(blocks.id, blockAssignments.blockId))
    .where(
      and(
        eq(blockAssignments.isActive, true),
        gte(blocks.serviceDate, eightWeeksAgo)
      )
    )
    .groupBy(sql`EXTRACT(DOW FROM ${blocks.serviceDate})`);

  const recentDayCounts: Record<string, number> = { Sun: 0, Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0 };
  for (const row of recentDayDist) {
    const dayIdx = Number(row.dayOfWeek);
    recentDayCounts[dayNames[dayIdx]] = row.count;
  }
  console.log("  ", Object.entries(recentDayCounts).map(([d, c]) => `${d}: ${c}`).join(" | "));

  const sunWed = recentDayCounts.Sun + recentDayCounts.Mon + recentDayCounts.Tue + recentDayCounts.Wed;
  const wedSat = recentDayCounts.Wed + recentDayCounts.Thu + recentDayCounts.Fri + recentDayCounts.Sat;
  console.log("\n  Sun-Wed total:", sunWed);
  console.log("  Wed-Sat total:", wedSat);

  if (recentResult[0]?.count === 0) {
    console.log("\n⚠️  NO DATA in last 8 weeks! K-Means has nothing to learn from.");
    console.log("   You need to import historical schedules OR apply some assignments first.");
  }

  process.exit(0);
}

checkHistory().catch(console.error);
