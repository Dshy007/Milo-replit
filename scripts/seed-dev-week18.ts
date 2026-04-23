/**
 * Seed script — populates the dev DB with a realistic Week 18 (Apr 26 – May 2)
 * Solo2 setup so the UI isn't empty during local development.
 *
 * Run:
 *   cross-env NODE_ENV=development tsx scripts/seed-dev-week18.ts
 *
 * What it inserts (for the first tenant found, typically `freedom`):
 *   - 8 drivers (aliases only; no real names)
 *   - 7 Solo2 contracts (08:30, 11:30, 15:30, 16:30, 18:30, 21:30, 23:30)
 *   - 14 Solo2 blocks for Apr 26 – May 2 (every-other-day cadence per lane)
 *
 * Safe to re-run: uses ON CONFLICT-style checks and skips duplicates.
 */
import "dotenv/config";
import { db } from "../server/db";
import { tenants, drivers, contracts, blocks } from "../shared/schema";
import { eq, and } from "drizzle-orm";

const WEEK_START = new Date("2026-04-26T00:00:00"); // Sunday

const DRIVERS = [
  { first: "Alpha", last: "Driver", domicile: "MKC" },
  { first: "Bravo", last: "Driver", domicile: "MKC" },
  { first: "Charlie", last: "Driver", domicile: "MKC" },
  { first: "Delta", last: "Driver", domicile: "MKC" },
  { first: "Echo", last: "Driver", domicile: "MKC" },
  { first: "Foxtrot", last: "Driver", domicile: "MKC" },
  { first: "Golf", last: "Driver", domicile: "MKC" },
  { first: "Hotel", last: "Driver", domicile: "MKC" },
];

const SOLO2_SLOTS = [
  { startTime: "08:30", tractorId: "Tractor_201" },
  { startTime: "11:30", tractorId: "Tractor_202" },
  { startTime: "15:30", tractorId: "Tractor_203" },
  { startTime: "16:30", tractorId: "Tractor_204" },
  { startTime: "18:30", tractorId: "Tractor_205" },
  { startTime: "21:30", tractorId: "Tractor_206" },
  { startTime: "23:30", tractorId: "Tractor_207" },
];

function parseHHMM(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return { h, m };
}

async function run() {
  console.log("[seed] Looking up tenant...");
  const tenantRows = await db.select().from(tenants).limit(1);
  if (tenantRows.length === 0) {
    console.error("[seed] No tenant found. Sign up at http://localhost:3000 first.");
    process.exit(1);
  }
  const tenant = tenantRows[0];
  console.log(`[seed] Using tenant: ${tenant.name} (${tenant.id})`);

  // ---- DRIVERS ----
  console.log("[seed] Inserting drivers...");
  let driversAdded = 0;
  for (const d of DRIVERS) {
    const existing = await db
      .select()
      .from(drivers)
      .where(and(
        eq(drivers.tenantId, tenant.id),
        eq(drivers.firstName, d.first),
        eq(drivers.lastName, d.last),
      ))
      .limit(1);
    if (existing.length > 0) continue;
    await db.insert(drivers).values({
      tenantId: tenant.id,
      firstName: d.first,
      lastName: d.last,
      domicile: d.domicile,
      status: "active",
      isActive: true,
      loadEligible: true,
      profileVerified: true,
    });
    driversAdded++;
  }
  console.log(`[seed] Drivers added: ${driversAdded} (skipped ${DRIVERS.length - driversAdded} existing)`);

  // ---- CONTRACTS ----
  console.log("[seed] Inserting Solo2 contracts...");
  let contractsAdded = 0;
  const contractIdByStartTime = new Map<string, string>();
  for (const slot of SOLO2_SLOTS) {
    const existing = await db
      .select()
      .from(contracts)
      .where(and(
        eq(contracts.tenantId, tenant.id),
        eq(contracts.type, "solo2"),
        eq(contracts.startTime, slot.startTime),
        eq(contracts.tractorId, slot.tractorId),
      ))
      .limit(1);
    if (existing.length > 0) {
      contractIdByStartTime.set(slot.startTime, existing[0].id);
      continue;
    }
    const inserted = await db.insert(contracts).values({
      tenantId: tenant.id,
      name: `Solo2 ${slot.startTime} ${slot.tractorId}`,
      type: "solo2",
      startTime: slot.startTime,
      tractorId: slot.tractorId,
      duration: 38,
      baseRoutes: 7,
      daysPerWeek: 6,
      status: "active",
      domicile: "MKC",
    }).returning();
    contractIdByStartTime.set(slot.startTime, inserted[0].id);
    contractsAdded++;
  }
  console.log(`[seed] Contracts added: ${contractsAdded} (${contractIdByStartTime.size} total)`);

  // ---- BLOCKS ----
  // Every-other-day Solo2 cadence per lane: Sun, Tue, Thu, Sat
  const DAY_OFFSETS = [0, 2, 4, 6];
  console.log("[seed] Inserting Solo2 blocks for Week 18 (Apr 26 – May 2)...");
  let blocksAdded = 0;
  let blockCounter = 1_000_000;
  for (const slot of SOLO2_SLOTS) {
    const contractId = contractIdByStartTime.get(slot.startTime)!;
    const { h, m } = parseHHMM(slot.startTime);
    for (const dayOffset of DAY_OFFSETS) {
      const serviceDate = new Date(WEEK_START);
      serviceDate.setDate(serviceDate.getDate() + dayOffset);
      const startTs = new Date(serviceDate);
      startTs.setHours(h, m, 0, 0);
      const endTs = new Date(startTs.getTime() + 38 * 60 * 60 * 1000);

      const blockExternalId = `B-SEED-${slot.startTime.replace(":", "")}-${serviceDate.toISOString().slice(0, 10)}`;
      const existing = await db
        .select()
        .from(blocks)
        .where(and(
          eq(blocks.tenantId, tenant.id),
          eq(blocks.blockId, blockExternalId),
          eq(blocks.serviceDate, serviceDate),
        ))
        .limit(1);
      if (existing.length > 0) continue;

      await db.insert(blocks).values({
        tenantId: tenant.id,
        blockId: blockExternalId,
        serviceDate,
        contractId,
        startTimestamp: startTs,
        endTimestamp: endTs,
        tractorId: slot.tractorId,
        soloType: "solo2",
        duration: 38,
        status: "unassigned",
        onBenchStatus: "on_bench",
      });
      blocksAdded++;
      blockCounter++;
    }
  }
  console.log(`[seed] Blocks added: ${blocksAdded}`);

  console.log("[seed] ✓ Done.");
  process.exit(0);
}

run().catch((err) => {
  console.error("[seed] FAILED:", err);
  process.exit(1);
});
