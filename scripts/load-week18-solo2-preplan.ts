/**
 * Load Dan's MANUAL Solo2 preplan for Week 18 (Apr 26 – May 2) into the DB.
 *
 * This is the preplan Dan built by hand in a prior thread. It is NOT solver
 * output — it is the baseline. The solver's job later is only to reoptimize
 * when things change mid-week, or to generate for future weeks.
 *
 * What this script does:
 *   1. Finds all Week 18 Solo2 blocks in the DB
 *   2. Marks asset-down blocks (status=cancelled, truck in shop)
 *   3. Creates blockAssignments for each manual driver placement
 *   4. Updates block.status='assigned' for assigned blocks
 *
 * Run:
 *   cross-env NODE_ENV=development tsx scripts/load-week18-solo2-preplan.ts
 *
 * Safe to re-run: clears this week's existing blockAssignments first.
 */
import "dotenv/config";
import { db } from "../server/db";
import { tenants, drivers, blocks, blockAssignments } from "../shared/schema";
import { eq, and, gte, lt, sql } from "drizzle-orm";

const WEEK_START = "2026-04-26"; // Sunday

// Dan's manual Solo2 preplan from the Week 18 walkthrough thread.
// Each entry is a DISPATCH day for a given slot (start time).
// Solo2 block = 38h, so name appears on dispatch day + next day in UI.
type Dispatch = { slot: string; dayOffset: number; driverLastName: string };

const DISPATCHES: Dispatch[] = [
  // --- 08:30 Ivy (2 dispatches — Mon + Wed) ---
  { slot: "08:30", dayOffset: 1, driverLastName: "Ivy" },         // Mon
  { slot: "08:30", dayOffset: 3, driverLastName: "Ivy" },         // Wed

  // --- 11:30 Jacob + Lyndon (3 dispatches: Sun, Tue, Thu) ---
  { slot: "11:30", dayOffset: 0, driverLastName: "Maroria" },     // Sun Jacob
  { slot: "11:30", dayOffset: 2, driverLastName: "Wright" },      // Tue Lyndon
  { slot: "11:30", dayOffset: 4, driverLastName: "Wright" },      // Thu Lyndon

  // --- 15:30 Rasool + Jacob interlock (3 dispatches: Sun, Tue, Thu) ---
  { slot: "15:30", dayOffset: 0, driverLastName: "Abdul Rasool" }, // Sun Rasool
  { slot: "15:30", dayOffset: 2, driverLastName: "Maroria" },     // Tue Jacob
  { slot: "15:30", dayOffset: 4, driverLastName: "Abdul Rasool" }, // Thu Rasool

  // --- 16:30 Shalamar (3 dispatches: Sun, Tue, Thu) ---
  { slot: "16:30", dayOffset: 0, driverLastName: "Smith, Shalamar" }, // Sun — disambig for Smith
  { slot: "16:30", dayOffset: 2, driverLastName: "Smith, Shalamar" }, // Tue
  { slot: "16:30", dayOffset: 4, driverLastName: "Smith, Shalamar" }, // Thu

  // --- 18:30 Michael + Derie (3 dispatches: Sun, Tue, Fri) ---
  { slot: "18:30", dayOffset: 0, driverLastName: "Wanjaoh" },     // Sun Michael
  { slot: "18:30", dayOffset: 2, driverLastName: "Wanjaoh" },     // Tue Michael
  { slot: "18:30", dayOffset: 5, driverLastName: "Andrews" },     // Fri Derie

  // --- 21:30 Abshir + MJ (4 dispatches: Sun, Tue, Thu, Sat) ---
  { slot: "21:30", dayOffset: 0, driverLastName: "Hired" },       // Sun Abshir
  { slot: "21:30", dayOffset: 2, driverLastName: "Hired" },       // Tue Abshir
  { slot: "21:30", dayOffset: 4, driverLastName: "FREEMAN" },     // Thu MJ
  { slot: "21:30", dayOffset: 6, driverLastName: "FREEMAN" },     // Sat MJ

  // --- 23:30 Adan (3 back-to-back: Mon, Wed, Fri) ---
  { slot: "23:30", dayOffset: 1, driverLastName: "Sabriye" },     // Mon
  { slot: "23:30", dayOffset: 3, driverLastName: "Sabriye" },     // Wed
  { slot: "23:30", dayOffset: 5, driverLastName: "Sabriye" },     // Fri
];

// Blocks that are truck-down this week (from Dan's Work Planner screenshots):
//   Sun 08:30 — Asset pink
//   Thu 18:30 — Asset pink
//   Sun 23:30 — Driver-locked pink (Adan's lane can't dispatch Sun because it
//               would collide with his Mon/Wed/Fri pattern — same truck)
const ASSET_DOWN: { slot: string; dayOffset: number; reason: string }[] = [
  { slot: "08:30", dayOffset: 0, reason: "Asset unavailable (truck in shop)" },
  { slot: "18:30", dayOffset: 4, reason: "Asset unavailable (truck in shop)" },
  { slot: "23:30", dayOffset: 0, reason: "Driver unavailable — Adan lane locked Mon/Wed/Fri" },
];

async function run() {
  const tenantRows = await db.select().from(tenants).limit(1);
  if (tenantRows.length === 0) {
    console.error("[load] No tenant.");
    process.exit(1);
  }
  const tenant = tenantRows[0];
  console.log(`[load] Target tenant: ${tenant.name}`);

  const weekStart = new Date(WEEK_START + "T00:00:00");
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

  // Load all active drivers once for lookup
  const allDrivers = await db.select().from(drivers).where(eq(drivers.tenantId, tenant.id));
  const findDriver = (lastNameHint: string) => {
    // "Smith, Shalamar" is disambig — check both last AND first match
    if (lastNameHint.includes(",")) {
      const [lastPart, firstPart] = lastNameHint.split(",").map(s => s.trim());
      return allDrivers.find(d =>
        d.lastName.toLowerCase() === lastPart.toLowerCase() &&
        d.firstName.toLowerCase().startsWith(firstPart.toLowerCase())
      );
    }
    return allDrivers.find(d => d.lastName.toLowerCase() === lastNameHint.toLowerCase());
  };

  // Load all Week 18 Solo2 blocks
  const weekBlocks = await db
    .select()
    .from(blocks)
    .where(and(
      eq(blocks.tenantId, tenant.id),
      eq(blocks.soloType, "solo2"),
      gte(blocks.serviceDate, weekStart),
      lt(blocks.serviceDate, weekEnd),
    ));
  console.log(`[load] Found ${weekBlocks.length} Solo2 blocks in Week 18`);

  const findBlock = (slot: string, dayOffset: number) => {
    const svc = new Date(weekStart.getTime() + dayOffset * 24 * 60 * 60 * 1000);
    return weekBlocks.find(b => {
      if (b.serviceDate.toISOString().slice(0, 10) !== svc.toISOString().slice(0, 10)) return false;
      const bStart = new Date(b.startTimestamp).toTimeString().slice(0, 5);
      return bStart === slot;
    });
  };

  // Clear existing Solo2 assignments for Week 18
  const blockIds = weekBlocks.map(b => b.id);
  if (blockIds.length > 0) {
    const cleared = await db
      .delete(blockAssignments)
      .where(and(
        eq(blockAssignments.tenantId, tenant.id),
        sql`${blockAssignments.blockId} IN (${sql.join(blockIds.map(id => sql`${id}`), sql`, `)})`,
      ))
      .returning();
    console.log(`[load] Cleared ${cleared.length} existing assignments`);
  }

  // Reset all Solo2 blocks for Week 18 back to unassigned before applying
  await db
    .update(blocks)
    .set({ status: "unassigned" })
    .where(and(
      eq(blocks.tenantId, tenant.id),
      eq(blocks.soloType, "solo2"),
      gte(blocks.serviceDate, weekStart),
      lt(blocks.serviceDate, weekEnd),
    ));

  // ---- Apply asset-down blocks ----
  let assetDownApplied = 0;
  for (const ad of ASSET_DOWN) {
    const blk = findBlock(ad.slot, ad.dayOffset);
    if (!blk) {
      console.warn(`[load] Asset-down target not found: ${ad.slot} day ${ad.dayOffset}`);
      continue;
    }
    await db.update(blocks)
      .set({ status: "cancelled", isRejectedLoad: true, offBenchReason: "asset_unavailable" })
      .where(eq(blocks.id, blk.id));
    assetDownApplied++;
  }
  console.log(`[load] Marked ${assetDownApplied} blocks as asset-down / cancelled`);

  // ---- Apply assignments ----
  let assignmentsApplied = 0;
  let skipped = 0;
  for (const d of DISPATCHES) {
    const blk = findBlock(d.slot, d.dayOffset);
    if (!blk) {
      console.warn(`[load] No block for ${d.slot} day ${d.dayOffset} — skipping ${d.driverLastName}`);
      skipped++;
      continue;
    }
    const driver = findDriver(d.driverLastName);
    if (!driver) {
      console.warn(`[load] No driver matched: "${d.driverLastName}" — skipping`);
      skipped++;
      continue;
    }
    await db.insert(blockAssignments).values({
      tenantId: tenant.id,
      blockId: blk.id,
      driverId: driver.id,
      amazonBlockId: blk.blockId,
      validationStatus: "valid",
      notes: "Loaded from manual Week 18 preplan (thread 2026-04-22)",
      isActive: true,
    });
    await db.update(blocks)
      .set({ status: "assigned" })
      .where(eq(blocks.id, blk.id));
    assignmentsApplied++;
  }
  console.log(`[load] ✓ Applied ${assignmentsApplied} driver assignments (skipped ${skipped})`);
  console.log(`[load] ✓ ${assetDownApplied} asset-down markers`);
  process.exit(0);
}

run().catch(err => {
  console.error("[load] FAILED:", err);
  process.exit(1);
});
