/**
 * Test Bump Logic - Pulling Canonical Times from Contracts Table
 *
 * Demonstrates SaaS-ready bump logic:
 * 1. Query contracts table for tenant's canonical times
 * 2. Filter to times within ±Xhr of original
 * 3. Check which are open on this day
 * 4. Pick nearest open slot
 */

import { db } from "./server/db";
import { contracts, tenants } from "./shared/schema";
import { eq, and } from "drizzle-orm";
import { spawn } from "child_process";

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface SlotKey {
  soloType: string;
  tractorId: string;
  canonicalTime: string;
  dayOfWeek: string;
}

interface SlotDistribution {
  slot_type: "owned" | "rotating" | "unknown";
  owner: string | null;
  owner_share: number;
  shares: Record<string, number>;
  total_assignments: number;
  slot: string;
}

function makeSlotKey(slot: SlotKey): string {
  return `${slot.soloType}_${slot.tractorId}_${slot.canonicalTime}_${slot.dayOfWeek}`;
}

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + (minutes || 0);
}

async function getSlotDistribution(
  soloType: string,
  tractorId: string,
  dayOfWeek: number
): Promise<SlotDistribution> {
  return new Promise((resolve) => {
    const input = JSON.stringify({
      action: "get_distribution",
      soloType,
      tractorId,
      dayOfWeek,
    });

    const pythonProcess = spawn("python", ["python/xgboost_ownership.py"], {
      cwd: process.cwd(),
    });

    let stdout = "";
    pythonProcess.stdin.write(input);
    pythonProcess.stdin.end();
    pythonProcess.stdout.on("data", (data) => { stdout += data.toString(); });
    pythonProcess.on("close", () => {
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch {
        resolve({
          slot_type: "unknown",
          owner: null,
          owner_share: 0,
          shares: {},
          total_assignments: 0,
          slot: `${soloType}_${tractorId}_${DAY_NAMES[dayOfWeek]}`,
        });
      }
    });
  });
}

/**
 * Get canonical times from contracts table (SaaS-ready)
 */
async function getCanonicalTimesFromContracts(
  tenantId: string,
  soloType: string
): Promise<Array<{ startTime: string; tractorId: string }>> {
  const contractRecords = await db
    .select({
      startTime: contracts.startTime,
      tractorId: contracts.tractorId,
    })
    .from(contracts)
    .where(
      and(
        eq(contracts.tenantId, tenantId),
        eq(contracts.type, soloType),
        eq(contracts.status, "active")
      )
    );

  return contractRecords;
}

/**
 * Find bump candidates from contracts table
 */
async function findBumpCandidates(
  originalSlot: SlotKey,
  flexibilityHours: number,
  tenantId: string,
  assignedSlots: Map<string, string>,
  distributionMap: Map<string, SlotDistribution>
): Promise<Array<{
  slot: SlotKey;
  slotKey: string;
  bumpMinutes: number;
  isOpen: boolean;
  slotType: string;
  ownerName: string | null;
  conflictPenalty: number;
  distancePenalty: number;
  totalPenalty: number;
}>> {
  // Step 1: Query contracts table
  const contractTimes = await getCanonicalTimesFromContracts(tenantId, originalSlot.soloType);

  const originalMinutes = timeToMinutes(originalSlot.canonicalTime);
  const flexibilityMinutes = flexibilityHours * 60;

  const candidates: any[] = [];

  // Step 2: Filter to times within ±Xhr
  for (const contract of contractTimes) {
    const slotMinutes = timeToMinutes(contract.startTime);

    let diff = slotMinutes - originalMinutes;
    if (diff > 720) diff -= 1440;
    if (diff < -720) diff += 1440;

    const absDiff = Math.abs(diff);

    // Step 3: Check if within flexibility range
    if (absDiff > flexibilityMinutes) {
      continue;
    }

    // Build bump slot
    const bumpSlot: SlotKey = {
      soloType: originalSlot.soloType,
      tractorId: contract.tractorId,
      canonicalTime: contract.startTime,
      dayOfWeek: originalSlot.dayOfWeek,
    };

    const slotKey = makeSlotKey(bumpSlot);

    // Step 4: Check availability
    const isOpen = !assignedSlots.has(slotKey);
    const distribution = distributionMap.get(slotKey);
    const slotType = distribution?.slot_type || "unknown";
    const ownerName = distribution?.owner || null;

    let conflictPenalty = 0;
    if (!isOpen) {
      conflictPenalty = 0.5;
    } else if (slotType === "owned" && ownerName) {
      conflictPenalty = 0.2;
    }

    const distancePenalty = absDiff / 60 * 0.1;

    candidates.push({
      slot: bumpSlot,
      slotKey,
      bumpMinutes: diff,
      isOpen,
      slotType,
      ownerName,
      conflictPenalty,
      distancePenalty,
      totalPenalty: conflictPenalty + distancePenalty,
    });
  }

  // Step 5: Sort by preference
  candidates.sort((a, b) => {
    if (a.isOpen !== b.isOpen) return a.isOpen ? -1 : 1;
    return a.totalPenalty - b.totalPenalty;
  });

  return candidates;
}

async function main() {
  console.log("=".repeat(70));
  console.log("BUMP LOGIC - PULLING FROM CONTRACTS TABLE");
  console.log("=".repeat(70));

  // Get tenant ID (find tenant with multiple solo1 contracts)
  // Use tenant that has Tractor_X style contracts
  const tenantId = "3cf00ed3-3eb9-43bf-b001-aee880b30304";

  if (!tenantId) {
    console.log("No tenant found in database");
    process.exit(1);
  }

  console.log(`\n📋 Tenant ID: ${tenantId}`);

  const TIME_FLEXIBILITY = 2;
  const soloType = "solo1";
  const dayOfWeek = "saturday";
  const dayIndex = 6;

  // Step 1: Query ALL contracts to show filtering
  console.log(`\n${"─".repeat(70)}`);
  console.log("STEP 1: Query contracts table (showing solo type filtering)");
  console.log(`${"─".repeat(70)}`);

  // Get ALL contracts for this tenant to show what gets filtered
  const allContracts = await db
    .select({
      type: contracts.type,
      startTime: contracts.startTime,
      tractorId: contracts.tractorId,
    })
    .from(contracts)
    .where(
      and(
        eq(contracts.tenantId, tenantId),
        eq(contracts.status, "active")
      )
    );

  // Filter by solo type
  const contractTimes = allContracts.filter(c => c.type === soloType);
  const filteredOut = allContracts.filter(c => c.type !== soloType);

  console.log(`\n📊 SOLO TYPE FILTERING:`);
  console.log(`   Query: contracts WHERE type = '${soloType}'`);
  console.log(`   Total contracts: ${allContracts.length}`);
  console.log(`   ✅ Matching ${soloType}: ${contractTimes.length}`);
  console.log(`   ❌ Filtered out: ${filteredOut.length}`);

  console.log(`\n✅ INCLUDED (${soloType} contracts):`);
  const sortedTimes = [...contractTimes].sort((a, b) =>
    timeToMinutes(a.startTime) - timeToMinutes(b.startTime)
  );
  for (const ct of sortedTimes) {
    console.log(`   ✅ ${ct.type.padEnd(6)} ${ct.startTime.padEnd(6)} ${ct.tractorId}`);
  }

  console.log(`\n❌ FILTERED OUT (wrong solo type):`);
  const sortedFiltered = [...filteredOut].sort((a, b) =>
    timeToMinutes(a.startTime) - timeToMinutes(b.startTime)
  );
  for (const ct of sortedFiltered) {
    console.log(`   ❌ ${ct.type.padEnd(6)} ${ct.startTime.padEnd(6)} ${ct.tractorId} → wrong solo type`);
  }

  // Original slot (simulated as taken)
  const originalTime = "16:30";
  const originalSlot: SlotKey = {
    soloType,
    tractorId: "Tractor_1",
    canonicalTime: originalTime,
    dayOfWeek,
  };

  console.log(`\n📍 Original slot: ${soloType} ${originalSlot.tractorId} ${dayOfWeek} ${originalTime}`);
  console.log(`   Status: TAKEN (simulated)`);

  // Simulate some slots as taken
  const assignedSlots = new Map<string, string>();
  assignedSlots.set(makeSlotKey(originalSlot), "other-driver");

  // Step 2: Filter to times within ±2hr
  console.log(`\n${"─".repeat(70)}`);
  console.log(`STEP 2: Filter to times within ±${TIME_FLEXIBILITY}hr of ${originalTime}`);
  console.log(`${"─".repeat(70)}`);

  const originalMinutes = timeToMinutes(originalTime);
  const flexMinutes = TIME_FLEXIBILITY * 60;

  console.log(`\nOriginal: ${originalTime} = ${originalMinutes} minutes`);
  console.log(`Range: ${originalMinutes - flexMinutes} to ${originalMinutes + flexMinutes} minutes`);

  const inRange = sortedTimes.filter(ct => {
    const mins = timeToMinutes(ct.startTime);
    let diff = mins - originalMinutes;
    if (diff > 720) diff -= 1440;
    if (diff < -720) diff += 1440;
    return Math.abs(diff) <= flexMinutes;
  });

  console.log(`\nContracts within ±${TIME_FLEXIBILITY}hr:`);
  for (const ct of inRange) {
    const mins = timeToMinutes(ct.startTime);
    let diff = mins - originalMinutes;
    if (diff > 720) diff -= 1440;
    if (diff < -720) diff += 1440;
    const diffStr = diff > 0 ? `+${diff}` : `${diff}`;
    console.log(`   ${ct.startTime.padEnd(6)} - ${ct.tractorId.padEnd(12)} (${diffStr}min)`);
  }

  // Step 3 & 4: Get distributions and check availability
  console.log(`\n${"─".repeat(70)}`);
  console.log("STEP 3 & 4: Check availability on Saturday");
  console.log(`${"─".repeat(70)}`);

  // Build distribution map
  const distributionMap = new Map<string, SlotDistribution>();
  for (const ct of inRange) {
    const slot: SlotKey = {
      soloType,
      tractorId: ct.tractorId,
      canonicalTime: ct.startTime,
      dayOfWeek,
    };
    const dist = await getSlotDistribution(soloType, ct.tractorId, dayIndex);
    distributionMap.set(makeSlotKey(slot), dist);
  }

  // Find bump candidates
  const bumpCandidates = await findBumpCandidates(
    originalSlot,
    TIME_FLEXIBILITY,
    tenantId,
    assignedSlots,
    distributionMap
  );

  console.log(`\nBump candidates for ${originalTime} (${soloType} ONLY):`);
  console.log("─".repeat(95));
  console.log(`${"SoloType".padEnd(8)} ${"Time".padEnd(8)} ${"Tractor".padEnd(12)} ${"Bump".padEnd(8)} ${"Open?".padEnd(6)} ${"Type".padEnd(10)} ${"Owner".padEnd(15)} ${"Penalty"}`);
  console.log("─".repeat(95));

  for (const bump of bumpCandidates) {
    const bumpStr = bump.bumpMinutes > 0 ? `+${bump.bumpMinutes}m` : `${bump.bumpMinutes}m`;
    const openStr = bump.isOpen ? "✓" : "✗";
    const ownerStr = bump.ownerName?.slice(0, 14) || "-";

    console.log(
      `✅ ${bump.slot.soloType.padEnd(6)} ` +
      `${bump.slot.canonicalTime.padEnd(8)} ` +
      `${bump.slot.tractorId.padEnd(12)} ` +
      `${bumpStr.padEnd(8)} ` +
      `${openStr.padEnd(6)} ` +
      `${bump.slotType.padEnd(10)} ` +
      `${ownerStr.padEnd(15)} ` +
      `-${(bump.totalPenalty * 100).toFixed(0)}%`
    );
  }

  // Show that solo2 contracts were NOT considered
  console.log(`\n❌ NOT CONSIDERED (wrong solo type):`);
  for (const ct of sortedFiltered.slice(0, 5)) {
    const mins = timeToMinutes(ct.startTime);
    let diff = mins - originalMinutes;
    if (diff > 720) diff -= 1440;
    if (diff < -720) diff += 1440;
    const inTimeRange = Math.abs(diff) <= flexMinutes;
    const rangeStr = inTimeRange ? "(would be in ±2hr range)" : "(outside time range)";
    console.log(`   ❌ ${ct.type.padEnd(6)} ${ct.startTime.padEnd(6)} ${ct.tractorId.padEnd(12)} → wrong solo type ${rangeStr}`);
  }

  // Step 5: Pick nearest open
  console.log(`\n${"─".repeat(70)}`);
  console.log("STEP 5: Pick nearest open slot");
  console.log(`${"─".repeat(70)}`);

  const bestBump = bumpCandidates.find(b => b.isOpen);
  if (bestBump) {
    console.log(`\n✓ BEST BUMP CHOICE:`);
    console.log(`   Solo Type: ${bestBump.slot.soloType} ✅ (matches original)`);
    console.log(`   Time: ${bestBump.slot.canonicalTime} (${bestBump.bumpMinutes > 0 ? "+" : ""}${bestBump.bumpMinutes}min from original)`);
    console.log(`   Tractor: ${bestBump.slot.tractorId}`);
    console.log(`   Slot Type: ${bestBump.slotType.toUpperCase()}`);
    console.log(`   Distance Penalty: -${(bestBump.distancePenalty * 100).toFixed(0)}%`);
    console.log(`   Conflict Penalty: -${(bestBump.conflictPenalty * 100).toFixed(0)}%`);
    console.log(`   Total Penalty: -${(bestBump.totalPenalty * 100).toFixed(0)}%`);
  } else {
    console.log(`\n✗ No open bump slots available within ±${TIME_FLEXIBILITY}hr`);
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log("SUMMARY: SaaS-Ready Bump Logic");
  console.log("=".repeat(70));
  console.log(`
Flow:
  1. Query contracts table WHERE tenant_id = '${tenantId}' AND type = '${soloType}'
  2. Got ${contractTimes.length} canonical times from database (NOT hardcoded!)
  3. Filtered to ${inRange.length} times within ±${TIME_FLEXIBILITY}hr of ${originalTime}
  4. Checked availability on ${dayOfWeek}
  5. Picked best open slot: ${bestBump?.slot.canonicalTime || "none"}

This is SaaS-ready:
  - Each tenant has their own contracts
  - Canonical times come from database
  - No hardcoded time arrays
`);

  process.exit(0);
}

main().catch(console.error);
