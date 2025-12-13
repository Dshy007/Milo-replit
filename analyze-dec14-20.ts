import { db } from './server/db';
import { blocks, blockAssignments, drivers } from './shared/schema';
import { eq, sql, gte, and } from 'drizzle-orm';
import { subWeeks, format } from 'date-fns';
import * as fs from 'fs';
import Papa from 'papaparse';

interface BlockNeed {
  date: string;
  dayName: string;
  contractType: string;
  tractorId: string;
  operatorId: string;
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
  primaryTime: string;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

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
      hasDriver: !!row['Driver Name']?.trim(),
      existingDriver: row['Driver Name']?.trim() || null
    });
  }

  // Dedupe by date + contractType + tractorId
  const uniqueBlocks = new Map<string, BlockNeed>();
  for (const b of blockNeeds) {
    const key = `${b.date}_${b.contractType}_${b.tractorId}`;
    if (!uniqueBlocks.has(key)) {
      uniqueBlocks.set(key, b);
    }
  }

  console.log('=== DEC 14-20 BLOCK ANALYSIS ===\n');
  console.log(`Total blocks in CSV: ${blockNeeds.length}`);
  console.log(`Unique blocks: ${uniqueBlocks.size}`);
  console.log(`Pre-assigned: ${[...uniqueBlocks.values()].filter(b => b.hasDriver).length}`);
  console.log(`Need assignment: ${[...uniqueBlocks.values()].filter(b => !b.hasDriver).length}`);

  // Group by day
  const byDay = new Map<string, BlockNeed[]>();
  for (const b of uniqueBlocks.values()) {
    if (!byDay.has(b.date)) byDay.set(b.date, []);
    byDay.get(b.date)!.push(b);
  }

  console.log('\n--- BLOCKS BY DAY ---');
  for (const [date, dayBlocks] of [...byDay.entries()].sort()) {
    const dayName = dayBlocks[0].dayName;
    const solo1 = dayBlocks.filter(b => b.contractType === 'solo1').length;
    const solo2 = dayBlocks.filter(b => b.contractType === 'solo2').length;
    const assigned = dayBlocks.filter(b => b.hasDriver).length;
    console.log(`${date} (${dayName}): ${dayBlocks.length} blocks (Solo1: ${solo1}, Solo2: ${solo2}) - ${assigned} pre-assigned`);
  }

  // 2. Get driver history from last 8 weeks
  console.log('\n--- DRIVER HISTORY (8 weeks) ---');

  const history = await db.execute(sql`
    SELECT
      d.id as driver_id,
      d.first_name,
      d.last_name,
      b.solo_type,
      b.service_date,
      b.tractor_id,
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

    if (!driverProfiles.has(driverId)) {
      driverProfiles.set(driverId, {
        id: driverId,
        name,
        contractType: soloType,
        totalShifts: 0,
        dayCounts: {},
        primaryDays: [],
        primaryTime: ''
      });
    }

    const profile = driverProfiles.get(driverId)!;
    profile.dayCounts[dayName] = (profile.dayCounts[dayName] || 0) + 1;
    profile.totalShifts++;

    // Update contract type based on majority
    if (soloType === 'solo2') {
      // Count solo2 assignments
      const solo2Key = `_solo2_count`;
      (profile as any)[solo2Key] = ((profile as any)[solo2Key] || 0) + 1;
    }
  }

  // Finalize profiles
  for (const profile of driverProfiles.values()) {
    // Determine contract type
    const solo2Count = (profile as any)['_solo2_count'] || 0;
    if (solo2Count > profile.totalShifts * 0.6) {
      profile.contractType = 'solo2';
    } else {
      profile.contractType = 'solo1';
    }

    // Find primary days (days worked >= 2 times)
    profile.primaryDays = Object.entries(profile.dayCounts)
      .filter(([_, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .map(([day]) => day);
  }

  // Group by contract type
  const solo1Drivers = [...driverProfiles.values()].filter(d => d.contractType === 'solo1')
    .sort((a, b) => b.totalShifts - a.totalShifts);
  const solo2Drivers = [...driverProfiles.values()].filter(d => d.contractType === 'solo2')
    .sort((a, b) => b.totalShifts - a.totalShifts);

  console.log(`\nSolo1 Drivers: ${solo1Drivers.length}`);
  console.log(`Solo2 Drivers: ${solo2Drivers.length}`);

  // 3. Generate recommendations
  console.log('\n=== SCHEDULING RECOMMENDATIONS ===\n');

  const recommendations: Array<{date: string; dayName: string; contractType: string; tractorId: string; driver: string; reason: string}> = [];
  const driverAssignmentCount = new Map<string, number>();

  for (const [date, dayBlocks] of [...byDay.entries()].sort()) {
    const dayName = dayBlocks[0].dayName;
    console.log(`\n--- ${date} (${dayName}) ---`);

    for (const block of dayBlocks.sort((a, b) => a.contractType.localeCompare(b.contractType))) {
      if (block.hasDriver) {
        console.log(`  ${block.contractType} ${block.tractorId}: ${block.existingDriver} (pre-assigned)`);
        recommendations.push({
          date, dayName, contractType: block.contractType, tractorId: block.tractorId,
          driver: block.existingDriver!, reason: 'Pre-assigned in CSV'
        });
        continue;
      }

      // Find best driver
      const candidates = block.contractType === 'solo2' ? solo2Drivers : solo1Drivers;
      let bestDriver: DriverProfile | null = null;
      let bestScore = -1;
      let bestReason = '';

      for (const driver of candidates) {
        // Skip if already assigned 5+ this week
        const weekCount = driverAssignmentCount.get(driver.id) || 0;
        if (weekCount >= 5) continue;

        let score = 0;
        let reason = '';

        // Score based on day preference
        if (driver.primaryDays.includes(dayName)) {
          score += 50;
          reason = `Works ${dayName}s`;
        }

        // Score based on total shifts (reliability)
        score += Math.min(driver.totalShifts, 20);

        // Penalize overloading
        score -= weekCount * 10;

        if (score > bestScore) {
          bestScore = score;
          bestDriver = driver;
          bestReason = reason || `${driver.totalShifts} shifts, ${driver.primaryDays.slice(0, 3).join('/')}`;
        }
      }

      if (bestDriver) {
        console.log(`  ${block.contractType} ${block.tractorId}: ${bestDriver.name} (${bestReason})`);
        recommendations.push({
          date, dayName, contractType: block.contractType, tractorId: block.tractorId,
          driver: bestDriver.name, reason: bestReason
        });
        driverAssignmentCount.set(bestDriver.id, (driverAssignmentCount.get(bestDriver.id) || 0) + 1);
      } else {
        console.log(`  ${block.contractType} ${block.tractorId}: ⚠️ NO AVAILABLE DRIVER`);
        recommendations.push({
          date, dayName, contractType: block.contractType, tractorId: block.tractorId,
          driver: '⚠️ UNASSIGNED', reason: 'No available driver'
        });
      }
    }
  }

  // Summary
  console.log('\n=== DRIVER WORKLOAD SUMMARY ===');
  const workloadSummary = [...driverAssignmentCount.entries()]
    .map(([id, count]) => ({ name: driverProfiles.get(id)?.name || id, count }))
    .sort((a, b) => b.count - a.count);

  for (const { name, count } of workloadSummary) {
    console.log(`  ${name}: ${count} days`);
  }

  console.log('\n=== TOP SOLO1 DRIVERS ===');
  for (const d of solo1Drivers.slice(0, 15)) {
    console.log(`  ${d.name}: ${d.totalShifts} shifts, works ${d.primaryDays.slice(0, 4).join(', ')}`);
  }

  console.log('\n=== TOP SOLO2 DRIVERS ===');
  for (const d of solo2Drivers.slice(0, 10)) {
    console.log(`  ${d.name}: ${d.totalShifts} shifts, works ${d.primaryDays.slice(0, 4).join(', ')}`);
  }

  process.exit(0);
}

analyze().catch(e => { console.error(e); process.exit(1); });
