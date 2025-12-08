import { db } from './server/db.js';
import { sql } from 'drizzle-orm';
import { format, subWeeks } from 'date-fns';

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_ABBREV: Record<string, string> = {
  sunday: 'Sun', monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed',
  thursday: 'Thu', friday: 'Fri', saturday: 'Sat'
};

// Holy Grail - Solo1 Tractors and their canonical times
const SOLO1_SLOTS = [
  { time: '00:30', tractor: 'Tractor_8' },
  { time: '01:30', tractor: 'Tractor_6' },
  { time: '16:30', tractor: 'Tractor_1' },
  { time: '16:30', tractor: 'Tractor_9' },
  { time: '17:30', tractor: 'Tractor_4' },
  { time: '18:30', tractor: 'Tractor_7' },
  { time: '20:30', tractor: 'Tractor_2' },
  { time: '20:30', tractor: 'Tractor_3' },
  { time: '20:30', tractor: 'Tractor_10' },
  { time: '21:30', tractor: 'Tractor_5' },
];

async function main() {
  const eightWeeksAgo = subWeeks(new Date(), 8);
  const cutoffDate = format(eightWeeksAgo, 'yyyy-MM-dd');

  console.log('=== SOLO1 SLOT OWNERSHIP BY DAY (Last 8 Weeks) ===\n');
  console.log('For each time slot + tractor, showing who worked each day of the week\n');

  for (const slot of SOLO1_SLOTS) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`TIME: ${slot.time} | TRACTOR: ${slot.tractor}`);
    console.log('='.repeat(70));

    // Get all assignments for this specific tractor on Solo1 blocks
    const assignments = await db.execute(sql`
      SELECT
        d.id as driver_id,
        d.first_name,
        d.last_name,
        b.service_date,
        b.solo_type,
        b.tractor_id,
        EXTRACT(DOW FROM b.service_date) as day_of_week
      FROM block_assignments ba
      JOIN blocks b ON ba.block_id = b.id
      JOIN drivers d ON ba.driver_id = d.id
      WHERE ba.is_active = true
      AND b.service_date >= ${cutoffDate}::date
      AND LOWER(b.solo_type) = 'solo1'
      AND b.tractor_id = ${slot.tractor}
      ORDER BY b.service_date
    `);

    // Group by day of week, then by driver
    const dayDriverCounts: Record<string, Record<string, { name: string, count: number, dates: string[] }>> = {};

    for (const dayName of DAY_NAMES) {
      dayDriverCounts[dayName] = {};
    }

    for (const row of assignments.rows as any[]) {
      const driverName = `${row.first_name} ${row.last_name}`;
      const driverId = row.driver_id;
      const serviceDate = new Date(row.service_date);
      const dayIndex = serviceDate.getDay();
      const dayName = DAY_NAMES[dayIndex];
      const dateStr = format(serviceDate, 'MM/dd');

      if (!dayDriverCounts[dayName][driverId]) {
        dayDriverCounts[dayName][driverId] = { name: driverName, count: 0, dates: [] };
      }
      dayDriverCounts[dayName][driverId].count++;
      dayDriverCounts[dayName][driverId].dates.push(dateStr);
    }

    // Print by day
    for (const dayName of DAY_NAMES) {
      const drivers = Object.values(dayDriverCounts[dayName]);
      drivers.sort((a, b) => b.count - a.count);

      console.log(`\n  ${DAY_ABBREV[dayName].toUpperCase()}:`);
      if (drivers.length === 0) {
        console.log('    (no assignments)');
      } else {
        for (const driver of drivers) {
          const pct = Math.round((driver.count / 8) * 100); // 8 weeks
          const bar = '█'.repeat(Math.min(driver.count, 8));
          console.log(`    ${driver.name.padEnd(35)} ${driver.count} shifts (${pct.toString().padStart(3)}%) ${bar}`);
        }
      }
    }

    // Summary: Who OWNS this slot?
    console.log(`\n  SLOT OWNER SUMMARY:`);
    const allDrivers: Record<string, { name: string, totalCount: number, days: string[] }> = {};
    for (const dayName of DAY_NAMES) {
      for (const [driverId, data] of Object.entries(dayDriverCounts[dayName])) {
        if (!allDrivers[driverId]) {
          allDrivers[driverId] = { name: data.name, totalCount: 0, days: [] };
        }
        allDrivers[driverId].totalCount += data.count;
        if (data.count >= 2) { // At least 2 shifts on this day = owns this day
          allDrivers[driverId].days.push(DAY_ABBREV[dayName]);
        }
      }
    }

    const sortedOwners = Object.values(allDrivers).sort((a, b) => b.totalCount - a.totalCount);
    for (const owner of sortedOwners) {
      if (owner.totalCount >= 2) {
        console.log(`    ${owner.name.padEnd(35)} ${owner.totalCount} total | Days: ${owner.days.join(', ') || 'scattered'}`);
      }
    }
  }

  // Now show Brian Worts specifically
  console.log('\n\n');
  console.log('='.repeat(70));
  console.log('BRIAN WORTS - DETAILED PATTERN');
  console.log('='.repeat(70));

  const brianAssignments = await db.execute(sql`
    SELECT
      b.service_date,
      b.solo_type,
      b.tractor_id,
      EXTRACT(DOW FROM b.service_date) as day_of_week
    FROM block_assignments ba
    JOIN blocks b ON ba.block_id = b.id
    JOIN drivers d ON ba.driver_id = d.id
    WHERE ba.is_active = true
    AND b.service_date >= ${cutoffDate}::date
    AND (d.first_name ILIKE '%Brian%' AND d.last_name ILIKE '%Worts%')
    ORDER BY b.service_date
  `);

  console.log('\nAll assignments:');
  const brianByDay: Record<string, string[]> = {};
  for (const dayName of DAY_NAMES) {
    brianByDay[dayName] = [];
  }

  for (const row of brianAssignments.rows as any[]) {
    const serviceDate = new Date(row.service_date);
    const dayIndex = serviceDate.getDay();
    const dayName = DAY_NAMES[dayIndex];
    const dateStr = format(serviceDate, 'yyyy-MM-dd');
    brianByDay[dayName].push(`${dateStr} (${row.tractor_id}, ${row.solo_type})`);
  }

  for (const dayName of DAY_NAMES) {
    console.log(`\n  ${DAY_ABBREV[dayName].toUpperCase()}: ${brianByDay[dayName].length} shifts`);
    for (const shift of brianByDay[dayName]) {
      console.log(`    ${shift}`);
    }
  }

  console.log('\n\nBrian Worts pattern summary:');
  for (const dayName of DAY_NAMES) {
    console.log(`  ${DAY_ABBREV[dayName]}: ${brianByDay[dayName].length} shifts`);
  }

  process.exit(0);
}
main();
