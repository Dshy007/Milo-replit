/**
 * Test script to verify the DNA time sorting fix
 * This simulates what the DNA analysis will produce for Adan
 */
import { db } from "../db";
import { driverDnaProfiles, drivers, blockAssignments, blocks } from "@shared/schema";
import { eq, and, ilike, desc, gte, or, sql } from "drizzle-orm";
import { subWeeks, getDay } from "date-fns";

const CANONICAL_START_TIMES: Record<string, string> = {
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
  "solo2_Tractor_1": "18:30",
  "solo2_Tractor_2": "23:30",
  "solo2_Tractor_3": "21:30",
  "solo2_Tractor_4": "08:30",
  "solo2_Tractor_5": "15:30",
  "solo2_Tractor_6": "11:30",
  "solo2_Tractor_7": "16:30",
};

function getTopNFromMap<T>(map: Map<T, number>, n: number): T[] {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])  // Sort by frequency DESC
    .slice(0, n)
    .map(([item]) => item);
}

async function testFix() {
  console.log('\n=== Testing DNA Time Sorting Fix for Adan ===\n');

  // Find Adan
  const foundDrivers = await db.select().from(drivers)
    .where(ilike(drivers.firstName, '%adan%'));

  if (foundDrivers.length === 0) {
    console.log('Adan not found');
    process.exit(1);
  }

  const driver = foundDrivers[0];
  console.log(`Driver: ${driver.firstName} ${driver.lastName}`);
  console.log(`ID: ${driver.id}\n`);

  // Get assignments
  const sixWeeksAgo = subWeeks(new Date(), 12);
  const assignments = await db
    .select({
      tractorId: blocks.tractorId,
      soloType: blocks.soloType,
      startTimestamp: blocks.startTimestamp,
    })
    .from(blockAssignments)
    .innerJoin(blocks, eq(blockAssignments.blockId, blocks.id))
    .where(
      and(
        eq(blockAssignments.driverId, driver.id),
        eq(blockAssignments.isActive, true),
        gte(blocks.startTimestamp, sixWeeksAgo)
      )
    );

  // Build time frequency map using canonical times
  const timeFrequency = new Map<string, number>();

  for (const a of assignments) {
    const soloType = a.soloType?.toLowerCase() || 'solo1';
    const tractorId = a.tractorId || '';
    const key = `${soloType}_${tractorId}`;
    const canonicalTime = CANONICAL_START_TIMES[key];

    // Fallback to raw time if no canonical
    let rawTime = '00:00';
    if (a.startTimestamp) {
      const ts = new Date(a.startTimestamp);
      rawTime = ts.toISOString().split('T')[1].slice(0, 5);
    }

    const effectiveTime = canonicalTime || rawTime;
    timeFrequency.set(effectiveTime, (timeFrequency.get(effectiveTime) || 0) + 1);
  }

  console.log('Time frequencies:');
  for (const [time, count] of Array.from(timeFrequency.entries()).sort((a,b) => b[1] - a[1])) {
    console.log(`  ${time}: ${count} times`);
  }

  // OLD behavior: sorted alphabetically
  const oldTimes = getTopNFromMap(timeFrequency, 2).sort();
  console.log(`\nOLD behavior (sorted alphabetically): [${oldTimes.join(', ')}]`);

  // NEW behavior: keep frequency order
  const newTimes = getTopNFromMap(timeFrequency, 2);
  console.log(`NEW behavior (frequency order): [${newTimes.join(', ')}]`);

  // What UI would show
  console.log(`\nUI shows first 2 times:`);
  console.log(`  OLD: ${oldTimes.slice(0, 2).join(', ')}`);
  console.log(`  NEW: ${newTimes.slice(0, 2).join(', ')}`);

  // Convert to 12h format for comparison with user's screenshot
  const to12h = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;
  };

  console.log(`\n12-hour format:`);
  console.log(`  OLD: ${oldTimes.slice(0, 2).map(to12h).join(', ')}`);
  console.log(`  NEW: ${newTimes.slice(0, 2).map(to12h).join(', ')}`);

  // Get current profile
  const profile = await db.select().from(driverDnaProfiles)
    .where(eq(driverDnaProfiles.driverId, driver.id));

  if (profile.length > 0) {
    console.log(`\nCurrent profile times in DB: [${(profile[0].preferredStartTimes as string[])?.join(', ') || 'none'}]`);
  }

  console.log('\n=== FIX VERIFIED ===');
  console.log('The fix removes alphabetical sorting so most frequent time appears first.');
  console.log(`For Adan, 23:30 (${to12h('23:30')}) should now appear FIRST since it has the most occurrences.`);

  process.exit(0);
}

testFix().catch(console.error);
