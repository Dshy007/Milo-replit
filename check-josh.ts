import { db } from './server/db';
import { sql } from 'drizzle-orm';
import { subWeeks } from 'date-fns';

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

async function checkJosh() {
  const cutoff = subWeeks(new Date(), 8);
  const tenantId = '3cf00ed3-3eb9-43bf-b001-aee880b30304';

  const result = await db.execute(sql`
    SELECT
      d.first_name,
      d.last_name,
      b.solo_type,
      b.service_date,
      b.tractor_id,
      EXTRACT(DOW FROM b.service_date) as day_of_week
    FROM block_assignments ba
    JOIN blocks b ON ba.block_id = b.id
    JOIN drivers d ON ba.driver_id = d.id
    WHERE b.tenant_id = ${tenantId}
    AND b.service_date >= ${cutoff}
    AND ba.is_active = true
    AND LOWER(d.last_name) LIKE '%green%'
    ORDER BY b.service_date DESC
  `);

  if (result.rows.length === 0) {
    console.log('No assignments found for any driver named Green in the last 8 weeks');
    process.exit(0);
  }

  const name = `${(result.rows[0] as any).first_name} ${(result.rows[0] as any).last_name}`;
  console.log(`\n=== ${name.toUpperCase()} WORK HISTORY (Last 8 Weeks) ===\n`);
  console.log(`Total shifts: ${result.rows.length}`);

  // Count by day
  const dayCounts: Record<string, number> = {};
  const typeCounts: Record<string, number> = {};

  for (const row of result.rows as any[]) {
    const dayName = DAY_NAMES[parseInt(row.day_of_week)];
    dayCounts[dayName] = (dayCounts[dayName] || 0) + 1;

    const soloType = row.solo_type || 'solo1';
    typeCounts[soloType] = (typeCounts[soloType] || 0) + 1;
  }

  console.log('\n--- Contract Type ---');
  for (const [type, count] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
    const pct = Math.round((count / result.rows.length) * 100);
    console.log(`  ${type}: ${count} shifts (${pct}%)`);
  }

  console.log('\n--- Days Worked ---');
  for (const day of DAY_NAMES) {
    const count = dayCounts[day] || 0;
    if (count > 0) {
      const bar = '█'.repeat(count) + '░'.repeat(8 - count);
      console.log(`  ${day.padEnd(10)} ${bar} ${count}`);
    }
  }

  console.log('\n--- Recent Assignments ---');
  for (const row of (result.rows as any[]).slice(0, 15)) {
    const dayName = DAY_NAMES[parseInt(row.day_of_week)];
    console.log(`  ${row.service_date} (${dayName}) - ${row.solo_type || 'solo1'} ${row.tractor_id || ''}`);
  }

  process.exit(0);
}

checkJosh().catch(e => { console.error(e); process.exit(1); });
