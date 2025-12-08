import { db } from './server/db.js';
import { sql } from 'drizzle-orm';
import { format, subWeeks } from 'date-fns';

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// Solo2 canonical times from Holy Grail
const CANONICAL_START_TIMES: Record<string, string> = {
  "solo2_Tractor_1": "18:30",
  "solo2_Tractor_2": "23:30",
  "solo2_Tractor_3": "21:30",
  "solo2_Tractor_4": "08:30",
  "solo2_Tractor_5": "15:30",
  "solo2_Tractor_6": "11:30",
  "solo2_Tractor_7": "16:30",
};

async function main() {
  const eightWeeksAgo = subWeeks(new Date(), 8);
  const cutoffDate = format(eightWeeksAgo, 'yyyy-MM-dd');

  // Get all Solo2 assignments from last 8 weeks
  const assignments = await db.execute(sql`
    SELECT
      d.id as driver_id,
      d.first_name || ' ' || d.last_name as driver_name,
      b.service_date,
      b.solo_type,
      b.tractor_id
    FROM block_assignments ba
    JOIN blocks b ON ba.block_id = b.id
    JOIN drivers d ON ba.driver_id = d.id
    WHERE ba.is_active = true
    AND b.service_date >= ${cutoffDate}::date
    AND LOWER(b.solo_type) = 'solo2'
    ORDER BY b.service_date
  `);

  console.log('=== SOLO2 COVERAGE ANALYSIS (Last 8 Weeks) ===\n');
  console.log(`Found ${assignments.rows.length} Solo2 assignments\n`);

  // Group by slot (day + time)
  const slotCoverage: Record<string, Set<string>> = {};

  for (const row of assignments.rows as any[]) {
    const serviceDate = new Date(row.service_date);
    const dayName = DAY_NAMES[serviceDate.getDay()];
    const tractorId = row.tractor_id || 'Unknown';
    const soloType = (row.solo_type || 'solo2').toLowerCase();
    const lookupKey = `${soloType}_${tractorId}`;
    const startTime = CANONICAL_START_TIMES[lookupKey] || 'unknown';
    const slot = `${dayName}_${startTime}`;

    if (!slotCoverage[slot]) {
      slotCoverage[slot] = new Set();
    }
    slotCoverage[slot].add(row.driver_name);
  }

  // The problem slots from the optimizer
  const problemSlots = [
    'sunday_21:30', 'sunday_15:30', 'sunday_18:30', 'sunday_16:30',
    'monday_08:30', 'monday_11:30',
    'tuesday_16:30', 'tuesday_15:30', 'tuesday_18:30', 'tuesday_21:30'
  ];

  console.log('=== PROBLEM SLOTS - WHO COVERS THEM? ===\n');

  for (const slot of problemSlots) {
    const drivers = slotCoverage[slot];
    if (drivers && drivers.size > 0) {
      console.log(`${slot}: ${Array.from(drivers).join(', ')}`);
    } else {
      console.log(`${slot}: NO COVERAGE IN LAST 8 WEEKS`);
    }
  }

  console.log('\n\n=== ALL SOLO2 SLOTS WITH COVERAGE ===\n');

  const sortedSlots = Object.keys(slotCoverage).sort((a, b) => {
    const dayOrder = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const [dayA, timeA] = a.split('_');
    const [dayB, timeB] = b.split('_');
    const dayDiff = dayOrder.indexOf(dayA) - dayOrder.indexOf(dayB);
    if (dayDiff !== 0) return dayDiff;
    return timeA.localeCompare(timeB);
  });

  for (const slot of sortedSlots) {
    const drivers = slotCoverage[slot];
    console.log(`${slot.padEnd(18)}: ${Array.from(drivers).join(', ')}`);
  }

  // Show driver preferences vs reality
  console.log('\n\n=== SOLO2 DRIVER WORK PATTERNS ===\n');

  const driverPatterns: Record<string, { days: Set<string>, times: Set<string>, count: number }> = {};

  for (const row of assignments.rows as any[]) {
    const driverName = row.driver_name;
    const serviceDate = new Date(row.service_date);
    const dayName = DAY_NAMES[serviceDate.getDay()];
    const tractorId = row.tractor_id || 'Unknown';
    const soloType = (row.solo_type || 'solo2').toLowerCase();
    const lookupKey = `${soloType}_${tractorId}`;
    const startTime = CANONICAL_START_TIMES[lookupKey] || 'unknown';

    if (!driverPatterns[driverName]) {
      driverPatterns[driverName] = { days: new Set(), times: new Set(), count: 0 };
    }
    driverPatterns[driverName].days.add(dayName);
    driverPatterns[driverName].times.add(startTime);
    driverPatterns[driverName].count++;
  }

  for (const [driver, pattern] of Object.entries(driverPatterns).sort((a, b) => b[1].count - a[1].count)) {
    const days = Array.from(pattern.days).sort((a, b) =>
      DAY_NAMES.indexOf(a) - DAY_NAMES.indexOf(b)
    );
    const times = Array.from(pattern.times).sort();
    console.log(`${driver}:`);
    console.log(`  Days: ${days.join(', ')}`);
    console.log(`  Times: ${times.join(', ')}`);
    console.log(`  Shifts: ${pattern.count}`);
    console.log('');
  }

  process.exit(0);
}

main();
