import { db } from './server/db';
import { sql } from 'drizzle-orm';

async function check() {
  // Check blocks table (new import system)
  const blocks = await db.execute(sql`
    SELECT
      b.id,
      b.block_id,
      b.service_date,
      b.solo_type,
      b.tractor_id,
      b.status,
      b.is_rejected_load,
      ba.driver_id,
      d.first_name,
      d.last_name
    FROM blocks b
    LEFT JOIN block_assignments ba ON ba.block_id = b.id AND ba.is_active = true
    LEFT JOIN drivers d ON ba.driver_id = d.id
    WHERE b.service_date >= '2025-12-01'
    ORDER BY b.service_date, b.solo_type
    LIMIT 100
  `);

  console.log(`=== Blocks Table (${blocks.rows.length} rows) ===\n`);

  // Group by contract type
  const solo2Blocks = (blocks.rows as any[]).filter(b => b.solo_type === 'solo2');
  const solo1Blocks = (blocks.rows as any[]).filter(b => b.solo_type === 'solo1');
  const unassignedSolo2 = solo2Blocks.filter(b => !b.driver_id);

  console.log(`Total blocks: ${blocks.rows.length}`);
  console.log(`Solo1: ${solo1Blocks.length}`);
  console.log(`Solo2: ${solo2Blocks.length}`);
  console.log(`Unassigned Solo2: ${unassignedSolo2.length}`);

  console.log('\n=== Unassigned Solo2 Blocks ===');
  for (const b of unassignedSolo2.slice(0, 20)) {
    console.log(`  ${b.service_date} - ${b.block_id} - ${b.solo_type} - Tractor: ${b.tractor_id || 'N/A'} - Status: ${b.status}`);
  }

  // Check date range
  const dateRange = await db.execute(sql`
    SELECT MIN(service_date) as min_date, MAX(service_date) as max_date, COUNT(*) as total
    FROM blocks
  `);
  console.log('\n=== Blocks Date Range ===');
  console.log(dateRange.rows[0]);

  // Check shift_occurrences date range for comparison
  const shiftRange = await db.execute(sql`
    SELECT MIN(service_date) as min_date, MAX(service_date) as max_date, COUNT(*) as total
    FROM shift_occurrences
  `);
  console.log('\n=== Shift Occurrences Date Range ===');
  console.log(shiftRange.rows[0]);
}

check().then(() => process.exit(0)).catch(console.error);
