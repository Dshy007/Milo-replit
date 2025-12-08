import { db } from './server/db.js';
import { sql } from 'drizzle-orm';
import { format, subWeeks } from 'date-fns';

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_ABBREV: Record<string, string> = {
  sunday: 'Sun', monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed',
  thursday: 'Thu', friday: 'Fri', saturday: 'Sat'
};

// Based on Holy Grail analysis - TRUE slot owners by day
// Format: { time, tractor, dayOwners: { dayName: 'DriverName' } }
const SLOT_OWNERSHIP = [
  {
    time: '00:30', tractor: 'Tractor_8',
    owners: {
      sunday: 'Brian Worts',
      monday: null, // Scattered - need to find backup
      tuesday: 'Brian Worts',
      wednesday: 'Brian Worts',
      thursday: 'Brian Worts',
      friday: 'Brian Worts',
      saturday: 'Brian Worts',
    },
    backups: {
      monday: ['Theotis J Harris', 'Brian ALLAN Strickland'], // Based on history
      saturday: ['Brian ALLAN Strickland', 'DEVIN WAYNE HILL'],
    }
  },
  {
    time: '01:30', tractor: 'Tractor_6',
    owners: {
      sunday: 'Richard Anthony Ewing niederhauser',
      monday: 'Richard Anthony Ewing niederhauser',
      tuesday: 'Richard Anthony Ewing niederhauser',
      wednesday: 'Richard Anthony Ewing niederhauser',
      thursday: 'Richard Anthony Ewing niederhauser',
      friday: null, // Scattered
      saturday: 'ABBAS AL-RAMAHI', // 2 shifts vs Richard's 2
    },
    backups: {
      friday: ['ABBAS AL-RAMAHI', 'Richard Anthony Ewing niederhauser'],
    }
  },
  {
    time: '16:30', tractor: 'Tractor_1',
    owners: {
      sunday: 'Tareef THAMER Mahdi', // 2 shifts
      monday: 'Firas IMAD Tahseen', // 2 shifts
      tuesday: null, // Scattered
      wednesday: 'Isaac Kiragu', // 2 shifts, Raymond 2 shifts
      thursday: null, // Scattered
      friday: 'Theotis J Harris', // 2 shifts
      saturday: 'Firas IMAD Tahseen', // 2 shifts
    }
  },
  {
    time: '16:30', tractor: 'Tractor_9',
    owners: {
      sunday: 'Firas IMAD Tahseen', // 2 shifts
      monday: 'Isaac Kiragu', // 2 shifts
      tuesday: null, // Scattered
      wednesday: 'COURTNEY TYLAND SMITH', // 2 shifts
      thursday: null, // Scattered
      friday: null, // Scattered
      saturday: 'Firas IMAD Tahseen', // 3 shifts
    }
  },
  {
    time: '17:30', tractor: 'Tractor_4',
    owners: {
      sunday: 'Theotis J Harris', // 2 shifts
      monday: null, // Scattered
      tuesday: 'Theotis J Harris', // 2 shifts
      wednesday: 'COURTNEY TYLAND SMITH', // 2 shifts
      thursday: 'Raymond Jacinto Beeks', // 1 shift only
      friday: 'COURTNEY TYLAND SMITH', // 3 shifts
      saturday: 'Tareef THAMER Mahdi', // 2 shifts
    }
  },
  {
    time: '18:30', tractor: 'Tractor_7',
    owners: {
      sunday: 'Michael Shane Burton', // 2 shifts
      monday: null, // Scattered
      tuesday: null, // Scattered
      wednesday: 'Kwana Barber', // 3 shifts
      thursday: 'Kwana Barber', // 2 shifts
      friday: 'Kwana Barber', // 3 shifts
      saturday: 'Kwana Barber', // 6 shifts!
    }
  },
  {
    time: '20:30', tractor: 'Tractor_2',
    owners: {
      sunday: 'Joshua ALLEN Green', // 2 shifts
      monday: null, // Scattered
      tuesday: 'Richard EUGENE Nelson', // 2 shifts
      wednesday: null, // Scattered
      thursday: null, // Scattered
      friday: 'Raymond Jacinto Beeks', // 2 shifts
      saturday: 'Raymond Jacinto Beeks', // 4 shifts!
    }
  },
  {
    time: '20:30', tractor: 'Tractor_3',
    owners: {
      sunday: null, // Scattered
      monday: 'Joshua ALLEN Green', // 2 shifts
      tuesday: 'Robert Charles, JR Dixon', // 2 shifts
      wednesday: null, // Scattered
      thursday: 'Raymond Jacinto Beeks', // 2 shifts
      friday: null, // Scattered
      saturday: 'Raymond Jacinto Beeks', // 2 shifts
    }
  },
  {
    time: '20:30', tractor: 'Tractor_10',
    owners: {
      sunday: null, // Scattered
      monday: 'Joshua ALLEN Green', // 2 shifts
      tuesday: 'Joshua ALLEN Green', // 2 shifts
      wednesday: null, // Scattered
      thursday: null, // Scattered
      friday: 'Robert Charles, JR Dixon', // 2 shifts, DEVIN 2
      saturday: null, // Scattered
    }
  },
  {
    time: '21:30', tractor: 'Tractor_5',
    owners: {
      sunday: 'Brett Michael Baker', // 4 shifts!
      monday: 'Brett Michael Baker', // 4 shifts!
      tuesday: 'Brett Michael Baker', // 3 shifts
      wednesday: 'Brett Michael Baker', // 2 shifts
      thursday: 'Richard EUGENE Nelson', // 2 shifts
      friday: 'Richard EUGENE Nelson', // 3 shifts
      saturday: 'Richard EUGENE Nelson', // 3 shifts
    }
  },
];

// Unassigned blocks from CSV
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
  console.log('=== SLOT-BY-SLOT ASSIGNMENT (Based on Holy Grail Ownership) ===\n');

  // Track driver assignments per day (one block per day max)
  const driverDayAssignments = new Map<string, Set<string>>(); // driverName -> Set of dates
  const MAX_DAYS = 6;

  // Helper to check if driver can work on date
  const canAssign = (driverName: string, date: string): boolean => {
    const dates = driverDayAssignments.get(driverName) || new Set();
    if (dates.has(date)) return false; // Already working this date

    // Count days in week Dec 7-13
    let weekDays = 0;
    for (const d of dates) {
      if (d >= '2025-12-07' && d <= '2025-12-13') weekDays++;
    }
    return weekDays < MAX_DAYS;
  };

  // Assign driver to date
  const assign = (driverName: string, date: string) => {
    if (!driverDayAssignments.has(driverName)) {
      driverDayAssignments.set(driverName, new Set());
    }
    driverDayAssignments.get(driverName)!.add(date);
  };

  // Find owner for a slot
  const findOwner = (time: string, tractor: string, day: string): string | null => {
    const slot = SLOT_OWNERSHIP.find(s => s.time === time && s.tractor === tractor);
    if (!slot) return null;
    return (slot.owners as any)[day] || null;
  };

  // Sort blocks by date/time
  const sortedBlocks = [...UNASSIGNED_BLOCKS].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.time.localeCompare(b.time);
  });

  const assignments: Array<{ block: typeof UNASSIGNED_BLOCKS[0], driver: string | null, note: string }> = [];

  for (const block of sortedBlocks) {
    const owner = findOwner(block.time, block.tractor, block.day);
    let assignedDriver: string | null = null;
    let note = '';

    if (owner && canAssign(owner, block.date)) {
      assignedDriver = owner;
      assign(owner, block.date);
      note = 'OWNER';
    } else if (owner) {
      note = `OWNER ${owner} unavailable`;
    } else {
      note = 'NO CLEAR OWNER';
    }

    assignments.push({ block, driver: assignedDriver, note });
  }

  // Print first pass
  console.log('=== FIRST PASS (Owners Only) ===\n');

  let currentDate = '';
  for (const { block, driver, note } of assignments) {
    if (block.date !== currentDate) {
      currentDate = block.date;
      const date = new Date(block.date + 'T00:00:00');
      const dayName = DAY_NAMES[date.getDay()];
      console.log(`\n${block.date} (${DAY_ABBREV[dayName]}):`);
    }

    const driverStr = driver ? driver.padEnd(35) : '** UNASSIGNED **'.padEnd(35);
    console.log(`  ${block.time} ${block.tractor.padEnd(12)} -> ${driverStr} [${note}]`);
  }

  // Count
  const assigned = assignments.filter(a => a.driver).length;
  const unassigned = assignments.filter(a => !a.driver).length;

  console.log(`\n\n=== FIRST PASS SUMMARY ===`);
  console.log(`Assigned by owner: ${assigned}`);
  console.log(`Need backup: ${unassigned}`);

  // Show driver workloads
  console.log(`\n\n=== DRIVER WORKLOADS (First Pass) ===\n`);
  const workloads: Array<{ name: string, days: number, dates: string[] }> = [];
  for (const [name, dates] of driverDayAssignments) {
    const weekDates = Array.from(dates).filter(d => d >= '2025-12-07' && d <= '2025-12-13').sort();
    workloads.push({ name, days: weekDates.length, dates: weekDates });
  }
  workloads.sort((a, b) => b.days - a.days);

  for (const { name, days, dates } of workloads) {
    const daysStr = dates.map(d => DAY_ABBREV[DAY_NAMES[new Date(d + 'T00:00:00').getDay()]]).join(', ');
    console.log(`  ${name.padEnd(35)} ${days}/6 days [${daysStr}]`);
  }

  // List unassigned blocks
  console.log(`\n\n=== BLOCKS NEEDING BACKUP ASSIGNMENT ===\n`);
  for (const { block, note } of assignments.filter(a => !a.driver)) {
    console.log(`  ${block.date} ${DAY_ABBREV[block.day]} ${block.time} ${block.tractor} - ${note}`);
  }

  process.exit(0);
}
main();
