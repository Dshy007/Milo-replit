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
 * Get canonical start time from soloType and tractorId
 * Falls back to formatted timestamp if no match found
 */
function getCanonicalStartTime(soloType: string | null, tractorId: string | null, fallbackTimestamp: Date): string {
  if (soloType && tractorId) {
    // Build lookup key: "solo1_Tractor_6" or "solo2_Tractor_4"
    const key = `${soloType.toLowerCase()}_${tractorId}`;
    const canonicalTime = CANONICAL_START_TIMES[key];
    if (canonicalTime) {
      return canonicalTime;
    }
  }
  // Fallback to formatted timestamp
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
  const { tenantId, driverId } = options;
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
