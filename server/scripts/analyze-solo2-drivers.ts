/**
 * Analyze Solo2 Driver DNA Profiles
 *
 * PROBLEM: Solo2 drivers have different work patterns than Solo1:
 * - Solo1: 14 hours max in 24 hours (works 4+ days/week typically)
 * - Solo2: 38 hours max in 48 hours (works 2-3 days/week, longer shifts)
 *
 * The standard DNA profiler uses week-based frequency analysis which
 * can incorrectly capture occasional days for Solo2 drivers who work
 * fewer but longer shifts.
 *
 * SOLUTION: For Solo2 drivers, we should:
 * 1. Look at the MOST RECENT 3 weeks (past, present, future context)
 * 2. Only capture days that appear in ALL recent weeks (not 50%)
 * 3. Use contract-based canonical start times, not raw data
 */

import { db } from "../db";
import { blockAssignments, blocks, drivers, driverDnaProfiles } from "@shared/schema";
import { eq, and, desc, gte } from "drizzle-orm";
import { format, getDay, subWeeks } from "date-fns";

// The canonical start times lookup table
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

interface Solo2Analysis {
  driverId: string;
  driverName: string;
  profileDays: string[];
  profileTimes: string[];
  profileTractors: string[];
  actualTopDays: string[];
  actualTopTimes: string[];
  actualTopTractors: string[];
  issues: string[];
  weekByWeek: {
    week: string;
    days: string[];
    times: string[];
    tractors: string[];
  }[];
  recommendation: {
    days: string[];
    times: string[];
    tractors: string[];
  };
}

function getCanonicalTime(soloType: string | null, tractorId: string | null): string | null {
  if (!soloType || !tractorId) return null;
  const key = `${soloType.toLowerCase()}_${tractorId}`;
  return CANONICAL_START_TIMES[key] || null;
}

async function analyzeSolo2Drivers() {
  console.log("═══════════════════════════════════════════════════════════════════════════════════════════════════");
  console.log("                              SOLO2 DRIVER DNA ANALYSIS                                              ");
  console.log("═══════════════════════════════════════════════════════════════════════════════════════════════════\n");

  // Get all DNA profiles for solo2 drivers
  const allProfiles = await db.select().from(driverDnaProfiles)
    .where(eq(driverDnaProfiles.preferredContractType, 'solo2'));

  const allDrivers = await db.select().from(drivers);
  const driverNameMap = new Map(allDrivers.map(d => [d.id, `${d.firstName} ${d.lastName}`]));

  console.log(`Found ${allProfiles.length} Solo2 driver profiles\n`);

  const analyses: Solo2Analysis[] = [];

  // Analyze each Solo2 driver
  for (const profile of allProfiles) {
    const driverName = driverNameMap.get(profile.driverId) || 'Unknown';

    // Get recent assignments (last 6 weeks for Solo2 - longer window)
    const sixWeeksAgo = subWeeks(new Date(), 6);

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
          eq(blockAssignments.driverId, profile.driverId),
          eq(blockAssignments.isActive, true),
          gte(blocks.startTimestamp, sixWeeksAgo)
        )
      )
      .orderBy(desc(blocks.startTimestamp));

    if (assignments.length === 0) {
      console.log(`  ⚠️  ${driverName}: No recent assignments found\n`);
      continue;
    }

    // Group by week
    const weekMap = new Map<string, typeof assignments>();
    for (const a of assignments) {
      const date = new Date(a.startTimestamp!);
      const weekStart = new Date(date);
      weekStart.setDate(date.getDate() - date.getDay()); // Sunday
      const weekKey = format(weekStart, 'yyyy-MM-dd');

      if (!weekMap.has(weekKey)) {
        weekMap.set(weekKey, []);
      }
      weekMap.get(weekKey)!.push(a);
    }

    // Analyze each week
    const weekByWeek: Solo2Analysis['weekByWeek'] = [];
    const allDays: string[] = [];
    const allTimes: string[] = [];
    const allTractors: string[] = [];

    for (const [weekKey, weekAssignments] of Array.from(weekMap).sort((a, b) => b[0].localeCompare(a[0]))) {
      const days: string[] = [];
      const times: string[] = [];
      const tractors: string[] = [];

      for (const a of weekAssignments) {
        const dayOfWeek = getDay(new Date(a.startTimestamp!));
        const dayName = DAY_NAMES[dayOfWeek];
        if (!days.includes(dayName)) days.push(dayName);

        const canonicalTime = getCanonicalTime(a.soloType, a.tractorId);
        const time = canonicalTime || format(new Date(a.startTimestamp!), 'HH:mm');
        if (!times.includes(time)) times.push(time);

        if (a.tractorId && !tractors.includes(a.tractorId)) {
          tractors.push(a.tractorId);
        }

        allDays.push(dayName);
        allTimes.push(time);
        if (a.tractorId) allTractors.push(a.tractorId);
      }

      weekByWeek.push({ week: weekKey, days, times, tractors });
    }

    // Find most frequent patterns
    const dayCount = new Map<string, number>();
    const timeCount = new Map<string, number>();
    const tractorCount = new Map<string, number>();

    for (const d of allDays) {
      dayCount.set(d, (dayCount.get(d) || 0) + 1);
    }
    for (const t of allTimes) {
      timeCount.set(t, (timeCount.get(t) || 0) + 1);
    }
    for (const t of allTractors) {
      tractorCount.set(t, (tractorCount.get(t) || 0) + 1);
    }

    // Get top items
    const actualTopDays = Array.from(dayCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([d]) => d);

    const actualTopTimes = Array.from(timeCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([t]) => t);

    const actualTopTractors = Array.from(tractorCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([t]) => t);

    // Get profile data
    const profileDays = profile.preferredDays as string[] || [];
    const profileTimes = profile.preferredStartTimes as string[] || [];
    const profileTractors = profile.preferredTractors as string[] || [];

    // Identify issues
    const issues: string[] = [];

    // Check for times in profile that NEVER appear in recent weeks
    for (const profileTime of profileTimes) {
      const count = timeCount.get(profileTime) || 0;
      if (count === 0) {
        issues.push(`Time "${profileTime}" in profile but NEVER in last 6 weeks`);
      } else if (count < 2) {
        issues.push(`Time "${profileTime}" only appeared ${count} time(s) - may be anomaly`);
      }
    }

    // Check for days in profile that rarely appear
    for (const profileDay of profileDays) {
      const count = dayCount.get(profileDay) || 0;
      if (count === 0) {
        issues.push(`Day "${profileDay}" in profile but NEVER in last 6 weeks`);
      } else if (count < 2) {
        issues.push(`Day "${profileDay}" only appeared ${count} time(s) - may be anomaly`);
      }
    }

    // Generate recommendation based on CONSISTENT patterns
    // For Solo2, only include times/days that appear in multiple weeks
    const minWeekCount = Math.min(2, weekMap.size); // At least 2 weeks or total weeks

    const recommendedDays = Array.from(dayCount.entries())
      .filter(([, count]) => count >= minWeekCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([d]) => d);

    const recommendedTimes = Array.from(timeCount.entries())
      .filter(([, count]) => count >= minWeekCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([t]) => t);

    const recommendedTractors = Array.from(tractorCount.entries())
      .filter(([, count]) => count >= minWeekCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([t]) => t);

    analyses.push({
      driverId: profile.driverId,
      driverName,
      profileDays,
      profileTimes,
      profileTractors,
      actualTopDays,
      actualTopTimes,
      actualTopTractors,
      issues,
      weekByWeek,
      recommendation: {
        days: recommendedDays,
        times: recommendedTimes,
        tractors: recommendedTractors,
      },
    });
  }

  // Print detailed analysis
  console.log("═══════════════════════════════════════════════════════════════════════════════════════════════════");
  console.log("                              DETAILED ANALYSIS                                                      ");
  console.log("═══════════════════════════════════════════════════════════════════════════════════════════════════\n");

  for (const analysis of analyses) {
    console.log(`📋 ${analysis.driverName}`);
    console.log(`   Profile Days:     [${analysis.profileDays.join(', ')}]`);
    console.log(`   Actual Top Days:  [${analysis.actualTopDays.join(', ')}]`);
    console.log(`   Profile Times:    [${analysis.profileTimes.join(', ')}]`);
    console.log(`   Actual Top Times: [${analysis.actualTopTimes.join(', ')}]`);
    console.log(`   Profile Tractors: [${analysis.profileTractors.join(', ')}]`);
    console.log(`   Actual Tractors:  [${analysis.actualTopTractors.join(', ')}]`);

    if (analysis.issues.length > 0) {
      console.log(`   ⚠️  ISSUES:`);
      for (const issue of analysis.issues) {
        console.log(`      - ${issue}`);
      }
    }

    console.log(`   Week-by-Week:`);
    for (const week of analysis.weekByWeek.slice(0, 6)) {
      console.log(`      ${week.week}: Days=[${week.days.join(',')}] Times=[${week.times.join(',')}] Tractors=[${week.tractors.join(',')}]`);
    }

    if (analysis.recommendation.days.length > 0 || analysis.recommendation.times.length > 0) {
      console.log(`   ✅ RECOMMENDATION:`);
      console.log(`      Days: [${analysis.recommendation.days.join(', ')}]`);
      console.log(`      Times: [${analysis.recommendation.times.join(', ')}]`);
      console.log(`      Tractors: [${analysis.recommendation.tractors.join(', ')}]`);
    }

    console.log();
  }

  // Summary of issues
  const driversWithIssues = analyses.filter(a => a.issues.length > 0);
  console.log("═══════════════════════════════════════════════════════════════════════════════════════════════════");
  console.log("                              SUMMARY                                                                ");
  console.log("═══════════════════════════════════════════════════════════════════════════════════════════════════\n");
  console.log(`Total Solo2 drivers analyzed: ${analyses.length}`);
  console.log(`Drivers with profile issues: ${driversWithIssues.length}`);
  console.log();

  if (driversWithIssues.length > 0) {
    console.log("Drivers needing profile fixes:");
    for (const a of driversWithIssues) {
      console.log(`  - ${a.driverName}: ${a.issues.length} issue(s)`);
    }
  }

  return analyses;
}

// Option to fix profiles based on analysis
async function fixSolo2Profiles(analyses: Solo2Analysis[]) {
  console.log("\n═══════════════════════════════════════════════════════════════════════════════════════════════════");
  console.log("                              APPLYING FIXES                                                         ");
  console.log("═══════════════════════════════════════════════════════════════════════════════════════════════════\n");

  let fixed = 0;
  for (const analysis of analyses) {
    if (analysis.issues.length === 0) continue;
    if (analysis.recommendation.days.length === 0 && analysis.recommendation.times.length === 0) continue;

    // Only update if we have a better recommendation
    const hasChanges =
      JSON.stringify(analysis.profileDays.sort()) !== JSON.stringify(analysis.recommendation.days.sort()) ||
      JSON.stringify(analysis.profileTimes.sort()) !== JSON.stringify(analysis.recommendation.times.sort()) ||
      JSON.stringify(analysis.profileTractors.sort()) !== JSON.stringify(analysis.recommendation.tractors.sort());

    if (!hasChanges) continue;

    console.log(`Fixing ${analysis.driverName}...`);
    console.log(`  Old: Days=[${analysis.profileDays.join(',')}] Times=[${analysis.profileTimes.join(',')}]`);
    console.log(`  New: Days=[${analysis.recommendation.days.join(',')}] Times=[${analysis.recommendation.times.join(',')}]`);

    await db
      .update(driverDnaProfiles)
      .set({
        preferredDays: analysis.recommendation.days,
        preferredStartTimes: analysis.recommendation.times,
        preferredTractors: analysis.recommendation.tractors,
        updatedAt: new Date(),
      })
      .where(eq(driverDnaProfiles.driverId, analysis.driverId));

    fixed++;
  }

  console.log(`\n✅ Fixed ${fixed} Solo2 driver profiles`);
}

// Main execution
async function main() {
  const analyses = await analyzeSolo2Drivers();

  // Check if we should apply fixes
  const shouldFix = process.argv.includes('--fix');
  if (shouldFix) {
    await fixSolo2Profiles(analyses);
  } else {
    console.log("\n💡 To apply fixes, run with --fix flag: npx tsx server/scripts/analyze-solo2-drivers.ts --fix");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
