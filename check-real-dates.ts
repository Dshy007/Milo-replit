import { db } from './server/db.js';
import { sql } from 'drizzle-orm';

async function main() {
  // Get the actual dates stored in the database
  const dates = await db.execute(sql`
    SELECT DISTINCT service_date::text as service_date
    FROM blocks
    ORDER BY service_date DESC
    LIMIT 20
  `);

  console.log('=== DATES IN DATABASE ===\n');
  for (const row of dates.rows as any[]) {
    console.log(row.service_date);
  }

  // Find blocks that are on an actual Saturday (day of week = 6)
  const saturdayBlocks = await db.execute(sql`
    SELECT b.id, b.service_date::text as service_date, b.solo_type, b.tractor_id,
           EXTRACT(DOW FROM b.service_date) as day_of_week,
           ba.driver_id
    FROM blocks b
    LEFT JOIN block_assignments ba ON ba.block_id = b.id AND ba.is_active = true
    WHERE EXTRACT(DOW FROM b.service_date) = 6
    AND b.service_date >= '2025-12-01'::date
    ORDER BY b.service_date
  `);

  console.log('\n=== SATURDAY BLOCKS (Dec 2025) ===\n');
  console.log(`Found ${saturdayBlocks.rows.length} Saturday blocks:\n`);
  for (const row of saturdayBlocks.rows as any[]) {
    const status = row.driver_id ? 'ASSIGNED' : 'UNASSIGNED';
    console.log(`  ${row.service_date} - ${row.solo_type} ${row.tractor_id} - ${status}`);
  }

  // Check which week the UI is showing - look for Dec 6 as Saturday
  console.log('\n=== CHECKING DEC 6 AS SATURDAY ===\n');
  const dec6Check = await db.execute(sql`
    SELECT b.id, b.service_date::text as service_date, b.solo_type, b.tractor_id,
           EXTRACT(DOW FROM b.service_date) as day_of_week,
           TO_CHAR(b.service_date, 'Day') as day_name
    FROM blocks b
    WHERE b.service_date = '2025-12-06'::date
    LIMIT 10
  `);

  console.log(`Found ${dec6Check.rows.length} blocks on 2025-12-06:`);
  for (const row of dec6Check.rows as any[]) {
    console.log(`  ${row.service_date} is ${row.day_name} (DOW: ${row.day_of_week})`);
  }

  process.exit(0);
}

main();
