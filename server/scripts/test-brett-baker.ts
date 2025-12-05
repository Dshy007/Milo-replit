/**
 * Test script to analyze Brett Baker's assignment history
 * and verify his DNA profile matches canonical start times
 */
import { db } from "../db";
import { blockAssignments, blocks, drivers, driverDnaProfiles } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
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

// Brett Baker's known ID from the DNA profile
const BRETT_BAKER_ID = "f73f8c67-31c8-4676-a20d-6a94a5c784d3";

async function testBrettBaker() {
  console.log("═══════════════════════════════════════════════════════════════════════");
  console.log("                    BRETT BAKER DNA PROFILE TEST                        ");
  console.log("═══════════════════════════════════════════════════════════════════════\n");

  // Step 1: Find Brett Baker's driver record
  const brettRecords = await db
    .select()
    .from(drivers)
    .where(eq(drivers.id, BRETT_BAKER_ID));

  if (brettRecords.length === 0) {
    console.log("❌ Brett Baker not found in drivers table");
    return;
  }

  const brett = brettRecords[0];
  console.log(`✅ Found Brett Baker: ${brett.id}`);
  console.log(`   Contract Type: ${brett.contractType}`);
  console.log(`   Active: ${brett.isActive}\n`);

  // Step 2: Get his DNA profile
  const dnaProfiles = await db
    .select()
    .from(driverDnaProfiles)
    .where(eq(driverDnaProfiles.driverId, brett.id));

  if (dnaProfiles.length === 0) {
    console.log("❌ No DNA profile found for Brett");
  } else {
    const profile = dnaProfiles[0];
    console.log("📊 DNA PROFILE:");
    console.log(`   Pattern Group: ${profile.patternGroup}`);
    console.log(`   Preferred Days: ${JSON.stringify(profile.preferredDays)}`);
    console.log(`   Preferred Start Times: ${JSON.stringify(profile.preferredStartTimes)}`);
    console.log(`   Preferred Tractors: ${JSON.stringify(profile.preferredTractors)}`);
    console.log(`   Contract Type: ${profile.preferredContractType}`);
    console.log(`   Consistency Score: ${(parseFloat(profile.consistencyScore || "0") * 100).toFixed(1)}%`);
    console.log(`   Assignments Analyzed: ${profile.assignmentsAnalyzed}`);
    console.log(`   Analysis Period: ${format(profile.analysisStartDate!, 'yyyy-MM-dd')} to ${format(profile.analysisEndDate!, 'yyyy-MM-dd')}\n`);
  }

  // Step 3: Get his actual assignment history
  console.log("📜 ACTUAL ASSIGNMENT HISTORY (last 50):\n");

  const assignments = await db
    .select({
      blockId: blocks.blockId,
      serviceDate: blocks.serviceDate,
      startTimestamp: blocks.startTimestamp,
      tractorId: blocks.tractorId,
      soloType: blocks.soloType,
      assignedAt: blockAssignments.assignedAt,
    })
    .from(blockAssignments)
    .innerJoin(blocks, eq(blockAssignments.blockId, blocks.id))
    .where(
      and(
        eq(blockAssignments.driverId, brett.id),
        eq(blockAssignments.isActive, true)
      )
    )
    .orderBy(desc(blocks.startTimestamp))
    .limit(50);

  console.log(`Found ${assignments.length} assignments\n`);

  // Group by pattern analysis
  const dayCount: Record<string, number> = {};
  const timeCount: Record<string, number> = {};
  const tractorCount: Record<string, number> = {};

  for (const a of assignments) {
    const dayOfWeek = getDay(new Date(a.startTimestamp!));
    const dayName = DAY_NAMES[dayOfWeek];
    dayCount[dayName] = (dayCount[dayName] || 0) + 1;

    // Get canonical start time
    const key = `${a.soloType?.toLowerCase() || 'solo1'}_${a.tractorId}`;
    const canonicalTime = CANONICAL_START_TIMES[key] || format(new Date(a.startTimestamp!), 'HH:mm');
    timeCount[canonicalTime] = (timeCount[canonicalTime] || 0) + 1;

    if (a.tractorId) {
      tractorCount[a.tractorId] = (tractorCount[a.tractorId] || 0) + 1;
    }

    // Log each assignment
    console.log(`   ${format(new Date(a.serviceDate!), 'yyyy-MM-dd')} (${dayName.padEnd(9)}) | ${canonicalTime} | ${a.tractorId?.padEnd(10) || 'N/A'} | ${a.soloType || 'N/A'}`);
  }

  console.log("\n═══════════════════════════════════════════════════════════════════════");
  console.log("                           PATTERN ANALYSIS                              ");
  console.log("═══════════════════════════════════════════════════════════════════════\n");

  // Sort and display day distribution
  console.log("📅 DAY DISTRIBUTION:");
  const sortedDays = Object.entries(dayCount).sort((a, b) => b[1] - a[1]);
  const totalAssignments = assignments.length;
  for (const [day, count] of sortedDays) {
    const pct = ((count / totalAssignments) * 100).toFixed(1);
    console.log(`   ${day.padEnd(10)}: ${count} (${pct}%)`);
  }

  console.log("\n⏰ TIME DISTRIBUTION:");
  const sortedTimes = Object.entries(timeCount).sort((a, b) => b[1] - a[1]);
  for (const [time, count] of sortedTimes) {
    const pct = ((count / totalAssignments) * 100).toFixed(1);
    console.log(`   ${time.padEnd(6)}: ${count} (${pct}%)`);
  }

  console.log("\n🚜 TRACTOR DISTRIBUTION:");
  const sortedTractors = Object.entries(tractorCount).sort((a, b) => b[1] - a[1]);
  for (const [tractor, count] of sortedTractors) {
    const pct = ((count / totalAssignments) * 100).toFixed(1);
    console.log(`   ${tractor.padEnd(12)}: ${count} (${pct}%)`);
  }

  // Compare with DNA profile
  if (dnaProfiles.length > 0) {
    const profile = dnaProfiles[0];
    console.log("\n═══════════════════════════════════════════════════════════════════════");
    console.log("                         PROFILE VS ACTUAL                              ");
    console.log("═══════════════════════════════════════════════════════════════════════\n");

    // Check if actual top days match profile preferred days
    const actualTopDays = sortedDays.slice(0, 4).map(d => d[0]);
    const profileDays = profile.preferredDays as string[];
    console.log("📅 DAYS COMPARISON:");
    console.log(`   Profile days: ${profileDays.join(', ')}`);
    console.log(`   Actual top 4: ${actualTopDays.join(', ')}`);
    const dayMatch = actualTopDays.every(d => profileDays.includes(d));
    console.log(`   Match: ${dayMatch ? '✅ YES' : '❌ NO'}\n`);

    // Check if actual top times match profile preferred times
    const actualTopTimes = sortedTimes.slice(0, 3).map(t => t[0]);
    const profileTimes = profile.preferredStartTimes as string[];
    console.log("⏰ TIMES COMPARISON:");
    console.log(`   Profile times: ${profileTimes.join(', ')}`);
    console.log(`   Actual top 3: ${actualTopTimes.join(', ')}`);
    const timeMatch = actualTopTimes.every(t => profileTimes.includes(t));
    console.log(`   Match: ${timeMatch ? '✅ YES' : '❌ NO'}\n`);

    // Check if actual top tractors match profile preferred tractors
    const actualTopTractors = sortedTractors.slice(0, 2).map(t => t[0]);
    const profileTractors = profile.preferredTractors as string[];
    console.log("🚜 TRACTORS COMPARISON:");
    console.log(`   Profile tractors: ${profileTractors.join(', ')}`);
    console.log(`   Actual top 2: ${actualTopTractors.join(', ')}`);
    const tractorMatch = actualTopTractors.every(t => profileTractors.includes(t));
    console.log(`   Match: ${tractorMatch ? '✅ YES' : '❌ NO'}\n`);

    // Expected S-W pattern
    console.log("🎯 EXPECTED S-W PATTERN CHECK:");
    const swDays = ['sunday', 'monday', 'tuesday', 'wednesday'];
    const hasSwPattern = swDays.every(d => profileDays.includes(d));
    console.log(`   Expected: Sun, Mon, Tue, Wed`);
    console.log(`   Profile has S-W: ${hasSwPattern ? '✅ YES' : '❌ NO'}`);

    // Check bump time (20:30 for late shifts)
    console.log("\n🔄 BUMP TIME CHECK (20:30):");
    const has2030 = profileTimes.includes('20:30');
    const actual2030Count = timeCount['20:30'] || 0;
    console.log(`   Profile has 20:30: ${has2030 ? '✅ YES' : '❌ NO'}`);
    console.log(`   Actual 20:30 shifts: ${actual2030Count} (${((actual2030Count/totalAssignments)*100).toFixed(1)}%)`);
  }

  console.log("\n═══════════════════════════════════════════════════════════════════════");
  console.log("                              TEST COMPLETE                              ");
  console.log("═══════════════════════════════════════════════════════════════════════\n");
}

testBrettBaker()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
