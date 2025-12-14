/**
 * Debug: Show EXACTLY what's in the blocks table
 * So you can visually verify the import is correct
 */
import { db } from './server/db';
import { sql } from 'drizzle-orm';

async function main() {
  // 1. Show raw block data - EXACTLY as stored
  console.log('='.repeat(100));
  console.log('RAW BLOCKS TABLE DATA (exactly as stored in PostgreSQL)');
  console.log('='.repeat(100));

  const rawBlocks = await db.execute(sql`
    SELECT
      id,
      block_id,
      solo_type,
      tractor_id,
      start_timestamp,
      end_timestamp,
      service_date,
      canonical_start,
      pattern_group,
      duration,
      status,
      created_at
    FROM blocks
    WHERE service_date >= CURRENT_DATE
    ORDER BY service_date, start_timestamp
    LIMIT 30
  `);

  console.log('\nFirst 30 blocks (raw database values):');
  console.log('-'.repeat(100));

  for (const b of rawBlocks.rows as any[]) {
    console.log(`Block ID: ${b.block_id}`);
    console.log(`  solo_type:       ${b.solo_type}`);
    console.log(`  tractor_id:      ${b.tractor_id}`);
    console.log(`  start_timestamp: ${b.start_timestamp}`);
    console.log(`  end_timestamp:   ${b.end_timestamp}`);
    console.log(`  service_date:    ${b.service_date}`);
    console.log(`  canonical_start: ${b.canonical_start}`);
    console.log(`  pattern_group:   ${b.pattern_group}`);
    console.log(`  duration:        ${b.duration} hours`);
    console.log(`  status:          ${b.status}`);
    console.log('');
  }

  // 2. Show what CANONICAL times exist in your history
  console.log('\n' + '='.repeat(100));
  console.log('CANONICAL START TIMES IN YOUR HISTORICAL DATA');
  console.log('(What times have drivers actually worked?)');
  console.log('='.repeat(100));

  const canonicalTimes = await db.execute(sql`
    SELECT
      solo_type,
      TO_CHAR(start_timestamp, 'HH24:MI') as start_time,
      COUNT(*) as block_count,
      COUNT(DISTINCT tractor_id) as tractors_used
    FROM blocks
    WHERE service_date >= CURRENT_DATE - INTERVAL '12 weeks'
    GROUP BY solo_type, TO_CHAR(start_timestamp, 'HH24:MI')
    ORDER BY solo_type, start_time
  `);

  console.log('\nSolo Type | Start Time | Block Count | Tractors');
  console.log('-'.repeat(60));
  for (const t of canonicalTimes.rows as any[]) {
    console.log(`${t.solo_type.padEnd(9)} | ${t.start_time}      | ${String(t.block_count).padStart(11)} | ${t.tractors_used}`);
  }

  // 3. Check for mismatches between new blocks and historical patterns
  console.log('\n' + '='.repeat(100));
  console.log('NEW BLOCKS vs HISTORICAL PATTERNS');
  console.log('(Are new blocks using times that exist in history?)');
  console.log('='.repeat(100));

  const newBlockTimes = await db.execute(sql`
    WITH new_times AS (
      SELECT DISTINCT
        solo_type,
        TO_CHAR(start_timestamp, 'HH24:MI') as start_time
      FROM blocks
      WHERE service_date >= CURRENT_DATE
    ),
    historical_times AS (
      SELECT DISTINCT
        solo_type,
        TO_CHAR(start_timestamp, 'HH24:MI') as start_time
      FROM blocks
      WHERE service_date < CURRENT_DATE
        AND service_date >= CURRENT_DATE - INTERVAL '12 weeks'
    )
    SELECT
      n.solo_type,
      n.start_time,
      CASE WHEN h.start_time IS NOT NULL THEN 'YES' ELSE 'NO - NEW TIME!' END as in_history
    FROM new_times n
    LEFT JOIN historical_times h
      ON n.solo_type = h.solo_type AND n.start_time = h.start_time
    ORDER BY n.solo_type, n.start_time
  `);

  console.log('\nSolo Type | Start Time | Has History?');
  console.log('-'.repeat(50));
  for (const t of newBlockTimes.rows as any[]) {
    const flag = t.in_history === 'NO - NEW TIME!' ? ' ⚠️' : '';
    console.log(`${t.solo_type.padEnd(9)} | ${t.start_time}      | ${t.in_history}${flag}`);
  }

  // 4. Show the contracts table (canonical times defined)
  console.log('\n' + '='.repeat(100));
  console.log('CONTRACTS TABLE (Canonical start times by tractor)');
  console.log('='.repeat(100));

  const contracts = await db.execute(sql`
    SELECT * FROM contracts
    ORDER BY solo_type, tractor_id
  `);

  if (contracts.rows.length === 0) {
    console.log('\n⚠️  NO CONTRACTS DEFINED!');
    console.log('The contracts table is empty. This means canonical times are not configured.');
  } else {
    console.log('\nTractor    | Solo Type | Canonical Time | Pattern');
    console.log('-'.repeat(60));
    for (const c of contracts.rows as any[]) {
      console.log(`${(c.tractor_id || '').padEnd(10)} | ${(c.solo_type || '').padEnd(9)} | ${c.canonical_start_time || 'N/A'}          | ${c.pattern || 'N/A'}`);
    }
  }

  process.exit(0);
}

main().catch(console.error);
