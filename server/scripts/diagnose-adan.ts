/**
 * Diagnostic script to check what assignment data exists for Adan
 * and what the DNA analyzer is actually seeing
 */

import { db } from '../db.js';
import { drivers, blockAssignments, blocks, shiftOccurrences } from '../../shared/schema.js';
import { eq, and, ilike, desc, gte, lte } from 'drizzle-orm';
import { subWeeks, startOfWeek, format } from 'date-fns';

async function diagnoseAdan() {
  console.log('='.repeat(80));
  console.log('ADAN ASSIGNMENT DIAGNOSTIC');
  console.log('='.repeat(80));

  // Find Adan
  const adanResults = await db.select()
    .from(drivers)
    .where(ilike(drivers.firstName, '%adan%'));

  if (adanResults.length === 0) {
    console.log('ERROR: Adan not found in drivers table');
    process.exit(1);
  }

  const adan = adanResults[0];
  console.log(`\nFound driver: ${adan.firstName} ${adan.lastName} (ID: ${adan.id})`);
  console.log(`Tenant: ${adan.tenantId}`);

  // Calculate date range (same as DNA analyzer)
  const now = new Date();
  const startDate = subWeeks(startOfWeek(now, { weekStartsOn: 0 }), 12);
  const endDate = now;

  console.log(`\nDate range for 12-week lookback:`);
  console.log(`  Start: ${format(startDate, 'yyyy-MM-dd')} (${format(startDate, 'EEEE')})`);
  console.log(`  End:   ${format(endDate, 'yyyy-MM-dd')} (${format(endDate, 'EEEE')})`);

  // Check blocks table for assignments
  console.log('\n--- BLOCKS TABLE ASSIGNMENTS ---');
  const blockAssignmentResults = await db.select({
    blockId: blocks.blockId,
    serviceDate: blocks.serviceDate,
    startTime: blocks.startTimestamp,
    soloType: blocks.soloType,
    tractorId: blocks.tractorId,
    driverId: blockAssignments.driverId,
  })
  .from(blockAssignments)
  .innerJoin(blocks, eq(blockAssignments.blockId, blocks.id))
  .where(
    and(
      eq(blockAssignments.driverId, adan.id),
      eq(blockAssignments.isActive, true),
      gte(blocks.startTimestamp, startDate),
      lte(blocks.startTimestamp, endDate)
    )
  )
  .orderBy(desc(blocks.startTimestamp));

  console.log(`Found ${blockAssignmentResults.length} assignments from blocks table:`);
  for (const a of blockAssignmentResults.slice(0, 15)) {
    const date = a.serviceDate ? format(new Date(a.serviceDate), 'yyyy-MM-dd (EEE)') : 'N/A';
    const time = a.startTime ? format(new Date(a.startTime), 'HH:mm') : 'N/A';
    console.log(`  ${date} @ ${time} - ${a.soloType} - ${a.tractorId || 'No tractor'}`);
  }
  if (blockAssignmentResults.length > 15) {
    console.log(`  ... and ${blockAssignmentResults.length - 15} more`);
  }

  // Check shift_occurrences for assignments
  console.log('\n--- SHIFT_OCCURRENCES TABLE ASSIGNMENTS ---');
  const shiftResults = await db.select({
    occurrenceId: shiftOccurrences.occurrenceId,
    serviceDate: shiftOccurrences.serviceDate,
    startTime: shiftOccurrences.scheduledStart,
    contractType: shiftOccurrences.contractType,
    tractorId: shiftOccurrences.tractorId,
    driverId: blockAssignments.driverId,
  })
  .from(blockAssignments)
  .innerJoin(shiftOccurrences, eq(blockAssignments.occurrenceId, shiftOccurrences.id))
  .where(
    and(
      eq(blockAssignments.driverId, adan.id),
      eq(blockAssignments.isActive, true),
      gte(shiftOccurrences.scheduledStart, startDate),
      lte(shiftOccurrences.scheduledStart, endDate)
    )
  )
  .orderBy(desc(shiftOccurrences.scheduledStart));

  console.log(`Found ${shiftResults.length} assignments from shift_occurrences table:`);
  for (const a of shiftResults.slice(0, 15)) {
    const date = a.serviceDate ? format(new Date(a.serviceDate), 'yyyy-MM-dd (EEE)') : 'N/A';
    const time = a.startTime ? format(new Date(a.startTime), 'HH:mm') : 'N/A';
    console.log(`  ${date} @ ${time} - ${a.contractType} - ${a.tractorId || 'No tractor'}`);
  }
  if (shiftResults.length > 15) {
    console.log(`  ... and ${shiftResults.length - 15} more`);
  }

  // Count by contract type
  console.log('\n--- CONTRACT TYPE BREAKDOWN ---');
  const solo1Blocks = blockAssignmentResults.filter(a => a.soloType?.toLowerCase() === 'solo1').length;
  const solo2Blocks = blockAssignmentResults.filter(a => a.soloType?.toLowerCase() === 'solo2').length;
  const solo1Shifts = shiftResults.filter(a => a.contractType?.toLowerCase() === 'solo1').length;
  const solo2Shifts = shiftResults.filter(a => a.contractType?.toLowerCase() === 'solo2').length;

  console.log(`Blocks table: Solo1=${solo1Blocks}, Solo2=${solo2Blocks}`);
  console.log(`Shifts table: Solo1=${solo1Shifts}, Solo2=${solo2Shifts}`);

  // Count unique start times
  console.log('\n--- START TIME FREQUENCY ---');
  const timeFreq = new Map<string, number>();
  for (const a of [...blockAssignmentResults, ...shiftResults]) {
    if (a.startTime) {
      const time = format(new Date(a.startTime), 'HH:mm');
      timeFreq.set(time, (timeFreq.get(time) || 0) + 1);
    }
  }
  const sortedTimes = Array.from(timeFreq.entries()).sort((a, b) => b[1] - a[1]);
  for (const [time, count] of sortedTimes.slice(0, 10)) {
    console.log(`  ${time}: ${count} times`);
  }

  // Check what's in the DNA profile
  console.log('\n--- CURRENT DNA PROFILE ---');
  const { driverDnaProfiles } = await import('../../shared/schema.js');
  const dnaProfile = await db.select()
    .from(driverDnaProfiles)
    .where(eq(driverDnaProfiles.driverId, adan.id));

  if (dnaProfile.length > 0) {
    const p = dnaProfile[0];
    console.log(`Contract Type: ${p.preferredContractType}`);
    console.log(`Preferred Days: ${JSON.stringify(p.preferredDays)}`);
    console.log(`Preferred Times: ${JSON.stringify(p.preferredStartTimes)}`);
    console.log(`Preferred Tractors: ${JSON.stringify(p.preferredTractors)}`);
    console.log(`Pattern Group: ${p.patternGroup}`);
    console.log(`Assignments Analyzed: ${p.assignmentsAnalyzed}`);
    console.log(`Analysis Start: ${p.analysisStartDate ? format(new Date(p.analysisStartDate), 'yyyy-MM-dd') : 'N/A'}`);
    console.log(`Analysis End: ${p.analysisEndDate ? format(new Date(p.analysisEndDate), 'yyyy-MM-dd') : 'N/A'}`);
    console.log(`AI Summary: ${p.aiSummary}`);
  } else {
    console.log('No DNA profile found for Adan');
  }

  console.log('\n' + '='.repeat(80));
  process.exit(0);
}

diagnoseAdan().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
