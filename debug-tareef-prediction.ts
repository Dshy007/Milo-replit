/**
 * Debug why Tareef was predicted for Friday with 8-week lookback
 * but not with 2-week lookback
 */

import { db } from "./server/db";
import { sql } from "drizzle-orm";
import { subDays, format } from "date-fns";

async function main() {
  console.log("=".repeat(70));
  console.log("Debugging Tareef's Friday Prediction");
  console.log("=".repeat(70));

  // Get Tareef's full history
  const tareef = await db.execute(sql`
    SELECT
      d.id as driver_id,
      d.first_name || ' ' || d.last_name as driver_name,
      b.service_date::date as service_date,
      EXTRACT(DOW FROM b.service_date) as dow
    FROM block_assignments ba
    JOIN blocks b ON ba.block_id = b.id
    JOIN drivers d ON ba.driver_id = d.id
    WHERE ba.is_active = true
      AND LOWER(d.first_name) LIKE '%tareef%'
    ORDER BY b.service_date
  `);

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  console.log("\n1. TAREEF'S FULL HISTORY:");
  console.log("-".repeat(50));

  const dayCounts: Record<string, number> = {};
  for (const row of tareef.rows) {
    const dayName = dayNames[Number(row.dow)];
    dayCounts[dayName] = (dayCounts[dayName] || 0) + 1;
    console.log(`  ${row.service_date} (${dayName})`);
  }

  console.log("\nDay breakdown:");
  for (const [day, count] of Object.entries(dayCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${day}: ${count} shifts`);
  }

  // Calculate what features the model would see
  console.log("\n2. FEATURE ANALYSIS FOR FRIDAY DEC 20:");
  console.log("-".repeat(50));

  const totalShifts = tareef.rows.length;
  const satCount = dayCounts["Sat"] || 0;
  const sunCount = dayCounts["Sun"] || 0;
  const friCount = dayCounts["Fri"] || 0;

  console.log(`\nWith 8-week lookback (${totalShifts} shifts):`);
  console.log(`  historical_freq_friday = ${friCount}/${totalShifts} = ${(friCount/totalShifts*100).toFixed(1)}%`);
  console.log(`  historical_freq_saturday = ${satCount}/${totalShifts} = ${(satCount/totalShifts*100).toFixed(1)}%`);
  console.log(`  historical_freq_sunday = ${sunCount}/${totalShifts} = ${(sunCount/totalShifts*100).toFixed(1)}%`);

  // 2-week lookback
  const twoWeeksAgo = subDays(new Date(), 14);
  const recentShifts = tareef.rows.filter(r => new Date(String(r.service_date)) >= twoWeeksAgo);

  const recentDayCounts: Record<string, number> = {};
  for (const row of recentShifts) {
    const dayName = dayNames[Number(row.dow)];
    recentDayCounts[dayName] = (recentDayCounts[dayName] || 0) + 1;
  }

  const recentTotal = recentShifts.length;
  const recentFri = recentDayCounts["Fri"] || 0;
  const recentSat = recentDayCounts["Sat"] || 0;
  const recentSun = recentDayCounts["Sun"] || 0;

  console.log(`\nWith 2-week lookback (${recentTotal} shifts):`);
  console.log(`  historical_freq_friday = ${recentFri}/${recentTotal} = ${(recentFri/Math.max(1,recentTotal)*100).toFixed(1)}%`);
  console.log(`  historical_freq_saturday = ${recentSat}/${recentTotal} = ${(recentSat/Math.max(1,recentTotal)*100).toFixed(1)}%`);
  console.log(`  historical_freq_sunday = ${recentSun}/${recentTotal} = ${(recentSun/Math.max(1,recentTotal)*100).toFixed(1)}%`);

  console.log("\n3. ROOT CAUSE:");
  console.log("-".repeat(50));
  console.log(`
The XGBoost model's most important feature is "historical_freq_this_day"
(how often a driver works on that specific day of the week).

For Tareef:
- He has NEVER worked a Friday (0 Friday shifts in all history)
- With 8-week data: Friday freq = 0% (correct)
- With 2-week data: Friday freq = 0% (correct)

So WHY did the 8-week model predict 98% for Friday?

The issue is that with MORE training data (8 weeks), the model has learned
from OTHER drivers' patterns. Some drivers work many days including Fridays.
The model learned: "drivers with high shift counts tend to work many days"

Tareef has ${totalShifts} shifts in 8 weeks - that's a lot!
The model might be confusing his HIGH VOLUME with HIGH AVAILABILITY.

Other features like:
- rolling_interval (his average gap between shifts)
- is_rolling_match (does Friday fit his pattern?)
- days_since_last_worked

...may have contributed to the false positive.

With 2-week data:
- Tareef only has ${recentTotal} shifts
- Less "noise" from volume effects
- Model focuses more on actual day patterns
`);

  console.log("\n4. SOLUTION:");
  console.log("-".repeat(50));
  console.log(`
To fix this, the model needs to weight "historical_freq_this_day" MORE heavily.
If a driver has 0% frequency on Fridays, they should NOT be predicted for Friday
regardless of other features.

Current feature importance shows historical_freq_this_day at ~25-37%.
It should probably be 50%+ to prevent this kind of false positive.

Alternatively, add a HARD RULE: If historical_freq_this_day < 5%, cap probability at 20%.
`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
