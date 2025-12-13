/**
 * Test Bump Logic
 *
 * Demonstrates:
 * 1. Owner's slot is taken
 * 2. timeFlexibility = 2 (±2hr)
 * 3. Bump candidates and their scores
 */

import { spawn } from "child_process";

// Day names for display
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_NAME_TO_INDEX: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

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
 * Find bump candidates within ±flexibilityHours
 */
function findBumpCandidates(
  originalSlot: SlotKey,
  flexibilityHours: number,
  allSlots: SlotKey[],
  assignedSlots: Map<string, string>,
  distributionMap: Map<string, SlotDistribution>
): Array<{
  slot: SlotKey;
  slotKey: string;
  bumpMinutes: number;
  isOpen: boolean;
  slotType: string;
  ownerName: string | null;
  conflictPenalty: number;
  distancePenalty: number;
  totalPenalty: number;
}> {
  const originalMinutes = timeToMinutes(originalSlot.canonicalTime);
  const flexibilityMinutes = flexibilityHours * 60;
  const candidates: any[] = [];

  for (const slot of allSlots) {
    // Must match soloType, tractorId, and dayOfWeek
    if (
      slot.soloType !== originalSlot.soloType ||
      slot.tractorId !== originalSlot.tractorId ||
      slot.dayOfWeek !== originalSlot.dayOfWeek
    ) {
      continue;
    }

    const slotMinutes = timeToMinutes(slot.canonicalTime);

    // Calculate time difference
    let diff = slotMinutes - originalMinutes;
    if (diff > 720) diff -= 1440;
    if (diff < -720) diff += 1440;

    const absDiff = Math.abs(diff);

    // Check if within flexibility range
    if (absDiff > flexibilityMinutes) {
      continue;
    }

    const slotKey = makeSlotKey(slot);
    const isOpen = !assignedSlots.has(slotKey);
    const distribution = distributionMap.get(slotKey);
    const slotType = distribution?.slot_type || "unknown";
    const ownerName = distribution?.owner || null;

    // Conflict penalty
    let conflictPenalty = 0;
    if (!isOpen) {
      conflictPenalty = 0.5;
    } else if (slotType === "owned" && ownerName) {
      conflictPenalty = 0.2;
    }

    // Distance penalty: 0.1 per hour
    const distancePenalty = absDiff / 60 * 0.1;

    candidates.push({
      slot,
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

  // Sort by: 1) Open first, 2) Lowest total penalty
  candidates.sort((a, b) => {
    if (a.isOpen !== b.isOpen) return a.isOpen ? -1 : 1;
    return a.totalPenalty - b.totalPenalty;
  });

  return candidates;
}

async function main() {
  console.log("=".repeat(70));
  console.log("BUMP LOGIC TEST");
  console.log("=".repeat(70));

  const TIME_FLEXIBILITY = 2; // ±2 hours

  // Simulate slots for a day (solo1, multiple times on Wednesday)
  const dayOfWeek = "wednesday";
  const soloType = "solo1";
  const tractorId = "Tractor_10";

  // Generate slots at different times (simulating what would exist)
  const allSlots: SlotKey[] = [
    { soloType, tractorId, canonicalTime: "18:30", dayOfWeek },
    { soloType, tractorId, canonicalTime: "19:30", dayOfWeek },
    { soloType, tractorId, canonicalTime: "20:30", dayOfWeek }, // Original owner's slot
    { soloType, tractorId, canonicalTime: "21:30", dayOfWeek },
    { soloType, tractorId, canonicalTime: "22:30", dayOfWeek },
  ];

  // Simulate: Owner's preferred slot (20:30) is TAKEN
  const assignedSlots = new Map<string, string>();
  const takenSlotKey = makeSlotKey(allSlots[2]); // 20:30
  assignedSlots.set(takenSlotKey, "some-other-driver-id");

  console.log(`\n📍 SCENARIO: Owner's preferred slot is TAKEN`);
  console.log(`   Slot: ${soloType} ${tractorId} ${dayOfWeek} 20:30`);
  console.log(`   Taken by: Another driver`);
  console.log(`   Time Flexibility: ±${TIME_FLEXIBILITY} hours`);

  // Get distributions for all slots
  const distributionMap = new Map<string, SlotDistribution>();
  for (const slot of allSlots) {
    const dist = await getSlotDistribution(
      slot.soloType,
      slot.tractorId,
      DAY_NAME_TO_INDEX[slot.dayOfWeek]
    );
    distributionMap.set(makeSlotKey(slot), dist);
  }

  // Show original slot ownership
  const originalSlot = allSlots[2];
  const originalDist = distributionMap.get(makeSlotKey(originalSlot));
  console.log(`\n📊 ORIGINAL SLOT OWNERSHIP (${originalSlot.canonicalTime}):`);
  console.log(`   Type: ${originalDist?.slot_type?.toUpperCase() || "UNKNOWN"}`);
  if (originalDist?.shares) {
    const sortedShares = Object.entries(originalDist.shares).sort((a, b) => b[1] - a[1]);
    for (const [driver, share] of sortedShares) {
      console.log(`   ${driver.padEnd(25)} ${(share * 100).toFixed(0)}%`);
    }
  }

  // Simulate owner looking for bump slots
  const ownerName = originalDist?.shares
    ? Object.entries(originalDist.shares).sort((a, b) => b[1] - a[1])[0]?.[0]
    : "Unknown Owner";
  const ownerBaseScore = 0.8; // Simulated high ownership score

  console.log(`\n👤 OWNER: ${ownerName}`);
  console.log(`   Base Score: ${(ownerBaseScore * 100).toFixed(0)}%`);

  // Find bump candidates
  const bumpCandidates = findBumpCandidates(
    originalSlot,
    TIME_FLEXIBILITY,
    allSlots,
    assignedSlots,
    distributionMap
  );

  console.log(`\n⏰ BUMP CANDIDATES (within ±${TIME_FLEXIBILITY}hr):`);
  console.log("─".repeat(70));
  console.log(`${"Time".padEnd(8)} ${"Bump".padEnd(8)} ${"Open?".padEnd(6)} ${"Type".padEnd(10)} ${"Dist Pen".padEnd(10)} ${"Conf Pen".padEnd(10)} ${"Total".padEnd(10)} Final Score`);
  console.log("─".repeat(70));

  for (const bump of bumpCandidates) {
    const bumpStr = bump.bumpMinutes > 0 ? `+${bump.bumpMinutes}m` : `${bump.bumpMinutes}m`;
    const openStr = bump.isOpen ? "✓" : "✗";
    const finalScore = bump.isOpen ? Math.max(0, ownerBaseScore - bump.totalPenalty) : 0;

    console.log(
      `${bump.slot.canonicalTime.padEnd(8)} ` +
      `${bumpStr.padEnd(8)} ` +
      `${openStr.padEnd(6)} ` +
      `${bump.slotType.padEnd(10)} ` +
      `${(`-${(bump.distancePenalty * 100).toFixed(0)}%`).padEnd(10)} ` +
      `${(`-${(bump.conflictPenalty * 100).toFixed(0)}%`).padEnd(10)} ` +
      `${(`-${(bump.totalPenalty * 100).toFixed(0)}%`).padEnd(10)} ` +
      `${bump.isOpen ? `${(finalScore * 100).toFixed(0)}%` : "N/A (taken)"}`
    );
  }

  // Show best bump choice
  const bestBump = bumpCandidates.find(b => b.isOpen);
  if (bestBump) {
    const finalScore = ownerBaseScore - bestBump.totalPenalty;
    console.log(`\n✓ BEST BUMP CHOICE:`);
    console.log(`   Time: ${bestBump.slot.canonicalTime} (${bestBump.bumpMinutes > 0 ? "+" : ""}${bestBump.bumpMinutes} minutes from original)`);
    console.log(`   Slot Type: ${bestBump.slotType.toUpperCase()}`);
    console.log(`   Distance Penalty: -${(bestBump.distancePenalty * 100).toFixed(0)}%`);
    console.log(`   Conflict Penalty: -${(bestBump.conflictPenalty * 100).toFixed(0)}%`);
    console.log(`   Final Score: ${(finalScore * 100).toFixed(0)}% (down from ${(ownerBaseScore * 100).toFixed(0)}%)`);

    if (bestBump.slotType === "rotating") {
      console.log(`   ✓ Bumping to ROTATING slot (no conflict)`);
    } else if (bestBump.ownerName) {
      console.log(`   ⚠ Bumping into ${bestBump.ownerName}'s owned slot`);
    }
  }

  // Priority explanation
  console.log(`\n${"=".repeat(70)}`);
  console.log("BUMP PRIORITY ORDER:");
  console.log("=".repeat(70));
  console.log(`
1. ROTATING slot (no dominant owner)
   → Conflict penalty: 0%
   → Only distance penalty applies

2. Slot where bumping driver ALSO has history
   → Conflict penalty: 0% (driver has claim)
   → Only distance penalty applies

3. OWNED slot by someone else
   → Conflict penalty: 20% (taking someone's slot)
   → Distance penalty also applies

4. Taken slot
   → Not available for bumping
   → Must find alternative

SCORING FORMULA:
  baseScore = ownershipScore (from XGBoost)
  distancePenalty = |bumpMinutes| / 60 × 0.1
  conflictPenalty = 0.2 if bumping into owned slot
  finalScore = baseScore - distancePenalty - conflictPenalty
`);

  // SCENARIO 2: Test with mixed slot types (some OWNED)
  console.log("\n" + "=".repeat(70));
  console.log("SCENARIO 2: Mixed slot types (OWNED vs ROTATING)");
  console.log("=".repeat(70));

  // Manually create mixed distributions
  const mixedDistributionMap = new Map<string, SlotDistribution>();
  mixedDistributionMap.set(makeSlotKey(allSlots[0]), {
    slot_type: "owned",
    owner: "Driver A",
    owner_share: 0.85,
    shares: { "Driver A": 0.85 },
    total_assignments: 10,
    slot: makeSlotKey(allSlots[0]),
  });
  mixedDistributionMap.set(makeSlotKey(allSlots[1]), {
    slot_type: "rotating",
    owner: null,
    owner_share: 0.35,
    shares: { "Driver B": 0.35, "Driver C": 0.35 },
    total_assignments: 10,
    slot: makeSlotKey(allSlots[1]),
  });
  mixedDistributionMap.set(makeSlotKey(allSlots[2]), {
    slot_type: "rotating",
    owner: null,
    owner_share: 0.40,
    shares: { "Josh": 0.40 },
    total_assignments: 10,
    slot: makeSlotKey(allSlots[2]),
  });
  mixedDistributionMap.set(makeSlotKey(allSlots[3]), {
    slot_type: "owned",
    owner: "Driver D",
    owner_share: 0.75,
    shares: { "Driver D": 0.75 },
    total_assignments: 10,
    slot: makeSlotKey(allSlots[3]),
  });
  mixedDistributionMap.set(makeSlotKey(allSlots[4]), {
    slot_type: "rotating",
    owner: null,
    owner_share: 0.30,
    shares: { "Driver E": 0.30 },
    total_assignments: 10,
    slot: makeSlotKey(allSlots[4]),
  });

  console.log(`\n📊 SLOT TYPE DISTRIBUTION:`);
  for (const slot of allSlots) {
    const dist = mixedDistributionMap.get(makeSlotKey(slot));
    const isTaken = assignedSlots.has(makeSlotKey(slot));
    console.log(`   ${slot.canonicalTime}: ${(dist?.slot_type?.toUpperCase() || "?").padEnd(8)} ${dist?.owner ? `Owner: ${dist.owner}` : "(no owner)".padEnd(20)} ${isTaken ? "[TAKEN]" : ""}`);
  }

  // Find bump candidates with mixed types
  const mixedBumpCandidates = findBumpCandidates(
    originalSlot,
    TIME_FLEXIBILITY,
    allSlots,
    assignedSlots,
    mixedDistributionMap
  );

  console.log(`\n⏰ BUMP CANDIDATES (prioritizing ROTATING over OWNED):`);
  console.log("─".repeat(85));
  console.log(`${"Time".padEnd(8)} ${"Bump".padEnd(8)} ${"Open?".padEnd(6)} ${"Type".padEnd(10)} ${"Owner".padEnd(12)} ${"Dist Pen".padEnd(10)} ${"Conf Pen".padEnd(10)} ${"Final"}`);
  console.log("─".repeat(85));

  for (const bump of mixedBumpCandidates) {
    const bumpStr = bump.bumpMinutes > 0 ? `+${bump.bumpMinutes}m` : `${bump.bumpMinutes}m`;
    const openStr = bump.isOpen ? "✓" : "✗";
    const ownerStr = bump.ownerName || "-";
    const finalScore = bump.isOpen ? Math.max(0, ownerBaseScore - bump.totalPenalty) : 0;

    console.log(
      `${bump.slot.canonicalTime.padEnd(8)} ` +
      `${bumpStr.padEnd(8)} ` +
      `${openStr.padEnd(6)} ` +
      `${bump.slotType.padEnd(10)} ` +
      `${ownerStr.padEnd(12)} ` +
      `${(`-${(bump.distancePenalty * 100).toFixed(0)}%`).padEnd(10)} ` +
      `${(`-${(bump.conflictPenalty * 100).toFixed(0)}%`).padEnd(10)} ` +
      `${bump.isOpen ? `${(finalScore * 100).toFixed(0)}%` : "N/A"}`
    );
  }

  // Show best bump choice
  const mixedBestBump = mixedBumpCandidates.find(b => b.isOpen);
  if (mixedBestBump) {
    const finalScore = ownerBaseScore - mixedBestBump.totalPenalty;
    console.log(`\n✓ BEST BUMP CHOICE:`);
    console.log(`   Time: ${mixedBestBump.slot.canonicalTime} (${mixedBestBump.bumpMinutes > 0 ? "+" : ""}${mixedBestBump.bumpMinutes} min)`);
    console.log(`   Slot Type: ${mixedBestBump.slotType.toUpperCase()}`);
    if (mixedBestBump.slotType === "rotating") {
      console.log(`   ✓ ROTATING slot chosen over OWNED slots (no conflict penalty!)`);
    } else {
      console.log(`   ⚠ OWNED slot by ${mixedBestBump.ownerName} (conflict penalty: 20%)`);
    }
    console.log(`   Final Score: ${(finalScore * 100).toFixed(0)}%`);
  }

  process.exit(0);
}

main().catch(console.error);
