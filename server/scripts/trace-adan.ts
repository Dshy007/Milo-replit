/**
 * Trace Adan's data from source - find root cause of bad solo_type
 */
import { db } from '../db';
import { sql } from 'drizzle-orm';

async function trace() {
  // 1. What columns exist in drivers table?
  const columns = await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'drivers'
    ORDER BY ordinal_position
  `);
  console.log('=== DRIVERS TABLE COLUMNS ===');
  console.log((columns.rows as any[]).map(r => r.column_name).join(', '));

  // 2. What does the DRIVERS table say about Adan?
  const driver = await db.execute(sql`
    SELECT *
    FROM drivers
    WHERE first_name ILIKE '%adan%'
  `);
  console.log('\n=== ADAN DRIVER RECORD ===');
  console.log(driver.rows[0]);

  const driverId = (driver.rows[0] as any).id;

  // 2. What do the BLOCKS say (via block_assignments)?
  const blocks = await db.execute(sql`
    SELECT
      b.block_id,
      b.solo_type,
      b.tractor_id,
      b.service_date,
      b.start_timestamp,
      b.canonical_start
    FROM block_assignments ba
    JOIN blocks b ON ba.block_id = b.id
    WHERE ba.driver_id = ${driverId}
    AND ba.is_active = true
    ORDER BY b.service_date DESC
    LIMIT 15
  `);

  console.log('\n=== BLOCKS (raw from DB) ===');
  console.log('service_date | solo_type | tractor | start_timestamp (raw) | canonical_start (stored)');
  for (const b of blocks.rows as any[]) {
    const ts = b.start_timestamp;
    const utcTime = ts ? new Date(ts).toISOString() : 'N/A';
    console.log(`  ${b.service_date} | ${b.solo_type} | ${b.tractor_id} | ${utcTime} | ${b.canonical_start}`);
  }

  // 3. Count by solo_type
  const counts = await db.execute(sql`
    SELECT b.solo_type, COUNT(*) as cnt
    FROM block_assignments ba
    JOIN blocks b ON ba.block_id = b.id
    WHERE ba.driver_id = ${driverId}
    AND ba.is_active = true
    GROUP BY b.solo_type
  `);

  console.log('\n=== COUNTS BY SOLO_TYPE ===');
  for (const c of counts.rows as any[]) {
    console.log(`  ${c.solo_type}: ${c.cnt}`);
  }

  // 4. Check blocks table columns FIRST
  console.log('\n=== BLOCKS TABLE COLUMNS ===');
  const blockCols = await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'blocks'
    ORDER BY ordinal_position
  `);
  console.log('=== BLOCKS TABLE COLUMNS ===');
  console.log((blockCols.rows as any[]).map(r => r.column_name).join(', '));

  // 5. What does the DNA profile table have?
  const dna = await db.execute(sql`
    SELECT * FROM driver_dna_profiles
    WHERE driver_id = ${driverId}
  `);
  console.log('\n=== DNA PROFILE ===');
  console.log(dna.rows[0]);

  // 6. The key question: where does the driver's contract type ACTUALLY come from?
  // Check if there's a relationship to a contract or if it's inferred
  const dnaCols = await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'driver_dna_profiles'
    ORDER BY ordinal_position
  `);
  console.log('\n=== DNA_PROFILES TABLE COLUMNS ===');
  console.log((dnaCols.rows as any[]).map(r => r.column_name).join(', '));
}

trace().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
