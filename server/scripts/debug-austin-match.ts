/**
 * Debug script to trace WHY Austin Tyler Fall shows "No matching blocks"
 *
 * Austin should match Tractor_5 at 15:30 - let's trace the matching logic
 */

import { db } from '../db.js';
import { drivers, driverDnaProfiles, shiftOccurrences } from '../../shared/schema.js';
import { eq, ilike, and, gte, lte } from 'drizzle-orm';

async function debug() {
  console.log('='.repeat(80));
  console.log('DEBUGGING: Austin Tyler Fall Block Matching');
  console.log('='.repeat(80));

  // 1. Find Austin
  const austinResults = await db.select()
    .from(drivers)
    .where(ilike(drivers.lastName, '%fall%'));

  if (austinResults.length === 0) {
    console.log('ERROR: Austin not found');
    process.exit(1);
  }

  const austin = austinResults[0];
  console.log(`\nDriver: ${austin.firstName} ${austin.lastName}`);
  console.log(`ID: ${austin.id}`);

  // 2. Get his DNA profile
  const profile = await db.select()
    .from(driverDnaProfiles)
    .where(eq(driverDnaProfiles.driverId, austin.id));

  if (profile.length === 0) {
    console.log('ERROR: No DNA profile found');
    process.exit(1);
  }

  const dna = profile[0];
  console.log('\n--- DNA PROFILE ---');
  console.log(`Contract Type: ${dna.preferredContractType}`);
  console.log(`Preferred Days: ${JSON.stringify(dna.preferredDays)}`);
  console.log(`Preferred Times: ${JSON.stringify(dna.preferredStartTimes)}`);
  console.log(`Preferred Tractors: ${JSON.stringify(dna.preferredTractors)}`);

  // 3. Get unassigned blocks for this week
  const weekStart = new Date('2025-11-30');
  const weekEnd = new Date('2025-12-06');

  console.log('\n--- CHECKING BLOCK B-3K7KJZ831 (Sun 15:30 Tractor_5) ---');

  // The block shown in screenshot: B-3K7KJZ831, Sun Nov 30, 15:30, Tractor_5, SOLO2
  const blockDate = '2025-11-30';
  const blockTime = '15:30';
  const blockTractor = 'Tractor_5';
  const blockContractType = 'solo2';

  // Check each matching criteria
  console.log('\n[CRITERION 1] Contract Type Match:');
  console.log(`  Block: ${blockContractType}`);
  console.log(`  Driver preferred: ${dna.preferredContractType}`);
  console.log(`  MATCH: ${blockContractType.toLowerCase() === dna.preferredContractType?.toLowerCase()}`);

  console.log('\n[CRITERION 2] Day Match:');
  const dayOfWeek = new Date(blockDate).toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
  console.log(`  Block day: ${dayOfWeek}`);
  console.log(`  Driver preferred days: ${JSON.stringify(dna.preferredDays)}`);
  const dayMatches = dna.preferredDays?.map(d => d.toLowerCase()).includes(dayOfWeek);
  console.log(`  MATCH: ${dayMatches}`);

  console.log('\n[CRITERION 3] Time Match (within 2 hours):');
  console.log(`  Block time: ${blockTime}`);
  console.log(`  Driver preferred times: ${JSON.stringify(dna.preferredStartTimes)}`);

  // Time matching logic
  const timeToMinutes = (time: string): number => {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + (m || 0);
  };

  const blockMinutes = timeToMinutes(blockTime);
  console.log(`  Block in minutes: ${blockMinutes}`);

  let bestTimeDiff = Infinity;
  for (const prefTime of (dna.preferredStartTimes || [])) {
    const prefMinutes = timeToMinutes(prefTime);
    const diff = Math.abs(blockMinutes - prefMinutes);
    const wrapDiff = Math.min(diff, 1440 - diff);
    console.log(`    Comparing to ${prefTime} (${prefMinutes} min): diff = ${wrapDiff} minutes`);
    if (wrapDiff < bestTimeDiff) {
      bestTimeDiff = wrapDiff;
    }
  }
  console.log(`  Best time diff: ${bestTimeDiff} minutes (${(bestTimeDiff / 60).toFixed(1)} hours)`);
  console.log(`  TIME MATCH (within 120 min): ${bestTimeDiff <= 120}`);

  console.log('\n[CRITERION 4] Tractor Match (optional):');
  console.log(`  Block tractor: ${blockTractor}`);
  console.log(`  Driver preferred tractors: ${JSON.stringify(dna.preferredTractors)}`);
  const tractorMatches = dna.preferredTractors?.includes(blockTractor);
  console.log(`  MATCH: ${tractorMatches}`);

  // Overall match
  console.log('\n' + '='.repeat(40));
  console.log('OVERALL MATCH RESULT:');
  console.log('='.repeat(40));

  const contractMatch = blockContractType.toLowerCase() === dna.preferredContractType?.toLowerCase();
  const timeMatch = bestTimeDiff <= 120;

  if (!contractMatch) {
    console.log(`❌ FAILED: Contract type mismatch (${blockContractType} vs ${dna.preferredContractType})`);
  } else if (!dayMatches) {
    console.log(`❌ FAILED: Day mismatch (${dayOfWeek} not in ${JSON.stringify(dna.preferredDays)})`);
  } else if (!timeMatch) {
    console.log(`❌ FAILED: Time too far off (${bestTimeDiff} minutes > 120 minutes)`);
  } else {
    console.log('✅ SHOULD MATCH!');
  }

  console.log('\n' + '='.repeat(80));
  process.exit(0);
}

debug().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
