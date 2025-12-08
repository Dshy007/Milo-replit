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
  // Find Firas's 8-week history
  const firasHistory = await db.execute(sql`
    SELECT
      b.service_date,
      b.solo_type,
      b.tractor_id,
      d.first_name || ' ' || d.last_name as driver_name,
      d.id as driver_id
    FROM block_assignments ba
    JOIN blocks b ON ba.block_id = b.id
    JOIN drivers d ON ba.driver_id = d.id
    WHERE ba.is_active = true
    AND b.service_date >= CURRENT_DATE - INTERVAL '56 days'
    AND (d.first_name ILIKE '%firas%' OR d.last_name ILIKE '%firas%')
    ORDER BY b.service_date
  `);

  console.log('=== FIRAS 8-WEEK HISTORY ===');
  console.log('Total assignments:', firasHistory.rows.length);

  // Group by day of week
  const dayPattern: Record<string, number> = {};
  const slotPattern: Record<string, number> = {};

  for (const row of firasHistory.rows as any[]) {
    const serviceDate = new Date(row.service_date);
    const dayName = DAY_NAMES[serviceDate.getDay()];
    const soloType = (row.solo_type || 'solo1').toLowerCase();
    const tractorId = row.tractor_id || 'Tractor_1';
    const lookupKey = `${soloType}_${tractorId}`;
    const time = CANONICAL_START_TIMES[lookupKey] || '??:??';
    const slot = `${dayName}_${time}`;

    dayPattern[dayName] = (dayPattern[dayName] || 0) + 1;
    slotPattern[slot] = (slotPattern[slot] || 0) + 1;

    console.log(`  ${row.service_date} (${dayName}) - ${slot}`);
  }

  console.log('\nDays worked:');
  for (const [day, count] of Object.entries(dayPattern).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${day}: ${count} times`);
  }

  console.log('\nSlots worked:');
  for (const [slot, count] of Object.entries(slotPattern).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${slot}: ${count} times`);
  }

  // Now check: what slots does this week have that match Firas's pattern?
  console.log('\n\n=== THIS WEEK BLOCKS MATCHING FIRAS SLOTS ===');

  const thisWeekBlocks = await db.execute(sql`
    SELECT b.id, b.service_date, b.solo_type, b.tractor_id
    FROM blocks b
    LEFT JOIN block_assignments ba ON ba.block_id = b.id AND ba.is_active = true
    WHERE b.service_date >= '2025-11-30'::date
    AND b.service_date <= '2025-12-06'::date
    AND ba.id IS NULL
    ORDER BY b.service_date
  `);

  for (const row of thisWeekBlocks.rows as any[]) {
    const serviceDate = new Date(row.service_date);
    const dayName = DAY_NAMES[serviceDate.getDay()];
    const soloType = (row.solo_type || 'solo1').toLowerCase();
    const tractorId = row.tractor_id || 'Tractor_1';
    const lookupKey = `${soloType}_${tractorId}`;
    const time = CANONICAL_START_TIMES[lookupKey] || '??:??';
    const slot = `${dayName}_${time}`;

    if (slotPattern[slot]) {
      console.log(`  MATCH: ${row.id} - ${slot} (Firas worked this ${slotPattern[slot]} times)`);
    }
  }

  process.exit(0);
}

main();
