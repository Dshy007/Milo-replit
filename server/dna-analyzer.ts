/**
 * DNA Analyzer Service
 *
 * Orchestrates the analysis of driver assignment history to build DNA profiles.
 * Connects to the database, fetches historical data, and uses GeminiProfiler
 * to generate AI-powered preference profiles.
 */

import { db } from "./db";
import { and, eq, gte, lte, desc, sql } from "drizzle-orm";
import { subWeeks, startOfWeek, format, getDay } from "date-fns";
import {
  drivers,
  blockAssignments,
  blocks,
  shiftOccurrences,
  shiftTemplates,
  driverDnaProfiles,
  type DriverDnaProfile,
  type InsertDriverDnaProfile,
} from "@shared/schema";
import {
  getGeminiProfiler,
  type DNAProfile,
  type DNAAnalysisInput,
  type HistoricalAssignment,
} from "./ai/agents/gemini-profiler";

// ═══════════════════════════════════════════════════════════════════════════════
//                              CANONICAL START TIMES
// ═══════════════════════════════════════════════════════════════════════════════

// Canonical start times lookup table - source of truth for contract start times
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

/**
 * Get canonical start time from soloType and tractorId
 * If tractorId is missing, finds the NEAREST canonical time based on raw timestamp
 */
function getCanonicalStartTime(soloType: string | null, tractorId: string | null, fallbackTimestamp: Date): string {
  // Direct lookup if we have both soloType and tractorId
  if (soloType && tractorId) {
    const key = `${soloType.toLowerCase()}_${tractorId}`;
    const canonicalTime = CANONICAL_START_TIMES[key];
    if (canonicalTime) {
      return canonicalTime;
    }
  }

  // If no tractorId, find nearest canonical time based on raw timestamp
  if (soloType) {
    const rawTime = format(new Date(fallbackTimestamp), 'HH:mm');
    const nearest = findNearestCanonicalTime(rawTime, soloType);
    // Only use if within 2 hours (120 minutes)
    if (nearest.diff <= 120) {
      return nearest.time;
    }
  }

  // Final fallback to formatted timestamp
  return format(new Date(fallbackTimestamp), 'HH:mm');
}

// ═══════════════════════════════════════════════════════════════════════════════
//                              TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface AnalysisOptions {
  tenantId: string;
  driverId?: string; // Optional: analyze specific driver, or all if omitted
  startDate?: Date; // Default: 12 weeks ago
  endDate?: Date; // Default: now
  dayThreshold?: number; // 0.0 to 1.0, default 0.5 (50%) - lower = more days detected
}

export interface AnalysisResult {
  totalDrivers: number;
  profilesCreated: number;
  profilesUpdated: number;
  errors: number;
  analysisStartDate: Date;
  analysisEndDate: Date;
  profiles: DNAProfile[];
}

export interface FleetDNAStats {
  totalProfiles: number;
  sunWedCount: number;
  wedSatCount: number;
  mixedCount: number;
  avgConsistency: number;
  totalAssignmentsAnalyzed: number;
  lastAnalyzedAt: Date | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
//                              MAIN FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Analyze driver assignment history and generate DNA profiles
 */
export async function analyzeDriverDNA(options: AnalysisOptions): Promise<AnalysisResult> {
  const { tenantId, driverId, dayThreshold } = options;
  const now = new Date();
  const startDate = options.startDate || subWeeks(startOfWeek(now, { weekStartsOn: 0 }), 12);
  const endDate = options.endDate || now;

  console.log(`[DNA Analyzer] Starting analysis for tenant ${tenantId}`);
  console.log(`[DNA Analyzer] Date range: ${format(startDate, 'yyyy-MM-dd')} to ${format(endDate, 'yyyy-MM-dd')}`);

  // Get the Gemini profiler
  const profiler = await getGeminiProfiler();

  // Fetch all drivers (or specific driver)
  const driverQuery = db
    .select()
    .from(drivers)
    .where(
      driverId
        ? and(eq(drivers.tenantId, tenantId), eq(drivers.id, driverId))
        : eq(drivers.tenantId, tenantId)
    );

  const allDrivers = await driverQuery;
  console.log(`[DNA Analyzer] Found ${allDrivers.length} drivers to analyze`);

  // Fetch historical assignments for all drivers
  const assignmentData = await fetchHistoricalAssignments(tenantId, startDate, endDate, driverId);
  console.log(`[DNA Analyzer] Found ${assignmentData.size} drivers with assignment data`);

  // Build analysis inputs
  const analysisInputs: DNAAnalysisInput[] = [];

  for (const driver of allDrivers) {
    const driverAssignments = assignmentData.get(driver.id) || [];
    analysisInputs.push({
      driverId: driver.id,
      driverName: `${driver.firstName} ${driver.lastName}`,
      assignments: driverAssignments,
      analysisStartDate: startDate,
      analysisEndDate: endDate,
      dayThreshold, // Pass threshold to profiler (undefined = use default 0.5)
    });
  }

  // Run the analysis
  const profiles = await profiler.analyzeMultipleDrivers(analysisInputs, (completed, total) => {
    console.log(`[DNA Analyzer] Progress: ${completed}/${total} drivers analyzed`);
  });

  // Save profiles to database
  let profilesCreated = 0;
  let profilesUpdated = 0;
  let errors = 0;

  for (const profile of profiles) {
    try {
      await saveDriverDNAProfile(tenantId, profile, startDate, endDate);

      // Check if it was an update or create
      const existing = await db
        .select()
        .from(driverDnaProfiles)
        .where(
          and(
            eq(driverDnaProfiles.tenantId, tenantId),
            eq(driverDnaProfiles.driverId, profile.driverId)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        profilesUpdated++;
      } else {
        profilesCreated++;
      }
    } catch (error) {
      console.error(`[DNA Analyzer] Failed to save profile for ${profile.driverId}:`, error);
      errors++;
    }
  }

  console.log(`[DNA Analyzer] Complete: ${profilesCreated} created, ${profilesUpdated} updated, ${errors} errors`);

  return {
    totalDrivers: allDrivers.length,
    profilesCreated,
    profilesUpdated,
    errors,
    analysisStartDate: startDate,
    analysisEndDate: endDate,
    profiles,
  };
}

/**
 * Fetch historical assignments from both blockAssignments and shiftOccurrences
 */
async function fetchHistoricalAssignments(
  tenantId: string,
  startDate: Date,
  endDate: Date,
  driverId?: string
): Promise<Map<string, HistoricalAssignment[]>> {
  const assignmentMap = new Map<string, HistoricalAssignment[]>();

  // Query blockAssignments (legacy system) - include canonicalStart for accurate time display
  const blockAssignmentData = await db
    .select({
      driverId: blockAssignments.driverId,
      blockId: blocks.blockId,
      serviceDate: blocks.serviceDate,
      startTimestamp: blocks.startTimestamp,
      canonicalStart: blocks.canonicalStart,
      tractorId: blocks.tractorId,
      soloType: blocks.soloType,
    })
    .from(blockAssignments)
    .innerJoin(blocks, eq(blockAssignments.blockId, blocks.id))
    .innerJoin(drivers, eq(blockAssignments.driverId, drivers.id))
    .where(
      and(
        eq(blockAssignments.tenantId, tenantId),
        eq(blockAssignments.isActive, true),
        gte(blocks.startTimestamp, startDate),
        lte(blocks.startTimestamp, endDate),
        driverId ? eq(blockAssignments.driverId, driverId) : sql`true`
      )
    )
    .orderBy(desc(blocks.startTimestamp));

  // Process block assignments
  for (const row of blockAssignmentData) {
    // Use canonical start time lookup based on soloType + tractorId
    // This gives consistent times like "01:30", "00:30", "08:30" instead of raw UTC timestamps
    const startTime = getCanonicalStartTime(row.soloType, row.tractorId, row.startTimestamp);

    const assignment: HistoricalAssignment = {
      driverId: row.driverId,
      driverName: '', // Will be filled later
      blockId: row.blockId,
      serviceDate: new Date(row.serviceDate),
      dayOfWeek: getDay(new Date(row.startTimestamp)),
      startTime,
      tractorId: row.tractorId || undefined,
      contractType: row.soloType,
    };

    if (!assignmentMap.has(row.driverId)) {
      assignmentMap.set(row.driverId, []);
    }
    assignmentMap.get(row.driverId)!.push(assignment);
  }

  // Also query shiftOccurrences if they have driver assignments via blockAssignments.shiftOccurrenceId
  // This handles the new shift-based system - join with templates to get canonicalStartTime
  try {
    const shiftData = await db
      .select({
        driverId: blockAssignments.driverId,
        externalBlockId: shiftOccurrences.externalBlockId,
        serviceDate: shiftOccurrences.serviceDate,
        scheduledStart: shiftOccurrences.scheduledStart,
        tractorId: shiftOccurrences.tractorId,
        templateId: shiftOccurrences.templateId,
        canonicalStartTime: shiftTemplates.canonicalStartTime,
        soloType: shiftTemplates.soloType,
      })
      .from(blockAssignments)
      .innerJoin(shiftOccurrences, eq(blockAssignments.shiftOccurrenceId, shiftOccurrences.id))
      .leftJoin(shiftTemplates, eq(shiftOccurrences.templateId, shiftTemplates.id))
      .where(
        and(
          eq(blockAssignments.tenantId, tenantId),
          eq(blockAssignments.isActive, true),
          gte(shiftOccurrences.scheduledStart, startDate),
          lte(shiftOccurrences.scheduledStart, endDate),
          driverId ? eq(blockAssignments.driverId, driverId) : sql`true`
        )
      )
      .orderBy(desc(shiftOccurrences.scheduledStart));

    for (const row of shiftData) {
      // Use canonical start time from template, then lookup table, then fall back to scheduled start
      const startTime = row.canonicalStartTime ||
        getCanonicalStartTime(row.soloType, row.tractorId, row.scheduledStart);
      const assignment: HistoricalAssignment = {
        driverId: row.driverId,
        driverName: '',
        blockId: row.externalBlockId || `shift-${row.templateId}`,
        serviceDate: new Date(row.serviceDate),
        dayOfWeek: getDay(new Date(row.scheduledStart)),
        startTime,
        tractorId: row.tractorId || undefined,
        contractType: row.soloType || 'solo1',
      };

      if (!assignmentMap.has(row.driverId)) {
        assignmentMap.set(row.driverId, []);
      }
      assignmentMap.get(row.driverId)!.push(assignment);
    }
  } catch (error) {
    console.log("[DNA Analyzer] Note: shiftOccurrences query skipped (may not have data)");
  }

  return assignmentMap;
}

/**
 * Save a DNA profile to the database
 */
async function saveDriverDNAProfile(
  tenantId: string,
  profile: DNAProfile,
  startDate: Date,
  endDate: Date
): Promise<void> {
  const profileData: InsertDriverDnaProfile = {
    tenantId,
    driverId: profile.driverId,
    preferredDays: profile.preferredDays,
    preferredStartTimes: profile.preferredStartTimes,
    preferredTractors: profile.preferredTractors,
    preferredContractType: profile.preferredContractType,
    homeBlocks: profile.homeBlocks,
    consistencyScore: profile.consistencyScore.toFixed(4),
    patternGroup: profile.patternGroup,
    weeksAnalyzed: profile.weeksAnalyzed,
    assignmentsAnalyzed: profile.assignmentsAnalyzed,
    aiSummary: profile.aiSummary,
    insights: profile.insights,
    analysisStartDate: startDate,
    analysisEndDate: endDate,
    lastAnalyzedAt: new Date(),
    analysisVersion: 1,
  };

  // Upsert the profile
  await db
    .insert(driverDnaProfiles)
    .values(profileData)
    .onConflictDoUpdate({
      target: [driverDnaProfiles.tenantId, driverDnaProfiles.driverId],
      set: {
        preferredDays: profileData.preferredDays,
        preferredStartTimes: profileData.preferredStartTimes,
        preferredTractors: profileData.preferredTractors,
        preferredContractType: profileData.preferredContractType,
        homeBlocks: profileData.homeBlocks,
        consistencyScore: profileData.consistencyScore,
        patternGroup: profileData.patternGroup,
        weeksAnalyzed: profileData.weeksAnalyzed,
        assignmentsAnalyzed: profileData.assignmentsAnalyzed,
        aiSummary: profileData.aiSummary,
        insights: profileData.insights,
        analysisStartDate: profileData.analysisStartDate,
        analysisEndDate: profileData.analysisEndDate,
        lastAnalyzedAt: profileData.lastAnalyzedAt,
        analysisVersion: sql`${driverDnaProfiles.analysisVersion} + 1`,
        updatedAt: new Date(),
      },
    });
}

/**
 * Get a single driver's DNA profile
 */
export async function getDriverDNAProfile(
  tenantId: string,
  driverId: string
): Promise<DriverDnaProfile | null> {
  const [profile] = await db
    .select()
    .from(driverDnaProfiles)
    .where(
      and(
        eq(driverDnaProfiles.tenantId, tenantId),
        eq(driverDnaProfiles.driverId, driverId)
      )
    )
    .limit(1);

  return profile || null;
}

/**
 * Get all DNA profiles for a tenant
 */
export async function getAllDNAProfiles(tenantId: string): Promise<(DriverDnaProfile & { driverName: string })[]> {
  const profiles = await db
    .select({
      profile: driverDnaProfiles,
      driverName: sql<string>`${drivers.firstName} || ' ' || ${drivers.lastName}`,
    })
    .from(driverDnaProfiles)
    .innerJoin(drivers, eq(driverDnaProfiles.driverId, drivers.id))
    .where(eq(driverDnaProfiles.tenantId, tenantId))
    .orderBy(desc(driverDnaProfiles.consistencyScore));

  return profiles.map(p => ({
    ...p.profile,
    driverName: p.driverName,
  }));
}

/**
 * Get fleet-wide DNA statistics
 */
export async function getFleetDNAStats(tenantId: string): Promise<FleetDNAStats> {
  const profiles = await db
    .select()
    .from(driverDnaProfiles)
    .where(eq(driverDnaProfiles.tenantId, tenantId));

  if (profiles.length === 0) {
    return {
      totalProfiles: 0,
      sunWedCount: 0,
      wedSatCount: 0,
      mixedCount: 0,
      avgConsistency: 0,
      totalAssignmentsAnalyzed: 0,
      lastAnalyzedAt: null,
    };
  }

  let sunWedCount = 0;
  let wedSatCount = 0;
  let mixedCount = 0;
  let totalConsistency = 0;
  let totalAssignments = 0;
  let lastAnalyzed: Date | null = null;

  for (const profile of profiles) {
    if (profile.patternGroup === 'sunWed') sunWedCount++;
    else if (profile.patternGroup === 'wedSat') wedSatCount++;
    else mixedCount++;

    totalConsistency += parseFloat(profile.consistencyScore as string) || 0;
    totalAssignments += profile.assignmentsAnalyzed || 0;

    if (profile.lastAnalyzedAt && (!lastAnalyzed || profile.lastAnalyzedAt > lastAnalyzed)) {
      lastAnalyzed = profile.lastAnalyzedAt;
    }
  }

  return {
    totalProfiles: profiles.length,
    sunWedCount,
    wedSatCount,
    mixedCount,
    avgConsistency: Math.round((totalConsistency / profiles.length) * 100) / 100,
    totalAssignmentsAnalyzed: totalAssignments,
    lastAnalyzedAt: lastAnalyzed,
  };
}

/**
 * Delete a DNA profile
 */
export async function deleteDNAProfile(tenantId: string, driverId: string): Promise<boolean> {
  const result = await db
    .delete(driverDnaProfiles)
    .where(
      and(
        eq(driverDnaProfiles.tenantId, tenantId),
        eq(driverDnaProfiles.driverId, driverId)
      )
    )
    .returning();

  return result.length > 0;
}

/**
 * Refresh all DNA profiles for a tenant
 */
export async function refreshAllDNAProfiles(tenantId: string): Promise<AnalysisResult> {
  return analyzeDriverDNA({ tenantId });
}

// ═══════════════════════════════════════════════════════════════════════════════
//                    REGENERATE FROM BLOCK_ASSIGNMENTS (IMPROVED)
// ═══════════════════════════════════════════════════════════════════════════════

const DAY_NAMES_LOWER = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

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

function getTopNFromMap<T>(map: Map<T, number>, n: number): T[] {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([item]) => item);
}

function computeDNAFromBlockAssignments(assignments: {
  serviceDate: Date;
  dayOfWeek: number;
  dayName: string;
  startTime: string;
  soloType: string;
  tractorId: string;
}[]): ComputedDNA {
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

  // === PASS 1: Determine primary contract type from ALL assignments ===
  const contractFrequency = new Map<string, number>();
  for (const a of assignments) {
    if (a.soloType) {
      contractFrequency.set(a.soloType, (contractFrequency.get(a.soloType) || 0) + 1);
    }
  }
  const preferredContractType = getTopNFromMap(contractFrequency, 1)[0] || 'solo1';

  // === PASS 2: Compute times/tractors ONLY from primary contract type ===
  // This prevents Solo1 times from polluting a Solo2 driver's profile (and vice versa)
  const primaryAssignments = assignments.filter(a =>
    (a.soloType || 'solo1').toLowerCase() === preferredContractType.toLowerCase()
  );

  const dayFrequency = new Map<string, number>();
  const timeFrequency = new Map<string, number>();
  const tractorFrequency = new Map<string, number>();
  const weekSet = new Set<string>();
  const weekDayMap = new Map<string, Set<string>>();

  // Use primaryAssignments for time/tractor computation
  for (const a of primaryAssignments) {
    const weekStart = new Date(a.serviceDate);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const weekKey = weekStart.toISOString().split('T')[0];
    weekSet.add(weekKey);

    if (!weekDayMap.has(weekKey)) {
      weekDayMap.set(weekKey, new Set());
    }
    weekDayMap.get(weekKey)!.add(a.dayName);

    dayFrequency.set(a.dayName, (dayFrequency.get(a.dayName) || 0) + 1);

    // Use canonical time from lookup, or find nearest if tractorId is missing
    let canonicalTime: string;
    if (a.tractorId) {
      const key = `${a.soloType?.toLowerCase()}_${a.tractorId}`;
      canonicalTime = CANONICAL_START_TIMES[key] || a.startTime;
    } else {
      // tractorId is missing - find nearest canonical time based on raw time
      const nearest = findNearestCanonicalTime(a.startTime, a.soloType || 'solo1');
      canonicalTime = nearest.diff <= 90 ? nearest.time : a.startTime; // Use nearest if within 90 min
    }
    timeFrequency.set(canonicalTime, (timeFrequency.get(canonicalTime) || 0) + 1);

    if (a.tractorId) {
      tractorFrequency.set(a.tractorId, (tractorFrequency.get(a.tractorId) || 0) + 1);
    }
  }

  const totalWeeks = weekSet.size;

  // Calculate per-week day consistency (50%+ threshold)
  const dayWeekCount = new Map<string, number>();
  for (const daysInWeek of weekDayMap.values()) {
    for (const day of daysInWeek) {
      dayWeekCount.set(day, (dayWeekCount.get(day) || 0) + 1);
    }
  }

  const preferredDays = Array.from(dayWeekCount.entries())
    .filter(([_, weekCount]) => weekCount >= totalWeeks * 0.5)
    .sort((a, b) => {
      const diff = b[1] - a[1];
      if (diff !== 0) return diff;
      return DAY_NAMES_LOWER.indexOf(a[0]) - DAY_NAMES_LOWER.indexOf(b[0]);
    })
    .map(([day]) => day);

  const finalPreferredDays = preferredDays.length > 0
    ? preferredDays
    : getTopNFromMap(dayFrequency, 4);

  // NOTE: Do NOT sort alphabetically - keep frequency order so most common times appear first
  // This is critical because UI often shows only first 2 times
  const preferredStartTimes = getTopNFromMap(timeFrequency, 2);
  const preferredTractors = getTopNFromMap(tractorFrequency, 3);
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

  const wedCount = dayFrequency.get('wednesday') || 0;
  sunWedCount -= wedCount / 2;
  wedSatCount -= wedCount / 2;

  let patternGroup: 'sunWed' | 'wedSat' | 'mixed' = 'mixed';
  if (totalCount > 0) {
    if (sunWedCount / totalCount >= 0.7) patternGroup = 'sunWed';
    else if (wedSatCount / totalCount >= 0.7) patternGroup = 'wedSat';
  }

  // Calculate consistency score
  let consistencyScore = 0;
  if (finalPreferredDays.length > 0 && totalWeeks > 0) {
    let perfectWeeks = 0;
    for (const daysWorked of weekDayMap.values()) {
      if (finalPreferredDays.every(day => daysWorked.has(day))) perfectWeeks++;
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

/**
 * Regenerate DNA profiles from block_assignments data
 * Uses improved algorithm that looks at actual assignment patterns
 */
export async function regenerateDNAFromBlockAssignments(tenantId: string): Promise<{
  processed: number;
  updated: number;
  skipped: number;
  details: { name: string; changed: boolean; before: string; after: string }[];
}> {
  console.log(`[DNA Regenerate] Starting for tenant ${tenantId}`);

  // Get all drivers with block assignments
  const driversResult = await db.execute(sql`
    SELECT DISTINCT
      d.id as driver_id,
      d.first_name,
      d.last_name,
      d.tenant_id
    FROM drivers d
    INNER JOIN block_assignments ba ON ba.driver_id = d.id
    WHERE ba.is_active = true AND d.tenant_id = ${tenantId}
    ORDER BY d.first_name, d.last_name
  `);

  const details: { name: string; changed: boolean; before: string; after: string }[] = [];
  let updated = 0;
  let skipped = 0;

  for (const row of driversResult.rows) {
    const driver = row as any;
    const driverName = `${driver.first_name} ${driver.last_name}`;

    // Get assignments
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

    const assignments = (assignmentsResult.rows as any[]).map(r => {
      const serviceDate = r.service_date instanceof Date ? r.service_date : new Date(r.service_date);
      const dayOfWeek = serviceDate.getDay();
      let startTime = '00:00';
      if (r.start_timestamp) {
        const ts = r.start_timestamp instanceof Date ? r.start_timestamp : new Date(r.start_timestamp);
        startTime = ts.toISOString().split('T')[1].slice(0, 5);
      }
      return {
        serviceDate,
        dayOfWeek,
        dayName: DAY_NAMES_LOWER[dayOfWeek],
        startTime,
        soloType: r.solo_type || 'solo1',
        tractorId: r.tractor_id || '',
      };
    });

    if (assignments.length < 3) {
      skipped++;
      continue;
    }

    const newDNA = computeDNAFromBlockAssignments(assignments);

    // Get existing profile
    const existingResult = await db.execute(sql`
      SELECT preferred_days, preferred_start_times, preferred_contract_type
      FROM driver_dna_profiles
      WHERE driver_id = ${driver.driver_id}
    `);

    const existing = existingResult.rows[0] as any;
    const beforeDays = existing?.preferred_days?.join(',') || 'none';
    const beforeTimes = existing?.preferred_start_times?.join(',') || 'none';
    const afterDays = newDNA.preferredDays.join(',');
    const afterTimes = newDNA.preferredStartTimes.join(',');
    const changed = beforeDays !== afterDays || beforeTimes !== afterTimes;

    const daysArrayLiteral = `{${newDNA.preferredDays.join(',')}}`;
    const timesArrayLiteral = `{${newDNA.preferredStartTimes.join(',')}}`;
    const tractorsArrayLiteral = `{${newDNA.preferredTractors.join(',')}}`;

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
      await db.execute(sql`
        INSERT INTO driver_dna_profiles (
          tenant_id, driver_id, preferred_days, preferred_start_times,
          preferred_tractors, preferred_contract_type, pattern_group,
          consistency_score, assignments_analyzed, weeks_analyzed,
          last_analyzed_at, analysis_version
        ) VALUES (
          ${tenantId}, ${driver.driver_id}, ${daysArrayLiteral}::text[],
          ${timesArrayLiteral}::text[], ${tractorsArrayLiteral}::text[],
          ${newDNA.preferredContractType}, ${newDNA.patternGroup},
          ${newDNA.consistencyScore.toFixed(4)}, ${newDNA.assignmentsAnalyzed},
          ${newDNA.weeksAnalyzed}, NOW(), 1
        )
      `);
    }

    updated++;
    details.push({
      name: driverName,
      changed,
      before: `${existing?.preferred_contract_type || 'none'} | ${beforeDays} @ ${beforeTimes}`,
      after: `${newDNA.preferredContractType} | ${afterDays} @ ${afterTimes}`,
    });
  }

  console.log(`[DNA Regenerate] Complete: ${updated} updated, ${skipped} skipped`);

  return {
    processed: driversResult.rows.length,
    updated,
    skipped,
    details,
  };
}

/**
 * Update DNA profile for a single driver based on their block_assignments
 * Automatically called after new assignments to keep profiles current
 * Only updates if driver has at least MIN_ASSIGNMENTS assignments
 */
const MIN_ASSIGNMENTS_FOR_DNA = 3;

export async function updateSingleDriverDNA(tenantId: string, driverId: string): Promise<{
  updated: boolean;
  reason: string;
  profile?: ComputedDNA;
}> {
  // Get driver info
  const driverResult = await db.execute(sql`
    SELECT id, first_name, last_name FROM drivers
    WHERE id = ${driverId} AND tenant_id = ${tenantId}
  `);

  if (driverResult.rows.length === 0) {
    return { updated: false, reason: 'Driver not found' };
  }

  const driver = driverResult.rows[0] as any;

  // Get assignments
  const assignmentsResult = await db.execute(sql`
    SELECT
      b.service_date,
      b.start_timestamp,
      b.solo_type,
      b.tractor_id
    FROM block_assignments ba
    JOIN blocks b ON ba.block_id = b.id
    WHERE ba.driver_id = ${driverId}
    AND ba.is_active = true
    ORDER BY b.service_date DESC
    LIMIT 100
  `);

  if (assignmentsResult.rows.length < MIN_ASSIGNMENTS_FOR_DNA) {
    return {
      updated: false,
      reason: `Only ${assignmentsResult.rows.length} assignments, need ${MIN_ASSIGNMENTS_FOR_DNA}`
    };
  }

  const assignments = (assignmentsResult.rows as any[]).map(r => {
    const serviceDate = r.service_date instanceof Date ? r.service_date : new Date(r.service_date);
    const dayOfWeek = serviceDate.getDay();
    let startTime = '00:00';
    if (r.start_timestamp) {
      const ts = r.start_timestamp instanceof Date ? r.start_timestamp : new Date(r.start_timestamp);
      startTime = ts.toISOString().split('T')[1].slice(0, 5);
    }
    return {
      serviceDate,
      dayOfWeek,
      dayName: DAY_NAMES_LOWER[dayOfWeek],
      startTime,
      soloType: r.solo_type || 'solo1',
      tractorId: r.tractor_id || '',
    };
  });

  const newDNA = computeDNAFromBlockAssignments(assignments);

  const daysArrayLiteral = `{${newDNA.preferredDays.join(',')}}`;
  const timesArrayLiteral = `{${newDNA.preferredStartTimes.join(',')}}`;
  const tractorsArrayLiteral = `{${newDNA.preferredTractors.join(',')}}`;

  // Check if profile exists
  const existingResult = await db.execute(sql`
    SELECT id FROM driver_dna_profiles WHERE driver_id = ${driverId}
  `);

  if (existingResult.rows.length > 0) {
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
      WHERE driver_id = ${driverId}
    `);
  } else {
    await db.execute(sql`
      INSERT INTO driver_dna_profiles (
        tenant_id, driver_id, preferred_days, preferred_start_times,
        preferred_tractors, preferred_contract_type, pattern_group,
        consistency_score, assignments_analyzed, weeks_analyzed,
        last_analyzed_at, analysis_version
      ) VALUES (
        ${tenantId}, ${driverId}, ${daysArrayLiteral}::text[],
        ${timesArrayLiteral}::text[], ${tractorsArrayLiteral}::text[],
        ${newDNA.preferredContractType}, ${newDNA.patternGroup},
        ${newDNA.consistencyScore.toFixed(4)}, ${newDNA.assignmentsAnalyzed},
        ${newDNA.weeksAnalyzed}, NOW(), 1
      )
    `);
  }

  console.log(`[DNA] Updated profile for ${driver.first_name} ${driver.last_name}: ${newDNA.preferredDays.join(',')} @ ${newDNA.preferredStartTimes.join(',')}`);

  return {
    updated: true,
    reason: 'Profile updated successfully',
    profile: newDNA,
  };
}
