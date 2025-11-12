import { and, eq, gte, lt, sql, desc } from "drizzle-orm";
import { db } from "./db";
import {
  blocks,
  blockAssignments,
  drivers,
  contracts,
  assignmentPatterns,
  type AssignmentPattern,
  type InsertAssignmentPattern,
} from "@shared/schema";
import { startOfWeek, subWeeks, differenceInWeeks, format } from "date-fns";

/**
 * Pattern Learning Engine
 * Analyzes historical block assignments to learn driver-block patterns
 * Uses exponential decay to weight recent assignments more heavily
 */

// Half-life for exponential decay: 4 weeks (assignments from 4 weeks ago have 50% weight)
const HALF_LIFE_WEEKS = 4;
const DECAY_FACTOR = Math.exp(-Math.log(2) / HALF_LIFE_WEEKS); // ≈ 0.8660

// Analysis window: 12 weeks of historical data
const ANALYSIS_WINDOW_WEEKS = 12;

// Confidence thresholds
export const CONFIDENCE_THRESHOLDS = {
  HIGH: 0.5,
  MEDIUM: 0.35,
  LOW: 0.0,
};

/**
 * Generate a normalized block signature for pattern matching
 * Format: "contractId_soloType_startTimeBucket_dayOfWeek_tractor"
 * 
 * This ensures future blocks can be matched to historical patterns
 */
export function generateBlockSignature(
  contractId: string,
  soloType: string,
  startTimestamp: Date,
  tractorId: string
): string {
  const dayOfWeek = format(startTimestamp, "EEEE"); // Monday, Tuesday, etc.
  const startTimeBucket = format(startTimestamp, "HH:mm"); // e.g., "16:30"
  
  return `${contractId}_${soloType}_${startTimeBucket}_${dayOfWeek}_${tractorId}`;
}

/**
 * Calculate exponential decay weight based on age
 * weight = decayFactor^weeksAgo
 */
function calculateDecayWeight(weeksAgo: number): number {
  return Math.pow(DECAY_FACTOR, weeksAgo);
}

/**
 * Recompute assignment patterns for a tenant
 * Analyzes last 12 weeks of assignments and updates the patterns table
 */
export async function recomputePatterns(tenantId: string): Promise<{
  patternsCreated: number;
  patternsUpdated: number;
  totalDrivers: number;
  analysisWindowStart: Date;
  analysisWindowEnd: Date;
}> {
  const now = new Date();
  const windowStart = subWeeks(startOfWeek(now, { weekStartsOn: 0 }), ANALYSIS_WINDOW_WEEKS);
  const windowEnd = now;

  // Fetch all assignments in the analysis window with associated block and driver data
  const assignments = await db
    .select({
      assignment: blockAssignments,
      block: blocks,
      driver: drivers,
      contract: contracts,
    })
    .from(blockAssignments)
    .innerJoin(blocks, eq(blockAssignments.blockId, blocks.id))
    .innerJoin(drivers, eq(blockAssignments.driverId, drivers.id))
    .innerJoin(contracts, eq(blocks.contractId, contracts.id))
    .where(
      and(
        eq(blockAssignments.tenantId, tenantId),
        gte(blocks.startTimestamp, windowStart),
        lt(blocks.startTimestamp, windowEnd)
      )
    )
    .orderBy(desc(blocks.startTimestamp));

  // Group assignments by (blockSignature, driverId)
  const patternMap = new Map<string, {
    tenantId: string;
    blockSignature: string;
    driverId: string;
    driverName: string;
    assignments: Array<{ date: Date; weeksAgo: number }>;
    weightedCount: number;
    rawCount: number;
    lastAssigned: Date | null;
  }>();

  for (const row of assignments) {
    const signature = generateBlockSignature(
      row.block.contractId,
      row.block.soloType,
      new Date(row.block.startTimestamp),
      row.block.tractorId
    );

    const key = `${signature}|${row.assignment.driverId}`;
    const weeksAgo = differenceInWeeks(now, new Date(row.block.startTimestamp));
    const weight = calculateDecayWeight(weeksAgo);

    if (!patternMap.has(key)) {
      patternMap.set(key, {
        tenantId,
        blockSignature: signature,
        driverId: row.assignment.driverId,
        driverName: `${row.driver.firstName} ${row.driver.lastName}`,
        assignments: [],
        weightedCount: 0,
        rawCount: 0,
        lastAssigned: null,
      });
    }

    const pattern = patternMap.get(key)!;
    pattern.assignments.push({
      date: new Date(row.block.startTimestamp),
      weeksAgo,
    });
    pattern.weightedCount += weight;
    pattern.rawCount += 1;

    if (!pattern.lastAssigned || new Date(row.block.startTimestamp) > pattern.lastAssigned) {
      pattern.lastAssigned = new Date(row.block.startTimestamp);
    }
  }

  // Calculate confidence scores per blockSignature
  // Confidence = (driver's weightedCount) / (sum of all drivers' weightedCount for this signature)
  const signatureTotals = new Map<string, number>();

  for (const pattern of Array.from(patternMap.values())) {
    const current = signatureTotals.get(pattern.blockSignature) || 0;
    signatureTotals.set(pattern.blockSignature, current + pattern.weightedCount);
  }

  const patternsToInsert: InsertAssignmentPattern[] = [];

  for (const pattern of Array.from(patternMap.values())) {
    const total = signatureTotals.get(pattern.blockSignature) || 1;
    const confidence = pattern.weightedCount / total;

    patternsToInsert.push({
      tenantId: pattern.tenantId,
      blockSignature: pattern.blockSignature,
      driverId: pattern.driverId,
      weightedCount: pattern.weightedCount.toFixed(4),
      rawCount: pattern.rawCount,
      lastAssigned: pattern.lastAssigned,
      confidence: confidence.toFixed(4),
      decayFactor: DECAY_FACTOR.toFixed(4),
    });
  }

  // Delete old patterns for this tenant and insert new ones
  await db.delete(assignmentPatterns).where(eq(assignmentPatterns.tenantId, tenantId));

  let patternsCreated = 0;
  if (patternsToInsert.length > 0) {
    const result = await db.insert(assignmentPatterns).values(patternsToInsert).returning();
    patternsCreated = result.length;
  }

  // Get unique driver count
  const uniqueDrivers = new Set(patternsToInsert.map(p => p.driverId));

  return {
    patternsCreated,
    patternsUpdated: 0, // We delete and recreate all patterns
    totalDrivers: uniqueDrivers.size,
    analysisWindowStart: windowStart,
    analysisWindowEnd: windowEnd,
  };
}

/**
 * Get patterns for a specific block signature
 * Returns all drivers who have been assigned this pattern, ranked by confidence
 */
export async function getPatternsForSignature(
  tenantId: string,
  blockSignature: string
): Promise<Array<AssignmentPattern & { driverName: string }>> {
  const patterns = await db
    .select({
      pattern: assignmentPatterns,
      driverName: sql<string>`${drivers.firstName} || ' ' || ${drivers.lastName}`,
    })
    .from(assignmentPatterns)
    .innerJoin(drivers, eq(assignmentPatterns.driverId, drivers.id))
    .where(
      and(
        eq(assignmentPatterns.tenantId, tenantId),
        eq(assignmentPatterns.blockSignature, blockSignature)
      )
    )
    .orderBy(desc(assignmentPatterns.confidence));

  return patterns.map(p => ({
    ...p.pattern,
    driverName: p.driverName,
  }));
}

/**
 * Get all patterns for a driver across all block types
 */
export async function getPatternsForDriver(
  tenantId: string,
  driverId: string
): Promise<AssignmentPattern[]> {
  return db
    .select()
    .from(assignmentPatterns)
    .where(
      and(
        eq(assignmentPatterns.tenantId, tenantId),
        eq(assignmentPatterns.driverId, driverId)
      )
    )
    .orderBy(desc(assignmentPatterns.confidence));
}

/**
 * Get pattern statistics for a tenant
 */
export async function getPatternStats(tenantId: string): Promise<{
  totalPatterns: number;
  uniqueBlockSignatures: number;
  uniqueDrivers: number;
  highConfidencePatterns: number;
  mediumConfidencePatterns: number;
  lowConfidencePatterns: number;
}> {
  const patterns = await db
    .select()
    .from(assignmentPatterns)
    .where(eq(assignmentPatterns.tenantId, tenantId));

  const uniqueSignatures = new Set(patterns.map(p => p.blockSignature));
  const uniqueDrivers = new Set(patterns.map(p => p.driverId));

  let highConf = 0;
  let medConf = 0;
  let lowConf = 0;

  for (const pattern of patterns) {
    const conf = parseFloat(pattern.confidence as string);
    if (conf >= CONFIDENCE_THRESHOLDS.HIGH) highConf++;
    else if (conf >= CONFIDENCE_THRESHOLDS.MEDIUM) medConf++;
    else lowConf++;
  }

  return {
    totalPatterns: patterns.length,
    uniqueBlockSignatures: uniqueSignatures.size,
    uniqueDrivers: uniqueDrivers.size,
    highConfidencePatterns: highConf,
    mediumConfidencePatterns: medConf,
    lowConfidencePatterns: lowConf,
  };
}
