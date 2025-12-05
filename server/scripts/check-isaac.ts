/**
 * Check a specific driver's DNA profile and recent assignments
 * Pass driver name as command line arg, e.g.: npx tsx server/scripts/check-isaac.ts "Adan"
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

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

async function checkDriver(searchName: string) {
  console.log(`\n=== Searching for driver: "${searchName}" ===\n`);

  // Find driver
  const foundDrivers = await db.select().from(drivers)
    .where(or(
      ilike(drivers.firstName, `%${searchName}%`),
      ilike(drivers.lastName, `%${searchName}%`)
    ));

  console.log(`Found ${foundDrivers.length} matching drivers\n`);

  for (const driver of foundDrivers) {
    console.log(`\n========================================`);
    console.log(`=== ${driver.firstName} ${driver.lastName} ===`);
    console.log(`========================================`);
    console.log(`Driver ID: ${driver.id}`);

    // Get current DNA profile
    const profile = await db.select().from(driverDnaProfiles)
      .where(eq(driverDnaProfiles.driverId, driver.id));

    if (profile.length > 0) {
      console.log(`\n--- Current DNA Profile ---`);
      console.log(`Contract Type: ${profile[0].preferredContractType}`);
      console.log(`Profile Days: ${JSON.stringify(profile[0].preferredDays)}`);
      console.log(`Profile Times: ${JSON.stringify(profile[0].preferredStartTimes)}`);
      console.log(`Profile Tractors: ${JSON.stringify(profile[0].preferredTractors)}`);
    } else {
      console.log(`\n⚠️ No DNA profile found`);
    }

    // Get recent assignments with ALL relevant fields
    const sixWeeksAgo = subWeeks(new Date(), 12);
    const assignments = await db
      .select({
        blockId: blocks.blockId,
        startTimestamp: blocks.startTimestamp,
        tractorId: blocks.tractorId,
        soloType: blocks.soloType,
        canonicalStart: blocks.canonicalStart,
        serviceDate: blocks.serviceDate,
      })
      .from(blockAssignments)
      .innerJoin(blocks, eq(blockAssignments.blockId, blocks.id))
      .where(
        and(
          eq(blockAssignments.driverId, driver.id),
          eq(blockAssignments.isActive, true),
          gte(blocks.startTimestamp, sixWeeksAgo)
        )
      )
      .orderBy(desc(blocks.startTimestamp));

    console.log(`\n--- Recent Assignments (${assignments.length} total) ---`);

    const timeCount = new Map<string, number>();
    const rawTimeCount = new Map<string, number>();
    const dayCount = new Map<string, number>();
    const tractorCount = new Map<string, number>();

    for (const a of assignments) {
      // Build lookup key
      const soloType = a.soloType?.toLowerCase() || 'solo1';
      const tractorId = a.tractorId || '';
      const key = `${soloType}_${tractorId}`;
      const canonicalTime = CANONICAL_START_TIMES[key];

      // Raw time from timestamp (UTC)
      const ts = a.startTimestamp;
      const rawUtcTime = ts ? new Date(ts).toISOString().split('T')[1].slice(0, 5) : '??:??';

      // Use canonical if available, else raw
      const effectiveTime = canonicalTime || rawUtcTime;

      const day = ts ? DAY_NAMES[getDay(new Date(ts))] : 'unknown';

      timeCount.set(effectiveTime, (timeCount.get(effectiveTime) || 0) + 1);
      rawTimeCount.set(rawUtcTime, (rawTimeCount.get(rawUtcTime) || 0) + 1);
      dayCount.set(day, (dayCount.get(day) || 0) + 1);
      if (tractorId) {
        tractorCount.set(tractorId, (tractorCount.get(tractorId) || 0) + 1);
      }
    }

    // Show first 15 assignments
    console.log(`\nFirst 15 assignments:`);
    for (const a of assignments.slice(0, 15)) {
      const soloType = a.soloType?.toLowerCase() || 'solo1';
      const tractorId = a.tractorId || 'NULL';
      const key = `${soloType}_${tractorId === 'NULL' ? '' : tractorId}`;
      const canonicalTime = CANONICAL_START_TIMES[key];

      const ts = a.startTimestamp;
      const rawUtcTime = ts ? new Date(ts).toISOString().split('T')[1].slice(0, 5) : '??:??';
      const day = ts ? DAY_NAMES[getDay(new Date(ts))] : 'unknown';

      const effectiveTime = canonicalTime || rawUtcTime;
      const timeSource = canonicalTime ? 'CANONICAL' : 'RAW UTC';

      console.log(`  ${day.padEnd(10)} ${effectiveTime} (${timeSource}) | Type: ${soloType.padEnd(6)} | Tractor: ${tractorId.padEnd(12)} | Key: "${key}"`);
    }

    console.log(`\n--- Time Frequencies (effective/canonical) ---`);
    for (const [time, count] of Array.from(timeCount.entries()).sort((a,b) => b[1] - a[1])) {
      console.log(`  ${time}: ${count} times`);
    }

    console.log(`\n--- Raw UTC Time Frequencies ---`);
    for (const [time, count] of Array.from(rawTimeCount.entries()).sort((a,b) => b[1] - a[1])) {
      console.log(`  ${time}: ${count} times`);
    }

    console.log(`\n--- Day Frequencies ---`);
    for (const [day, count] of Array.from(dayCount.entries()).sort((a,b) => b[1] - a[1])) {
      console.log(`  ${day}: ${count} times`);
    }

    console.log(`\n--- Tractor Frequencies ---`);
    for (const [tractor, count] of Array.from(tractorCount.entries()).sort((a,b) => b[1] - a[1])) {
      console.log(`  ${tractor}: ${count} times`);
    }

    // Analyze the issue
    console.log(`\n--- ANALYSIS ---`);
    const nullTractorAssignments = assignments.filter(a => !a.tractorId);
    if (nullTractorAssignments.length > 0) {
      console.log(`⚠️  ${nullTractorAssignments.length} assignments have NULL tractorId - these CANNOT use canonical time lookup!`);
    }
  }
}

const searchName = process.argv[2] || 'Adan';
checkDriver(searchName)
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
