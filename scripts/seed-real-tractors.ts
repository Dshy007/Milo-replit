/**
 * Import Freedom Transportation's real 21 tractors into the trucks table.
 *
 * Source: Amazon Relay asset list (Dan's screenshot 2026-04-22).
 * These are the PHYSICAL fleet — asset IDs 321692, 322054, etc.
 * Contract.tractorId (Tractor_1..10 / Tractor_1..7) are SLOT LABELS, not
 * physical truck references. Tractors can swap between slots when one breaks.
 *
 * Run:
 *   cross-env NODE_ENV=development tsx scripts/seed-real-tractors.ts
 */
import "dotenv/config";
import { db } from "../server/db";
import { tenants, trucks } from "../shared/schema";
import { eq } from "drizzle-orm";

type TractorRow = {
  assetId: string;
  make: string;
  model: string; // day_cab or sleeper
  fuel: "CNG" | "DIESEL";
  fleetType: "Fleet" | "Permaloaner";
};

const TRACTORS: TractorRow[] = [
  // ---- CNG Day cabs (13) — typically Solo1 local ----
  { assetId: "321692", make: "Volvo",        model: "Day cab", fuel: "CNG",    fleetType: "Permaloaner" },
  { assetId: "321791", make: "Volvo",        model: "Day cab", fuel: "CNG",    fleetType: "Fleet" },
  { assetId: "322054", make: "Volvo",        model: "Day cab", fuel: "CNG",    fleetType: "Fleet" },
  { assetId: "322052", make: "Volvo",        model: "Day cab", fuel: "CNG",    fleetType: "Fleet" },
  { assetId: "322077", make: "Volvo",        model: "Day cab", fuel: "CNG",    fleetType: "Fleet" },
  { assetId: "321381", make: "Volvo",        model: "Day cab", fuel: "CNG",    fleetType: "Fleet" },
  { assetId: "322047", make: "Volvo",        model: "Day cab", fuel: "CNG",    fleetType: "Fleet" },
  { assetId: "322079", make: "Volvo",        model: "Day cab", fuel: "CNG",    fleetType: "Permaloaner" },
  { assetId: "322072", make: "Volvo",        model: "Day cab", fuel: "CNG",    fleetType: "Fleet" },
  { assetId: "322057", make: "Volvo",        model: "Day cab", fuel: "CNG",    fleetType: "Fleet" },
  { assetId: "521146", make: "Kenworth",     model: "Day cab", fuel: "CNG",    fleetType: "Fleet" },
  { assetId: "322076", make: "Volvo",        model: "Day cab", fuel: "CNG",    fleetType: "Fleet" },
  { assetId: "122090", make: "Freightliner", model: "Day cab", fuel: "CNG",    fleetType: "Fleet" },

  // ---- DIESEL Sleepers (8) — typically Solo2 long-haul ----
  { assetId: "892487", make: "Freightliner", model: "Sleeper", fuel: "DIESEL", fleetType: "Fleet" },
  { assetId: "424031", make: "International", model: "Sleeper", fuel: "DIESEL", fleetType: "Fleet" },
  { assetId: "124065", make: "Freightliner", model: "Sleeper", fuel: "DIESEL", fleetType: "Fleet" },
  { assetId: "424030", make: "International", model: "Sleeper", fuel: "DIESEL", fleetType: "Fleet" },
  { assetId: "892485", make: "Freightliner", model: "Sleeper", fuel: "DIESEL", fleetType: "Permaloaner" },
  { assetId: "907701", make: "International", model: "Sleeper", fuel: "DIESEL", fleetType: "Fleet" },
  { assetId: "921158", make: "Freightliner", model: "Sleeper", fuel: "DIESEL", fleetType: "Fleet" },
  { assetId: "921157", make: "Freightliner", model: "Sleeper", fuel: "DIESEL", fleetType: "Fleet" },
];

async function run() {
  const tenantRows = await db.select().from(tenants).limit(1);
  if (tenantRows.length === 0) {
    console.error("[seed] No tenant.");
    process.exit(1);
  }
  const tenant = tenantRows[0];
  console.log(`[seed] Target tenant: ${tenant.name}`);

  const cleared = await db
    .delete(trucks)
    .where(eq(trucks.tenantId, tenant.id))
    .returning();
  console.log(`[seed] Cleared ${cleared.length} existing trucks`);

  let inserted = 0;
  for (const t of TRACTORS) {
    await db.insert(trucks).values({
      tenantId: tenant.id,
      truckNumber: t.assetId,
      type: "tractor",
      make: t.make,
      model: t.model.toLowerCase(),
      fuel: t.fuel.toLowerCase(),
      status: "available",
      complianceStatus: "pending",
      lastKnownLocation: t.fleetType, // stash fleet vs permaloaner here for now
    });
    inserted++;
  }

  console.log(`[seed] ✓ Inserted ${inserted} real tractors`);
  console.log(`        CNG day cabs:  ${TRACTORS.filter(t => t.fuel === "CNG").length} (Solo1 fleet)`);
  console.log(`        Diesel sleepers: ${TRACTORS.filter(t => t.fuel === "DIESEL").length} (Solo2 fleet)`);
  console.log(`        Permaloaners:  ${TRACTORS.filter(t => t.fleetType === "Permaloaner").length}`);
  process.exit(0);
}

run().catch((err) => {
  console.error("[seed] FAILED:", err);
  process.exit(1);
});
