import { db } from './server/db';
import { sql } from 'drizzle-orm';

async function main() {
  console.log('='.repeat(80));
  console.log('UNDERSTANDING THE DATA FLOW: CONTRACTS → BLOCKS');
  console.log('='.repeat(80));

  // 1. Show Contracts (the CANONICAL source of truth)
  console.log('\n1. CONTRACTS TABLE (Source of Canonical Time)');
  console.log('-'.repeat(60));
  const contracts = await db.execute(sql`
    SELECT type, tractor_id, start_time
    FROM contracts
    WHERE tenant_id = '3cf00ed3-3eb9-43bf-b001-aee880b30304'
    ORDER BY type, start_time
  `);

  console.log('Type     | Tractor    | Canonical Time');
  for (const c of contracts.rows as any[]) {
    console.log(`${c.type.padEnd(8)} | ${c.tractor_id.padEnd(10)} | ${c.start_time}`);
  }

  // 2. Show Blocks with their start_timestamp
  console.log('\n2. BLOCKS TABLE (Actual Start Time from Excel)');
  console.log('-'.repeat(60));
  const blocks = await db.execute(sql`
    SELECT solo_type, tractor_id,
           TO_CHAR(start_timestamp, 'HH24:MI') as actual_time,
           COUNT(*) as count
    FROM blocks
    WHERE tenant_id = '3cf00ed3-3eb9-43bf-b001-aee880b30304'
    GROUP BY solo_type, tractor_id, TO_CHAR(start_timestamp, 'HH24:MI')
    ORDER BY solo_type, tractor_id
    LIMIT 20
  `);

  console.log('Type     | Tractor    | Actual Time | Count');
  for (const b of blocks.rows as any[]) {
    console.log(`${(b.solo_type || '').padEnd(8)} | ${(b.tractor_id || '').padEnd(10)} | ${b.actual_time.padEnd(11)} | ${b.count}`);
  }

  // 3. Compare: For each block, what's the canonical vs actual?
  console.log('\n3. COMPARISON: Canonical (contracts) vs Actual (blocks)');
  console.log('-'.repeat(60));

  const comparison = await db.execute(sql`
    SELECT
      b.solo_type,
      b.tractor_id,
      c.start_time as canonical_time,
      TO_CHAR(b.start_timestamp, 'HH24:MI') as actual_time,
      CASE
        WHEN c.start_time = TO_CHAR(b.start_timestamp, 'HH24:MI') THEN 'MATCH'
        ELSE 'BUMPED'
      END as status,
      COUNT(*) as count
    FROM blocks b
    LEFT JOIN contracts c ON
      c.type = b.solo_type
      AND c.tractor_id = b.tractor_id
      AND c.tenant_id = b.tenant_id
    WHERE b.tenant_id = '3cf00ed3-3eb9-43bf-b001-aee880b30304'
      AND b.service_date >= CURRENT_DATE
    GROUP BY b.solo_type, b.tractor_id, c.start_time, TO_CHAR(b.start_timestamp, 'HH24:MI')
    ORDER BY b.solo_type, b.tractor_id
  `);

  console.log('Type     | Tractor    | Canonical | Actual   | Status  | Count');
  for (const row of comparison.rows as any[]) {
    console.log(`${(row.solo_type || '').padEnd(8)} | ${(row.tractor_id || '').padEnd(10)} | ${(row.canonical_time || 'N/A').padEnd(9)} | ${(row.actual_time || '').padEnd(8)} | ${row.status.padEnd(7)} | ${row.count}`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('KEY INSIGHT:');
  console.log('- CANONICAL TIME: From contracts table (e.g., solo1 Tractor_8 = 00:30)');
  console.log('- ACTUAL TIME: From blocks.start_timestamp (e.g., 06:30 from Excel)');
  console.log('- BUMP: When actual differs from canonical (Amazon shifted the time)');
  console.log('='.repeat(80));

  process.exit(0);
}

main().catch(console.error);
