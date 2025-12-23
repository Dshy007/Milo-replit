import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function checkDbState() {
  console.log('=== Database State Check ===\n');

  // Check blocks - first get column names
  const columns = await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'blocks'
    ORDER BY ordinal_position
  `);
  console.log('Block table columns:', columns.rows.map((r: any) => r.column_name).join(', '));

  // Check blocks with actual column names
  const blocks = await db.execute(sql`
    SELECT *
    FROM blocks
    ORDER BY service_date DESC
    LIMIT 20
  `);
  console.log(`Blocks in database: ${blocks.rows.length}`);
  if (blocks.rows.length > 0) {
    console.log('Recent blocks:');
    for (const row of blocks.rows as any[]) {
      console.log(`  ${row.block_id} | ${row.service_date} | ${row.solo_type || row.contractType} | ${row.tractor_id}`);
    }
  }

  // Check block_assignments
  const assignments = await db.execute(sql`
    SELECT id, block_id, driver_id, is_active
    FROM block_assignments
    LIMIT 20
  `);
  console.log(`\nBlock assignments in database: ${assignments.rows.length}`);

  // Check all tables with counts
  const tables = ['blocks', 'block_assignments', 'driver_dna_profiles', 'drivers', 'contracts', 'shift_occurrences', 'shift_templates'];
  console.log('\n=== Table Counts ===');
  for (const table of tables) {
    try {
      const result = await db.execute(sql.raw(`SELECT COUNT(*) as count FROM ${table}`));
      console.log(`  ${table}: ${result.rows[0].count}`);
    } catch (e) {
      console.log(`  ${table}: ERROR`);
    }
  }

  // Check date range if blocks exist
  const dateRange = await db.execute(sql`
    SELECT
      MIN(service_date) as earliest,
      MAX(service_date) as latest
    FROM blocks
  `);
  if (dateRange.rows[0].earliest) {
    console.log(`\nBlock date range: ${dateRange.rows[0].earliest} to ${dateRange.rows[0].latest}`);
  } else {
    console.log('\nNo blocks in database - date range is empty');
  }

  process.exit(0);
}

checkDbState().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
