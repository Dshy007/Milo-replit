import { db } from './server/db';
import { sql } from 'drizzle-orm';

async function main() {
  // Check for assignments without blocks
  const orphans = await db.execute(sql`
    SELECT COUNT(*) as cnt
    FROM block_assignments ba
    LEFT JOIN blocks b ON ba.block_id = b.id
    WHERE b.id IS NULL
  `);
  console.log('Orphan assignments (no matching block):', (orphans.rows[0] as any).cnt);

  // Check assignments grouped by whether they have a block
  const breakdown = await db.execute(sql`
    SELECT
      CASE WHEN b.id IS NULL THEN 'no_block' ELSE 'has_block' END as status,
      COUNT(*) as cnt
    FROM block_assignments ba
    LEFT JOIN blocks b ON ba.block_id = b.id
    GROUP BY CASE WHEN b.id IS NULL THEN 'no_block' ELSE 'has_block' END
  `);
  console.log('\nAssignment breakdown:');
  for (const r of breakdown.rows as any[]) {
    console.log(`  ${r.status}: ${r.cnt}`);
  }

  // Check if there are duplicate assignments
  const dupes = await db.execute(sql`
    SELECT block_id, COUNT(*) as cnt
    FROM block_assignments
    GROUP BY block_id
    HAVING COUNT(*) > 1
    LIMIT 5
  `);
  console.log('\nBlocks with multiple assignments:', dupes.rows.length);

  process.exit(0);
}

main().catch(console.error);
