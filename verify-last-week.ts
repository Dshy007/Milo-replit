/**
 * Verify what drivers actually worked last week (Dec 5-11)
 * to validate 1-week lookback predictions
 */

import { db } from "./server/db";
import { sql } from "drizzle-orm";

async function main() {
  const result = await db.execute(sql`
    SELECT
      d.first_name || ' ' || d.last_name as driver_name,
      b.service_date::date as service_date,
      CASE EXTRACT(DOW FROM b.service_date)
        WHEN 0 THEN 'Sun'
        WHEN 1 THEN 'Mon'
        WHEN 2 THEN 'Tue'
        WHEN 3 THEN 'Wed'
        WHEN 4 THEN 'Thu'
        WHEN 5 THEN 'Fri'
        WHEN 6 THEN 'Sat'
      END as day_name
    FROM block_assignments ba
    JOIN blocks b ON ba.block_id = b.id
    JOIN drivers d ON ba.driver_id = d.id
    WHERE ba.is_active = true
      AND b.service_date >= '2025-12-05'::timestamp
      AND b.service_date <= '2025-12-11'::timestamp
    ORDER BY d.first_name, b.service_date
  `);

  // Group by driver
  const byDriver: Record<string, string[]> = {};
  for (const row of result.rows) {
    const name = String(row.driver_name);
    if (!byDriver[name]) byDriver[name] = [];
    byDriver[name].push(String(row.day_name));
  }

  console.log("=== Last Week (Dec 5-11) Actual Work Days ===\n");
  for (const [name, days] of Object.entries(byDriver).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`${name.padEnd(40)}: ${days.join(", ")}`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
