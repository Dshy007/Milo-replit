/**
 * Check Mike Burton's REAL data in PostgreSQL
 */

import { db } from './server/db';
import { sql } from 'drizzle-orm';

async function main() {
  console.log('='.repeat(70));
  console.log('MIKE BURTON - POSTGRESQL DATA');
  console.log('='.repeat(70));

  // Find Mike Burton's driver record
  const drivers = await db.execute(sql`
    SELECT id, first_name, last_name, first_name || ' ' || last_name as full_name
    FROM drivers
    WHERE last_name ILIKE '%Burton%' OR first_name ILIKE '%Michael%Shane%'
  `);

  console.log('\n1. DRIVER RECORDS MATCHING "Burton":');
  for (const d of drivers.rows as any[]) {
    console.log(`   ID: ${d.id}`);
    console.log(`   Name: ${d.full_name}`);
  }

  if (drivers.rows.length === 0) {
    console.log('   No drivers found matching Burton');
    process.exit(1);
  }

  const mikeId = (drivers.rows[0] as any).id;
  const mikeName = (drivers.rows[0] as any).full_name;

  // Count Mike's assignments
  const countResult = await db.execute(sql`
    SELECT COUNT(*) as cnt
    FROM block_assignments ba
    WHERE ba.driver_id = ${mikeId}
  `);

  console.log(`\n2. MIKE'S ASSIGNMENT COUNT:`);
  console.log(`   Total: ${(countResult.rows[0] as any).cnt}`);

  // Date range
  const dateRange = await db.execute(sql`
    SELECT
      MIN(b.service_date) as min_date,
      MAX(b.service_date) as max_date
    FROM block_assignments ba
    JOIN blocks b ON ba.block_id = b.id
    WHERE ba.driver_id = ${mikeId}
  `);

  const dr = dateRange.rows[0] as any;
  console.log(`\n3. MIKE'S DATE RANGE:`);
  console.log(`   From: ${dr.min_date}`);
  console.log(`   To: ${dr.max_date}`);

  // All Mike's assignments with details
  const assignments = await db.execute(sql`
    SELECT
      b.service_date,
      b.solo_type,
      b.tractor_id,
      b.start_timestamp,
      EXTRACT(DOW FROM b.service_date) as day_of_week
    FROM block_assignments ba
    JOIN blocks b ON ba.block_id = b.id
    WHERE ba.driver_id = ${mikeId}
    ORDER BY b.service_date DESC
  `);

  console.log(`\n4. ALL ${assignments.rows.length} ASSIGNMENTS:`);
  const dowNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  for (const a of assignments.rows as any[]) {
    const dow = dowNames[parseInt(a.day_of_week)];
    const date = String(a.service_date).split('T')[0];
    console.log(`   ${date} ${dow}: ${a.solo_type} ${a.tractor_id}`);
  }

  // Count by day of week
  const byDay = await db.execute(sql`
    SELECT
      EXTRACT(DOW FROM b.service_date) as day_of_week,
      COUNT(*) as cnt
    FROM block_assignments ba
    JOIN blocks b ON ba.block_id = b.id
    WHERE ba.driver_id = ${mikeId}
    GROUP BY EXTRACT(DOW FROM b.service_date)
    ORDER BY day_of_week
  `);

  console.log(`\n5. MIKE'S ASSIGNMENTS BY DAY OF WEEK:`);
  for (const row of byDay.rows as any[]) {
    const dow = dowNames[parseInt(row.day_of_week)];
    console.log(`   ${dow}: ${row.cnt} assignments`);
  }

  // Now check what test-ownership-model.ts would have fetched
  console.log('\n' + '='.repeat(70));
  console.log('COMPARISON: MODEL TRAINING QUERY');
  console.log('='.repeat(70));

  const trainQuery = await db.execute(sql`
    SELECT
      ba.driver_id,
      d.first_name || ' ' || d.last_name as driver_name,
      b.solo_type,
      b.tractor_id,
      b.start_timestamp,
      b.service_date,
      EXTRACT(DOW FROM b.service_date) as day_of_week
    FROM block_assignments ba
    JOIN blocks b ON ba.block_id = b.id
    JOIN drivers d ON ba.driver_id = d.id
    WHERE ba.driver_id IS NOT NULL
    ORDER BY b.service_date DESC
  `);

  console.log(`Total assignments in training query: ${trainQuery.rows.length}`);

  // Filter to Mike
  const mikeInTraining = (trainQuery.rows as any[]).filter(
    r => r.driver_name?.includes('Burton') || r.driver_name?.includes('Michael Shane')
  );

  console.log(`Mike Burton in training query: ${mikeInTraining.length}`);

  if (mikeInTraining.length > 0) {
    console.log('\nMike\'s entries in training data:');
    for (const a of mikeInTraining.slice(0, 10)) {
      const date = String(a.service_date).split('T')[0];
      const dow = dowNames[parseInt(a.day_of_week)];
      console.log(`   ${date} ${dow}: ${a.driver_name} → ${a.solo_type} ${a.tractor_id}`);
    }
    if (mikeInTraining.length > 10) {
      console.log(`   ... and ${mikeInTraining.length - 10} more`);
    }
  }

  process.exit(0);
}

main().catch(console.error);
