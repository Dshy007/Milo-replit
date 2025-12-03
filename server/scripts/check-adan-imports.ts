import { db } from '../db';
import { drivers, shiftOccurrences, blockAssignments, blocks } from '../../shared/schema';
import { eq, ilike, or, desc, isNotNull } from 'drizzle-orm';

async function checkAdanImports() {
  // Find Adan Sandhool
  const adanDrivers = await db.select().from(drivers).where(
    or(
      ilike(drivers.firstName, '%adan%'),
      ilike(drivers.lastName, '%sandh%')
    )
  );

  if (adanDrivers.length === 0) {
    console.log('No driver found!');
    process.exit(1);
  }

  const adanId = adanDrivers[0].id;
  const adanName = `${adanDrivers[0].firstName} ${adanDrivers[0].lastName}`;
  console.log('Driver:', adanName);
  console.log('Driver ID:', adanId);

  // Get all shift occurrences assigned to Adan
  const imports = await db.select({
    id: shiftOccurrences.id,
    blockId: shiftOccurrences.blockId,
    serviceDate: shiftOccurrences.serviceDate,
    startTime: shiftOccurrences.startTime,
    contractType: blocks.contractType,
    tractorId: blocks.tractorId,
    driverId: shiftOccurrences.driverId,
  })
    .from(shiftOccurrences)
    .leftJoin(blocks, eq(shiftOccurrences.blockId, blocks.id))
    .where(eq(shiftOccurrences.driverId, adanId))
    .orderBy(desc(shiftOccurrences.serviceDate));

  console.log('\n=== IMPORTED BLOCKS (' + imports.length + ' total) ===');

  // Show recent imports
  for (const imp of imports.slice(0, 40)) {
    const date = imp.serviceDate ? new Date(imp.serviceDate + 'T00:00:00') : null;
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayName = date ? dayNames[date.getDay()] : '???';
    console.log(`  ${imp.serviceDate} (${dayName}) @ ${imp.startTime} - ${imp.contractType} - ${imp.tractorId} - ${imp.blockId}`);
  }

  // Analyze pattern from imported blocks
  const byContract: Record<string, number> = {};
  const byDay: Record<string, number> = {};
  const byTime: Record<string, number> = {};
  const byTractor: Record<string, number> = {};

  for (const imp of imports) {
    // Contract type
    const ct = imp.contractType || 'unknown';
    byContract[ct] = (byContract[ct] || 0) + 1;

    // Day of week
    if (imp.serviceDate) {
      const date = new Date(imp.serviceDate + 'T00:00:00');
      const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const day = days[date.getDay()];
      byDay[day] = (byDay[day] || 0) + 1;
    }

    // Start time
    const time = imp.startTime || 'unknown';
    byTime[time] = (byTime[time] || 0) + 1;

    // Tractor
    const tractor = imp.tractorId || 'unknown';
    byTractor[tractor] = (byTractor[tractor] || 0) + 1;
  }

  const totalImports = imports.length;
  console.log('\n=== ACTUAL PATTERN FROM IMPORTED BLOCKS ===');
  console.log('Total Imports:', totalImports);
  console.log('By Contract Type:', byContract);
  console.log('By Day of Week:', byDay);
  console.log('By Start Time:', byTime);
  console.log('By Tractor:', byTractor);

  // Calculate what DNA profile SHOULD be
  console.log('\n=== WHAT DNA PROFILE SHOULD BE ===');

  // Preferred contract type (majority)
  const sortedContracts = Object.entries(byContract).sort((a, b) => b[1] - a[1]);
  const topContract = sortedContracts[0];
  console.log('Preferred Contract:', topContract?.[0], `(${topContract?.[1]}/${totalImports} = ${Math.round((topContract?.[1] || 0) / totalImports * 100)}%)`);

  // Preferred days (>= 10% of assignments)
  const dayThreshold = Math.max(2, totalImports * 0.1);
  const preferredDays = Object.entries(byDay)
    .filter(([_, count]) => count >= dayThreshold)
    .sort((a, b) => b[1] - a[1])
    .map(([day, count]) => `${day} (${count})`);
  console.log('Preferred Days (>=10%):', preferredDays.join(', '));

  // Preferred times
  const timeThreshold = Math.max(2, totalImports * 0.1);
  const preferredTimes = Object.entries(byTime)
    .filter(([_, count]) => count >= timeThreshold)
    .sort((a, b) => b[1] - a[1])
    .map(([time, count]) => `${time} (${count})`);
  console.log('Preferred Times (>=10%):', preferredTimes.join(', '));

  // Count weeks
  const weekSet = new Set<string>();
  for (const imp of imports) {
    if (imp.serviceDate) {
      const date = new Date(imp.serviceDate + 'T00:00:00');
      // Get ISO week
      const startOfYear = new Date(date.getFullYear(), 0, 1);
      const days = Math.floor((date.getTime() - startOfYear.getTime()) / (24 * 60 * 60 * 1000));
      const weekNum = Math.ceil((days + startOfYear.getDay() + 1) / 7);
      weekSet.add(`${date.getFullYear()}-W${weekNum}`);
    }
  }
  console.log('Weeks with data:', weekSet.size);
  console.log('Avg assignments per week:', (totalImports / weekSet.size).toFixed(1));

  process.exit(0);
}

checkAdanImports().catch(console.error);
