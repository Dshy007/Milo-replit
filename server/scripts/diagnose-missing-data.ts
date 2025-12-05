/**
 * Diagnostic script to find missing data that causes DNA profile gaps
 */
import { db } from "../db";
import { blocks, blockAssignments, drivers, driverDnaProfiles, shiftOccurrences } from "@shared/schema";
import { eq, isNull, sql, and, count } from "drizzle-orm";

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

async function diagnose() {
  console.log("═══════════════════════════════════════════════════════════════════════");
  console.log("                    MISSING DATA DIAGNOSTIC REPORT                      ");
  console.log("═══════════════════════════════════════════════════════════════════════\n");

  // 1. Check blocks with NULL soloType
  const nullSoloType = await db
    .select({ count: sql<number>`count(*)` })
    .from(blocks)
    .where(isNull(blocks.soloType));
  console.log(`🔍 Blocks with NULL soloType: ${nullSoloType[0]?.count || 0}`);

  // 2. Check blocks with NULL tractorId
  const nullTractorId = await db
    .select({ count: sql<number>`count(*)` })
    .from(blocks)
    .where(isNull(blocks.tractorId));
  console.log(`🔍 Blocks with NULL tractorId: ${nullTractorId[0]?.count || 0}`);

  // 3. Check blocks with NULL canonicalStart
  const nullCanonicalStart = await db
    .select({ count: sql<number>`count(*)` })
    .from(blocks)
    .where(isNull(blocks.canonicalStart));
  console.log(`🔍 Blocks with NULL canonicalStart: ${nullCanonicalStart[0]?.count || 0}`);

  // 4. Check blocks with NULL startTimestamp
  const nullStartTimestamp = await db
    .select({ count: sql<number>`count(*)` })
    .from(blocks)
    .where(isNull(blocks.startTimestamp));
  console.log(`🔍 Blocks with NULL startTimestamp: ${nullStartTimestamp[0]?.count || 0}`);

  // 5. Get all unique soloType + tractorId combinations in blocks
  console.log("\n═══════════════════════════════════════════════════════════════════════");
  console.log("                    SOLOYPE + TRACTOR COMBINATIONS                      ");
  console.log("═══════════════════════════════════════════════════════════════════════\n");

  const combinations = await db
    .select({
      soloType: blocks.soloType,
      tractorId: blocks.tractorId,
      count: sql<number>`count(*)`,
    })
    .from(blocks)
    .groupBy(blocks.soloType, blocks.tractorId)
    .orderBy(blocks.soloType, blocks.tractorId);

  let missingFromLookup = 0;
  for (const combo of combinations) {
    const key = `${combo.soloType?.toLowerCase() || 'null'}_${combo.tractorId || 'null'}`;
    const hasLookup = CANONICAL_START_TIMES[key];
    const status = hasLookup ? '✅' : '❌ MISSING';
    console.log(`  ${key.padEnd(25)} | ${String(combo.count).padStart(4)} blocks | ${status}`);
    if (!hasLookup && combo.soloType && combo.tractorId) {
      missingFromLookup++;
    }
  }

  console.log(`\n  ⚠️  ${missingFromLookup} combinations missing from CANONICAL_START_TIMES lookup`);

  // 6. Check shift occurrences with NULL tractorId
  console.log("\n═══════════════════════════════════════════════════════════════════════");
  console.log("                    SHIFT OCCURRENCES DATA QUALITY                      ");
  console.log("═══════════════════════════════════════════════════════════════════════\n");

  try {
    const shiftNullTractor = await db
      .select({ count: sql<number>`count(*)` })
      .from(shiftOccurrences)
      .where(isNull(shiftOccurrences.tractorId));
    console.log(`🔍 Shift occurrences with NULL tractorId: ${shiftNullTractor[0]?.count || 0}`);

    const totalShifts = await db
      .select({ count: sql<number>`count(*)` })
      .from(shiftOccurrences);
    console.log(`🔍 Total shift occurrences: ${totalShifts[0]?.count || 0}`);
  } catch {
    console.log("  (shift occurrences table empty or not accessible)");
  }

  // 7. Check block assignments linking
  console.log("\n═══════════════════════════════════════════════════════════════════════");
  console.log("                    BLOCK ASSIGNMENTS DATA QUALITY                      ");
  console.log("═══════════════════════════════════════════════════════════════════════\n");

  const totalAssignments = await db
    .select({ count: sql<number>`count(*)` })
    .from(blockAssignments)
    .where(eq(blockAssignments.isActive, true));
  console.log(`🔍 Total active block assignments: ${totalAssignments[0]?.count || 0}`);

  // 8. Find assignments where block has missing data
  const assignmentsWithBadBlocks = await db
    .select({
      assignmentId: blockAssignments.id,
      driverId: blockAssignments.driverId,
      blockId: blocks.blockId,
      soloType: blocks.soloType,
      tractorId: blocks.tractorId,
    })
    .from(blockAssignments)
    .innerJoin(blocks, eq(blockAssignments.blockId, blocks.id))
    .where(
      and(
        eq(blockAssignments.isActive, true),
        sql`(${blocks.soloType} IS NULL OR ${blocks.tractorId} IS NULL)`
      )
    )
    .limit(10);

  if (assignmentsWithBadBlocks.length > 0) {
    console.log(`\n⚠️  Found ${assignmentsWithBadBlocks.length}+ assignments with incomplete block data:`);
    for (const a of assignmentsWithBadBlocks) {
      console.log(`   Block ${a.blockId}: soloType=${a.soloType || 'NULL'}, tractorId=${a.tractorId || 'NULL'}`);
    }
  } else {
    console.log(`✅ All active assignments have complete block data`);
  }

  // 9. Check which DNA profiles have issues
  console.log("\n═══════════════════════════════════════════════════════════════════════");
  console.log("                    DNA PROFILE DATA QUALITY                            ");
  console.log("═══════════════════════════════════════════════════════════════════════\n");

  const profiles = await db.select().from(driverDnaProfiles);
  const allDrivers = await db.select().from(drivers);
  const driverNameMap = new Map(allDrivers.map(d => [d.id, `${d.firstName} ${d.lastName}`]));

  let emptyTractors = 0;
  let emptyTimes = 0;
  let emptyDays = 0;

  for (const p of profiles) {
    const tractors = p.preferredTractors as string[] || [];
    const times = p.preferredStartTimes as string[] || [];
    const days = p.preferredDays as string[] || [];

    if (tractors.length === 0) {
      emptyTractors++;
      console.log(`  ⚠️  ${driverNameMap.get(p.driverId)}: No preferred tractors`);
    }
    if (times.length === 0) {
      emptyTimes++;
      console.log(`  ⚠️  ${driverNameMap.get(p.driverId)}: No preferred times`);
    }
    if (days.length === 0) {
      emptyDays++;
      console.log(`  ⚠️  ${driverNameMap.get(p.driverId)}: No preferred days`);
    }
  }

  console.log(`\n  Summary: ${emptyTractors} profiles missing tractors, ${emptyTimes} missing times, ${emptyDays} missing days`);

  // 10. Find drivers with most diverse time patterns (potential issue)
  console.log("\n═══════════════════════════════════════════════════════════════════════");
  console.log("                    DRIVERS WITH FRAGMENTED TIME PATTERNS              ");
  console.log("═══════════════════════════════════════════════════════════════════════\n");

  for (const p of profiles) {
    const times = p.preferredStartTimes as string[] || [];
    if (times.length > 4) {
      const name = driverNameMap.get(p.driverId) || 'Unknown';
      console.log(`  🔍 ${name}: ${times.length} different start times: [${times.join(', ')}]`);
    }
  }

  console.log("\n═══════════════════════════════════════════════════════════════════════");
  console.log("                              COMPLETE                                  ");
  console.log("═══════════════════════════════════════════════════════════════════════\n");
}

diagnose()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
