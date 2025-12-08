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
  // Get all assignments from last 8 weeks
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

  // Build slot history
  const slotHistory: Record<string, Record<string, number>> = {};

  for (const row of allAssignments.rows as any[]) {
    const serviceDate = new Date(row.service_date);
    const dayName = DAY_NAMES[serviceDate.getDay()];
    const soloType = (row.solo_type || 'solo1').toLowerCase();
    const tractorId = row.tractor_id || 'Tractor_1';
    const lookupKey = `${soloType}_${tractorId}`;
    const time = CANONICAL_START_TIMES[lookupKey] || '??:??';
    const slot = `${dayName}_${time}`;

    if (!slotHistory[slot]) slotHistory[slot] = {};
    slotHistory[slot][row.driver_name] = (slotHistory[slot][row.driver_name] || 0) + 1;
  }

  // Firas's key slots
  const firasSlots = ['sunday_16:30', 'monday_16:30', 'sunday_17:30', 'monday_17:30'];

  console.log('=== WHO COMPETES WITH FIRAS FOR HIS SLOTS? ===\n');

  for (const slot of firasSlots) {
    const drivers = slotHistory[slot] || {};
    const sorted = Object.entries(drivers).sort((a, b) => b[1] - a[1]);

    console.log(`${slot}:`);
    for (const [driver, count] of sorted) {
      const isFiras = driver.toLowerCase().includes('firas') ? ' <-- FIRAS' : '';
      console.log(`  ${driver}: ${count} times${isFiras}`);
    }
    console.log('');
  }

  // Now simulate: If optimizer processes in certain order, who gets what?
  console.log('\n=== SIMULATION: Who gets assigned first? ===\n');
  console.log('The optimizer processes slots in alphabetical order.');
  console.log('For each slot, the driver with HIGHEST count wins.\n');

  const allSlots = Object.keys(slotHistory).sort();
  const assignedDriversPerDay: Record<string, Set<string>> = {};

  for (const slot of allSlots) {
    const [dayName] = slot.split('_');
    if (!assignedDriversPerDay[dayName]) assignedDriversPerDay[dayName] = new Set();

    const drivers = slotHistory[slot] || {};
    const sorted = Object.entries(drivers).sort((a, b) => b[1] - a[1]);

    // Find first driver not already assigned today
    let winner = null;
    for (const [driver, count] of sorted) {
      if (!assignedDriversPerDay[dayName].has(driver)) {
        winner = { driver, count };
        assignedDriversPerDay[dayName].add(driver);
        break;
      }
    }

    if (winner && firasSlots.includes(slot)) {
      const isFiras = winner.driver.toLowerCase().includes('firas') ? ' <-- FIRAS WINS!' : '';
      console.log(`${slot}: ${winner.driver} (${winner.count} times)${isFiras}`);
    }
  }

  // Show all of Firas's wins
  console.log('\n=== FULL SIMULATION: All assignments ===\n');

  const assignedDriversPerDay2: Record<string, Set<string>> = {};
  const firasWins: string[] = [];
  const firasLosses: string[] = [];

  for (const slot of allSlots) {
    const [dayName] = slot.split('_');
    if (!assignedDriversPerDay2[dayName]) assignedDriversPerDay2[dayName] = new Set();

    const drivers = slotHistory[slot] || {};
    const sorted = Object.entries(drivers).sort((a, b) => b[1] - a[1]);

    for (const [driver, count] of sorted) {
      if (!assignedDriversPerDay2[dayName].has(driver)) {
        assignedDriversPerDay2[dayName].add(driver);

        if (driver.toLowerCase().includes('firas')) {
          firasWins.push(slot);
        }
        break;
      }
    }

    // Check if Firas is in this slot but didn't win
    const firasInSlot = sorted.find(([d]) => d.toLowerCase().includes('firas'));
    if (firasInSlot && !firasWins.includes(slot)) {
      if (assignedDriversPerDay2[dayName].has('Firas IMAD Tahseen') ||
          [...assignedDriversPerDay2[dayName]].some(d => d.toLowerCase().includes('firas'))) {
        // Firas already assigned today
      } else {
        // Firas lost to someone else
        const winner = sorted[0][0];
        if (!winner.toLowerCase().includes('firas')) {
          firasLosses.push(`${slot} (lost to ${winner} with ${sorted[0][1]} vs Firas's ${firasInSlot[1]})`);
        }
      }
    }
  }

  console.log('Firas WINS these slots:', firasWins.join(', ') || 'NONE');
  console.log('\nFiras LOSES these slots:');
  for (const loss of firasLosses) {
    console.log(`  ${loss}`);
  }

  process.exit(0);
}

main();
