import { db } from './server/db.js';
import { sql } from 'drizzle-orm';

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const CANONICAL_START_TIMES: Record<string, string> = {
  'solo1_Tractor_1': '16:30',
  'solo1_Tractor_2': '20:30',
  'solo1_Tractor_3': '20:30',
  'solo1_Tractor_4': '17:30',
  'solo1_Tractor_5': '21:30',
  'solo1_Tractor_6': '01:30',
  'solo1_Tractor_7': '18:30',
  'solo1_Tractor_8': '00:30',
  'solo1_Tractor_9': '16:30',
  'solo1_Tractor_10': '20:30',
  'solo2_Tractor_1': '18:30',
  'solo2_Tractor_2': '23:30',
  'solo2_Tractor_3': '21:30',
  'solo2_Tractor_4': '08:30',
  'solo2_Tractor_5': '15:30',
  'solo2_Tractor_6': '11:30',
  'solo2_Tractor_7': '16:30',
};

async function main() {
  // Check ALL blocks for this week, including assigned ones
  console.log('=== ALL SATURDAY BLOCKS (Dec 6, 2025) ===\n');

  const saturdayBlocks = await db.execute(sql`
    SELECT
      b.id,
      b.service_date,
      b.solo_type,
      b.tractor_id,
      ba.driver_id,
      d.first_name || ' ' || d.last_name as driver_name
    FROM blocks b
    LEFT JOIN block_assignments ba ON ba.block_id = b.id AND ba.is_active = true
    LEFT JOIN drivers d ON ba.driver_id = d.id
    WHERE b.service_date = '2025-12-06'::date
    ORDER BY b.tractor_id
  `);

  console.log(`Found ${saturdayBlocks.rows.length} Saturday blocks:\n`);

  for (const row of saturdayBlocks.rows as any[]) {
    const soloType = (row.solo_type || 'solo1').toLowerCase();
    const tractorId = row.tractor_id || 'Tractor_1';
    const lookupKey = `${soloType}_${tractorId}`;
    const time = CANONICAL_START_TIMES[lookupKey] || '??:??';
    const status = row.driver_name ? `ASSIGNED to ${row.driver_name}` : 'UNASSIGNED';

    console.log(`  ${tractorId} (${soloType}) - saturday_${time} - ${status}`);
  }

  // Also check: what slots from this week's unassigned match Firas?
  console.log('\n\n=== FIRAS SHOULD GET THESE SLOTS ===\n');

  // Get all unassigned blocks
  const unassignedBlocks = await db.execute(sql`
    SELECT b.id, b.service_date, b.solo_type, b.tractor_id
    FROM blocks b
    LEFT JOIN block_assignments ba ON ba.block_id = b.id AND ba.is_active = true
    WHERE b.service_date >= '2025-11-30'::date
    AND b.service_date <= '2025-12-06'::date
    AND ba.id IS NULL
    ORDER BY b.service_date, b.tractor_id
  `);

  // Firas's slots
  const firasSlots = ['saturday_16:30', 'sunday_16:30', 'monday_16:30', 'sunday_17:30', 'monday_17:30'];

  // Group by day
  const blocksPerDay: Record<string, any[]> = {};

  for (const row of unassignedBlocks.rows as any[]) {
    const serviceDate = new Date(row.service_date);
    const dayName = DAY_NAMES[serviceDate.getDay()];
    const soloType = (row.solo_type || 'solo1').toLowerCase();
    const tractorId = row.tractor_id || 'Tractor_1';
    const lookupKey = `${soloType}_${tractorId}`;
    const time = CANONICAL_START_TIMES[lookupKey] || '??:??';
    const slot = `${dayName}_${time}`;

    if (!blocksPerDay[dayName]) blocksPerDay[dayName] = [];

    if (firasSlots.includes(slot)) {
      blocksPerDay[dayName].push({ ...row, slot, time });
    }
  }

  for (const day of ['saturday', 'sunday', 'monday']) {
    const blocks = blocksPerDay[day] || [];
    console.log(`${day.toUpperCase()}: ${blocks.length} blocks Firas could work`);
    for (const b of blocks) {
      console.log(`  - ${b.slot} (${b.tractor_id})`);
    }
  }

  process.exit(0);
}

main();
