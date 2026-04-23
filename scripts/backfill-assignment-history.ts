/**
 * Backfill assignmentHistory + driverContractStats from existing blockAssignments.
 *
 * Walks all active blockAssignments for the first tenant and, for each one
 * that has pattern metadata on its block (patternGroup + canonicalStart +
 * cycleId), inserts a matching assignmentHistory row (if one does not already
 * exist) and upserts driverContractStats. Finally triggers DNA refresh for
 * every unique driver touched.
 *
 * Run:
 *   cross-env NODE_ENV=development tsx scripts/backfill-assignment-history.ts
 *
 * Idempotent — safe to re-run.
 */
import "dotenv/config";
import { db } from "../server/db";
import {
  blockAssignments,
  blocks,
  assignmentHistory,
  driverContractStats,
  tenants,
} from "../shared/schema";
import { eq, and } from "drizzle-orm";
import { calculateBumpMinutes } from "../server/bump-validation";
import { updateSingleDriverDNA } from "../server/dna-analyzer";

async function run() {
  const tenantRows = await db.select().from(tenants).limit(1);
  const tenant = tenantRows[0];
  if (!tenant) {
    console.error("[backfill] No tenant found — aborting.");
    process.exit(1);
  }

  const assignments = await db
    .select({
      assignment: blockAssignments,
      block: blocks,
    })
    .from(blockAssignments)
    .innerJoin(blocks, eq(blocks.id, blockAssignments.blockId))
    .where(
      and(
        eq(blockAssignments.tenantId, tenant.id),
        eq(blockAssignments.isActive, true)
      )
    );

  console.log(`[backfill] Processing ${assignments.length} active assignments for tenant ${tenant.id}`);

  let historyInserted = 0;
  let historySkipped = 0;
  let statsUpserted = 0;
  let skippedNoPattern = 0;
  const driverIds = new Set<string>();

  for (const { assignment, block } of assignments) {
    // Skip blocks without the pattern metadata assignmentHistory requires.
    if (!block.patternGroup || !block.canonicalStart || !block.cycleId) {
      skippedNoPattern++;
      continue;
    }

    // Idempotency — skip if a matching assignmentHistory row already exists.
    const existing = await db
      .select()
      .from(assignmentHistory)
      .where(
        and(
          eq(assignmentHistory.tenantId, tenant.id),
          eq(assignmentHistory.blockId, block.id),
          eq(assignmentHistory.driverId, assignment.driverId)
        )
      )
      .limit(1);
    if (existing.length > 0) {
      historySkipped++;
      continue;
    }

    const bumpMinutes = calculateBumpMinutes(
      new Date(block.startTimestamp),
      new Date(block.canonicalStart)
    );

    await db.insert(assignmentHistory).values({
      tenantId: tenant.id,
      blockId: block.id,
      driverId: assignment.driverId,
      contractId: block.contractId,
      startTimestamp: block.startTimestamp,
      canonicalStart: block.canonicalStart,
      patternGroup: block.patternGroup,
      cycleId: block.cycleId,
      bumpMinutes,
      isAutoAssigned: false,
      confidenceScore: null,
      assignmentSource: "manual",
      assignedBy: assignment.assignedBy ?? null,
    });
    historyInserted++;
    driverIds.add(assignment.driverId);

    // Upsert driverContractStats
    const existingStats = await db
      .select()
      .from(driverContractStats)
      .where(
        and(
          eq(driverContractStats.tenantId, tenant.id),
          eq(driverContractStats.driverId, assignment.driverId),
          eq(driverContractStats.contractId, block.contractId),
          eq(driverContractStats.patternGroup, block.patternGroup)
        )
      )
      .limit(1);

    if (existingStats.length > 0) {
      const stats = existingStats[0];
      const newTotalAssignments = stats.totalAssignments + 1;
      const newAvgBumpMinutes = Math.round(
        (stats.avgBumpMinutes * stats.totalAssignments + bumpMinutes) / newTotalAssignments
      );
      await db
        .update(driverContractStats)
        .set({
          totalAssignments: newTotalAssignments,
          streakCount: stats.lastCycleId === block.cycleId ? stats.streakCount : stats.streakCount + 1,
          avgBumpMinutes: newAvgBumpMinutes,
          lastWorked: block.startTimestamp,
          lastCycleId: block.cycleId,
        })
        .where(eq(driverContractStats.id, stats.id));
    } else {
      await db.insert(driverContractStats).values({
        tenantId: tenant.id,
        driverId: assignment.driverId,
        contractId: block.contractId,
        patternGroup: block.patternGroup,
        totalAssignments: 1,
        streakCount: 1,
        avgBumpMinutes: bumpMinutes,
        lastWorked: block.startTimestamp,
        lastCycleId: block.cycleId,
      });
    }
    statsUpserted++;
  }

  console.log(
    `[backfill] history inserted=${historyInserted} skipped-exists=${historySkipped} skipped-no-pattern=${skippedNoPattern}`
  );
  console.log(`[backfill] driverContractStats upserts=${statsUpserted}`);
  console.log(`[backfill] Triggering DNA refresh for ${driverIds.size} drivers...`);

  let dnaOk = 0;
  let dnaErr = 0;
  for (const driverId of Array.from(driverIds)) {
    try {
      await updateSingleDriverDNA(tenant.id, driverId);
      dnaOk++;
    } catch (err: any) {
      dnaErr++;
      console.error(`[backfill] DNA refresh failed for ${driverId}:`, err?.message ?? err);
    }
  }
  console.log(`[backfill] DNA refresh complete — ok=${dnaOk} err=${dnaErr}`);

  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
