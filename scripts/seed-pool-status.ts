import "dotenv/config";
import { db } from "../server/db";
import { drivers, tenants } from "../shared/schema";
import { eq, and } from "drizzle-orm";

// Last-name matches for Solo2 dispatch pool (from Dan's manual Week 18 preplan thread + dispatch-skill.md)
const IN_POOL_SOLO2 = ["Ivy", "Maroria", "Wright", "Abdul Rasool", "Smith", "Wanjaoh", "Andrews", "Hired", "Sabriye"];

// Solo1 dispatch pool from dispatch-skill.md
const IN_POOL_SOLO1 = [
  "YOUNG", "Freeman", "Al-Ramahi", "Baker", "Green", "Calhoun", "Barber",
  "Tahseen", "Mahdi", "Kiragu", "Harris", "Strickland", "Dixon", "SMITH"
];

// Explicit non-pool assignments
const ADMIN_MATCH = [
  { lastName: "Shirey", firstName: "Daniel" },
  { lastName: "Shirey", firstName: "Natasha" },
];
const LEAVING_MATCH = [{ lastName: "Finnell" }];
const ONBOARDING_MATCH = [
  { lastName: "Robinson", firstName: "Chloe", bucket: 6, bucketName: "JJ Keller", blockingReason: "Awaiting cert completion" },
  { lastName: "Estrada", firstName: "Zabdiel", bucket: 10, bucketName: "DQF", blockingReason: "Training midnight shift" },
];

async function run() {
  const tenantRows = await db.select().from(tenants).limit(1);
  const tenant = tenantRows[0];

  const allDrivers = await db.select().from(drivers).where(eq(drivers.tenantId, tenant.id));
  console.log(`[seed-pool-status] Found ${allDrivers.length} drivers`);

  let counts = { in_pool: 0, onboarding: 0, leaving: 0, admin: 0, off_roster: 0, unknown: 0 };

  for (const d of allDrivers) {
    let poolStatus: string = "unknown";
    let onboardingBucket: number | null = null;
    let onboardingBucketName: string | null = null;
    let onboardingBlockingReason: string | null = null;
    let soloType: string | null = null;

    // off-roster via inactive
    if (!d.isActive) {
      poolStatus = "off_roster";
    }
    // admin
    else if (ADMIN_MATCH.some(a =>
      d.lastName.toLowerCase().includes(a.lastName.toLowerCase()) &&
      d.firstName.toLowerCase().includes(a.firstName.toLowerCase())
    )) {
      poolStatus = "admin";
    }
    // leaving
    else if (LEAVING_MATCH.some(l => d.lastName.toLowerCase().includes(l.lastName.toLowerCase()))) {
      poolStatus = "leaving";
    }
    // onboarding
    else {
      const onb = ONBOARDING_MATCH.find(o =>
        d.lastName.toLowerCase().includes(o.lastName.toLowerCase()) &&
        d.firstName.toLowerCase().includes(o.firstName.toLowerCase())
      );
      if (onb) {
        poolStatus = "onboarding";
        onboardingBucket = onb.bucket;
        onboardingBucketName = onb.bucketName;
        onboardingBlockingReason = onb.blockingReason;
      }
      // in_pool via roster match
      else {
        const solo2Match = IN_POOL_SOLO2.some(ln => d.lastName.toUpperCase().includes(ln.toUpperCase()));
        const solo1Match = IN_POOL_SOLO1.some(ln => d.lastName.toUpperCase().includes(ln.toUpperCase()));
        if (solo2Match && solo1Match) { poolStatus = "in_pool"; soloType = "both"; }
        else if (solo2Match) { poolStatus = "in_pool"; soloType = "solo2"; }
        else if (solo1Match) { poolStatus = "in_pool"; soloType = "solo1"; }
      }
    }

    counts[poolStatus as keyof typeof counts]++;

    await db.update(drivers).set({
      poolStatus,
      onboardingBucket,
      onboardingBucketName,
      onboardingBlockingReason,
      soloType,
      dispatchReadyAt: poolStatus === "in_pool" ? new Date() : null,
    }).where(eq(drivers.id, d.id));
  }

  console.log("[seed-pool-status] Results:");
  Object.entries(counts).forEach(([k, v]) => console.log(`  ${k.padEnd(15)} ${v}`));
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
