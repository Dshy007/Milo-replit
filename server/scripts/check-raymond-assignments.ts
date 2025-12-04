import { db } from '../db';
import { sql } from 'drizzle-orm';

async function checkRaymondAssignments() {
  // Find Raymond
  const driverResult = await db.execute(sql`
    SELECT id, first_name, last_name FROM drivers
    WHERE LOWER(first_name) LIKE '%raymond%' AND LOWER(last_name) LIKE '%beek%'
    LIMIT 1
  `);

  if (driverResult.rows.length === 0) {
    console.log('Raymond not found!');
    process.exit(1);
  }

  const driver = driverResult.rows[0] as any;
  console.log('Driver:', driver.first_name, driver.last_name);
  console.log('Driver ID:', driver.id);

  // Get his assignments from block_assignments (service_date and start_timestamp are on blocks table)
  const result = await db.execute(sql`
    SELECT
      b.service_date,
      b.start_timestamp,
      b.solo_type,
      b.tractor_id
    FROM block_assignments ba
    JOIN blocks b ON ba.block_id = b.id
    WHERE ba.driver_id = ${driver.id}
    AND ba.is_active = true
    ORDER BY b.service_date DESC
    LIMIT 50
  `);

  console.log('\n=== BLOCK_ASSIGNMENTS (' + result.rows.length + ' rows) ===');

  const byTime: Record<string, number> = {};
  const byDay: Record<string, number> = {};

  for (const row of result.rows) {
    const r = row as any;
    const serviceDate = r.service_date instanceof Date ? r.service_date : new Date(r.service_date);
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayName = days[serviceDate.getDay()];
    const dateStr = serviceDate.toISOString().split('T')[0];

    // Extract time from start_timestamp
    let startTime = 'unknown';
    if (r.start_timestamp) {
      const ts = r.start_timestamp instanceof Date ? r.start_timestamp : new Date(r.start_timestamp);
      startTime = ts.toISOString().split('T')[1].slice(0, 5);
    }

    console.log(`  ${dateStr} (${dayName}) @ ${startTime} - ${r.solo_type} - ${r.tractor_id}`);

    byTime[startTime] = (byTime[startTime] || 0) + 1;
    byDay[dayName] = (byDay[dayName] || 0) + 1;
  }

  console.log('\n=== PATTERN SUMMARY ===');
  console.log('By Time:', byTime);
  console.log('By Day:', byDay);

  // Show dominant time
  const sortedTimes = Object.entries(byTime).sort((a, b) => b[1] - a[1]);
  if (sortedTimes.length > 0) {
    const total = result.rows.length;
    console.log('\nTop Times:');
    for (const [time, count] of sortedTimes) {
      const pct = Math.round((count / total) * 100);
      console.log(`  ${time}: ${count} times (${pct}%)`);
    }
  }

  process.exit(0);
}

checkRaymondAssignments().catch(console.error);
