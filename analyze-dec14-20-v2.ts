import { db } from './server/db';
import { sql } from 'drizzle-orm';
import { subWeeks, format } from 'date-fns';
import * as fs from 'fs';
import Papa from 'papaparse';

interface BlockNeed {
  date: string;
  dayName: string;
  contractType: string;
  tractorId: string;
  operatorId: string;
  startTime: string;
  hasDriver: boolean;
  existingDriver: string | null;
}

interface DriverProfile {
  id: string;
  name: string;
  contractType: string;
  totalShifts: number;
  dayCounts: Record<string, number>;
  primaryDays: string[];
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// EXCLUDED DRIVERS
const EXCLUDED_DRIVERS = [
  "haydee contreras de ramirez",
  "richard eugene nelson",
];

async function analyze() {
  const cutoff = subWeeks(new Date(), 8);
  const tenantId = '3cf00ed3-3eb9-43bf-b001-aee880b30304';

  // 1. Parse the CSV file
  const csvPath = 'C:/Users/shire/Downloads/Dec 14 - 20 no drivers.csv';
  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const parsed = Papa.parse(csvContent, { header: true });

  const blockNeeds: BlockNeed[] = [];
  for (const row of parsed.data as any[]) {
    if (!row['Block ID']) continue;

    const operatorId = row['Operator ID'] || '';
    const contractMatch = operatorId.match(/Solo(\d)_Tractor_(\d+)/i);
    const contractType = contractMatch ? `solo${contractMatch[1]}` : 'solo1';
    const tractorId = contractMatch ? `Tractor_${contractMatch[2]}` : 'Tractor_1';

    // Get start time from Stop 1 Planned Arrival Time or Stop 1 Planned Departure Time
    const startTime = row['Stop 1  Planned Departure Time'] || row['Stop 1 Planned Arrival Time'] || '00:00';

    // Parse date from Stop 1 Planned Departure Date
    const dateStr = row['Stop 1  Planned Departure Date'] || row['Stop 1 Planned Arrival Date'];
    if (!dateStr) continue;

    const [month, day, year] = dateStr.split('/');
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    const dayName = DAY_NAMES[date.getDay()];

    blockNeeds.push({
      date: format(date, 'yyyy-MM-dd'),
      dayName,
      contractType,
      tractorId,
      operatorId,
      startTime,
      hasDriver: !!row['Driver Name']?.trim(),
      existingDriver: row['Driver Name']?.trim() || null
    });
  }

  // Dedupe by date + contractType + tractorId, keeping earliest time
  const uniqueBlocks = new Map<string, BlockNeed>();
  for (const b of blockNeeds) {
    const key = `${b.date}_${b.contractType}_${b.tractorId}`;
    if (!uniqueBlocks.has(key) || b.startTime < uniqueBlocks.get(key)!.startTime) {
      uniqueBlocks.set(key, b);
    }
  }

  // Sort ALL blocks chronologically (date + time), Solo1 first within same slot
  const allBlocks = [...uniqueBlocks.values()].sort((a, b) => {
    // First by date
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    // Then by time
    if (a.startTime !== b.startTime) return a.startTime.localeCompare(b.startTime);
    // Then Solo1 before Solo2
    return a.contractType.localeCompare(b.contractType);
  });

  console.log('=== DEC 14-20 SCHEDULE (Chronological, Solo1 First) ===');
  console.log(`\nExcluded: ${EXCLUDED_DRIVERS.join(', ')}`);
  console.log(`Total blocks: ${allBlocks.length}`);

  // 2. Get driver history from last 8 weeks
  const history = await db.execute(sql`
    SELECT
      d.id as driver_id,
      d.first_name,
      d.last_name,
      b.solo_type,
      b.service_date,
      EXTRACT(DOW FROM b.service_date) as day_of_week
    FROM block_assignments ba
    JOIN blocks b ON ba.block_id = b.id
    JOIN drivers d ON ba.driver_id = d.id
    WHERE b.tenant_id = ${tenantId}
    AND b.service_date >= ${cutoff}
    AND ba.is_active = true
    ORDER BY d.last_name, b.service_date
  `);

  // Build driver profiles
  const driverProfiles = new Map<string, DriverProfile>();

  for (const row of history.rows as any[]) {
    const driverId = row.driver_id;
    const name = `${row.first_name} ${row.last_name}`;
    const soloType = (row.solo_type || 'solo1').toLowerCase();
    const dayIndex = parseInt(row.day_of_week);
    const dayName = DAY_NAMES[dayIndex];

    // Skip excluded drivers
    if (EXCLUDED_DRIVERS.includes(name.toLowerCase())) continue;

    if (!driverProfiles.has(driverId)) {
      driverProfiles.set(driverId, {
        id: driverId,
        name,
        contractType: soloType,
        totalShifts: 0,
        dayCounts: {},
        primaryDays: []
      });
    }

    const profile = driverProfiles.get(driverId)!;
    profile.dayCounts[dayName] = (profile.dayCounts[dayName] || 0) + 1;
    profile.totalShifts++;

    // Track solo2 count
    if (soloType === 'solo2') {
      (profile as any)['_solo2_count'] = ((profile as any)['_solo2_count'] || 0) + 1;
    }
  }

  // Finalize profiles
  for (const profile of driverProfiles.values()) {
    const solo2Count = (profile as any)['_solo2_count'] || 0;
    if (solo2Count > profile.totalShifts * 0.6) {
      profile.contractType = 'solo2';
    } else {
      profile.contractType = 'solo1';
    }
    profile.primaryDays = Object.entries(profile.dayCounts)
      .filter(([_, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .map(([day]) => day);
  }

  // Group by contract type and sort by reliability
  const solo1Drivers = [...driverProfiles.values()].filter(d => d.contractType === 'solo1')
    .sort((a, b) => b.totalShifts - a.totalShifts);
  const solo2Drivers = [...driverProfiles.values()].filter(d => d.contractType === 'solo2')
    .sort((a, b) => b.totalShifts - a.totalShifts);

  console.log(`\nAvailable Solo1 Drivers: ${solo1Drivers.length}`);
  console.log(`Available Solo2 Drivers: ${solo2Drivers.length}`);

  // 3. Assign drivers chronologically
  console.log('\n' + '='.repeat(80));
  console.log('CHRONOLOGICAL SCHEDULE (Solo1 filled first)');
  console.log('='.repeat(80));

  const driverWeekCount = new Map<string, number>();
  const driverDayAssignments = new Map<string, Set<string>>(); // driver -> set of dates
  let currentDate = '';

  for (const block of allBlocks) {
    // Print day header when date changes
    if (block.date !== currentDate) {
      currentDate = block.date;
      console.log(`\n${'─'.repeat(60)}`);
      console.log(`📅 ${block.date} (${block.dayName})`);
      console.log(`${'─'.repeat(60)}`);
    }

    const timeDisplay = block.startTime || '??:??';

    // Check if pre-assigned
    if (block.hasDriver) {
      // Skip excluded pre-assigned drivers
      if (EXCLUDED_DRIVERS.some(ex => block.existingDriver?.toLowerCase().includes(ex))) {
        console.log(`  ${timeDisplay} | ${block.contractType.toUpperCase()} ${block.tractorId} | ⚠️ ${block.existingDriver} (EXCLUDED - needs reassignment)`);
        block.hasDriver = false;
        block.existingDriver = null;
      } else {
        console.log(`  ${timeDisplay} | ${block.contractType.toUpperCase()} ${block.tractorId} | ✓ ${block.existingDriver} (pre-assigned)`);

        // CRITICAL: Mark this driver as used for this day so we don't double-book
        const preAssignedName = block.existingDriver!.toLowerCase();
        // Find the driver ID by name
        for (const [id, profile] of driverProfiles.entries()) {
          if (profile.name.toLowerCase().includes(preAssignedName) || preAssignedName.includes(profile.name.toLowerCase())) {
            if (!driverDayAssignments.has(id)) {
              driverDayAssignments.set(id, new Set());
            }
            driverDayAssignments.get(id)!.add(block.date);
            driverWeekCount.set(id, (driverWeekCount.get(id) || 0) + 1);
            break;
          }
        }
        continue;
      }
    }

    // Find best driver for this block
    const candidates = block.contractType === 'solo2' ? solo2Drivers : solo1Drivers;
    let bestDriver: DriverProfile | null = null;
    let bestScore = -1;
    let bestReason = '';

    for (const driver of candidates) {
      // Skip if already assigned 5+ days this week
      const weekCount = driverWeekCount.get(driver.id) || 0;
      if (weekCount >= 5) continue;

      // Skip if already assigned on this date
      const driverDates = driverDayAssignments.get(driver.id) || new Set();
      if (driverDates.has(block.date)) continue;

      let score = 0;
      let reason = '';

      // Primary: Day preference match
      if (driver.primaryDays.includes(block.dayName)) {
        score += 50;
        reason = `works ${block.dayName}s`;
      }

      // Secondary: Reliability (total shifts)
      score += Math.min(driver.totalShifts, 30);

      // Tertiary: Spread workload (penalize overloading)
      score -= weekCount * 8;

      if (score > bestScore) {
        bestScore = score;
        bestDriver = driver;
        bestReason = reason || `reliable (${driver.totalShifts} shifts)`;
      }
    }

    if (bestDriver) {
      // Update tracking
      driverWeekCount.set(bestDriver.id, (driverWeekCount.get(bestDriver.id) || 0) + 1);
      if (!driverDayAssignments.has(bestDriver.id)) {
        driverDayAssignments.set(bestDriver.id, new Set());
      }
      driverDayAssignments.get(bestDriver.id)!.add(block.date);

      const weekTotal = driverWeekCount.get(bestDriver.id);
      console.log(`  ${timeDisplay} | ${block.contractType.toUpperCase()} ${block.tractorId} | ${bestDriver.name} (${bestReason}) [${weekTotal}/5]`);
    } else {
      console.log(`  ${timeDisplay} | ${block.contractType.toUpperCase()} ${block.tractorId} | ⚠️ NO DRIVER AVAILABLE`);
    }
  }

  // Final workload summary
  console.log('\n' + '='.repeat(80));
  console.log('WEEKLY WORKLOAD SUMMARY');
  console.log('='.repeat(80));

  const workload = [...driverWeekCount.entries()]
    .map(([id, count]) => ({
      name: driverProfiles.get(id)?.name || id,
      count,
      type: driverProfiles.get(id)?.contractType || '?'
    }))
    .sort((a, b) => b.count - a.count);

  console.log('\nSolo1 Drivers:');
  for (const w of workload.filter(x => x.type === 'solo1')) {
    const bar = '█'.repeat(w.count) + '░'.repeat(5 - w.count);
    console.log(`  ${w.name.padEnd(35)} ${bar} ${w.count} days`);
  }

  console.log('\nSolo2 Drivers:');
  for (const w of workload.filter(x => x.type === 'solo2')) {
    const bar = '█'.repeat(w.count) + '░'.repeat(5 - w.count);
    console.log(`  ${w.name.padEnd(35)} ${bar} ${w.count} days`);
  }

  process.exit(0);
}

analyze().catch(e => { console.error(e); process.exit(1); });
