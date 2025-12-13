/**
 * Test Rotating Slot Detection + Fairness Logic
 *
 * Demonstrates:
 * 1. How slots are classified (OWNED vs ROTATING)
 * 2. Fairness logic for rotating slots
 */

import { spawn } from "child_process";

// Day names for display
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface SlotDistribution {
  slot_type: "owned" | "rotating" | "unknown";
  owner: string | null;
  owner_share: number;
  shares: Record<string, number>;
  total_assignments: number;
  slot: string;
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
 * Apply fairness scoring for rotating slots
 * NEW FORMULA: 70% fairness (fewer days), 30% history
 */
function applyFairnessLogic(
  distribution: SlotDistribution,
  weekDayCounts: Record<string, number>
): { driver: string; score: number; reason: string }[] {
  const results: { driver: string; score: number; reason: string }[] = [];

  if (distribution.slot_type !== "rotating") {
    // OWNED slot - return owner
    if (distribution.owner) {
      results.push({
        driver: distribution.owner,
        score: distribution.owner_share,
        reason: `OWNED slot (${(distribution.owner_share * 100).toFixed(0)}% ownership)`,
      });
    }
    return results;
  }

  // ROTATING slot - fairness is PRIMARY (70%), history is SECONDARY (30%)
  const maxDays = Math.max(...Object.values(weekDayCounts), 1);
  const minDays = Math.min(...Object.values(weekDayCounts));

  for (const [driver, share] of Object.entries(distribution.shares)) {
    const daysThisWeek = weekDayCounts[driver] ?? 0;

    // Fairness score: fewer days = higher score (normalized 0-1)
    // Driver with fewest days gets 1.0, most days gets 0.2
    const fairnessScore = maxDays > minDays
      ? 0.2 + 0.8 * ((maxDays - daysThisWeek) / (maxDays - minDays))
      : 0.6;

    // Historical share as tie-breaker (0-0.3 bonus)
    const historyBonus = share * 0.3;

    // Final score: 70% fairness, 30% history
    const score = fairnessScore * 0.7 + (share + historyBonus) * 0.3;

    results.push({
      driver,
      score,
      reason: `${daysThisWeek} days this week → fairness=${(fairnessScore * 100).toFixed(0)}%, history=${(share * 100).toFixed(0)}%`,
    });
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  return results;
}

async function main() {
  console.log("=".repeat(70));
  console.log("ROTATING SLOT DETECTION + FAIRNESS LOGIC TEST");
  console.log("=".repeat(70));

  // Test slots
  const testSlots = [
    { soloType: "solo1", tractorId: "Tractor_10", dayOfWeek: 3, desc: "Wed Tractor_10 20:30" },
    { soloType: "solo1", tractorId: "Tractor_3", dayOfWeek: 0, desc: "Sun Tractor_3 20:30" },
    { soloType: "solo1", tractorId: "Tractor_1", dayOfWeek: 0, desc: "Sun Tractor_1 16:30" },
  ];

  // Simulated week day counts
  const weekDayCounts: Record<string, number> = {
    "Joshua ALLEN Green": 4,
    "Michael Shane Burton": 2,
    "Raymond Jacinto Beeks": 1,
    "Brett Michael Baker": 3,
    "Brian ALLAN Strickland": 2,
    "Tareef THAMER Mahdi": 3,
    "Isaac Kiragu": 2,
  };

  console.log("\n📊 SIMULATED WEEK ASSIGNMENTS:");
  for (const [driver, days] of Object.entries(weekDayCounts).sort((a, b) => b[1] - a[1])) {
    const bar = "█".repeat(days);
    console.log(`  ${driver.padEnd(25)} ${days} days ${bar}`);
  }

  for (const slot of testSlots) {
    console.log("\n" + "─".repeat(70));
    console.log(`\n📍 SLOT: ${slot.desc}`);

    const dist = await getSlotDistribution(slot.soloType, slot.tractorId, slot.dayOfWeek);

    console.log(`\n🏷️  CLASSIFICATION: ${dist.slot_type.toUpperCase()}`);
    console.log(`   Top share: ${(dist.owner_share * 100).toFixed(0)}%`);
    console.log(`   Total historical assignments: ${dist.total_assignments}`);

    if (dist.slot_type === "owned") {
      console.log(`   ✓ OWNER: ${dist.owner}`);
      console.log(`   → Give to owner (current logic)`);
    } else if (dist.slot_type === "rotating") {
      console.log(`   ⟳ No dominant owner (all shares < 70%)`);

      console.log(`\n📊 OWNERSHIP DISTRIBUTION:`);
      const sortedShares = Object.entries(dist.shares).sort((a, b) => b[1] - a[1]);
      for (const [driver, share] of sortedShares) {
        const bar = "█".repeat(Math.round(share * 20));
        console.log(`   ${driver.padEnd(25)} ${(share * 100).toFixed(0).padStart(3)}% ${bar}`);
      }

      console.log(`\n⚖️  FAIRNESS SCORING (prioritize drivers with fewer days):`);
      const fairnessResults = applyFairnessLogic(dist, weekDayCounts);
      for (let i = 0; i < Math.min(fairnessResults.length, 4); i++) {
        const r = fairnessResults[i];
        const prefix = i === 0 ? "→ WINNER:" : "  ";
        console.log(`   ${prefix} ${r.driver}`);
        console.log(`      ${r.reason}`);
        console.log(`      Final score: ${(r.score * 100).toFixed(1)}%`);
      }
    }
  }

  console.log("\n" + "=".repeat(70));
  console.log("SUMMARY");
  console.log("=".repeat(70));
  console.log(`
SLOT CLASSIFICATION (70% threshold):
  • OWNED: One driver has ≥70% of historical assignments
    → Give to owner (current logic)

  • ROTATING: No driver has ≥70% (shared slot)
    → Apply fairness: prioritize drivers with FEWER days this week
    → Use historical share as tie-breaker

FAIRNESS FORMULA:
  fairnessBoost = 1.3 - (0.6 × daysThisWeek / maxDays)
  score = historicalShare × fairnessBoost × (1 + historicalShare × 0.3)
`);

  process.exit(0);
}

main().catch(console.error);
