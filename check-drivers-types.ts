import { db } from './server/db';
import { sql } from 'drizzle-orm';

async function main() {
  // Get solo1 drivers with their block assignments
  const result = await db.execute(sql`
    SELECT
      d.id,
      d.first_name || ' ' || d.last_name as name
    FROM drivers d
    WHERE d.tenant_id = '3cf00ed3-3eb9-43bf-b001-aee880b30304'
    AND d.status = 'active'
    AND EXISTS (
      SELECT 1 FROM block_assignments ba
      JOIN blocks b ON ba.block_id = b.id
      WHERE ba.driver_id = d.id AND b.solo_type = 'solo1' AND ba.is_active = true
    )
    ORDER BY d.first_name
    LIMIT 30
  `);

  console.log('SOLO1 DRIVERS:');
  for (const r of result.rows as any[]) {
    console.log(`  ${r.name} (${r.id})`);
  }
  console.log(`\nTotal: ${result.rows.length} drivers`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
