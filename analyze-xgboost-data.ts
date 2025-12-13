import { db } from "./server/db";
import { blocks, blockAssignments, neuralDecisions } from "./shared/schema";
import { sql, eq, isNotNull, gte } from "drizzle-orm";
import { subWeeks } from "date-fns";

async function analyzeOutcomeData() {
  const twelveWeeksAgo = subWeeks(new Date(), 12);

  console.log("=== XGBoost Training Data Analysis ===\n");

  // 1. Block outcomes
  console.log("1. BLOCK STATUS DISTRIBUTION (12 weeks):");
  const blockStatuses = await db.select({
    status: blocks.status,
    count: sql<number>`count(*)::int`
  })
  .from(blocks)
  .where(gte(blocks.serviceDate, twelveWeeksAgo))
  .groupBy(blocks.status);

  for (const s of blockStatuses) {
    console.log("   " + (s.status || "null") + ": " + s.count);
  }

  // 2. Rejected loads
  console.log("\n2. REJECTED LOADS (12 weeks):");
  const rejectedLoads = await db.select({
    isRejected: blocks.isRejectedLoad,
    count: sql<number>`count(*)::int`
  })
  .from(blocks)
  .where(gte(blocks.serviceDate, twelveWeeksAgo))
  .groupBy(blocks.isRejectedLoad);

  for (const r of rejectedLoads) {
    console.log("   isRejectedLoad=" + r.isRejected + ": " + r.count);
  }

  // 3. Block assignments
  console.log("\n3. BLOCK ASSIGNMENTS (12 weeks):");
  const assignments = await db.select({
    isActive: blockAssignments.isActive,
    count: sql<number>`count(*)::int`
  })
  .from(blockAssignments)
  .innerJoin(blocks, eq(blockAssignments.blockId, blocks.id))
  .where(gte(blocks.serviceDate, twelveWeeksAgo))
  .groupBy(blockAssignments.isActive);

  for (const a of assignments) {
    console.log("   isActive=" + a.isActive + ": " + a.count);
  }

  // 4. Neural decisions outcomes
  console.log("\n4. NEURAL DECISIONS (all time):");
  const neuralOutcomes = await db.select({
    outcome: neuralDecisions.outcome,
    count: sql<number>`count(*)::int`
  })
  .from(neuralDecisions)
  .groupBy(neuralDecisions.outcome);

  if (neuralOutcomes.length === 0) {
    console.log("   No neural decisions found");
  } else {
    for (const n of neuralOutcomes) {
      console.log("   " + (n.outcome || "null") + ": " + n.count);
    }
  }

  // 5. User feedback
  console.log("\n5. USER FEEDBACK ON NEURAL DECISIONS:");
  const feedback = await db.select({
    userFeedback: neuralDecisions.userFeedback,
    count: sql<number>`count(*)::int`
  })
  .from(neuralDecisions)
  .where(isNotNull(neuralDecisions.userFeedback))
  .groupBy(neuralDecisions.userFeedback);

  if (feedback.length === 0) {
    console.log("   No user feedback recorded");
  } else {
    for (const f of feedback) {
      console.log("   " + f.userFeedback + ": " + f.count);
    }
  }

  // 6. Total training samples potential
  console.log("\n6. TRAINING DATA SUMMARY:");
  const totalAssignments = await db.select({
    count: sql<number>`count(*)::int`
  })
  .from(blockAssignments)
  .innerJoin(blocks, eq(blockAssignments.blockId, blocks.id))
  .where(gte(blocks.serviceDate, twelveWeeksAgo));

  const uniqueDrivers = await db.select({
    count: sql<number>`count(distinct ${blockAssignments.driverId})::int`
  })
  .from(blockAssignments)
  .innerJoin(blocks, eq(blockAssignments.blockId, blocks.id))
  .where(gte(blocks.serviceDate, twelveWeeksAgo));

  const uniqueBlocks = await db.select({
    count: sql<number>`count(distinct ${blocks.id})::int`
  })
  .from(blocks)
  .where(gte(blocks.serviceDate, twelveWeeksAgo));

  console.log("   Total assignments (12 weeks): " + (totalAssignments[0]?.count || 0));
  console.log("   Unique drivers: " + (uniqueDrivers[0]?.count || 0));
  console.log("   Unique blocks: " + (uniqueBlocks[0]?.count || 0));

  // 7. Check for cancelled/reassigned patterns
  console.log("\n7. REASSIGNMENT PATTERNS (multiple assignments per block):");
  const multiAssignBlocks = await db.execute(sql`
    SELECT b.id, COUNT(*) as assignment_count
    FROM block_assignments ba
    JOIN blocks b ON ba.block_id = b.id
    WHERE b.service_date >= ${twelveWeeksAgo}
    GROUP BY b.id
    HAVING COUNT(*) > 1
    LIMIT 10
  `);

  console.log("   Blocks with >1 assignment: " + multiAssignBlocks.rows.length + " (showing first 10)");
  for (const row of multiAssignBlocks.rows as any[]) {
    console.log("     Block " + row.id.slice(0,8) + "...: " + row.assignment_count + " assignments");
  }

  process.exit(0);
}

analyzeOutcomeData().catch(e => { console.error(e); process.exit(1); });
