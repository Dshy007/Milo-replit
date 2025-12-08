import { db } from './server/db';
import { sql } from 'drizzle-orm';

async function analyze() {
  // Get all Solo2 block times in the system
  const blockTimes = await db.execute(sql`
    SELECT DISTINCT st.canonical_start_time
    FROM shift_templates st
    WHERE st.solo_type = 'solo2'
    ORDER BY st.canonical_start_time
  `);

  console.log('=== Solo2 Block Times in System ===');
  for (const row of blockTimes.rows as any[]) {
    console.log(`  ${row.canonical_start_time}`);
  }

  // Get all Solo2 driver preferred times
  const driverTimes = await db.execute(sql`
    SELECT
      d.first_name,
      d.last_name,
      dna.preferred_days,
      dna.preferred_start_times
    FROM drivers d
    JOIN driver_dna_profiles dna ON d.id = dna.driver_id
    WHERE dna.preferred_contract_type = 'solo2'
    AND d.status = 'active'
    ORDER BY d.last_name
  `);

  console.log('\n=== Solo2 Driver Preferred Times ===');
  const allDriverTimes = new Set<string>();
  for (const row of driverTimes.rows as any[]) {
    const times = row.preferred_start_times || [];
    console.log(`  ${row.first_name} ${row.last_name}: ${times.join(', ') || 'NONE'} (days: ${(row.preferred_days || []).join(', ')})`);
    for (const t of times) {
      allDriverTimes.add(t);
    }
  }

  // Find mismatches
  const blockTimesSet = new Set((blockTimes.rows as any[]).map(r => r.canonical_start_time));

  console.log('\n=== ANALYSIS ===');
  console.log('Block times available:', Array.from(blockTimesSet).sort().join(', '));
  console.log('Driver preferred times:', Array.from(allDriverTimes).sort().join(', '));

  const uncoveredBlockTimes = Array.from(blockTimesSet).filter(t => !allDriverTimes.has(t));
  const unusedDriverTimes = Array.from(allDriverTimes).filter(t => !blockTimesSet.has(t));

  if (uncoveredBlockTimes.length > 0) {
    console.log('\n⚠️  Block times with NO driver preferences:', uncoveredBlockTimes.join(', '));
  }
  if (unusedDriverTimes.length > 0) {
    console.log('\n⚠️  Driver times that don\'t match any blocks:', unusedDriverTimes.join(', '));
  }

  // Count how many drivers can work each block time
  console.log('\n=== DRIVER COVERAGE BY TIME SLOT ===');
  for (const blockTime of Array.from(blockTimesSet).sort()) {
    const driversForTime = (driverTimes.rows as any[]).filter(d =>
      (d.preferred_start_times || []).includes(blockTime)
    );
    console.log(`  ${blockTime}: ${driversForTime.length} drivers`);
    if (driversForTime.length > 0) {
      for (const d of driversForTime.slice(0, 3)) {
        console.log(`    - ${d.first_name} ${d.last_name}`);
      }
      if (driversForTime.length > 3) console.log(`    ... and ${driversForTime.length - 3} more`);
    }
  }
}

analyze().then(() => process.exit(0)).catch(console.error);
