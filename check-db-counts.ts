import { db } from "./server/db";
import { sql } from "drizzle-orm";
import { subDays, format } from "date-fns";

async function main() {
  // First, find the tenant
  const tenants = await db.execute(sql`SELECT id, name FROM tenants`);
  const TENANT_ID = tenants.rows[0]?.id as string;
  console.log(`Using tenant: ${TENANT_ID} (${tenants.rows[0]?.name})`);

  // Check total blocks
  const totalBlocks = await db.execute(sql`SELECT count(*) FROM blocks`);
  console.log(`\nTotal blocks: ${totalBlocks.rows[0]?.count}`);

  // Check total assignments
  const totalAssignments = await db.execute(sql`SELECT count(*) FROM block_assignments`);
  console.log(`Total assignments: ${totalAssignments.rows[0]?.count}`);

  // Check date range
  const dateRange = await db.execute(sql`
    SELECT MIN(service_date) as earliest, MAX(service_date) as latest FROM blocks
  `);
  console.log(`\nDate range in database:`);
  console.log(`  Earliest: ${dateRange.rows[0]?.earliest}`);
  console.log(`  Latest: ${dateRange.rows[0]?.latest}`);

  // Define lookback window
  const today = new Date();
  const eightWeeksAgo = subDays(today, 56);
  const yesterday = subDays(today, 1);
  console.log(`\nLookback window: ${format(eightWeeksAgo, "yyyy-MM-dd")} to ${format(yesterday, "yyyy-MM-dd")}`);

  // Count assignments with drivers in lookback
  const assignmentsInRange = await db.execute(sql`
    SELECT COUNT(*) as count
    FROM block_assignments ba
    JOIN blocks b ON ba.block_id = b.id
    WHERE ba.is_active = true
      AND ba.driver_id IS NOT NULL
      AND b.service_date >= ${format(eightWeeksAgo, "yyyy-MM-dd")}::timestamp
      AND b.service_date <= ${format(yesterday, "yyyy-MM-dd")}::timestamp
  `);
  console.log(`\nAssignments with drivers in lookback: ${assignmentsInRange.rows[0]?.count}`);

  // Get driver assignment counts
  const driverCounts = await db.execute(sql`
    SELECT d.first_name || ' ' || d.last_name as driver_name, b.solo_type, COUNT(*) as shift_count
    FROM block_assignments ba
    JOIN blocks b ON ba.block_id = b.id
    JOIN drivers d ON ba.driver_id = d.id
    WHERE ba.is_active = true
      AND ba.driver_id IS NOT NULL
      AND b.service_date >= ${format(eightWeeksAgo, "yyyy-MM-dd")}::timestamp
      AND b.service_date <= ${format(yesterday, "yyyy-MM-dd")}::timestamp
    GROUP BY d.id, d.first_name, d.last_name, b.solo_type
    ORDER BY shift_count DESC
    LIMIT 20
  `);

  console.log(`\nTop 20 drivers by shift count (8-week lookback):`);
  console.log(`${"Driver Name".padEnd(25)} ${"Type".padEnd(10)} Shifts`);
  console.log("-".repeat(50));
  for (const row of driverCounts.rows) {
    console.log(`${String(row.driver_name).padEnd(25)} ${String(row.solo_type).padEnd(10)} ${row.shift_count}`);
  }

  // Show day-of-week breakdown for one driver (Adan)
  const adanHistory = await db.execute(sql`
    SELECT
      d.first_name || ' ' || d.last_name as driver_name,
      EXTRACT(DOW FROM b.service_date) as dow,
      COUNT(*) as count
    FROM block_assignments ba
    JOIN blocks b ON ba.block_id = b.id
    JOIN drivers d ON ba.driver_id = d.id
    WHERE ba.is_active = true
      AND ba.driver_id IS NOT NULL
      AND (LOWER(d.first_name) LIKE '%adan%' OR LOWER(d.last_name) LIKE '%galvan%')
      AND b.service_date >= ${format(eightWeeksAgo, "yyyy-MM-dd")}::timestamp
      AND b.service_date <= ${format(yesterday, "yyyy-MM-dd")}::timestamp
    GROUP BY d.first_name, d.last_name, EXTRACT(DOW FROM b.service_date)
    ORDER BY count DESC
  `);

  if (adanHistory.rows.length > 0) {
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    console.log(`\nAdan Galvan's day-of-week pattern:`);
    for (const row of adanHistory.rows) {
      const dayName = dayNames[Number(row.dow)];
      console.log(`  ${dayName}: ${row.count} shifts`);
    }
  } else {
    console.log("\nNo Adan Galvan found in history.");
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
