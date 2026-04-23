/**
 * Generate blocks for a target week using the 17 REAL contracts in DB.
 *
 * Solo1: one block per day per contract (10 × 7 = 70 blocks)
 * Solo2: every-other-day cadence per lane (7 × 4 = 28 blocks)
 * Total: 98 blocks, all status=unassigned
 *
 * Run:
 *   cross-env NODE_ENV=development tsx scripts/seed-real-week-blocks.ts [YYYY-MM-DD]
 *
 * Default week_start is 2026-04-26 (Sunday, Week 18).
 * Safe to re-run for same week (clears first, then regenerates).
 */
import "dotenv/config";
import { db } from "../server/db";
import { tenants, contracts, blocks, blockAssignments } from "../shared/schema";
import { eq, and, gte, lt, sql } from "drizzle-orm";

const DEFAULT_WEEK_START = "2026-04-26"; // Sunday

function parseHHMM(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return { h, m };
}

async function run() {
  const arg = process.argv[2] || DEFAULT_WEEK_START;
  const weekStart = new Date(arg + "T00:00:00");
  if (isNaN(weekStart.getTime())) {
    console.error(`Bad date: ${arg}`);
    process.exit(1);
  }
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

  const tenantRows = await db.select().from(tenants).limit(1);
  if (tenantRows.length === 0) {
    console.error("[seed] No tenant.");
    process.exit(1);
  }
  const tenant = tenantRows[0];
  console.log(`[seed] Target tenant: ${tenant.name}`);
  console.log(`[seed] Week: ${weekStart.toISOString().slice(0, 10)} -> ${weekEnd.toISOString().slice(0, 10)}`);

  const allContracts = await db
    .select()
    .from(contracts)
    .where(eq(contracts.tenantId, tenant.id));
  if (allContracts.length === 0) {
    console.error("[seed] No contracts. Run seed-real-contracts.ts first.");
    process.exit(1);
  }
  const solo1 = allContracts.filter(c => c.type === "solo1");
  const solo2 = allContracts.filter(c => c.type === "solo2");
  console.log(`[seed] Contracts: ${solo1.length} solo1 + ${solo2.length} solo2`);

  // First, clear any assignments that reference this week's blocks (FK constraint)
  const weekBlocks = await db
    .select({ id: blocks.id })
    .from(blocks)
    .where(and(
      eq(blocks.tenantId, tenant.id),
      gte(blocks.serviceDate, weekStart),
      lt(blocks.serviceDate, weekEnd),
    ));
  const weekBlockIds = weekBlocks.map(b => b.id);
  if (weekBlockIds.length > 0) {
    const clearedAssignments = await db
      .delete(blockAssignments)
      .where(and(
        eq(blockAssignments.tenantId, tenant.id),
        sql`${blockAssignments.blockId} IN (${sql.join(weekBlockIds.map(id => sql`${id}`), sql`, `)})`,
      ))
      .returning();
    console.log(`[seed] Cleared ${clearedAssignments.length} assignments pointing at this week's blocks`);
  }

  // Clear this week's blocks
  const deleted = await db
    .delete(blocks)
    .where(and(
      eq(blocks.tenantId, tenant.id),
      gte(blocks.serviceDate, weekStart),
      lt(blocks.serviceDate, weekEnd),
    ))
    .returning();
  console.log(`[seed] Cleared ${deleted.length} blocks for this week`);

  let blockNum = 1000;
  let inserted = 0;

  // Solo1: every day, one block per contract
  for (const c of solo1) {
    const { h, m } = parseHHMM(c.startTime);
    for (let day = 0; day < 7; day++) {
      const svc = new Date(weekStart.getTime() + day * 24 * 60 * 60 * 1000);
      const start = new Date(svc);
      start.setHours(h, m, 0, 0);
      const end = new Date(start.getTime() + c.duration * 60 * 60 * 1000);

      await db.insert(blocks).values({
        tenantId: tenant.id,
        blockId: `B-SIM-${String(blockNum++).padStart(6, "0")}`,
        serviceDate: svc,
        contractId: c.id,
        startTimestamp: start,
        endTimestamp: end,
        tractorId: c.tractorId,
        soloType: "solo1",
        duration: c.duration,
        status: "unassigned",
        onBenchStatus: "on_bench",
      });
      inserted++;
    }
  }

  // Solo2: generate one block per day per lane (7 per lane).
  // Different lanes use different cadences (Sun/Tue/Thu vs Mon/Wed/Fri).
  // The solver's lane-capacity constraint prevents same-truck back-to-backs.
  // Dan's manual preplan picks which days are dispatched.
  const SOLO2_DAYS = [0, 1, 2, 3, 4, 5, 6];
  for (const c of solo2) {
    const { h, m } = parseHHMM(c.startTime);
    for (const day of SOLO2_DAYS) {
      const svc = new Date(weekStart.getTime() + day * 24 * 60 * 60 * 1000);
      const start = new Date(svc);
      start.setHours(h, m, 0, 0);
      const end = new Date(start.getTime() + c.duration * 60 * 60 * 1000);

      await db.insert(blocks).values({
        tenantId: tenant.id,
        blockId: `B-SIM-${String(blockNum++).padStart(6, "0")}`,
        serviceDate: svc,
        contractId: c.id,
        startTimestamp: start,
        endTimestamp: end,
        tractorId: c.tractorId,
        soloType: "solo2",
        duration: c.duration,
        status: "unassigned",
        onBenchStatus: "on_bench",
      });
      inserted++;
    }
  }

  console.log(`[seed] ✓ Inserted ${inserted} blocks`);
  console.log(`        Solo1: ${solo1.length * 7} = ${solo1.length} contracts × 7 days`);
  console.log(`        Solo2: ${solo2.length * SOLO2_DAYS.length} = ${solo2.length} contracts × 4 every-other days`);
  process.exit(0);
}

run().catch((err) => {
  console.error("[seed] FAILED:", err);
  process.exit(1);
});
