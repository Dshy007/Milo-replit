import { db } from './server/db';
import { sql } from 'drizzle-orm';

async function check() {
  const sample = await db.execute(sql`
    SELECT
      ba.driver_id,
      b.service_date,
      b.start_timestamp,
      b.canonical_start,
      b.tractor_id,
      b.solo_type,
      d.first_name,
      d.last_name,
      EXTRACT(DOW FROM b.service_date) as day_of_week
    FROM block_assignments ba
    JOIN blocks b ON ba.block_id = b.id
    JOIN drivers d ON ba.driver_id = d.id
    LIMIT 10
  `);
  console.log('Sample data:', JSON.stringify(sample.rows, null, 2));

  const tractors = await db.execute(sql`
    SELECT DISTINCT b.tractor_id, b.solo_type
    FROM block_assignments ba
    JOIN blocks b ON ba.block_id = b.id
    WHERE b.tractor_id IS NOT NULL
    ORDER BY b.solo_type, b.tractor_id
  `);
  console.log('\nTractors:', tractors.rows);

  // Count total assignments
  const count = await db.execute(sql`
    SELECT COUNT(*) as total FROM block_assignments
  `);
  console.log('\nTotal assignments:', count.rows);

  process.exit(0);
}
check().catch(e => { console.error(e); process.exit(1); });
