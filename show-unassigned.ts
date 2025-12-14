import { db } from './server/db';
import { sql } from 'drizzle-orm';

async function main() {
  const result = await db.execute(sql`
    SELECT
      b.id,
      b.solo_type,
      b.tractor_id,
      TO_CHAR(b.start_timestamp, 'HH24:MI') as start_time,
      b.service_date::text,
      TO_CHAR(b.service_date, 'Day') as day_name
    FROM blocks b
    LEFT JOIN block_assignments ba ON b.id = ba.block_id AND ba.is_active = true
    WHERE ba.id IS NULL
      AND b.service_date >= CURRENT_DATE
    ORDER BY b.service_date, b.start_timestamp
  `);

  console.log('UNASSIGNED BLOCKS');
  console.log('='.repeat(80));
  console.log('Date       | Day       | Time  | Type  | Tractor');
  console.log('-'.repeat(80));

  for (const b of result.rows as any[]) {
    const day = (b.day_name || '').trim().padEnd(9);
    console.log(`${b.service_date} | ${day} | ${b.start_time} | ${b.solo_type} | ${b.tractor_id}`);
  }

  console.log('-'.repeat(80));
  console.log(`Total: ${result.rows.length} unassigned blocks`);
  process.exit(0);
}

main().catch(console.error);
