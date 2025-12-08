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
  // Get driver ID for Firas and Isaac
  const driverIds = await db.execute(sql`
    SELECT id, first_name, last_name
    FROM drivers
    WHERE first_name ILIKE '%firas%' OR first_name ILIKE '%isaac%'
  `);

  console.log('=== DRIVER IDs ===');
  for (const row of driverIds.rows as any[]) {
    console.log(`${row.first_name} ${row.last_name}: ${row.id}`);
  }

  // Get all assignments from last 8 weeks with driver IDs
  const allAssignments = await db.execute(sql`
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
    ORDER BY b.service_date
  `);

  // Build slot history using DRIVER IDs (like the real optimizer)
  const slotHistory: Record<string, Record<string, number>> = {};
  const idToName: Record<string, string> = {};

  for (const row of allAssignments.rows as any[]) {
    const serviceDate = new Date(row.service_date);
    const dayName = DAY_NAMES[serviceDate.getDay()];
    const soloType = (row.solo_type || 'solo1').toLowerCase();
    const tractorId = row.tractor_id || 'Tractor_1';
    const lookupKey = `${soloType}_${tractorId}`;
    const time = CANONICAL_START_TIMES[lookupKey] || '??:??';
    const slot = `${dayName}_${time}`;

    if (!slotHistory[slot]) slotHistory[slot] = {};
    slotHistory[slot][row.driver_id] = (slotHistory[slot][row.driver_id] || 0) + 1;
    idToName[row.driver_id] = row.driver_name;
  }

  // Look at monday_16:30 specifically
  console.log('\n=== monday_16:30 slot history (by driver ID) ===');
  const mondaySlot = slotHistory['monday_16:30'] || {};
  const sortedMonday = Object.entries(mondaySlot).sort((a, b) => b[1] - a[1]);

  for (const [driverId, count] of sortedMonday) {
    console.log(`  ${driverId}: ${count} times (${idToName[driverId]})`);
  }

  console.log('\n=== After Python sort by -count ===');
  console.log('Python sorted() with key=lambda x: -x[1] is STABLE');
  console.log('So equal counts preserve original dict order');
  console.log('Dict order in Python 3.7+ is insertion order');
  console.log('');
  console.log('The REAL optimizer passes this from TypeScript...');
  console.log('TypeScript Object iteration order is: string keys in creation order');

  process.exit(0);
}

main();
