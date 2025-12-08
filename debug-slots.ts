import { db } from './server/db.js';
import { sql } from 'drizzle-orm';

const CANONICAL_START_TIMES: Record<string, string> = {
  "solo1_Tractor_1": "16:30",
  "solo1_Tractor_2": "20:30",
  "solo1_Tractor_3": "20:30",
  "solo1_Tractor_4": "17:30",
  "solo1_Tractor_5": "21:30",
  "solo1_Tractor_6": "01:30",
  "solo1_Tractor_7": "18:30",
  "solo1_Tractor_8": "00:30",
  "solo1_Tractor_9": "16:30",
  "solo1_Tractor_10": "20:30",
  "solo2_Tractor_1": "18:30",
  "solo2_Tractor_2": "23:30",
  "solo2_Tractor_3": "21:30",
  "solo2_Tractor_4": "08:30",
  "solo2_Tractor_5": "15:30",
  "solo2_Tractor_6": "11:30",
  "solo2_Tractor_7": "16:30",
};

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

async function main() {
  // Get THIS week's unassigned blocks (Nov 30 - Dec 6)
  const thisWeekBlocks = await db.execute(sql`
    SELECT b.id, b.service_date, b.solo_type, b.tractor_id
    FROM blocks b
    LEFT JOIN block_assignments ba ON ba.block_id = b.id AND ba.is_active = true
    WHERE b.service_date >= '2025-11-30'::date
    AND b.service_date <= '2025-12-06'::date
    AND ba.id IS NULL
    ORDER BY b.service_date
  `);

  // Get LAST week's assignments (Nov 23 - Nov 29)
  const lastWeekAssignments = await db.execute(sql`
    SELECT b.service_date, b.solo_type, b.tractor_id, d.first_name || ' ' || d.last_name as driver_name
    FROM block_assignments ba
    JOIN blocks b ON ba.block_id = b.id
    JOIN drivers d ON ba.driver_id = d.id
    WHERE ba.is_active = true
    AND b.service_date >= '2025-11-23'::date
    AND b.service_date <= '2025-11-29'::date
    ORDER BY b.service_date
  `);

  console.log('=== THIS WEEK UNASSIGNED BLOCKS (Nov 30 - Dec 6) ===\n');

  // Group this week by slot
  const thisWeekSlots: Record<string, number> = {};
  for (const row of thisWeekBlocks.rows as any[]) {
    const serviceDate = new Date(row.service_date);
    const dayName = DAY_NAMES[serviceDate.getDay()];
    const soloType = (row.solo_type || 'solo1').toLowerCase();
    const tractorId = row.tractor_id || 'Tractor_1';
    const lookupKey = `${soloType}_${tractorId}`;
    const time = CANONICAL_START_TIMES[lookupKey] || '??:??';
    const slot = `${dayName}_${time}`;
    thisWeekSlots[slot] = (thisWeekSlots[slot] || 0) + 1;
  }

  const sortedThisWeek = Object.entries(thisWeekSlots).sort((a, b) => a[0].localeCompare(b[0]));
  console.log(`Total: ${thisWeekBlocks.rows.length} unassigned blocks\n`);
  for (const [slot, count] of sortedThisWeek) {
    console.log(`  ${slot.padEnd(20)}: ${count} blocks`);
  }

  console.log('\n\n=== LAST WEEK ASSIGNMENTS (Nov 23 - Nov 29) ===\n');

  // Group last week by slot
  const lastWeekSlots: Record<string, string[]> = {};
  for (const row of lastWeekAssignments.rows as any[]) {
    const serviceDate = new Date(row.service_date);
    const dayName = DAY_NAMES[serviceDate.getDay()];
    const soloType = (row.solo_type || 'solo1').toLowerCase();
    const tractorId = row.tractor_id || 'Tractor_1';
    const lookupKey = `${soloType}_${tractorId}`;
    const time = CANONICAL_START_TIMES[lookupKey] || '??:??';
    const slot = `${dayName}_${time}`;
    if (!lastWeekSlots[slot]) lastWeekSlots[slot] = [];
    lastWeekSlots[slot].push(row.driver_name);
  }

  const sortedLastWeek = Object.entries(lastWeekSlots).sort((a, b) => a[0].localeCompare(b[0]));
  console.log(`Total: ${lastWeekAssignments.rows.length} assignments\n`);
  for (const [slot, drivers] of sortedLastWeek) {
    console.log(`  ${slot.padEnd(20)}: ${drivers.join(', ')}`);
  }

  console.log('\n\n=== COMPARISON ===\n');

  // Find slots in this week that have NO last week assignment
  const unmatchedThisWeek: string[] = [];
  for (const slot of Object.keys(thisWeekSlots)) {
    if (!lastWeekSlots[slot]) {
      unmatchedThisWeek.push(slot);
    }
  }

  // Find slots in last week that have NO this week blocks
  const unmatchedLastWeek: string[] = [];
  for (const slot of Object.keys(lastWeekSlots)) {
    if (!thisWeekSlots[slot]) {
      unmatchedLastWeek.push(slot);
    }
  }

  console.log('This week slots with NO last week driver:');
  for (const slot of unmatchedThisWeek.sort()) {
    console.log(`  ${slot} (${thisWeekSlots[slot]} blocks)`);
  }

  console.log('\nLast week drivers with NO this week blocks:');
  for (const slot of unmatchedLastWeek.sort()) {
    console.log(`  ${slot}: ${lastWeekSlots[slot].join(', ')}`);
  }

  process.exit(0);
}

main();
