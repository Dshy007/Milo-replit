/**
 * Regenerate DNA Profiles from Block Assignments
 *
 * This script analyzes ACTUAL block_assignments data for all drivers
 * and regenerates their DNA profiles based on real historical patterns.
 *
 * Usage: npx tsx server/scripts/regenerate-all-dna.ts
 */

import { db } from '../db';
import { sql } from 'drizzle-orm';
import { driverDnaProfiles } from '../../shared/schema';
import { eq, and } from 'drizzle-orm';

// Canonical start times lookup table - LOCAL times (not UTC)
const CANONICAL_START_TIMES: Record<string, string> = {
  "solo1_Tractor_1": "16:30",
  "solo1_Tractor_2": "20:30",
  "solo1_Tractor_3": "20:30",
  "solo1_Tractor_4": "17:30",
  "solo1_Tractor_5": "21:30",
  "solo1_Tractor_6": "01:30",
  "solo1_Tractor_7": "18:30",
  "solo1_Tractor_8": "00:30",
  "solo1_Tractor_9": "16:30",
  "solo1_Tractor_10": "20:30",
  "solo2_Tractor_1": "18:30",
  "solo2_Tractor_2": "23:30",
  "solo2_Tractor_3": "21:30",
  "solo2_Tractor_4": "08:30",
  "solo2_Tractor_5": "15:30",
  "solo2_Tractor_6": "11:30",
  "solo2_Tractor_7": "16:30",
};

interface DriverAssignmentSummary {
  driverId: string;
  firstName: string;
  lastName: string;
  tenantId: string;
  assignments: {
    serviceDate: Date;
    dayOfWeek: number; // 0=Sun, 6=Sat
    dayName: string;
    startTime: string;
    soloType: string;
    tractorId: string;
  }[];
}

interface ComputedDNA {
  preferredDays: string[];
  preferredStartTimes: string[];
  preferredTractors: string[];
  preferredContractType: string;
  patternGroup: 'sunWed' | 'wedSat' | 'mixed';
  consistencyScore: number;
  assignmentsAnalyzed: number;
  weeksAnalyzed: number;
}

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * Convert HH:MM to minutes since midnight
 */
function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + (m || 0);
}

/**
 * Find the NEAREST canonical start time for a raw timestamp
 * This handles cases where tractorId is missing but we can infer from time proximity
 */
function findNearestCanonicalTime(rawTime: string, contractType: string): { time: string; tractor: string; diff: number } {
  const rawMinutes = timeToMinutes(rawTime);
  const prefix = contractType.toLowerCase() + '_';

  let bestMatch = { time: rawTime, tractor: 'Unknown', diff: Infinity };

  for (const [key, canonicalTime] of Object.entries(CANONICAL_START_TIMES)) {
    if (!key.startsWith(prefix)) continue;

    const canonicalMinutes = timeToMinutes(canonicalTime);

    // Calculate difference with wraparound (e.g., 23:30 is close to 00:05)
    const diff = Math.abs(rawMinutes - canonicalMinutes);
    const wrapDiff = Math.min(diff, 1440 - diff); // 1440 = minutes in a day

    if (wrapDiff < bestMatch.diff) {
      bestMatch = {
        time: canonicalTime,
        tractor: key.replace(prefix, ''),
        diff: wrapDiff,
      };
    }
  }

  return bestMatch;
}

function getCanonicalStartTime(soloType: string | null, tractorId: string | null): string | null {
  if (!soloType || !tractorId) return null;
  const key = `${soloType.toLowerCase()}_${tractorId}`;
  return CANONICAL_START_TIMES[key] || null;
}

function getTopN<T>(map: Map<T, number>, n: number): T[] {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([item]) => item);
}

function computeDNAFromAssignments(assignments: DriverAssignmentSummary['assignments']): ComputedDNA {
  if (assignments.length === 0) {
    return {
      preferredDays: [],
      preferredStartTimes: [],
      preferredTractors: [],
      preferredContractType: 'solo1',
      patternGroup: 'mixed',
      consistencyScore: 0,
      assignmentsAnalyzed: 0,
      weeksAnalyzed: 0,
    };
  }

  // === PASS 1: Determine primary contract type ===
  const contractFrequency = new Map<string, number>();
  for (const a of assignments) {
    if (a.soloType) {
      contractFrequency.set(a.soloType, (contractFrequency.get(a.soloType) || 0) + 1);
    }
  }
  const preferredContractType = getTopN(contractFrequency, 1)[0] || 'solo1';

  // === PASS 2: Compute times/tractors ONLY from primary contract type ===
  // This prevents Solo1 times from polluting a Solo2 driver's profile (and vice versa)
  const primaryAssignments = assignments.filter(a =>
    (a.soloType || 'solo1').toLowerCase() === preferredContractType.toLowerCase()
  );

  const dayFrequency = new Map<string, number>();
  const timeFrequency = new Map<string, number>();
  const tractorFrequency = new Map<string, number>();
  const weekSet = new Set<string>();

  // Track per-week day occurrences for consistency scoring
  const weekDayMap = new Map<string, Set<string>>();

  // Use primaryAssignments for time/tractor computation
  for (const a of primaryAssignments) {
    // Get week identifier
    const weekStart = new Date(a.serviceDate);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const weekKey = weekStart.toISOString().split('T')[0];
    weekSet.add(weekKey);

    if (!weekDayMap.has(weekKey)) {
      weekDayMap.set(weekKey, new Set());
    }
    weekDayMap.get(weekKey)!.add(a.dayName);

    // Day frequency
    dayFrequency.set(a.dayName, (dayFrequency.get(a.dayName) || 0) + 1);

    // Time frequency - use canonical time, or find nearest if tractorId is missing
    let timeToUse: string;
    if (a.tractorId) {
      const canonicalTime = getCanonicalStartTime(a.soloType, a.tractorId);
      timeToUse = canonicalTime || a.startTime;
    } else {
      // tractorId is missing - find nearest canonical time based on raw time
      const nearest = findNearestCanonicalTime(a.startTime, a.soloType || 'solo1');
      timeToUse = nearest.diff <= 90 ? nearest.time : a.startTime; // Use nearest if within 90 min
    }
    timeFrequency.set(timeToUse, (timeFrequency.get(timeToUse) || 0) + 1);

    // Tractor frequency
    if (a.tractorId) {
      tractorFrequency.set(a.tractorId, (tractorFrequency.get(a.tractorId) || 0) + 1);
    }
  }

  const totalWeeks = weekSet.size;

  // Calculate per-week day consistency
  // A day is "preferred" if the driver works it in 50%+ of their active weeks
  const dayWeekCount = new Map<string, number>();
  for (const daysInWeek of weekDayMap.values()) {
    for (const day of daysInWeek) {
      dayWeekCount.set(day, (dayWeekCount.get(day) || 0) + 1);
    }
  }

  // Get days worked in 50%+ of weeks
  const preferredDays = Array.from(dayWeekCount.entries())
    .filter(([_, weekCount]) => weekCount >= totalWeeks * 0.5)
    .sort((a, b) => {
      const consistencyDiff = b[1] - a[1];
      if (consistencyDiff !== 0) return consistencyDiff;
      return DAY_NAMES.indexOf(a[0]) - DAY_NAMES.indexOf(b[0]);
    })
    .map(([day]) => day);

  // If no days meet 50% threshold, use top 4 by frequency
  const finalPreferredDays = preferredDays.length > 0
    ? preferredDays
    : getTopN(dayFrequency, 4);

  // Get top times (limit to 2 for cleaner profiles)
  // NOTE: Do NOT sort alphabetically - keep frequency order so most common times appear first
  // This is critical because UI often shows only first 2 times
  const preferredStartTimes = getTopN(timeFrequency, 2);

  // Get top tractors
  const preferredTractors = getTopN(tractorFrequency, 3);

  // NOTE: preferredContractType was already determined in PASS 1 above

  // Determine pattern group
  const sunWedDays = ['sunday', 'monday', 'tuesday', 'wednesday'];
  const wedSatDays = ['wednesday', 'thursday', 'friday', 'saturday'];

  let sunWedCount = 0;
  let wedSatCount = 0;
  let totalCount = 0;

  for (const [day, count] of dayFrequency) {
    totalCount += count;
    if (sunWedDays.includes(day)) sunWedCount += count;
    if (wedSatDays.includes(day)) wedSatCount += count;
  }

  // Subtract Wednesday overlap
  const wedCount = dayFrequency.get('wednesday') || 0;
  sunWedCount -= wedCount / 2;
  wedSatCount -= wedCount / 2;

  let patternGroup: 'sunWed' | 'wedSat' | 'mixed' = 'mixed';
  if (totalCount > 0) {
    const sunWedRatio = sunWedCount / totalCount;
    const wedSatRatio = wedSatCount / totalCount;
    if (sunWedRatio >= 0.7) patternGroup = 'sunWed';
    else if (wedSatRatio >= 0.7) patternGroup = 'wedSat';
  }

  // Calculate consistency score
  let consistencyScore = 0;
  if (finalPreferredDays.length > 0 && totalWeeks > 0) {
    let perfectWeeks = 0;
    for (const daysWorked of weekDayMap.values()) {
      const workedAllPreferred = finalPreferredDays.every(day => daysWorked.has(day));
      if (workedAllPreferred) perfectWeeks++;
    }
    consistencyScore = Math.round((perfectWeeks / totalWeeks) * 100) / 100;
  }

  return {
    preferredDays: finalPreferredDays,
    preferredStartTimes,
    preferredTractors,
    preferredContractType,
    patternGroup,
    consistencyScore,
    assignmentsAnalyzed: assignments.length,
    weeksAnalyzed: totalWeeks,
  };
}

async function regenerateAllDNA() {
  console.log('=== REGENERATING DNA PROFILES FROM BLOCK_ASSIGNMENTS ===\n');

  // Get all drivers with their block assignments
  const driversResult = await db.execute(sql`
    SELECT DISTINCT
      d.id as driver_id,
      d.first_name,
      d.last_name,
      d.tenant_id
    FROM drivers d
    INNER JOIN block_assignments ba ON ba.driver_id = d.id
    WHERE ba.is_active = true
    ORDER BY d.first_name, d.last_name
  `);

  console.log(`Found ${driversResult.rows.length} drivers with active assignments\n`);

  const results: { name: string; before: string; after: string; changed: boolean }[] = [];

  for (const driverRow of driversResult.rows) {
    const driver = driverRow as any;
    const driverName = `${driver.first_name} ${driver.last_name}`;

    // Get this driver's assignments
    const assignmentsResult = await db.execute(sql`
      SELECT
        b.service_date,
        b.start_timestamp,
        b.solo_type,
        b.tractor_id
      FROM block_assignments ba
      JOIN blocks b ON ba.block_id = b.id
      WHERE ba.driver_id = ${driver.driver_id}
      AND ba.is_active = true
      ORDER BY b.service_date DESC
      LIMIT 100
    `);

    const assignments = (assignmentsResult.rows as any[]).map(row => {
      const serviceDate = row.service_date instanceof Date ? row.service_date : new Date(row.service_date);
      const dayOfWeek = serviceDate.getDay();

      // Extract time from start_timestamp
      let startTime = '00:00';
      if (row.start_timestamp) {
        const ts = row.start_timestamp instanceof Date ? row.start_timestamp : new Date(row.start_timestamp);
        startTime = ts.toISOString().split('T')[1].slice(0, 5);
      }

      return {
        serviceDate,
        dayOfWeek,
        dayName: DAY_NAMES[dayOfWeek],
        startTime,
        soloType: row.solo_type || 'solo1',
        tractorId: row.tractor_id || '',
      };
    });

    if (assignments.length < 3) {
      console.log(`${driverName}: Only ${assignments.length} assignments, skipping`);
      continue;
    }

    // Compute new DNA profile
    const newDNA = computeDNAFromAssignments(assignments);

    // Get existing DNA profile
    const existingResult = await db.execute(sql`
      SELECT preferred_days, preferred_start_times, preferred_contract_type
      FROM driver_dna_profiles
      WHERE driver_id = ${driver.driver_id}
    `);

    const existing = existingResult.rows[0] as any;
    const beforeDays = existing?.preferred_days?.join(',') || 'none';
    const beforeTimes = existing?.preferred_start_times?.join(',') || 'none';
    const beforeContract = existing?.preferred_contract_type || 'none';

    const afterDays = newDNA.preferredDays.join(',');
    const afterTimes = newDNA.preferredStartTimes.join(',');
    const afterContract = newDNA.preferredContractType;

    const changed = beforeDays !== afterDays || beforeTimes !== afterTimes || beforeContract !== afterContract;

    results.push({
      name: driverName,
      before: `${beforeContract} | ${beforeDays} @ ${beforeTimes}`,
      after: `${afterContract} | ${afterDays} @ ${afterTimes}`,
      changed,
    });

    // Convert arrays to PostgreSQL array literal format
    const daysArrayLiteral = `{${newDNA.preferredDays.join(',')}}`;
    const timesArrayLiteral = `{${newDNA.preferredStartTimes.join(',')}}`;
    const tractorsArrayLiteral = `{${newDNA.preferredTractors.join(',')}}`;

    // Update the DNA profile
    if (existing) {
      await db.execute(sql`
        UPDATE driver_dna_profiles SET
          preferred_days = ${daysArrayLiteral}::text[],
          preferred_start_times = ${timesArrayLiteral}::text[],
          preferred_tractors = ${tractorsArrayLiteral}::text[],
          preferred_contract_type = ${newDNA.preferredContractType},
          pattern_group = ${newDNA.patternGroup},
          consistency_score = ${newDNA.consistencyScore.toFixed(4)},
          assignments_analyzed = ${newDNA.assignmentsAnalyzed},
          weeks_analyzed = ${newDNA.weeksAnalyzed},
          last_analyzed_at = NOW(),
          updated_at = NOW()
        WHERE driver_id = ${driver.driver_id}
      `);
    } else {
      // Insert new profile
      await db.execute(sql`
        INSERT INTO driver_dna_profiles (
          tenant_id, driver_id, preferred_days, preferred_start_times,
          preferred_tractors, preferred_contract_type, pattern_group,
          consistency_score, assignments_analyzed, weeks_analyzed,
          last_analyzed_at, analysis_version
        ) VALUES (
          ${driver.tenant_id}, ${driver.driver_id}, ${daysArrayLiteral}::text[],
          ${timesArrayLiteral}::text[], ${tractorsArrayLiteral}::text[],
          ${newDNA.preferredContractType}, ${newDNA.patternGroup},
          ${newDNA.consistencyScore.toFixed(4)}, ${newDNA.assignmentsAnalyzed},
          ${newDNA.weeksAnalyzed}, NOW(), 1
        )
      `);
    }

    console.log(`${driverName}: ${changed ? 'UPDATED' : 'unchanged'}`);
    if (changed) {
      console.log(`  Before: ${beforeContract} | ${beforeDays} @ ${beforeTimes}`);
      console.log(`  After:  ${afterContract} | ${afterDays} @ ${afterTimes}`);
    }
  }

  console.log('\n=== SUMMARY ===');
  const changedCount = results.filter(r => r.changed).length;
  console.log(`Total drivers processed: ${results.length}`);
  console.log(`Profiles updated: ${changedCount}`);
  console.log(`Profiles unchanged: ${results.length - changedCount}`);

  process.exit(0);
}

regenerateAllDNA().catch(console.error);
