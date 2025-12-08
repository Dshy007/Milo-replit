import { db } from './server/db.js';
import { sql } from 'drizzle-orm';

async function main() {
  // Check what date Dec 6 falls on
  const dec6 = new Date('2025-12-06');
  console.log('Dec 6, 2025 is a:', ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dec6.getDay()]);

  // Get ALL blocks for Dec 6
  const dec6Blocks = await db.execute(sql`
    SELECT b.id, b.service_date, b.solo_type, b.tractor_id,
           ba.driver_id, d.first_name || ' ' || d.last_name as driver_name
    FROM blocks b
    LEFT JOIN block_assignments ba ON ba.block_id = b.id AND ba.is_active = true
    LEFT JOIN drivers d ON ba.driver_id = d.id
    WHERE b.service_date = '2025-12-06'::date
    ORDER BY b.tractor_id
  `);

  console.log(`\nFound ${dec6Blocks.rows.length} blocks on Dec 6:\n`);
  for (const row of dec6Blocks.rows as any[]) {
    const status = row.driver_name ? `ASSIGNED: ${row.driver_name}` : 'UNASSIGNED';
    console.log(`  ${row.id.slice(0,8)} - ${row.solo_type} ${row.tractor_id} - ${status}`);
  }

  // Check the date range used in my test
  console.log('\n\nDate range check:');
  console.log('Nov 30 =', new Date('2025-11-30').toDateString());
  console.log('Dec 6 =', new Date('2025-12-06').toDateString());

  // Check if Dec 6 is included in >= Nov 30 AND <= Dec 6
  const rangeBlocks = await db.execute(sql`
    SELECT COUNT(*) as cnt
    FROM blocks b
    WHERE b.service_date >= '2025-11-30'::date
    AND b.service_date <= '2025-12-06'::date
  `);
  console.log('\nBlocks in range Nov 30 - Dec 6:', (rangeBlocks.rows[0] as any).cnt);

  process.exit(0);
}

main();
