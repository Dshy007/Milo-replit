import * as fs from 'fs';
import Papa from 'papaparse';

const DAY_ABBREV: Record<number, string> = {
  0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat'
};

async function analyze() {
  const csvPath = 'C:/Users/shire/Downloads/Dec 14 - 20 no drivers.csv';
  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const parsed = Papa.parse(csvContent, { header: true });

  // Track driver -> days worked
  const driverDays = new Map<string, Set<string>>();
  const driverBlocks = new Map<string, Array<{date: string, day: string, time: string, contract: string}>>();

  for (const row of parsed.data as any[]) {
    if (!row['Block ID']) continue;

    const driverName = row['Driver Name']?.trim();
    if (!driverName) continue;

    // Parse date
    const dateStr = row['Stop 1  Planned Departure Date'] || row['Stop 1 Planned Arrival Date'];
    if (!dateStr) continue;

    const [month, day, year] = dateStr.split('/');
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    const dayName = DAY_ABBREV[date.getDay()];
    const dateKey = `${month}/${day}`;

    // Get contract type
    const operatorId = row['Operator ID'] || '';
    const contractMatch = operatorId.match(/Solo(\d)/i);
    const contract = contractMatch ? `S${contractMatch[1]}` : 'S1';

    // Get time
    const time = row['Stop 1  Planned Departure Time'] || row['Stop 1 Planned Arrival Time'] || '';

    if (!driverDays.has(driverName)) {
      driverDays.set(driverName, new Set());
      driverBlocks.set(driverName, []);
    }

    driverDays.get(driverName)!.add(dayName);
    driverBlocks.get(driverName)!.push({ date: dateKey, day: dayName, time, contract });
  }

  // Sort drivers by number of days (most to least)
  const sortedDrivers = [...driverDays.entries()]
    .map(([name, days]) => ({
      name,
      days: [...days],
      blocks: driverBlocks.get(name)!
    }))
    .sort((a, b) => b.days.length - a.days.length);

  console.log('=== DRIVER SCHEDULE BREAKDOWN (Dec 14-20) ===\n');

  // Order days correctly
  const dayOrder = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  for (const driver of sortedDrivers) {
    const orderedDays = driver.days.sort((a, b) => dayOrder.indexOf(a) - dayOrder.indexOf(b));
    const dayStr = orderedDays.join(', ');

    // Get contract types used
    const contracts = [...new Set(driver.blocks.map(b => b.contract))].join('/');

    console.log(`${driver.name.padEnd(40)} ${driver.days.length} days: ${dayStr.padEnd(25)} (${contracts})`);
  }

  console.log(`\n--- TOTAL: ${sortedDrivers.length} drivers with assignments ---`);

  // Count by day
  console.log('\n=== COVERAGE BY DAY ===');
  const dayCounts: Record<string, number> = {};
  for (const driver of sortedDrivers) {
    for (const day of driver.days) {
      dayCounts[day] = (dayCounts[day] || 0) + 1;
    }
  }
  for (const day of dayOrder) {
    if (dayCounts[day]) {
      console.log(`  ${day}: ${dayCounts[day]} drivers`);
    }
  }

  process.exit(0);
}

analyze().catch(e => { console.error(e); process.exit(1); });
