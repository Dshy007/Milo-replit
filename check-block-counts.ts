import { db } from './server/db';
import { sql } from 'drizzle-orm';

async function main() {
  console.log('='.repeat(80));
  console.log('BLOCK COUNT ANALYSIS');
  console.log('='.repeat(80));

  // Total blocks
  const total = await db.execute(sql`SELECT COUNT(*) as cnt FROM blocks`);
  console.log('\nTotal blocks in database:', (total.rows[0] as any).cnt);

  // Date range of all blocks
  const range = await db.execute(sql`
    SELECT
      MIN(service_date)::text as oldest,
      MAX(service_date)::text as newest
    FROM blocks
  `);
  const r = range.rows[0] as any;
  console.log('Date range:', r.oldest, 'to', r.newest);

  // Unassigned future blocks
  const unassignedFuture = await db.execute(sql`
    SELECT COUNT(*) as cnt
    FROM blocks b
    LEFT JOIN block_assignments ba ON b.id = ba.block_id
    WHERE ba.id IS NULL AND b.service_date >= CURRENT_DATE
  `);
  console.log('\nUnassigned (future only):', (unassignedFuture.rows[0] as any).cnt);

  // All unassigned (including historical)
  const unassignedAll = await db.execute(sql`
    SELECT COUNT(*) as cnt
    FROM blocks b
    LEFT JOIN block_assignments ba ON b.id = ba.block_id
    WHERE ba.id IS NULL
  `);
  console.log('Unassigned (all time):', (unassignedAll.rows[0] as any).cnt);

  // Already assigned blocks
  const assigned = await db.execute(sql`
    SELECT COUNT(DISTINCT b.id) as cnt
    FROM blocks b
    JOIN block_assignments ba ON b.id = ba.block_id
  `);
  console.log('Assigned blocks:', (assigned.rows[0] as any).cnt);

  // Breakdown by week
  console.log('\n' + '-'.repeat(80));
  console.log('BLOCKS BY WEEK (last 12 weeks + future):');
  console.log('-'.repeat(80));

  const byWeek = await db.execute(sql`
    SELECT
      DATE_TRUNC('week', service_date)::date as week_start,
      COUNT(*) as total_blocks,
      COUNT(ba.id) as assigned,
      COUNT(*) - COUNT(ba.id) as unassigned
    FROM blocks b
    LEFT JOIN block_assignments ba ON b.id = ba.block_id
    WHERE service_date >= CURRENT_DATE - INTERVAL '12 weeks'
    GROUP BY DATE_TRUNC('week', service_date)
    ORDER BY week_start
  `);

  console.log('\nWeek Start   | Total | Assigned | Unassigned');
  console.log('-'.repeat(50));
  for (const w of byWeek.rows as any[]) {
    const ws = String(w.week_start).substring(0, 10);
    console.log(`${ws}  | ${String(w.total_blocks).padStart(5)} | ${String(w.assigned).padStart(8)} | ${w.unassigned}`);
  }

  process.exit(0);
}

main().catch(console.error);
