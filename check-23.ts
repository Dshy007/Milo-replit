import { db } from './server/db';
import { sql } from 'drizzle-orm';

async function main() {
  const tenantId = '3cf00ed3-3eb9-43bf-b001-aee880b30304';

  // List all unassigned blocks by date
  const unassigned = await db.execute(sql`
    SELECT b.service_date::text as dt, COUNT(*) as cnt
    FROM blocks b
    WHERE b.tenant_id = ${tenantId}
    AND NOT EXISTS (
      SELECT 1 FROM block_assignments ba
      WHERE ba.block_id = b.id AND ba.is_active = true
    )
    GROUP BY b.service_date
    ORDER BY b.service_date
  `);

  console.log('UNASSIGNED BLOCKS BY DATE:');
  let total = 0;
  for (const row of unassigned.rows as any[]) {
    console.log(`  ${row.dt}: ${row.cnt}`);
    total += parseInt(row.cnt);
  }
  console.log(`  TOTAL: ${total}`);

  process.exit(0);
}
main().catch(console.error);
