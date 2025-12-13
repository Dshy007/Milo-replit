// Based on the screenshot, I can see the following drivers listed:
// Let me parse what I can see from the visible data

const drivers: Record<string, string[]> = {};

// From the screenshot, I can see rows with driver names and dates
// The format appears to be: Block ID, Trip ID, Block/Trip, Trip Stage, Load ID, etc.
// with Driver Name in column 9 and dates visible

// Looking at the visible data in the screenshot, I'll extract what I can see:
// The spreadsheet shows many rows with driver names visible

// Let me read the actual CSV and do a proper analysis
import * as fs from 'fs';
import Papa from 'papaparse';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

async function analyze() {
  const csvPath = 'C:/Users/shire/Downloads/Dec 14 - 20 no drivers.csv';
  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const parsed = Papa.parse(csvContent, { header: true });

  console.log('=== RAW CSV ANALYSIS ===');
  console.log(`Total rows: ${parsed.data.length}`);

  // Count rows with drivers
  let withDriver = 0;
  let withoutDriver = 0;
  const allDrivers = new Set<string>();

  for (const row of parsed.data as any[]) {
    if (!row['Block ID']) continue;
    const driver = row['Driver Name']?.trim();
    if (driver) {
      withDriver++;
      allDrivers.add(driver);
    } else {
      withoutDriver++;
    }
  }

  console.log(`Rows with driver: ${withDriver}`);
  console.log(`Rows without driver: ${withoutDriver}`);
  console.log(`Unique drivers: ${allDrivers.size}`);
  console.log('\nAll drivers found:');
  for (const d of [...allDrivers].sort()) {
    console.log(`  - ${d}`);
  }

  // Now build day breakdown
  console.log('\n=== DRIVER DAY BREAKDOWN ===\n');

  const driverSchedule = new Map<string, Map<string, string[]>>();

  for (const row of parsed.data as any[]) {
    if (!row['Block ID']) continue;
    const driver = row['Driver Name']?.trim();
    if (!driver) continue;

    const dateStr = row['Stop 1  Planned Departure Date'] || row['Stop 1 Planned Arrival Date'];
    if (!dateStr) continue;

    const [month, day, year] = dateStr.split('/');
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    const dayName = DAY_NAMES[date.getDay()];

    const operatorId = row['Operator ID'] || '';
    const contractMatch = operatorId.match(/Solo(\d)/i);
    const contract = contractMatch ? `S${contractMatch[1]}` : 'S1';

    const time = row['Stop 1  Planned Departure Time'] || '';

    if (!driverSchedule.has(driver)) {
      driverSchedule.set(driver, new Map());
    }
    const driverDays = driverSchedule.get(driver)!;
    if (!driverDays.has(dayName)) {
      driverDays.set(dayName, []);
    }
    driverDays.get(dayName)!.push(`${time} ${contract}`);
  }

  // Sort by name and print
  const sortedDrivers = [...driverSchedule.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  for (const [driver, days] of sortedDrivers) {
    const dayList = DAY_NAMES.filter(d => days.has(d));
    const dayCount = dayList.length;
    console.log(`${driver}`);
    console.log(`  ${dayCount} days: ${dayList.join(', ')}`);
  }

  process.exit(0);
}

analyze().catch(e => { console.error(e); process.exit(1); });
