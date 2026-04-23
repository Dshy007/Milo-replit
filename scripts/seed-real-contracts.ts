/**
 * Replace all fake contracts + blocks with the REAL 17 contracts
 * from Freedom Transportation's dispatch-skill.md.
 *
 * - 10 Solo1 contracts (14h blocks)
 * - 7 Solo2 contracts (38h blocks)
 *
 * Tractor IDs match the Start Times page layout from Amazon Relay.
 *
 * Run:
 *   cross-env NODE_ENV=development tsx scripts/seed-real-contracts.ts
 *
 * Safe to re-run. Wipes `blocks` then `contracts` for the tenant, re-inserts fresh.
 */
import "dotenv/config";
import { db } from "../server/db";
import { tenants, contracts, blocks } from "../shared/schema";
import { eq } from "drizzle-orm";

type ContractRow = {
  type: "solo1" | "solo2";
  startTime: string; // HH:MM
  tractorId: string;
  duration: number;
};

// Source of truth: dispatch-skill.md + your Start Times page layout.
const CONTRACTS: ContractRow[] = [
  // ---- 10 Solo1 contracts (14h) ----
  { type: "solo1", startTime: "00:30", tractorId: "Tractor_8", duration: 14 },
  { type: "solo1", startTime: "01:30", tractorId: "Tractor_6", duration: 14 },
  { type: "solo1", startTime: "16:30", tractorId: "Tractor_1", duration: 14 },
  { type: "solo1", startTime: "16:30", tractorId: "Tractor_9", duration: 14 },
  { type: "solo1", startTime: "17:30", tractorId: "Tractor_4", duration: 14 },
  { type: "solo1", startTime: "18:30", tractorId: "Tractor_7", duration: 14 },
  { type: "solo1", startTime: "20:30", tractorId: "Tractor_10", duration: 14 },
  { type: "solo1", startTime: "20:30", tractorId: "Tractor_2",  duration: 14 },
  { type: "solo1", startTime: "20:30", tractorId: "Tractor_3",  duration: 14 },
  { type: "solo1", startTime: "21:30", tractorId: "Tractor_5",  duration: 14 },

  // ---- 7 Solo2 contracts (38h) ----
  { type: "solo2", startTime: "08:30", tractorId: "Tractor_4", duration: 38 },
  { type: "solo2", startTime: "11:30", tractorId: "Tractor_6", duration: 38 },
  { type: "solo2", startTime: "15:30", tractorId: "Tractor_5", duration: 38 },
  { type: "solo2", startTime: "16:30", tractorId: "Tractor_7", duration: 38 },
  { type: "solo2", startTime: "18:30", tractorId: "Tractor_1", duration: 38 },
  { type: "solo2", startTime: "21:30", tractorId: "Tractor_3", duration: 38 },
  { type: "solo2", startTime: "23:30", tractorId: "Tractor_2", duration: 38 },
];

async function run() {
  const tenantRows = await db.select().from(tenants).limit(1);
  if (tenantRows.length === 0) {
    console.error("[seed] No tenant. Sign up first.");
    process.exit(1);
  }
  const tenant = tenantRows[0];
  console.log(`[seed] Target tenant: ${tenant.name} (${tenant.id})`);

  // Delete blocks first (they FK to contracts)
  const blocksDeleted = await db
    .delete(blocks)
    .where(eq(blocks.tenantId, tenant.id))
    .returning();
  console.log(`[seed] Cleared ${blocksDeleted.length} blocks`);

  // Delete old contracts
  const contractsDeleted = await db
    .delete(contracts)
    .where(eq(contracts.tenantId, tenant.id))
    .returning();
  console.log(`[seed] Cleared ${contractsDeleted.length} old contracts`);

  // Insert real 17
  let inserted = 0;
  for (const c of CONTRACTS) {
    await db.insert(contracts).values({
      tenantId: tenant.id,
      name: `${c.type === "solo1" ? "Solo1" : "Solo2"} ${c.startTime} ${c.tractorId}`,
      type: c.type,
      startTime: c.startTime,
      tractorId: c.tractorId,
      duration: c.duration,
      baseRoutes: c.type === "solo1" ? 10 : 7,
      daysPerWeek: 6,
      status: "active",
      domicile: "MKC",
    });
    inserted++;
  }

  console.log(`[seed] ✓ Inserted ${inserted} real contracts`);
  console.log(`        Solo1: ${CONTRACTS.filter(c => c.type === "solo1").length}`);
  console.log(`        Solo2: ${CONTRACTS.filter(c => c.type === "solo2").length}`);
  process.exit(0);
}

run().catch((err) => {
  console.error("[seed] FAILED:", err);
  process.exit(1);
});
