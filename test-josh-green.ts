/**
 * Test consistency metric on Josh Green
 */

import { db } from './server/db';
import { sql } from 'drizzle-orm';

async function testJoshGreen() {
  // Get Josh Green's driver ID
  const driverResult = await db.execute(sql`
    SELECT id, first_name, last_name
    FROM drivers
    WHERE first_name ILIKE '%Josh%' AND last_name ILIKE 'Green'
  `);

  if (driverResult.rows.length === 0) {
    console.log('Josh Green not found');
    process.exit(1);
  }

  const josh = driverResult.rows[0] as any;
  console.log('='.repeat(70));
  console.log('TEST: Josh Green Consistency');
  console.log('='.repeat(70));
  console.log(`Driver: ${josh.first_name} ${josh.last_name} (${josh.id})`);

  // Get Josh's assignment history
  const historyResult = await db.execute(sql`
    SELECT
      b.service_date,
      EXTRACT(DOW FROM b.service_date) as day_of_week,
      b.solo_type,
      b.tractor_id
    FROM block_assignments ba
    JOIN blocks b ON ba.block_id = b.id
    WHERE ba.driver_id = ${josh.id}
    ORDER BY b.service_date DESC
    LIMIT 50
  `);

  const history = historyResult.rows as any[];
  console.log(`\nAssignments: ${history.length}`);

  // Count by day of week
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayFreq: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };

  for (const h of history) {
    const dow = parseInt(h.day_of_week);
    dayFreq[dow]++;
  }

  console.log('\nDay-of-week distribution:');
  for (let i = 0; i < 7; i++) {
    const bar = '#'.repeat(dayFreq[i]);
    console.log(`  ${dayNames[i]}: ${dayFreq[i].toString().padStart(2)} ${bar}`);
  }

  // Calculate consistency
  const counts = Object.values(dayFreq).filter(c => c > 0);
  const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
  const variance = counts.reduce((sum, c) => sum + Math.pow(c - mean, 2), 0) / counts.length;
  const stddev = Math.sqrt(variance);
  const consistency = Math.max(0, Math.min(1, 1 - (stddev / mean)));

  console.log(`\nConsistency Calculation:`);
  console.log(`  Days worked: ${counts.length}`);
  console.log(`  Mean assignments per day: ${mean.toFixed(2)}`);
  console.log(`  Std deviation: ${stddev.toFixed(2)}`);
  console.log(`  Consistency: ${(consistency * 100).toFixed(0)}%`);

  // Show consistency boost
  const boost = 0.8 + (consistency * 0.2);
  console.log(`\nScoring Impact:`);
  console.log(`  Consistency boost: ${boost.toFixed(3)}x`);

  if (consistency >= 0.8) {
    console.log('  Status: HIGH consistency - reliable driver');
  } else if (consistency >= 0.5) {
    console.log('  Status: MEDIUM consistency - somewhat predictable');
  } else {
    console.log('  Status: LOW consistency - erratic schedule');
  }

  // Show recent assignments
  console.log('\nRecent assignments:');
  for (const h of history.slice(0, 10)) {
    const dow = parseInt(h.day_of_week);
    console.log(`  ${h.service_date} (${dayNames[dow]}) - ${h.solo_type} ${h.tractor_id}`);
  }

  console.log('\n' + '='.repeat(70));

  process.exit(0);
}

testJoshGreen();
