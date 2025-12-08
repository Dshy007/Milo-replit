/**
 * Debug script to understand why Solo2 blocks aren't matching correctly
 */

import { db } from "./server/db";
import { sql } from "drizzle-orm";

async function debugSolo2Matching() {
  console.log("=== SOLO2 MATCHING DEBUG ===\n");

  // 1. Get all Solo2 drivers with their DNA profiles
  const solo2Drivers = await db.execute(sql`
    SELECT
      d.id,
      d.first_name,
      d.last_name,
      dna.preferred_days,
      dna.preferred_start_times,
      dna.preferred_contract_type,
      dna.pattern_group
    FROM drivers d
    LEFT JOIN driver_dna_profiles dna ON d.id = dna.driver_id
    WHERE dna.preferred_contract_type = 'solo2'
    AND d.status = 'active'
    AND d.load_eligible = true
    ORDER BY d.last_name
  `);

  console.log(`Found ${solo2Drivers.rows.length} active Solo2 drivers:\n`);

  for (const driver of solo2Drivers.rows as any[]) {
    const days = driver.preferred_days || [];
    const times = driver.preferred_start_times || [];
    console.log(`  ${driver.first_name} ${driver.last_name}:`);
    console.log(`    Days: ${days.length > 0 ? days.join(', ') : 'NONE'}`);
    console.log(`    Times: ${times.length > 0 ? times.join(', ') : 'NONE'}`);
    console.log(`    Pattern: ${driver.pattern_group || 'N/A'}`);
    console.log();
  }

  // 2. Get unassigned Solo2 blocks for current/next week
  const unassignedBlocks = await db.execute(sql`
    SELECT
      so.id as occurrence_id,
      so.service_date,
      st.canonical_start_time as start_time,
      so.external_block_id as block_id,
      st.solo_type as contract_type,
      ba.driver_id
    FROM shift_occurrences so
    JOIN shift_templates st ON so.template_id = st.id
    LEFT JOIN block_assignments ba ON ba.shift_occurrence_id = so.id AND ba.is_active = true
    WHERE st.solo_type = 'solo2'
    AND ba.driver_id IS NULL
    AND so.status != 'rejected'
    AND so.service_date >= CURRENT_DATE
    AND so.service_date <= CURRENT_DATE + INTERVAL '14 days'
    ORDER BY so.service_date, st.canonical_start_time
  `);

  console.log(`\nFound ${unassignedBlocks.rows.length} unassigned Solo2 blocks:\n`);

  // Group by day of week
  const blocksByDay: Record<string, any[]> = {};
  const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

  for (const block of unassignedBlocks.rows as any[]) {
    const date = new Date(block.service_date + 'T00:00:00');
    const dayOfWeek = DAYS[date.getDay()];
    if (!blocksByDay[dayOfWeek]) blocksByDay[dayOfWeek] = [];
    blocksByDay[dayOfWeek].push(block);
  }

  for (const day of DAYS) {
    const blocks = blocksByDay[day] || [];
    if (blocks.length > 0) {
      console.log(`  ${day.toUpperCase()}: ${blocks.length} blocks`);
      for (const b of blocks.slice(0, 3)) {
        console.log(`    - ${b.block_id} @ ${b.start_time} (${b.service_date})`);
      }
      if (blocks.length > 3) console.log(`    ... and ${blocks.length - 3} more`);
    }
  }

  // 3. Check for matching issues
  console.log("\n=== MATCHING ANALYSIS ===\n");

  // Count drivers by preferred days
  const driversByDay: Record<string, number> = {};
  for (const driver of solo2Drivers.rows as any[]) {
    const days = driver.preferred_days || [];
    for (const day of days) {
      driversByDay[day] = (driversByDay[day] || 0) + 1;
    }
  }

  console.log("Solo2 drivers available by day:");
  for (const day of DAYS) {
    const driverCount = driversByDay[day] || 0;
    const blockCount = (blocksByDay[day] || []).length;
    const coverage = blockCount > 0 ? Math.round((driverCount / blockCount) * 100) : 0;
    console.log(`  ${day}: ${driverCount} drivers, ${blockCount} blocks (${coverage}% coverage)`);
  }

  // 4. Check drivers with empty preferences
  const emptyPrefs = (solo2Drivers.rows as any[]).filter(d =>
    !d.preferred_days?.length || !d.preferred_start_times?.length
  );

  if (emptyPrefs.length > 0) {
    console.log(`\n⚠️  ${emptyPrefs.length} Solo2 drivers have EMPTY preferences (won't match anything):`);
    for (const d of emptyPrefs) {
      console.log(`  - ${d.first_name} ${d.last_name}: days=${d.preferred_days?.length || 0}, times=${d.preferred_start_times?.length || 0}`);
    }
  }

  // 5. Check time mismatches
  console.log("\n=== TIME ANALYSIS ===\n");

  // Get unique block times
  const blockTimes = new Set<string>();
  for (const block of unassignedBlocks.rows as any[]) {
    blockTimes.add(block.start_time);
  }
  console.log(`Unassigned block times: ${Array.from(blockTimes).sort().join(', ')}`);

  // Get unique driver preferred times
  const driverTimes = new Set<string>();
  for (const driver of solo2Drivers.rows as any[]) {
    for (const time of (driver.preferred_start_times || [])) {
      driverTimes.add(time);
    }
  }
  console.log(`Driver preferred times: ${Array.from(driverTimes).sort().join(', ')}`);

  // Find times with no driver coverage
  const uncoveredTimes = Array.from(blockTimes).filter(t => !driverTimes.has(t));
  if (uncoveredTimes.length > 0) {
    console.log(`\n⚠️  Block times with NO driver preference: ${uncoveredTimes.join(', ')}`);
  }

  // 6. Simulate matching for a specific driver (Mathew William Ivy)
  const mathew = (solo2Drivers.rows as any[]).find(d =>
    d.first_name === 'Mathew' && d.last_name?.includes('Ivy')
  );

  if (mathew) {
    console.log(`\n=== MATHEW WILLIAM IVY ANALYSIS ===`);
    console.log(`Preferred days: ${mathew.preferred_days?.join(', ')}`);
    console.log(`Preferred times: ${mathew.preferred_start_times?.join(', ')}`);

    // Find blocks that should match
    const matchingBlocks = (unassignedBlocks.rows as any[]).filter(block => {
      const date = new Date(block.service_date + 'T00:00:00');
      const dayOfWeek = DAYS[date.getDay()];
      return mathew.preferred_days?.includes(dayOfWeek);
    });

    console.log(`\nBlocks on Mathew's preferred days: ${matchingBlocks.length}`);
    for (const b of matchingBlocks.slice(0, 5)) {
      const date = new Date(b.service_date + 'T00:00:00');
      const dayOfWeek = DAYS[date.getDay()];
      const timeMatch = mathew.preferred_start_times?.includes(b.start_time) ? '✅' : '❌';
      console.log(`  ${dayOfWeek} ${b.service_date} @ ${b.start_time} ${timeMatch}`);
    }
  }

  process.exit(0);
}

debugSolo2Matching().catch(console.error);
