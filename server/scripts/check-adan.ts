import { db } from '../db';
import { drivers, blockAssignments, blocks, driverDnaProfiles } from '../../shared/schema';
import { eq, ilike, sql, and, or } from 'drizzle-orm';

async function checkAdan() {
  // Find Adan Sandhool
  const adanDrivers = await db.select().from(drivers).where(
    or(
      ilike(drivers.firstName, '%adan%'),
      ilike(drivers.lastName, '%sandh%')
    )
  );

  console.log('=== DRIVER RECORD ===');
  console.log(JSON.stringify(adanDrivers, null, 2));

  if (adanDrivers.length === 0) {
    console.log('No driver found!');
    process.exit(1);
  }

  const adanId = adanDrivers[0].id;
  console.log('\nDriver ID:', adanId);

  // Get DNA profile
  const dnaProfile = await db.select().from(driverDnaProfiles).where(
    eq(driverDnaProfiles.driverId, adanId)
  );

  console.log('\n=== CURRENT DNA PROFILE ===');
  if (dnaProfile.length > 0) {
    console.log(JSON.stringify(dnaProfile[0], null, 2));
  } else {
    console.log('No DNA profile found!');
  }

  // Get all assignments for Adan
  const assignments = await db.select({
    assignmentId: blockAssignments.id,
    blockId: blockAssignments.blockId,
    serviceDate: blockAssignments.serviceDate,
    startTime: blockAssignments.startTime,
    contractType: blocks.contractType,
    tractorId: blocks.tractorId,
  })
  .from(blockAssignments)
  .leftJoin(blocks, eq(blockAssignments.blockId, blocks.id))
  .where(eq(blockAssignments.driverId, adanId))
  .orderBy(blockAssignments.serviceDate);

  console.log('\n=== ALL ASSIGNMENTS (' + assignments.length + ' total) ===');

  // Show last 30 assignments
  const recent = assignments.slice(-30);
  for (const a of recent) {
    const date = a.serviceDate ? new Date(a.serviceDate + 'T00:00:00') : null;
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayName = date ? dayNames[date.getDay()] : '???';
    console.log(`  ${a.serviceDate} (${dayName}) @ ${a.startTime} - ${a.contractType} - ${a.tractorId}`);
  }

  // Analyze pattern
  const byContract: Record<string, number> = {};
  const byDay: Record<string, number> = {};
  const byTime: Record<string, number> = {};
  const byTractor: Record<string, number> = {};

  for (const a of assignments) {
    // Contract type
    const ct = a.contractType || 'unknown';
    byContract[ct] = (byContract[ct] || 0) + 1;

    // Day of week
    if (a.serviceDate) {
      const date = new Date(a.serviceDate + 'T00:00:00');
      const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const day = days[date.getDay()];
      byDay[day] = (byDay[day] || 0) + 1;
    }

    // Start time
    const time = a.startTime || 'unknown';
    byTime[time] = (byTime[time] || 0) + 1;

    // Tractor
    const tractor = a.tractorId || 'unknown';
    byTractor[tractor] = (byTractor[tractor] || 0) + 1;
  }

  console.log('\n=== ACTUAL PATTERN ANALYSIS ===');
  console.log('By Contract Type:', byContract);
  console.log('By Day of Week:', byDay);
  console.log('By Start Time:', byTime);
  console.log('By Tractor:', byTractor);

  // Calculate what DNA profile SHOULD be
  const totalAssignments = assignments.length;
  console.log('\n=== RECOMMENDED DNA PROFILE ===');

  // Preferred contract type (majority)
  const sortedContracts = Object.entries(byContract).sort((a, b) => b[1] - a[1]);
  console.log('Preferred Contract:', sortedContracts[0]?.[0], `(${sortedContracts[0]?.[1]}/${totalAssignments} = ${Math.round((sortedContracts[0]?.[1] || 0) / totalAssignments * 100)}%)`);

  // Preferred days (>= 20% of assignments)
  const threshold = totalAssignments * 0.1; // 10% threshold
  const preferredDays = Object.entries(byDay)
    .filter(([_, count]) => count >= threshold)
    .sort((a, b) => b[1] - a[1])
    .map(([day]) => day);
  console.log('Preferred Days:', preferredDays.join(', '));

  // Preferred times
  const preferredTimes = Object.entries(byTime)
    .filter(([_, count]) => count >= threshold)
    .sort((a, b) => b[1] - a[1])
    .map(([time]) => time);
  console.log('Preferred Times:', preferredTimes.join(', '));

  // Preferred tractors
  const preferredTractors = Object.entries(byTractor)
    .filter(([_, count]) => count >= threshold)
    .sort((a, b) => b[1] - a[1])
    .map(([tractor]) => tractor);
  console.log('Preferred Tractors:', preferredTractors.join(', '));

  process.exit(0);
}

checkAdan().catch(console.error);
