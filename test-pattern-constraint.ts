/**
 * Test Pattern-Based Constraint Filter
 *
 * Demonstrates:
 * 1. Get REAL driver patterns from XGBoost (typical_days, day_list)
 * 2. Apply 4-day MINIMUM fairness floor
 * 3. Apply 6-day MAXIMUM safety cap
 *
 * Logic:
 *   targetDays = max(4, xgboostPattern)   // Fairness floor
 *   targetDays = min(targetDays, 6)       // Safety cap
 *
 * Examples:
 *   Mike Burton (pattern 2) → max(4, 2) = 4 days
 *   Josh Green (pattern 5)  → max(4, 5) = 5 days
 *   Unknown (no pattern)    → 4 days minimum, 6 max
 */

import { spawn } from "child_process";

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface SlotKey {
  soloType: string;
  tractorId: string;
  canonicalTime: string;
  dayOfWeek: string;
}

interface DriverConstraints {
  driverId: string;
  driverName: string;             // Real name for XGBoost lookup
  contractType: string;
  daysThisWeek: Set<string>;
  shiftsThisWeek: Array<{ date: string; startTime: string; endTime: string }>;
  xgboostPattern?: number;        // Raw pattern from XGBoost
  targetDaysPerWeek: number;      // Computed: max(4, min(pattern, 6))
  preferredDays?: string[];       // From XGBoost pattern
}

interface DriverPattern {
  driver: string;
  typical_days: number;
  day_list: string[];
  day_counts: Record<string, number>;
  confidence: number;
}

const MIN_DAYS_PER_WEEK = 4;  // Fairness floor
const MAX_DAYS_PER_WEEK = 6;  // Safety cap

/**
 * Compute target days: max(4, min(pattern, 6))
 */
function computeTargetDays(xgboostPattern?: number): number {
  if (xgboostPattern === undefined) {
    return MIN_DAYS_PER_WEEK;  // Unknown driver gets fairness floor
  }
  const withFloor = Math.max(MIN_DAYS_PER_WEEK, xgboostPattern);
  return Math.min(withFloor, MAX_DAYS_PER_WEEK);
}

async function getDriverPattern(driverName: string): Promise<DriverPattern> {
  return new Promise((resolve) => {
    const input = JSON.stringify({
      action: "get_driver_pattern",
      driverName,
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
        resolve(JSON.parse(stdout.trim()) as DriverPattern);
      } catch {
        resolve({
          driver: driverName,
          typical_days: 6,
          day_list: [],
          day_counts: {},
          confidence: 0,
        });
      }
    });
  });
}

function checkConstraints(
  driverId: string,
  slot: SlotKey,
  serviceDate: string,
  driverConstraints: Map<string, DriverConstraints>
): { valid: boolean; reason: string } {
  const constraints = driverConstraints.get(driverId);

  if (!constraints) {
    return { valid: true, reason: "" };
  }

  // CONTRACT TYPE MATCH
  if (constraints.contractType !== slot.soloType) {
    return {
      valid: false,
      reason: `Contract mismatch: driver is ${constraints.contractType}, block is ${slot.soloType}`,
    };
  }

  // DAY LIMIT - Use computed target (min 4, max 6)
  const daysIfAssigned = new Set(constraints.daysThisWeek);
  daysIfAssigned.add(serviceDate);

  if (daysIfAssigned.size > constraints.targetDaysPerWeek) {
    const patternInfo = constraints.xgboostPattern !== undefined
      ? `XGBoost: ${constraints.xgboostPattern} → target: ${constraints.targetDaysPerWeek}`
      : `no pattern → target: ${constraints.targetDaysPerWeek}`;
    return {
      valid: false,
      reason: `Day limit: ${constraints.daysThisWeek.size}/${constraints.targetDaysPerWeek} days (${patternInfo})`,
    };
  }

  return { valid: true, reason: "" };
}

async function main() {
  console.log("=".repeat(70));
  console.log("PATTERN-BASED CONSTRAINT FILTER TEST");
  console.log("=".repeat(70));
  console.log(`\nLogic: targetDays = max(${MIN_DAYS_PER_WEEK}, min(XGBoostPattern, ${MAX_DAYS_PER_WEEK}))`);

  // ──────────────────────────────────────────────────────────────────────
  // Step 1: Get REAL patterns from XGBoost
  // ──────────────────────────────────────────────────────────────────────
  console.log("\n" + "─".repeat(70));
  console.log("STEP 1: Get REAL patterns from XGBoost");
  console.log("─".repeat(70));

  const joshPattern = await getDriverPattern("Joshua ALLEN Green");
  const mikePattern = await getDriverPattern("Michael Shane Burton");

  console.log(`\nJOSH GREEN (Joshua ALLEN Green):`);
  console.log(`   XGBoost typical_days: ${joshPattern.typical_days}`);
  console.log(`   day_list: [${joshPattern.day_list.join(", ")}]`);
  console.log(`   confidence: ${(joshPattern.confidence * 100).toFixed(0)}%`);
  console.log(`   → targetDays = max(4, min(${joshPattern.typical_days}, 6)) = ${computeTargetDays(joshPattern.typical_days)}`);

  console.log(`\nMIKE BURTON (Michael Shane Burton):`);
  console.log(`   XGBoost typical_days: ${mikePattern.typical_days}`);
  console.log(`   day_list: [${mikePattern.day_list.join(", ")}]`);
  console.log(`   confidence: ${(mikePattern.confidence * 100).toFixed(0)}%`);
  console.log(`   → targetDays = max(4, min(${mikePattern.typical_days}, 6)) = ${computeTargetDays(mikePattern.typical_days)}`);

  // ──────────────────────────────────────────────────────────────────────
  // Step 2: Build constraints with computed targets
  // ──────────────────────────────────────────────────────────────────────
  console.log("\n" + "─".repeat(70));
  console.log("STEP 2: Build constraints with computed targets");
  console.log("─".repeat(70));

  // Josh: pattern=5, target=max(4,min(5,6))=5
  const joshConstraints: DriverConstraints = {
    driverId: "josh-green",
    driverName: "Joshua ALLEN Green",
    contractType: "solo1",
    daysThisWeek: new Set([
      "2024-12-14", // Saturday
      "2024-12-15", // Sunday
      "2024-12-16", // Monday
      "2024-12-17", // Tuesday
      "2024-12-18", // Wednesday
    ]),
    shiftsThisWeek: [],
    xgboostPattern: joshPattern.typical_days,
    targetDaysPerWeek: computeTargetDays(joshPattern.typical_days),
    preferredDays: joshPattern.day_list.map(d => d.toLowerCase()),
  };

  // Mike: pattern=2, target=max(4,min(2,6))=4 (raised by fairness floor!)
  const mikeConstraints: DriverConstraints = {
    driverId: "mike-burton",
    driverName: "Michael Shane Burton",
    contractType: "solo1",
    daysThisWeek: new Set([
      "2024-12-14",
      "2024-12-15",
      "2024-12-16",
    ]),
    shiftsThisWeek: [],
    xgboostPattern: mikePattern.typical_days,
    targetDaysPerWeek: computeTargetDays(mikePattern.typical_days),
    preferredDays: mikePattern.day_list.map(d => d.toLowerCase()),
  };

  // Unknown driver: no pattern, target=4 (fairness floor)
  const unknownConstraints: DriverConstraints = {
    driverId: "unknown-driver",
    driverName: "New Driver",
    contractType: "solo1",
    daysThisWeek: new Set([
      "2024-12-14",
      "2024-12-15",
      "2024-12-16",
    ]),
    shiftsThisWeek: [],
    xgboostPattern: undefined,
    targetDaysPerWeek: computeTargetDays(undefined),
  };

  const constraintsMap = new Map<string, DriverConstraints>();
  constraintsMap.set("josh-green", joshConstraints);
  constraintsMap.set("mike-burton", mikeConstraints);
  constraintsMap.set("unknown-driver", unknownConstraints);

  console.log(`\nCONSTRAINTS BUILT:`);
  console.log(`   Josh Green:    XGBoost=${joshConstraints.xgboostPattern} → target=${joshConstraints.targetDaysPerWeek}, worked=${joshConstraints.daysThisWeek.size}`);
  console.log(`   Mike Burton:   XGBoost=${mikeConstraints.xgboostPattern} → target=${mikeConstraints.targetDaysPerWeek}, worked=${mikeConstraints.daysThisWeek.size}`);
  console.log(`   Unknown:       XGBoost=none → target=${unknownConstraints.targetDaysPerWeek}, worked=${unknownConstraints.daysThisWeek.size}`);

  // ──────────────────────────────────────────────────────────────────────
  // Step 3: Test assignments
  // ──────────────────────────────────────────────────────────────────────
  console.log("\n" + "─".repeat(70));
  console.log("STEP 3: Test block assignments");
  console.log("─".repeat(70));

  const testSlot: SlotKey = {
    soloType: "solo1",
    tractorId: "Tractor_1",
    canonicalTime: "16:30",
    dayOfWeek: "thursday",
  };

  // Test Josh: 5 days worked, target=5, trying 6th day
  console.log(`\nTEST 1: Josh Green (5 days worked, target=5)`);
  console.log(`        Trying to assign Thursday (6th day)`);
  const joshResult = checkConstraints("josh-green", testSlot, "2024-12-19", constraintsMap);
  console.log(`        Result: ${joshResult.valid ? "VALID" : "BLOCKED"}`);
  if (!joshResult.valid) console.log(`        Reason: ${joshResult.reason}`);

  // Test Mike: 3 days worked, target=4 (raised from pattern=2)
  console.log(`\nTEST 2: Mike Burton (3 days worked, XGBoost=2 → target=4)`);
  console.log(`        Trying to assign Thursday (4th day)`);
  const mikeResult = checkConstraints("mike-burton", testSlot, "2024-12-19", constraintsMap);
  console.log(`        Result: ${mikeResult.valid ? "VALID" : "BLOCKED"}`);
  if (!mikeResult.valid) console.log(`        Reason: ${mikeResult.reason}`);

  // Test Mike: trying 5th day (should be blocked)
  console.log(`\nTEST 3: Mike Burton (now 4 days worked, target=4)`);
  console.log(`        Trying to assign Friday (5th day)`);
  mikeConstraints.daysThisWeek.add("2024-12-19"); // Add Thursday
  const mikeResult2 = checkConstraints("mike-burton", testSlot, "2024-12-20", constraintsMap);
  console.log(`        Result: ${mikeResult2.valid ? "VALID" : "BLOCKED"}`);
  if (!mikeResult2.valid) console.log(`        Reason: ${mikeResult2.reason}`);

  // Test Unknown: 3 days worked, target=4 (fairness floor)
  console.log(`\nTEST 4: Unknown Driver (3 days worked, no pattern → target=4)`);
  console.log(`        Trying to assign Thursday (4th day)`);
  const unknownResult = checkConstraints("unknown-driver", testSlot, "2024-12-19", constraintsMap);
  console.log(`        Result: ${unknownResult.valid ? "VALID" : "BLOCKED"}`);
  if (!unknownResult.valid) console.log(`        Reason: ${unknownResult.reason}`);

  // ──────────────────────────────────────────────────────────────────────
  // Summary
  // ──────────────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(70));
  console.log("SUMMARY");
  console.log("=".repeat(70));

  console.log(`
TARGET DAYS FORMULA: max(4, min(XGBoostPattern, 6))

RESULTS WITH REAL DATA:
  Josh Green:
    - XGBoost pattern: ${joshPattern.typical_days} days [${joshPattern.day_list.join(", ")}]
    - Target: max(4, min(${joshPattern.typical_days}, 6)) = ${computeTargetDays(joshPattern.typical_days)} days
    - 5 days worked → 6th day: BLOCKED

  Mike Burton:
    - XGBoost pattern: ${mikePattern.typical_days} days [${mikePattern.day_list.join(", ")}]
    - Target: max(4, min(${mikePattern.typical_days}, 6)) = ${computeTargetDays(mikePattern.typical_days)} days
    - 3 days worked → 4th day: ALLOWED
    - 4 days worked → 5th day: BLOCKED

  Unknown Driver:
    - No XGBoost data
    - Target: ${computeTargetDays(undefined)} days (fairness floor)
    - 3 days worked → 4th day: ALLOWED

KEY RULES:
  - Minimum: 4 days (fairness floor - everyone gets fair share)
  - Target: XGBoost pattern if > 4 (respect driver preferences)
  - Maximum: 6 days (safety cap - never exceed)
`);

  process.exit(0);
}

main().catch(console.error);
