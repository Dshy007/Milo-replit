/**
 * Test Constraint Filter - Step 3 of Pipeline
 *
 * Demonstrates constraint filtering:
 * 1. Max 6 days per driver per week
 * 2. No double-booking (driver can't work 2 blocks same time)
 * 3. Contract type must match (solo1 driver → solo1 blocks only)
 * 4. 10-hour rest between shifts
 */

// Types matching schedule-pipeline.ts
interface SlotKey {
  soloType: string;
  tractorId: string;
  canonicalTime: string;
  dayOfWeek: string;
}

interface DriverScore {
  driverId: string;
  driverName: string;
  score: number;
  ownershipScore: number;
  bumpPenalty: number;
  bumpMinutes: number;
  method: string;
  reason: string;
}

interface BlockCandidate {
  blockId: string;
  slot: SlotKey;
  candidates: DriverScore[];
}

interface DriverConstraints {
  driverId: string;
  contractType: string;
  daysThisWeek: Set<string>;
  shiftsThisWeek: Array<{
    date: string;
    startTime: string;
    endTime: string;
  }>;
}

interface FilterResult {
  valid: boolean;
  reason: string;
}

function makeSlotKey(slot: SlotKey): string {
  return `${slot.soloType}_${slot.tractorId}_${slot.canonicalTime}_${slot.dayOfWeek}`;
}

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + (minutes || 0);
}

function checkConstraints(
  driverId: string,
  slot: SlotKey,
  serviceDate: string,
  driverConstraints: Map<string, DriverConstraints>,
  maxDaysPerWeek: number,
  minRestHours: number
): FilterResult {
  const constraints = driverConstraints.get(driverId);

  if (!constraints) {
    return { valid: true, reason: "" };
  }

  // 1. CONTRACT TYPE MATCH
  if (constraints.contractType !== slot.soloType) {
    return {
      valid: false,
      reason: `Contract mismatch: driver is ${constraints.contractType}, block is ${slot.soloType}`,
    };
  }

  // 2. MAX DAYS PER WEEK
  const daysIfAssigned = new Set(constraints.daysThisWeek);
  daysIfAssigned.add(serviceDate);

  if (daysIfAssigned.size > maxDaysPerWeek) {
    return {
      valid: false,
      reason: `6-day limit: driver already has ${constraints.daysThisWeek.size} days this week`,
    };
  }

  // 3. DOUBLE-BOOKING
  // Check if driver already has a shift that overlaps with this new slot
  const newStartMinutes = timeToMinutes(slot.canonicalTime);
  const newEndMinutes = newStartMinutes + 480; // 8-hour shift

  for (const existingShift of constraints.shiftsThisWeek) {
    const existingStartMinutes = timeToMinutes(existingShift.startTime);
    let existingEndMinutes = timeToMinutes(existingShift.endTime);

    // Handle overnight shifts (end time < start time means next day)
    const isOvernightShift = existingEndMinutes < existingStartMinutes;

    if (existingShift.date === serviceDate) {
      // Same day - check for overlap
      if (isOvernightShift) {
        // Existing shift goes overnight (e.g., 17:30-01:30)
        // New shift overlaps if it starts before midnight (shift runs until 1440+existingEndMinutes)
        existingEndMinutes = 1440 + existingEndMinutes; // Extend to next day
      }

      if (newStartMinutes < existingEndMinutes && newEndMinutes > existingStartMinutes) {
        return {
          valid: false,
          reason: `Double-booking: driver already has ${existingShift.startTime} shift on ${serviceDate}`,
        };
      }
    }

    // Also check if new shift overlaps with overnight portion of previous day's shift
    const prevDate = new Date(serviceDate);
    prevDate.setDate(prevDate.getDate() - 1);
    const prevDateStr = prevDate.toISOString().split('T')[0];

    if (existingShift.date === prevDateStr && isOvernightShift) {
      // Previous day's overnight shift extends into this day
      // Check if new shift starts before overnight portion ends
      if (newStartMinutes < existingEndMinutes) {
        return {
          valid: false,
          reason: `Double-booking: driver's ${existingShift.startTime} shift from ${prevDateStr} extends into this day`,
        };
      }
    }
  }

  // 4. REST PERIOD (10 hours between shifts)
  const thisDate2 = new Date(serviceDate);
  const prevDate2 = new Date(thisDate2);
  prevDate2.setDate(prevDate2.getDate() - 1);
  const nextDate2 = new Date(thisDate2);
  nextDate2.setDate(nextDate2.getDate() + 1);

  const prevDateStr2 = prevDate2.toISOString().split('T')[0];
  const nextDateStr2 = nextDate2.toISOString().split('T')[0];

  // Check rest from previous day's shifts
  const prevDayShifts = constraints.shiftsThisWeek.filter(s => s.date === prevDateStr2);
  for (const prevShift of prevDayShifts) {
    const prevStartMinutes = timeToMinutes(prevShift.startTime);
    let prevEndMinutes = timeToMinutes(prevShift.endTime);

    // Handle overnight shift (end < start means next day)
    const isOvernightShift = prevEndMinutes < prevStartMinutes;

    if (isOvernightShift) {
      // Shift ends on THIS day (the service date) at prevEndMinutes
      // Rest = newStartMinutes - prevEndMinutes (same day)
      const restMinutes = newStartMinutes - prevEndMinutes;
      const restHours = restMinutes / 60;

      if (restHours < minRestHours) {
        return {
          valid: false,
          reason: `Rest violation: only ${restHours.toFixed(1)}hr rest after ${prevDateStr2} shift (ended ${prevShift.endTime} today, need ${minRestHours}hr)`,
        };
      }
    } else {
      // Normal shift ends same day
      // Rest = (1440 - prevEndMinutes) + newStartMinutes
      const restMinutes = (1440 - prevEndMinutes) + newStartMinutes;
      const restHours = restMinutes / 60;

      if (restHours < minRestHours) {
        return {
          valid: false,
          reason: `Rest violation: only ${restHours.toFixed(1)}hr rest after ${prevDateStr2} ${prevShift.endTime} shift (need ${minRestHours}hr)`,
        };
      }
    }
  }

  // Check rest before next day's shifts
  const nextDayShifts = constraints.shiftsThisWeek.filter(s => s.date === nextDateStr2);
  for (const nextShift of nextDayShifts) {
    const nextStartMinutes = timeToMinutes(nextShift.startTime);

    // New shift ends at newEndMinutes (might be overnight)
    const newEndMinutes2 = newStartMinutes + 480;
    const newShiftIsOvernight = newEndMinutes2 > 1440;

    if (newShiftIsOvernight) {
      // New shift ends on next day at (newEndMinutes2 - 1440)
      const actualEndMinutes = newEndMinutes2 - 1440;
      const restMinutes = nextStartMinutes - actualEndMinutes;
      const restHours = restMinutes / 60;

      if (restHours < minRestHours) {
        return {
          valid: false,
          reason: `Rest violation: only ${restHours.toFixed(1)}hr rest before ${nextDateStr2} ${nextShift.startTime} shift (need ${minRestHours}hr)`,
        };
      }
    } else {
      // New shift ends same day
      const restMinutes = (1440 - newEndMinutes2) + nextStartMinutes;
      const restHours = restMinutes / 60;

      if (restHours < minRestHours) {
        return {
          valid: false,
          reason: `Rest violation: only ${restHours.toFixed(1)}hr rest before ${nextDateStr2} ${nextShift.startTime} shift (need ${minRestHours}hr)`,
        };
      }
    }
  }

  return { valid: true, reason: "" };
}

function filterInvalidOptions(
  candidates: BlockCandidate[],
  driverConstraints: Map<string, DriverConstraints>,
  serviceDates: Record<string, string>,
  maxDaysPerWeek: number = 6,
  minRestHours: number = 10
): { filtered: BlockCandidate[]; violations: Array<{ blockId: string; driverId: string; reason: string }> } {
  const filtered: BlockCandidate[] = [];
  const violations: Array<{ blockId: string; driverId: string; reason: string }> = [];

  for (const block of candidates) {
    const slotKey = makeSlotKey(block.slot);
    const serviceDate = serviceDates[slotKey] || serviceDates[block.blockId];

    const validCandidates: DriverScore[] = [];

    for (const candidate of block.candidates) {
      const result = checkConstraints(
        candidate.driverId,
        block.slot,
        serviceDate,
        driverConstraints,
        maxDaysPerWeek,
        minRestHours
      );

      if (result.valid) {
        validCandidates.push(candidate);
      } else {
        violations.push({
          blockId: block.blockId,
          driverId: candidate.driverId,
          reason: result.reason,
        });
      }
    }

    filtered.push({
      ...block,
      candidates: validCandidates,
    });
  }

  return { filtered, violations };
}

// =============================================================================
// TEST SCENARIOS
// =============================================================================

async function main() {
  console.log("=".repeat(70));
  console.log("CONSTRAINT FILTER TEST - Step 3 of Pipeline");
  console.log("=".repeat(70));

  // Setup test data
  const drivers = [
    { id: "driver-josh", name: "Josh Green", contractType: "solo1" },
    { id: "driver-mike", name: "Mike Burton", contractType: "solo1" },
    { id: "driver-ray", name: "Ray Beeks", contractType: "solo2" },  // Different contract!
    { id: "driver-brett", name: "Brett Baker", contractType: "solo1" },
  ];

  // Week: Dec 14-20, 2024 (Sat-Fri)
  const weekDates = [
    "2024-12-14", // Saturday
    "2024-12-15", // Sunday
    "2024-12-16", // Monday
    "2024-12-17", // Tuesday
    "2024-12-18", // Wednesday
    "2024-12-19", // Thursday
    "2024-12-20", // Friday
  ];

  // ==========================================================================
  // SCENARIO 1: 6-DAY LIMIT
  // ==========================================================================
  console.log("\n" + "─".repeat(70));
  console.log("SCENARIO 1: 6-Day Limit");
  console.log("─".repeat(70));

  // Josh already worked 6 days this week
  const joshConstraints: DriverConstraints = {
    driverId: "driver-josh",
    contractType: "solo1",
    daysThisWeek: new Set([
      "2024-12-14", // Sat
      "2024-12-15", // Sun
      "2024-12-16", // Mon
      "2024-12-17", // Tue
      "2024-12-18", // Wed
      "2024-12-19", // Thu - 6 days!
    ]),
    shiftsThisWeek: [
      { date: "2024-12-14", startTime: "16:30", endTime: "00:30" },
      { date: "2024-12-15", startTime: "16:30", endTime: "00:30" },
      { date: "2024-12-16", startTime: "16:30", endTime: "00:30" },
      { date: "2024-12-17", startTime: "16:30", endTime: "00:30" },
      { date: "2024-12-18", startTime: "16:30", endTime: "00:30" },
      { date: "2024-12-19", startTime: "16:30", endTime: "00:30" },
    ],
  };

  // Mike only worked 3 days
  const mikeConstraints: DriverConstraints = {
    driverId: "driver-mike",
    contractType: "solo1",
    daysThisWeek: new Set(["2024-12-14", "2024-12-15", "2024-12-16"]),
    shiftsThisWeek: [
      { date: "2024-12-14", startTime: "17:30", endTime: "01:30" },
      { date: "2024-12-15", startTime: "17:30", endTime: "01:30" },
      { date: "2024-12-16", startTime: "17:30", endTime: "01:30" },
    ],
  };

  const constraintsMap1 = new Map<string, DriverConstraints>();
  constraintsMap1.set("driver-josh", joshConstraints);
  constraintsMap1.set("driver-mike", mikeConstraints);

  // Try to assign Friday block to both
  const fridayBlock: BlockCandidate = {
    blockId: "block-fri-1630",
    slot: {
      soloType: "solo1",
      tractorId: "Tractor_1",
      canonicalTime: "16:30",
      dayOfWeek: "friday",
    },
    candidates: [
      { driverId: "driver-josh", driverName: "Josh Green", score: 0.85, ownershipScore: 0.85, bumpPenalty: 0, bumpMinutes: 0, method: "ownership", reason: "Owner" },
      { driverId: "driver-mike", driverName: "Mike Burton", score: 0.65, ownershipScore: 0.65, bumpPenalty: 0, bumpMinutes: 0, method: "ownership", reason: "Backup" },
    ],
  };

  const serviceDates1 = { "block-fri-1630": "2024-12-20" };

  console.log("\n📋 SETUP:");
  console.log(`   Josh Green: ${joshConstraints.daysThisWeek.size} days worked (Sat-Thu)`);
  console.log(`   Mike Burton: ${mikeConstraints.daysThisWeek.size} days worked (Sat-Mon)`);
  console.log(`   Block: Friday 2024-12-20, 16:30 solo1`);

  console.log("\n📊 CANDIDATES BEFORE FILTER:");
  for (const c of fridayBlock.candidates) {
    console.log(`   ${c.driverName.padEnd(15)} score=${(c.score * 100).toFixed(0)}%`);
  }

  const result1 = filterInvalidOptions([fridayBlock], constraintsMap1, serviceDates1, 6, 10);

  console.log("\n❌ VIOLATIONS:");
  for (const v of result1.violations) {
    console.log(`   ${v.driverId.padEnd(15)} → ${v.reason}`);
  }

  console.log("\n✅ CANDIDATES AFTER FILTER:");
  for (const c of result1.filtered[0].candidates) {
    console.log(`   ${c.driverName.padEnd(15)} score=${(c.score * 100).toFixed(0)}%`);
  }

  // ==========================================================================
  // SCENARIO 2: DOUBLE-BOOKING
  // ==========================================================================
  console.log("\n" + "─".repeat(70));
  console.log("SCENARIO 2: Double-Booking");
  console.log("─".repeat(70));

  // Mike already has a 17:30 shift on Saturday
  const mikeConstraints2: DriverConstraints = {
    driverId: "driver-mike",
    contractType: "solo1",
    daysThisWeek: new Set(["2024-12-14"]),
    shiftsThisWeek: [
      { date: "2024-12-14", startTime: "17:30", endTime: "01:30" }, // 17:30-01:30 shift
    ],
  };

  // Brett has no conflicts
  const brettConstraints: DriverConstraints = {
    driverId: "driver-brett",
    contractType: "solo1",
    daysThisWeek: new Set(["2024-12-15"]),
    shiftsThisWeek: [
      { date: "2024-12-15", startTime: "16:30", endTime: "00:30" },
    ],
  };

  const constraintsMap2 = new Map<string, DriverConstraints>();
  constraintsMap2.set("driver-mike", mikeConstraints2);
  constraintsMap2.set("driver-brett", brettConstraints);

  // Try to assign another Saturday 16:30 block (overlaps with Mike's 17:30)
  const saturdayBlock: BlockCandidate = {
    blockId: "block-sat-1630",
    slot: {
      soloType: "solo1",
      tractorId: "Tractor_9",
      canonicalTime: "16:30",
      dayOfWeek: "saturday",
    },
    candidates: [
      { driverId: "driver-mike", driverName: "Mike Burton", score: 0.75, ownershipScore: 0.75, bumpPenalty: 0, bumpMinutes: 0, method: "ownership", reason: "Owner" },
      { driverId: "driver-brett", driverName: "Brett Baker", score: 0.60, ownershipScore: 0.60, bumpPenalty: 0, bumpMinutes: 0, method: "ownership", reason: "Backup" },
    ],
  };

  const serviceDates2 = { "block-sat-1630": "2024-12-14" };

  console.log("\n📋 SETUP:");
  console.log(`   Mike Burton: has 17:30-01:30 shift on 2024-12-14`);
  console.log(`   Brett Baker: no Saturday shifts`);
  console.log(`   Block: Saturday 2024-12-14, 16:30 solo1 (would run 16:30-00:30)`);

  console.log("\n📊 CANDIDATES BEFORE FILTER:");
  for (const c of saturdayBlock.candidates) {
    console.log(`   ${c.driverName.padEnd(15)} score=${(c.score * 100).toFixed(0)}%`);
  }

  const result2 = filterInvalidOptions([saturdayBlock], constraintsMap2, serviceDates2, 6, 10);

  console.log("\n❌ VIOLATIONS:");
  for (const v of result2.violations) {
    console.log(`   ${v.driverId.padEnd(15)} → ${v.reason}`);
  }

  console.log("\n✅ CANDIDATES AFTER FILTER:");
  for (const c of result2.filtered[0].candidates) {
    console.log(`   ${c.driverName.padEnd(15)} score=${(c.score * 100).toFixed(0)}%`);
  }

  // ==========================================================================
  // SCENARIO 3: CONTRACT TYPE MISMATCH
  // ==========================================================================
  console.log("\n" + "─".repeat(70));
  console.log("SCENARIO 3: Contract Type Mismatch");
  console.log("─".repeat(70));

  // Ray is solo2 driver
  const rayConstraints: DriverConstraints = {
    driverId: "driver-ray",
    contractType: "solo2",  // solo2 driver!
    daysThisWeek: new Set(["2024-12-14"]),
    shiftsThisWeek: [
      { date: "2024-12-14", startTime: "08:30", endTime: "16:30" },
    ],
  };

  // Fresh Mike for this scenario - no shifts
  const mikeConstraints3: DriverConstraints = {
    driverId: "driver-mike",
    contractType: "solo1",
    daysThisWeek: new Set([]),
    shiftsThisWeek: [],
  };

  const constraintsMap3 = new Map<string, DriverConstraints>();
  constraintsMap3.set("driver-ray", rayConstraints);
  constraintsMap3.set("driver-mike", mikeConstraints3);

  // solo1 block - Ray shouldn't be eligible
  const solo1Block: BlockCandidate = {
    blockId: "block-sun-1630",
    slot: {
      soloType: "solo1",  // solo1 block!
      tractorId: "Tractor_1",
      canonicalTime: "16:30",
      dayOfWeek: "sunday",
    },
    candidates: [
      { driverId: "driver-ray", driverName: "Ray Beeks", score: 0.80, ownershipScore: 0.80, bumpPenalty: 0, bumpMinutes: 0, method: "ownership", reason: "High score" },
      { driverId: "driver-mike", driverName: "Mike Burton", score: 0.70, ownershipScore: 0.70, bumpPenalty: 0, bumpMinutes: 0, method: "ownership", reason: "Backup" },
    ],
  };

  const serviceDates3 = { "block-sun-1630": "2024-12-15" };

  console.log("\n📋 SETUP:");
  console.log(`   Ray Beeks: contract type = solo2`);
  console.log(`   Mike Burton: contract type = solo1`);
  console.log(`   Block: solo1 Tractor_1 Sunday 16:30`);

  console.log("\n📊 CANDIDATES BEFORE FILTER:");
  for (const c of solo1Block.candidates) {
    console.log(`   ${c.driverName.padEnd(15)} score=${(c.score * 100).toFixed(0)}%`);
  }

  const result3 = filterInvalidOptions([solo1Block], constraintsMap3, serviceDates3, 6, 10);

  console.log("\n❌ VIOLATIONS:");
  for (const v of result3.violations) {
    console.log(`   ${v.driverId.padEnd(15)} → ${v.reason}`);
  }

  console.log("\n✅ CANDIDATES AFTER FILTER:");
  for (const c of result3.filtered[0].candidates) {
    console.log(`   ${c.driverName.padEnd(15)} score=${(c.score * 100).toFixed(0)}%`);
  }

  // ==========================================================================
  // SCENARIO 4: REST PERIOD VIOLATION
  // ==========================================================================
  console.log("\n" + "─".repeat(70));
  console.log("SCENARIO 4: Rest Period Violation (10hr minimum)");
  console.log("─".repeat(70));

  // Brett worked late shift ending at 04:30 on Saturday
  const brettConstraints2: DriverConstraints = {
    driverId: "driver-brett",
    contractType: "solo1",
    daysThisWeek: new Set(["2024-12-14"]),
    shiftsThisWeek: [
      { date: "2024-12-14", startTime: "20:30", endTime: "04:30" }, // Ends 04:30 Sunday morning
    ],
  };

  // Fresh Mike for this scenario - no conflicts
  const mikeConstraints4: DriverConstraints = {
    driverId: "driver-mike",
    contractType: "solo1",
    daysThisWeek: new Set([]),
    shiftsThisWeek: [],
  };

  const constraintsMap4 = new Map<string, DriverConstraints>();
  constraintsMap4.set("driver-brett", brettConstraints2);
  constraintsMap4.set("driver-mike", mikeConstraints4);

  // Sunday 08:30 block - only 4 hours after Brett's previous shift ended
  const sundayEarlyBlock: BlockCandidate = {
    blockId: "block-sun-0830",
    slot: {
      soloType: "solo1",
      tractorId: "Tractor_4",
      canonicalTime: "08:30",
      dayOfWeek: "sunday",
    },
    candidates: [
      { driverId: "driver-brett", driverName: "Brett Baker", score: 0.85, ownershipScore: 0.85, bumpPenalty: 0, bumpMinutes: 0, method: "ownership", reason: "Owner" },
      { driverId: "driver-mike", driverName: "Mike Burton", score: 0.55, ownershipScore: 0.55, bumpPenalty: 0, bumpMinutes: 0, method: "ownership", reason: "Backup" },
    ],
  };

  const serviceDates4 = { "block-sun-0830": "2024-12-15" };

  console.log("\n📋 SETUP:");
  console.log(`   Brett Baker: worked 20:30-04:30 on 2024-12-14 (ended 04:30 Sunday)`);
  console.log(`   Mike Burton: no recent late shifts`);
  console.log(`   Block: Sunday 2024-12-15, 08:30 solo1`);
  console.log(`   Rest between Brett's shift end (04:30) and new shift (08:30) = 4 hours`);

  console.log("\n📊 CANDIDATES BEFORE FILTER:");
  for (const c of sundayEarlyBlock.candidates) {
    console.log(`   ${c.driverName.padEnd(15)} score=${(c.score * 100).toFixed(0)}%`);
  }

  const result4 = filterInvalidOptions([sundayEarlyBlock], constraintsMap4, serviceDates4, 6, 10);

  console.log("\n❌ VIOLATIONS:");
  for (const v of result4.violations) {
    console.log(`   ${v.driverId.padEnd(15)} → ${v.reason}`);
  }

  console.log("\n✅ CANDIDATES AFTER FILTER:");
  for (const c of result4.filtered[0].candidates) {
    console.log(`   ${c.driverName.padEnd(15)} score=${(c.score * 100).toFixed(0)}%`);
  }

  // ==========================================================================
  // SUMMARY
  // ==========================================================================
  console.log("\n" + "=".repeat(70));
  console.log("SUMMARY");
  console.log("=".repeat(70));
  console.log(`
CONSTRAINT CHECKS IMPLEMENTED:

1. ✅ MAX 6 DAYS PER WEEK
   - Counts unique service dates for driver this week
   - Blocks 7th day assignment
   - Example: Josh had 6 days → blocked from Friday

2. ✅ NO DOUBLE-BOOKING
   - Checks for time overlap on same day
   - Uses 8-hour shift duration estimate
   - Example: Mike had 17:30 shift → blocked from 16:30 on same day

3. ✅ CONTRACT TYPE MATCH
   - solo1 drivers → solo1 blocks only
   - solo2 drivers → solo2 blocks only
   - Example: Ray (solo2) → blocked from solo1 block

4. ✅ 10-HOUR REST PERIOD
   - Checks time between adjacent shifts
   - Accounts for overnight shifts (shift end next day)
   - Example: Brett ended 04:30 → blocked from 08:30 (only 4hr rest)
`);

  process.exit(0);
}

main().catch(console.error);
