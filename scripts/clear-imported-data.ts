import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function clearImportedData() {
  console.log('=== Clearing Imported Data for Fresh Training ===\n');

  // Get counts before deletion
  const blockCount = await db.execute(sql`SELECT COUNT(*) as count FROM blocks`);
  const assignmentCount = await db.execute(sql`SELECT COUNT(*) as count FROM block_assignments`);
  const dnaCount = await db.execute(sql`SELECT COUNT(*) as count FROM driver_dna_profiles`);
  const shiftOccCount = await db.execute(sql`SELECT COUNT(*) as count FROM shift_occurrences`);
  const shiftTemplateCount = await db.execute(sql`SELECT COUNT(*) as count FROM shift_templates`);

  // Get date range of blocks to show what we're clearing
  const dateRange = await db.execute(sql`
    SELECT
      MIN(service_date) as earliest,
      MAX(service_date) as latest,
      COUNT(DISTINCT DATE_TRUNC('week', service_date::date)) as weeks
    FROM blocks
  `);

  const range = dateRange.rows[0];
  console.log('Current data counts:');
  console.log(`  Blocks: ${blockCount.rows[0].count}`);
  console.log(`  Block Assignments: ${assignmentCount.rows[0].count}`);
  console.log(`  Driver DNA Profiles: ${dnaCount.rows[0].count}`);
  console.log(`  Shift Occurrences: ${shiftOccCount.rows[0].count}`);
  console.log(`  Shift Templates: ${shiftTemplateCount.rows[0].count}`);

  if (range.earliest) {
    console.log(`\nDate range: ${range.earliest} to ${range.latest}`);
    console.log(`Weeks of data: ${range.weeks}`);
  }

  console.log('\nDeleting data...');

  // Delete in order to respect foreign keys
  // 1. Delete block assignments first (references blocks and drivers)
  await db.execute(sql`DELETE FROM block_assignments`);
  console.log('  ✓ Deleted block_assignments');

  // 2. Delete blocks
  await db.execute(sql`DELETE FROM blocks`);
  console.log('  ✓ Deleted blocks');

  // 3. Delete driver DNA profiles (so they can be rebuilt from fresh data)
  await db.execute(sql`DELETE FROM driver_dna_profiles`);
  console.log('  ✓ Deleted driver_dna_profiles');

  // 4. Delete shift occurrences (old scheduling system)
  await db.execute(sql`DELETE FROM shift_occurrences`);
  console.log('  ✓ Deleted shift_occurrences');

  // 5. Delete shift templates (old scheduling system)
  await db.execute(sql`DELETE FROM shift_templates`);
  console.log('  ✓ Deleted shift_templates');

  // Verify deletion
  const afterBlocks = await db.execute(sql`SELECT COUNT(*) as count FROM blocks`);
  const afterAssignments = await db.execute(sql`SELECT COUNT(*) as count FROM block_assignments`);
  const afterDna = await db.execute(sql`SELECT COUNT(*) as count FROM driver_dna_profiles`);
  const afterShiftOcc = await db.execute(sql`SELECT COUNT(*) as count FROM shift_occurrences`);
  const afterShiftTemp = await db.execute(sql`SELECT COUNT(*) as count FROM shift_templates`);

  console.log('\nAfter deletion:');
  console.log(`  Blocks: ${afterBlocks.rows[0].count}`);
  console.log(`  Block Assignments: ${afterAssignments.rows[0].count}`);
  console.log(`  Driver DNA Profiles: ${afterDna.rows[0].count}`);
  console.log(`  Shift Occurrences: ${afterShiftOcc.rows[0].count}`);
  console.log(`  Shift Templates: ${afterShiftTemp.rows[0].count}`);

  // Keep drivers and contracts intact
  const driverCount = await db.execute(sql`SELECT COUNT(*) as count FROM drivers`);
  const contractCount = await db.execute(sql`SELECT COUNT(*) as count FROM contracts`);

  console.log('\nPreserved data:');
  console.log(`  Drivers: ${driverCount.rows[0].count} (kept)`);
  console.log(`  Contracts: ${contractCount.rows[0].count} (kept)`);

  console.log('\n✓ Database cleared for fresh week-by-week training!');
  console.log('You can now import data one week at a time to train properly.');

  process.exit(0);
}

clearImportedData().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
