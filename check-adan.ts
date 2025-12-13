import { db } from './server/db';
import { blocks, blockAssignments, drivers } from './shared/schema';
import { eq, sql } from 'drizzle-orm';
import { subWeeks } from 'date-fns';

async function checkAdan() {
  const cutoff = subWeeks(new Date(), 12);

  // Find Adan
  const allDrivers = await db.select({ id: drivers.id, firstName: drivers.firstName, lastName: drivers.lastName })
    .from(drivers);

  const adan = allDrivers.find(d => d.firstName?.toLowerCase().includes('adan') || d.lastName?.toLowerCase().includes('adan'));

  if (!adan) {
    console.log('Adan not found');
    process.exit(0);
  }

  console.log('Found Adan:', adan.id, adan.firstName, adan.lastName);

  // Get his assignment history with solo types
  const history = await db.execute(sql`
    SELECT b.solo_type, b.service_date, b.tractor_id
    FROM block_assignments ba
    JOIN blocks b ON ba.block_id = b.id
    WHERE ba.driver_id = ${adan.id}
    AND b.service_date >= ${cutoff}
    ORDER BY b.service_date DESC
    LIMIT 20
  `);

  console.log('\nAdan recent assignments:');
  for (const row of history.rows as any[]) {
    console.log('  ', row.service_date, row.solo_type, row.tractor_id);
  }

  // Count by type
  const counts = await db.execute(sql`
    SELECT b.solo_type, COUNT(*) as count
    FROM block_assignments ba
    JOIN blocks b ON ba.block_id = b.id
    WHERE ba.driver_id = ${adan.id}
    AND b.service_date >= ${cutoff}
    GROUP BY b.solo_type
  `);

  console.log('\nCounts by type:');
  for (const row of counts.rows as any[]) {
    console.log('  ', row.solo_type, ':', row.count);
  }

  process.exit(0);
}

checkAdan();
