/**
 * Test script to analyze ALL drivers' DNA profiles
 * and verify they match canonical start times
 */
import { db } from "../db";
import { blockAssignments, blocks, drivers, driverDnaProfiles } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { format, getDay } from "date-fns";

// Canonical start times lookup table (from dna-analyzer.ts)
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

interface DriverAnalysis {
  driverId: string;
  name: string;
  assignmentCount: number;
  actualTopDays: string[];
  actualTopTimes: string[];
  actualTopTractors: string[];
  profileDays: string[];
  profileTimes: string[];
  profileTractors: string[];
  daysMatch: boolean;
  timesMatch: boolean;
  tractorsMatch: boolean;
  overallMatch: boolean;
  consistencyScore: number;
  issues: string[];
}

async function analyzeDriver(driverId: string, driverName: string): Promise<DriverAnalysis | null> {
  // Get DNA profile
  const profiles = await db
    .select()
    .from(driverDnaProfiles)
    .where(eq(driverDnaProfiles.driverId, driverId));

  if (profiles.length === 0) {
    return null;
  }

  const profile = profiles[0];

  // Get assignments
  const assignments = await db
    .select({
      blockId: blocks.blockId,
      serviceDate: blocks.serviceDate,
      startTimestamp: blocks.startTimestamp,
      tractorId: blocks.tractorId,
      soloType: blocks.soloType,
    })
    .from(blockAssignments)
    .innerJoin(blocks, eq(blockAssignments.blockId, blocks.id))
    .where(
      and(
        eq(blockAssignments.driverId, driverId),
        eq(blockAssignments.isActive, true)
      )
    )
    .orderBy(desc(blocks.startTimestamp))
    .limit(50);

  if (assignments.length === 0) {
    return null;
  }

  // Analyze patterns
  const dayCount: Record<string, number> = {};
  const timeCount: Record<string, number> = {};
  const tractorCount: Record<string, number> = {};

  for (const a of assignments) {
    const dayOfWeek = getDay(new Date(a.startTimestamp!));
    const dayName = DAY_NAMES[dayOfWeek];
    dayCount[dayName] = (dayCount[dayName] || 0) + 1;

    const key = `${a.soloType?.toLowerCase() || 'solo1'}_${a.tractorId}`;
    const canonicalTime = CANONICAL_START_TIMES[key] || format(new Date(a.startTimestamp!), 'HH:mm');
    timeCount[canonicalTime] = (timeCount[canonicalTime] || 0) + 1;

    if (a.tractorId) {
      tractorCount[a.tractorId] = (tractorCount[a.tractorId] || 0) + 1;
    }
  }

  const sortedDays = Object.entries(dayCount).sort((a, b) => b[1] - a[1]);
  const sortedTimes = Object.entries(timeCount).sort((a, b) => b[1] - a[1]);
  const sortedTractors = Object.entries(tractorCount).sort((a, b) => b[1] - a[1]);

  const actualTopDays = sortedDays.slice(0, 4).map(d => d[0]);
  const actualTopTimes = sortedTimes.slice(0, 3).map(t => t[0]);
  const actualTopTractors = sortedTractors.slice(0, 2).map(t => t[0]);

  const profileDays = profile.preferredDays as string[] || [];
  const profileTimes = profile.preferredStartTimes as string[] || [];
  const profileTractors = profile.preferredTractors as string[] || [];

  const daysMatch = actualTopDays.every(d => profileDays.includes(d));
  const timesMatch = actualTopTimes.every(t => profileTimes.includes(t));
  const tractorsMatch = actualTopTractors.every(t => profileTractors.includes(t));

  const issues: string[] = [];
  if (!daysMatch) {
    const missingDays = actualTopDays.filter(d => !profileDays.includes(d));
    issues.push(`Missing days: ${missingDays.join(', ')}`);
  }
  if (!timesMatch) {
    const missingTimes = actualTopTimes.filter(t => !profileTimes.includes(t));
    issues.push(`Missing times: ${missingTimes.join(', ')}`);
  }
  if (!tractorsMatch) {
    const missingTractors = actualTopTractors.filter(t => !profileTractors.includes(t));
    issues.push(`Missing tractors: ${missingTractors.join(', ')}`);
  }

  return {
    driverId,
    name: driverName,
    assignmentCount: assignments.length,
    actualTopDays,
    actualTopTimes,
    actualTopTractors,
    profileDays,
    profileTimes,
    profileTractors,
    daysMatch,
    timesMatch,
    tractorsMatch,
    overallMatch: daysMatch && timesMatch && tractorsMatch,
    consistencyScore: parseFloat(profile.consistencyScore || "0"),
    issues,
  };
}

async function testAllDrivers() {
  console.log("═══════════════════════════════════════════════════════════════════════════════════════════════════");
  console.log("                                  ALL DRIVERS DNA PROFILE TEST                                       ");
  console.log("═══════════════════════════════════════════════════════════════════════════════════════════════════\n");

  // Get all DNA profiles first
  const allProfiles = await db.select().from(driverDnaProfiles);

  // Get all drivers for name lookup - concatenate firstName and lastName
  const allDrivers = await db.select().from(drivers);
  const driverNameMap = new Map(allDrivers.map(d => [d.id, `${d.firstName} ${d.lastName}`]));

  console.log(`Found ${allProfiles.length} DNA profiles to analyze\n`);

  const results: DriverAnalysis[] = [];
  const noAssignments: string[] = [];

  for (const profile of allProfiles) {
    const driverName = driverNameMap.get(profile.driverId) || 'Unknown';

    const analysis = await analyzeDriver(profile.driverId, driverName);
    if (analysis) {
      results.push(analysis);
    } else {
      noAssignments.push(driverName);
    }
  }

  // Sort by match status (mismatches first)
  results.sort((a, b) => {
    if (a.overallMatch !== b.overallMatch) return a.overallMatch ? 1 : -1;
    return b.consistencyScore - a.consistencyScore;
  });

  // Print summary
  const perfectMatch = results.filter(r => r.overallMatch);
  const partialMatch = results.filter(r => !r.overallMatch && (r.daysMatch || r.timesMatch || r.tractorsMatch));
  const noMatch = results.filter(r => !r.daysMatch && !r.timesMatch && !r.tractorsMatch);

  console.log("═══════════════════════════════════════════════════════════════════════════════════════════════════");
  console.log("                                        SUMMARY                                                     ");
  console.log("═══════════════════════════════════════════════════════════════════════════════════════════════════\n");

  console.log(`  ✅ Perfect Match: ${perfectMatch.length} drivers`);
  console.log(`  ⚠️  Partial Match: ${partialMatch.length} drivers`);
  console.log(`  ❌ No Match: ${noMatch.length} drivers`);
  console.log(`  📭 No Assignments: ${noAssignments.length} drivers\n`);

  // Print detailed results for mismatches
  if (partialMatch.length > 0 || noMatch.length > 0) {
    console.log("═══════════════════════════════════════════════════════════════════════════════════════════════════");
    console.log("                                 PROFILES NEEDING ATTENTION                                        ");
    console.log("═══════════════════════════════════════════════════════════════════════════════════════════════════\n");

    for (const r of [...noMatch, ...partialMatch]) {
      console.log(`📋 ${r.name} (${r.assignmentCount} assignments, ${(r.consistencyScore * 100).toFixed(0)}% consistency)`);
      console.log(`   Days:     Profile: [${r.profileDays.join(', ')}]`);
      console.log(`             Actual:  [${r.actualTopDays.join(', ')}] ${r.daysMatch ? '✅' : '❌'}`);
      console.log(`   Times:    Profile: [${r.profileTimes.join(', ')}]`);
      console.log(`             Actual:  [${r.actualTopTimes.join(', ')}] ${r.timesMatch ? '✅' : '❌'}`);
      console.log(`   Tractors: Profile: [${r.profileTractors.join(', ')}]`);
      console.log(`             Actual:  [${r.actualTopTractors.join(', ')}] ${r.tractorsMatch ? '✅' : '❌'}`);
      if (r.issues.length > 0) {
        console.log(`   Issues:   ${r.issues.join('; ')}`);
      }
      console.log();
    }
  }

  // Print perfect matches briefly
  if (perfectMatch.length > 0) {
    console.log("═══════════════════════════════════════════════════════════════════════════════════════════════════");
    console.log("                                    PERFECT MATCHES                                                 ");
    console.log("═══════════════════════════════════════════════════════════════════════════════════════════════════\n");

    for (const r of perfectMatch) {
      console.log(`  ✅ ${r.name.padEnd(30)} | ${r.assignmentCount.toString().padStart(2)} assignments | ${(r.consistencyScore * 100).toFixed(0)}% | Days: [${r.actualTopDays.join(',')}] | Times: [${r.actualTopTimes.join(',')}]`);
    }
    console.log();
  }

  // Print drivers with no assignments
  if (noAssignments.length > 0) {
    console.log("═══════════════════════════════════════════════════════════════════════════════════════════════════");
    console.log("                               DRIVERS WITH NO ASSIGNMENTS                                         ");
    console.log("═══════════════════════════════════════════════════════════════════════════════════════════════════\n");

    for (const name of noAssignments) {
      console.log(`  📭 ${name}`);
    }
    console.log();
  }

  console.log("═══════════════════════════════════════════════════════════════════════════════════════════════════");
  console.log("                                      TEST COMPLETE                                                 ");
  console.log("═══════════════════════════════════════════════════════════════════════════════════════════════════\n");
}

testAllDrivers()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
