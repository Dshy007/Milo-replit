import { db } from './server/db';
import { sql } from 'drizzle-orm';

async function main() {
  const tenantId = '3cf00ed3-3eb9-43bf-b001-aee880b30304';

  const blocks = await db.execute(sql`
    SELECT b.id, b.service_date::text as dt, b.solo_type, b.tractor_id,
           b.start_timestamp::text as start_time,
           d.first_name || ' ' || d.last_name as driver
    FROM blocks b
    LEFT JOIN block_assignments ba ON ba.block_id = b.id AND ba.is_active = true
    LEFT JOIN drivers d ON ba.driver_id = d.id
    WHERE b.tenant_id = ${tenantId}
    AND b.service_date >= '2025-12-12'
    AND b.service_date <= '2025-12-13'
    ORDER BY b.service_date, b.solo_type, b.tractor_id
  `);

  console.log('BLOCKS Dec 12-13:');
  for (const b of blocks.rows as any[]) {
    const status = b.driver ? 'ASSIGNED' : 'UNASSIGNED';
    console.log(`  ${b.dt} ${b.solo_type} ${b.tractor_id} @ ${b.start_time} → ${b.driver || '(none)'} [${status}]`);
  }

  process.exit(0);
}
main().catch(console.error);
