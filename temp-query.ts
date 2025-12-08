import { db } from './server/db.js';
import { sql } from 'drizzle-orm';
import { format, subWeeks, startOfWeek, endOfWeek } from 'date-fns';
import { blocks, blockAssignments, drivers, driverDnaProfiles } from './shared/schema.js';
import { and, eq, gte, lte } from 'drizzle-orm';

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_ABBREV: Record<string, string> = {
  sunday: 'Sun', monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed',
  thursday: 'Thu', friday: 'Fri', saturday: 'Sat'
};

const CANONICAL_START_TIMES: Record<string, string> = {
  // Solo1 (10 tractors)
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
  // Solo2 (7 tractors)
  "solo2_Tractor_1": "18:30",
  "solo2_Tractor_2": "23:30",
  "solo2_Tractor_3": "21:30",
  "solo2_Tractor_4": "08:30",
  "solo2_Tractor_5": "15:30",
  "solo2_Tractor_6": "11:30",
  "solo2_Tractor_7": "16:30",
};

// RULE: Maximum 6 days per driver per week
const MAX_DAYS_PER_WEEK = 6;

// Unassigned Solo1 blocks from the CSV (Dec 7-13)
const UNASSIGNED_BLOCKS = [
  { id: 'B-8ZW9KFF6V', date: '2025-12-07', day: 'sunday', time: '16:30', tractor: 'Tractor_9' },
  { id: 'B-S1RJ3LQM1', date: '2025-12-07', day: 'sunday', time: '16:30', tractor: 'Tractor_1' },
  { id: 'B-5TDZCKJHN', date: '2025-12-07', day: 'sunday', time: '17:30', tractor: 'Tractor_4' },
  { id: 'B-K4LR2L6FX', date: '2025-12-07', day: 'sunday', time: '18:30', tractor: 'Tractor_7' },
  { id: 'B-27KWNM3FL', date: '2025-12-07', day: 'sunday', time: '20:30', tractor: 'Tractor_3' },
  { id: 'B-34MVG43VK', date: '2025-12-07', day: 'sunday', time: '20:30', tractor: 'Tractor_10' },
  { id: 'B-40NJQ49DF', date: '2025-12-07', day: 'sunday', time: '20:30', tractor: 'Tractor_2' },
  { id: 'B-RH0H6CD7P', date: '2025-12-07', day: 'sunday', time: '21:30', tractor: 'Tractor_5' },
  { id: 'B-79N9T02C4', date: '2025-12-08', day: 'monday', time: '00:30', tractor: 'Tractor_8' },
  { id: 'B-85P19GJBX', date: '2025-12-08', day: 'monday', time: '01:30', tractor: 'Tractor_6' },
  { id: 'B-L5MV4F68P', date: '2025-12-08', day: 'monday', time: '16:30', tractor: 'Tractor_1' },
  { id: 'B-PG4K034GW', date: '2025-12-08', day: 'monday', time: '16:30', tractor: 'Tractor_9' },
  { id: 'B-50LRHJ37D', date: '2025-12-08', day: 'monday', time: '17:30', tractor: 'Tractor_4' },
  { id: 'B-1P2TR4VWT', date: '2025-12-08', day: 'monday', time: '18:30', tractor: 'Tractor_7' },
  { id: 'B-JKKTW20B8', date: '2025-12-08', day: 'monday', time: '20:30', tractor: 'Tractor_3' },
  { id: 'B-MBGNQWCLX', date: '2025-12-08', day: 'monday', time: '20:30', tractor: 'Tractor_10' },
  { id: 'B-B1LLTDCRS', date: '2025-12-08', day: 'monday', time: '20:30', tractor: 'Tractor_2' },
  { id: 'B-T4W43ZLNM', date: '2025-12-09', day: 'tuesday', time: '00:30', tractor: 'Tractor_8' },
  { id: 'B-MRWLKHNZ5', date: '2025-12-09', day: 'tuesday', time: '01:30', tractor: 'Tractor_6' },
  { id: 'B-84W75TKW6', date: '2025-12-09', day: 'tuesday', time: '16:30', tractor: 'Tractor_9' },
  { id: 'B-0Q32PWKL0', date: '2025-12-09', day: 'tuesday', time: '16:30', tractor: 'Tractor_1' },
  { id: 'B-DFQH62NN5', date: '2025-12-09', day: 'tuesday', time: '17:30', tractor: 'Tractor_4' },
  { id: 'B-XD06L9B90', date: '2025-12-09', day: 'tuesday', time: '18:30', tractor: 'Tractor_7' },
  { id: 'B-26H9H2B82', date: '2025-12-09', day: 'tuesday', time: '20:30', tractor: 'Tractor_3' },
  { id: 'B-ZF2XK5JB6', date: '2025-12-09', day: 'tuesday', time: '20:30', tractor: 'Tractor_2' },
  { id: 'B-HTJXNXH70', date: '2025-12-09', day: 'tuesday', time: '20:30', tractor: 'Tractor_10' },
  { id: 'B-ZXJ4N3M1C', date: '2025-12-09', day: 'tuesday', time: '21:30', tractor: 'Tractor_5' },
  { id: 'B-SWBDS9JPG', date: '2025-12-10', day: 'wednesday', time: '00:30', tractor: 'Tractor_8' },
  { id: 'B-674H8J97P', date: '2025-12-10', day: 'wednesday', time: '16:30', tractor: 'Tractor_1' },
  { id: 'B-8C15J1C2V', date: '2025-12-10', day: 'wednesday', time: '16:30', tractor: 'Tractor_9' },
  { id: 'B-MXVBJC6K2', date: '2025-12-10', day: 'wednesday', time: '17:30', tractor: 'Tractor_4' },
  { id: 'B-RR9475SF7', date: '2025-12-10', day: 'wednesday', time: '18:30', tractor: 'Tractor_7' },
  { id: 'B-PG3R9FZ1X', date: '2025-12-10', day: 'wednesday', time: '20:30', tractor: 'Tractor_10' },
  { id: 'B-DCS66F403', date: '2025-12-10', day: 'wednesday', time: '20:30', tractor: 'Tractor_3' },
  { id: 'B-32DHBCKMX', date: '2025-12-10', day: 'wednesday', time: '20:30', tractor: 'Tractor_2' },
  { id: 'B-XRZ3ZHHL7', date: '2025-12-10', day: 'wednesday', time: '21:30', tractor: 'Tractor_5' },
  { id: 'B-C2XGXZHHR', date: '2025-12-11', day: 'thursday', time: '00:30', tractor: 'Tractor_8' },
  { id: 'B-N0PG1G0W8', date: '2025-12-11', day: 'thursday', time: '01:30', tractor: 'Tractor_6' },
  { id: 'B-7FKXZP8LB', date: '2025-12-11', day: 'thursday', time: '16:30', tractor: 'Tractor_1' },
  { id: 'B-G067FGKT4', date: '2025-12-11', day: 'thursday', time: '16:30', tractor: 'Tractor_9' },
  { id: 'B-J48GFT1P7', date: '2025-12-11', day: 'thursday', time: '17:30', tractor: 'Tractor_4' },
  { id: 'B-B5L6R712J', date: '2025-12-11', day: 'thursday', time: '18:30', tractor: 'Tractor_7' },
  { id: 'B-VX7XPZ144', date: '2025-12-11', day: 'thursday', time: '20:30', tractor: 'Tractor_2' },
  { id: 'B-LMMZ20GL9', date: '2025-12-11', day: 'thursday', time: '21:30', tractor: 'Tractor_5' },
  { id: 'B-B0HK5QT74', date: '2025-12-12', day: 'friday', time: '01:30', tractor: 'Tractor_6' },
  { id: 'B-W6TM19NHP', date: '2025-12-12', day: 'friday', time: '16:30', tractor: 'Tractor_9' },
  { id: 'B-V4VVHV51D', date: '2025-12-12', day: 'friday', time: '17:30', tractor: 'Tractor_4' },
  { id: 'B-KJV7SLFVL', date: '2025-12-12', day: 'friday', time: '20:30', tractor: 'Tractor_10' },
  { id: 'B-RZBKV6WN9', date: '2025-12-12', day: 'friday', time: '20:30', tractor: 'Tractor_3' },
  { id: 'B-5433RW06K', date: '2025-12-12', day: 'friday', time: '21:30', tractor: 'Tractor_5' },
  { id: 'B-V04MHTGGG', date: '2025-12-13', day: 'saturday', time: '00:30', tractor: 'Tractor_8' },
  { id: 'B-TM575ZDHN', date: '2025-12-13', day: 'saturday', time: '01:30', tractor: 'Tractor_6' },
  { id: 'B-60JLWK7QM', date: '2025-12-13', day: 'saturday', time: '16:30', tractor: 'Tractor_1' },
  { id: 'B-4G1DMV73H', date: '2025-12-13', day: 'saturday', time: '18:30', tractor: 'Tractor_7' },
  { id: 'B-QRSBK80J8', date: '2025-12-13', day: 'saturday', time: '20:30', tractor: 'Tractor_10' },
  { id: 'B-LRF0JFQ4W', date: '2025-12-13', day: 'saturday', time: '20:30', tractor: 'Tractor_2' },
  { id: 'B-QR5P318CF', date: '2025-12-13', day: 'saturday', time: '20:30', tractor: 'Tractor_3' },
  { id: 'B-G0H7S35NC', date: '2025-12-13', day: 'saturday', time: '21:30', tractor: 'Tractor_5' },
  { id: 'B-F6H6Z5T0H', date: '2025-12-14', day: 'sunday', time: '00:30', tractor: 'Tractor_8' },
  { id: 'B-Z7B04SWT6', date: '2025-12-14', day: 'sunday', time: '01:30', tractor: 'Tractor_6' },
];

async function main() {
  const eightWeeksAgo = subWeeks(new Date(), 8);
  const cutoffDate = format(eightWeeksAgo, 'yyyy-MM-dd');

  // Step 1: Get PREDOMINANT contract type for each driver (MAJORITY of assignments, not just most recent)
  console.log('=== VERIFYING SOLO1 vs SOLO2 DRIVERS (by MAJORITY of assignments) ===\n');

  const driverContractCounts = await db.execute(sql`
    SELECT
      ba.driver_id,
      d.first_name,
      d.last_name,
      LOWER(b.solo_type) as solo_type,
      COUNT(*) as assignment_count
    FROM block_assignments ba
    JOIN blocks b ON ba.block_id = b.id
    JOIN drivers d ON ba.driver_id = d.id
    WHERE ba.is_active = true
    AND b.service_date >= ${cutoffDate}::date
    GROUP BY ba.driver_id, d.first_name, d.last_name, LOWER(b.solo_type)
    ORDER BY d.last_name, d.first_name, assignment_count DESC
  `);

  // Calculate predominant type per driver
  const driverPredominantType = new Map<string, { name: string, solo1Count: number, solo2Count: number, predominant: string }>();

  for (const row of driverContractCounts.rows as any[]) {
    const driverId = row.driver_id;
    const name = `${row.first_name} ${row.last_name}`;
    const soloType = row.solo_type || '';
    const count = parseInt(row.assignment_count);

    if (!driverPredominantType.has(driverId)) {
      driverPredominantType.set(driverId, { name, solo1Count: 0, solo2Count: 0, predominant: '' });
    }

    const data = driverPredominantType.get(driverId)!;
    if (soloType === 'solo1') {
      data.solo1Count += count;
    } else if (soloType === 'solo2') {
      data.solo2Count += count;
    }
  }

  // Determine predominant type
  const solo1Drivers = new Set<string>();
  const solo2Drivers = new Set<string>();

  for (const [driverId, data] of driverPredominantType) {
    // PREDOMINANT = whichever has MORE assignments
    // If tied, consider them mixed (exclude from pure Solo1 list)
    if (data.solo1Count > data.solo2Count) {
      data.predominant = 'solo1';
      solo1Drivers.add(driverId);
      console.log(`  ✓ ${data.name.padEnd(35)} Solo1 (${data.solo1Count} solo1 vs ${data.solo2Count} solo2)`);
    } else if (data.solo2Count > data.solo1Count) {
      data.predominant = 'solo2';
      solo2Drivers.add(driverId);
      console.log(`  ✗ ${data.name.padEnd(35)} Solo2 - EXCLUDED (${data.solo1Count} solo1 vs ${data.solo2Count} solo2)`);
    } else {
      // Equal - exclude to be safe
      data.predominant = 'mixed';
      solo2Drivers.add(driverId); // Exclude from Solo1
      console.log(`  ? ${data.name.padEnd(35)} Mixed - EXCLUDED (${data.solo1Count} solo1 vs ${data.solo2Count} solo2)`);
    }
  }

  console.log(`\n  Total Solo1 drivers: ${solo1Drivers.size}`);
  console.log(`  Total Solo2/Mixed drivers: ${solo2Drivers.size}`);

  // Step 2: Get Solo1 assignments from last 8 weeks (ONLY for Solo1 drivers)
  const assignments = await db.execute(sql`
    SELECT
      d.id as driver_id,
      d.first_name,
      d.last_name,
      b.service_date,
      b.solo_type,
      b.tractor_id
    FROM block_assignments ba
    JOIN blocks b ON ba.block_id = b.id
    JOIN drivers d ON ba.driver_id = d.id
    WHERE ba.is_active = true
    AND b.service_date >= ${cutoffDate}::date
    AND LOWER(b.solo_type) = 'solo1'
    ORDER BY d.last_name, d.first_name, b.service_date
  `);

  // Group by driver (only include Solo1 drivers)
  const driverMap = new Map<string, {
    id: string,
    name: string,
    assignments: Array<{date: string, day: string, tractorId: string, time: string}>
  }>();

  for (const row of assignments.rows as any[]) {
    const driverId = row.driver_id;

    // SKIP if this driver is predominantly a Solo2 driver
    if (solo2Drivers.has(driverId)) {
      continue;
    }

    const driverName = `${row.first_name} ${row.last_name}`;

    if (!driverMap.has(driverId)) {
      driverMap.set(driverId, { id: driverId, name: driverName, assignments: [] });
    }

    const serviceDate = new Date(row.service_date);
    const dayIndex = serviceDate.getDay();
    const dayName = DAY_NAMES[dayIndex];
    const tractorId = row.tractor_id || 'Unknown';
    const lookupKey = `solo1_${tractorId}`;
    const time = CANONICAL_START_TIMES[lookupKey] || '??:??';

    driverMap.get(driverId)!.assignments.push({
      date: format(serviceDate, 'yyyy-MM-dd'),
      day: dayName,
      tractorId,
      time
    });
  }

  // Calculate patterns for each driver
  type DriverProfile = {
    id: string,
    name: string,
    days: string[],
    times: string[],
    time: string,
    dayCounts: Record<string, number>,
    timeCounts: Record<string, number>,
    totalAssignments: number
  };

  const driverProfiles: DriverProfile[] = [];

  for (const [driverId, data] of driverMap) {
    const dayCounts: Record<string, number> = {};
    const timeCounts: Record<string, number> = {};

    for (const a of data.assignments) {
      dayCounts[a.day] = (dayCounts[a.day] || 0) + 1;
      timeCounts[a.time] = (timeCounts[a.time] || 0) + 1;
    }

    const preferredDays = Object.entries(dayCounts)
      .filter(([_, count]) => count >= 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 7)
      .map(([day]) => day);

    const allTimes = Object.keys(timeCounts);

    const preferredTime = Object.entries(timeCounts)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || '??:??';

    if (preferredDays.length > 0) {
      driverProfiles.push({
        id: data.id,
        name: data.name,
        days: preferredDays,
        times: allTimes,
        time: preferredTime,
        dayCounts,
        timeCounts,
        totalAssignments: data.assignments.length
      });
    }
  }

  driverProfiles.sort((a, b) => a.name.localeCompare(b.name));

  // Print driver patterns
  console.log('\n\n=== SOLO1 DRIVER PATTERNS (PREDOMINANTLY Solo1 Drivers Only) ===\n');

  const TIMES = ['00:30', '01:30', '16:30', '17:30', '18:30', '20:30', '21:30'];
  const DAYS_ORDER = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

  for (const time of TIMES) {
    console.log(`\n========== ${time} ==========`);
    const driversAtTime = driverProfiles.filter(d => d.times.includes(time));

    if (driversAtTime.length === 0) {
      console.log('  (no drivers)');
      continue;
    }

    for (const driver of driversAtTime) {
      const data = driverMap.get(driver.id)!;
      const dayCountsForTime: Record<string, number> = {};
      for (const a of data.assignments) {
        if (a.time === time) {
          dayCountsForTime[a.day] = (dayCountsForTime[a.day] || 0) + 1;
        }
      }

      const totalForTime = Object.values(dayCountsForTime).reduce((a, b) => a + b, 0);
      const daysWorked = DAYS_ORDER
        .filter(d => dayCountsForTime[d])
        .map(d => `${DAY_ABBREV[d]}(${dayCountsForTime[d]})`);

      console.log(`  ${driver.name.padEnd(35)} ${daysWorked.join(', ').padEnd(40)} [${totalForTime} shifts]`);
    }
  }

  // MATCHING with 6-day max rule
  console.log('\n\n=== MATCHING DRIVERS TO BLOCKS (with 6-day max rule) ===\n');

  const driverAssignedDates = new Map<string, Set<string>>();
  const blockAssignments: Array<{block: typeof UNASSIGNED_BLOCKS[0], driver: DriverProfile | null, matchQuality: string, note: string}> = [];

  const WEEK_START = '2025-12-07';
  const WEEK_END = '2025-12-13';

  const countDaysInWeek = (driverId: string): number => {
    const dates = driverAssignedDates.get(driverId) || new Set();
    let count = 0;
    for (const date of dates) {
      if (date >= WEEK_START && date <= WEEK_END) {
        count++;
      }
    }
    return count;
  };

  const sortedBlocks = [...UNASSIGNED_BLOCKS].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.time.localeCompare(b.time);
  });

  for (const block of sortedBlocks) {
    let bestDriver: DriverProfile | null = null;
    let bestScore = -1;
    let matchQuality = '';
    let note = '';

    for (const driver of driverProfiles) {
      const assignedDates = driverAssignedDates.get(driver.id) || new Set();
      if (assignedDates.has(block.date)) continue;

      const daysInWeek = countDaysInWeek(driver.id);
      if (daysInWeek >= MAX_DAYS_PER_WEEK) continue;

      if (!driver.days.includes(block.day)) continue;

      let score = 0;
      if (driver.time === block.time) {
        score = 100;
      } else if (driver.times.includes(block.time)) {
        score = 90;
      } else {
        const driverMinutes = parseInt(driver.time.split(':')[0]) * 60 + parseInt(driver.time.split(':')[1]);
        const blockMinutes = parseInt(block.time.split(':')[0]) * 60 + parseInt(block.time.split(':')[1]);
        const diff = Math.abs(driverMinutes - blockMinutes);
        const timeDiff = Math.min(diff, 1440 - diff);

        if (timeDiff <= 60) score = 80;
        else if (timeDiff <= 120) score = 50;
        else score = 10;
      }

      const currentDays = countDaysInWeek(driver.id);
      score += (MAX_DAYS_PER_WEEK - currentDays) * 2;

      if (score > bestScore) {
        bestScore = score;
        bestDriver = driver;
        matchQuality = score >= 100 ? 'PERFECT' : score >= 80 ? 'GOOD' : score >= 50 ? 'OK' : 'WEAK';
      }
    }

    if (bestDriver) {
      const assignedDates = driverAssignedDates.get(bestDriver.id) || new Set();
      assignedDates.add(block.date);
      driverAssignedDates.set(bestDriver.id, assignedDates);
      note = `(${countDaysInWeek(bestDriver.id)}/${MAX_DAYS_PER_WEEK} days)`;
    } else {
      note = '** NO MATCH **';
    }

    blockAssignments.push({ block, driver: bestDriver, matchQuality, note });
  }

  // Print assignments by date
  let currentDate = '';
  for (const { block, driver, matchQuality, note } of blockAssignments) {
    if (block.date !== currentDate) {
      currentDate = block.date;
      const date = new Date(block.date + 'T00:00:00');
      const dayName = DAY_NAMES[date.getDay()];
      console.log(`\n${block.date} (${DAY_ABBREV[dayName]}):`);
    }

    const driverStr = driver ? `${driver.name.padEnd(30)} [${matchQuality}] ${note}` : `${'** UNASSIGNED **'.padEnd(30)} ${note}`;
    console.log(`  ${block.time} ${block.tractor.padEnd(12)} -> ${driverStr}`);
  }

  // Driver workload summary
  console.log('\n\n=== DRIVER WORKLOAD SUMMARY (Dec 7-13) ===\n');
  const workloadSummary: Array<{name: string, days: number, dates: string[]}> = [];

  for (const [driverId, dates] of driverAssignedDates) {
    const driver = driverProfiles.find(d => d.id === driverId);
    if (driver) {
      const weekDates = Array.from(dates).filter(d => d >= WEEK_START && d <= WEEK_END).sort();
      workloadSummary.push({ name: driver.name, days: weekDates.length, dates: weekDates });
    }
  }

  workloadSummary.sort((a, b) => b.days - a.days);

  for (const { name, days, dates } of workloadSummary) {
    const status = days > MAX_DAYS_PER_WEEK ? '⚠️ VIOLATION' : days === MAX_DAYS_PER_WEEK ? '⚠️ MAX' : '✓';
    const daysStr = dates.map(d => DAY_ABBREV[DAY_NAMES[new Date(d + 'T00:00:00').getDay()]]).join(', ');
    console.log(`  ${name.padEnd(35)} ${days}/${MAX_DAYS_PER_WEEK} days ${status} [${daysStr}]`);
  }

  // Summary
  const assigned = blockAssignments.filter(a => a.driver).length;
  const unassigned = blockAssignments.filter(a => !a.driver).length;
  console.log(`\n\n=== FINAL SUMMARY ===`);
  console.log(`Total blocks: ${blockAssignments.length}`);
  console.log(`Assigned: ${assigned}`);
  console.log(`Unassigned: ${unassigned}`);
  console.log(`Max days per driver: ${MAX_DAYS_PER_WEEK}`);

  if (unassigned > 0) {
    console.log(`\nUnassigned blocks:`);
    for (const { block } of blockAssignments.filter(a => !a.driver)) {
      console.log(`  ${block.date} ${block.day} ${block.time} ${block.tractor}`);
    }
  }

  process.exit(0);
}
main();
