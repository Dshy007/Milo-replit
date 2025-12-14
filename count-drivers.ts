import { db } from './server/db';
import { sql } from 'drizzle-orm';

async function main() {
  const tenantId = '3cf00ed3-3eb9-43bf-b001-aee880b30304';

  // Total active drivers
  const total = await db.execute(sql`
    SELECT COUNT(*) as count FROM drivers
    WHERE tenant_id = ${tenantId} AND status = 'active'
  `);

  // Solo1 drivers (have worked solo1 blocks)
  const solo1 = await db.execute(sql`
    SELECT COUNT(DISTINCT d.id) as count
    FROM drivers d
    WHERE d.tenant_id = ${tenantId}
    AND d.status = 'active'
    AND EXISTS (
      SELECT 1 FROM block_assignments ba
      JOIN blocks b ON ba.block_id = b.id
      WHERE ba.driver_id = d.id AND b.solo_type = 'solo1' AND ba.is_active = true
    )
  `);

  // Solo2 drivers
  const solo2 = await db.execute(sql`
    SELECT COUNT(DISTINCT d.id) as count
    FROM drivers d
    WHERE d.tenant_id = ${tenantId}
    AND d.status = 'active'
    AND EXISTS (
      SELECT 1 FROM block_assignments ba
      JOIN blocks b ON ba.block_id = b.id
      WHERE ba.driver_id = d.id AND b.solo_type = 'solo2' AND ba.is_active = true
    )
  `);

  // Drivers with ANY active assignments
  const withAssignments = await db.execute(sql`
    SELECT COUNT(DISTINCT d.id) as count
    FROM drivers d
    WHERE d.tenant_id = ${tenantId}
    AND d.status = 'active'
    AND EXISTS (
      SELECT 1 FROM block_assignments ba
      WHERE ba.driver_id = d.id AND ba.is_active = true
    )
  `);

  console.log('DRIVER COUNTS:');
  console.log('  Total active drivers:', (total.rows[0] as any).count);
  console.log('  With ANY assignments:', (withAssignments.rows[0] as any).count);
  console.log('  Solo1 drivers:', (solo1.rows[0] as any).count);
  console.log('  Solo2 drivers:', (solo2.rows[0] as any).count);

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
