import { db } from './server/db';
import { sql } from 'drizzle-orm';

async function check() {
  const result = await db.execute(sql`
    SELECT COUNT(*) as cnt FROM blocks
    WHERE service_date >= '2025-12-07' AND service_date <= '2025-12-13'
  `);
  console.log('Blocks in DB for Dec 7-13:', result.rows[0]);

  // Check a sample
  const sample = await db.execute(sql`
    SELECT block_id, service_date, solo_type, tractor_id
    FROM blocks
    WHERE service_date >= '2025-12-07' AND service_date <= '2025-12-13'
    LIMIT 5
  `);
  console.log('\nSample blocks:');
  for (const row of sample.rows as any[]) {
    console.log(' ', row.block_id, row.service_date, row.solo_type, row.tractor_id);
  }

  process.exit(0);
}

check();
