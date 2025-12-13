import { db } from "./server/db";
import { sql } from "drizzle-orm";

async function main() {
  // Find Tareef's full history
  const tareef = await db.execute(sql`
    SELECT
      d.first_name || ' ' || d.last_name as driver_name,
      d.id as driver_id,
      b.service_date::date as service_date,
      EXTRACT(DOW FROM b.service_date) as dow
    FROM block_assignments ba
    JOIN blocks b ON ba.block_id = b.id
    JOIN drivers d ON ba.driver_id = d.id
    WHERE ba.is_active = true
      AND LOWER(d.first_name) LIKE '%tareef%'
    ORDER BY b.service_date DESC
  `);

  console.log("Tareef THAMER Mahdi - Full Assignment History:");
  console.log("=".repeat(50));

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  for (const row of tareef.rows) {
    const dayName = dayNames[Number(row.dow)];
    console.log(`  ${row.service_date} (${dayName})`);
  }

  // Count by day of week
  console.log("\nDay-of-week breakdown:");
  const dayCounts: Record<string, number> = {};
  for (const row of tareef.rows) {
    const dayName = dayNames[Number(row.dow)];
    dayCounts[dayName] = (dayCounts[dayName] || 0) + 1;
  }
  for (const [day, count] of Object.entries(dayCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${day}: ${count} shifts`);
  }

  // Show last week only (Dec 1-7)
  console.log("\n" + "=".repeat(50));
  console.log("LAST WEEK ONLY (Dec 1-7, 2025):");
  console.log("=".repeat(50));

  const lastWeek = await db.execute(sql`
    SELECT
      d.first_name || ' ' || d.last_name as driver_name,
      b.service_date::date as service_date,
      EXTRACT(DOW FROM b.service_date) as dow
    FROM block_assignments ba
    JOIN blocks b ON ba.block_id = b.id
    JOIN drivers d ON ba.driver_id = d.id
    WHERE ba.is_active = true
      AND LOWER(d.first_name) LIKE '%tareef%'
      AND b.service_date >= '2025-12-01'::timestamp
      AND b.service_date <= '2025-12-07'::timestamp
    ORDER BY b.service_date
  `);

  for (const row of lastWeek.rows) {
    const dayName = dayNames[Number(row.dow)];
    console.log(`  ${row.service_date} (${dayName})`);
  }

  if (lastWeek.rows.length === 0) {
    console.log("  (No shifts last week)");
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
