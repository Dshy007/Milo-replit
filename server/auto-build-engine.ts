import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "./db";
import {
  blocks,
  blockAssignments,
  drivers,
  contracts,
  protectedDriverRules,
  autoBuildRuns,
  type Block,
  type Driver,
  type InsertAutoBuildRun,
  type AutoBuildRun,
} from "@shared/schema";
import { startOfWeek, endOfWeek, addWeeks, format, differenceInDays } from "date-fns";
import {
  generateBlockSignature,
  getPatternsForSignature,
  CONFIDENCE_THRESHOLDS,
} from "./pattern-engine";
import { getDriverWorkloadForWeek } from "./workload-calculator";
import { validateBlockAssignment, type AssignmentGuardResult } from "./rolling6-calculator";

/**
 * Auto-Build Next Week Engine
 * Generates intelligent block assignments for upcoming weeks based on:
 * - Historical pattern analysis (50% weight)
 * - Workload balance (30% weight)
 * - DOT compliance (20% weight)
 * - Protected driver rules (hard constraints)
 */

export interface BlockSuggestion {
  blockId: string;
  blockDisplayId: string;
  driverId: string;
  driverName: string;
  confidence: number;
  compositeScore: number;
  patternScore: number;
  workloadScore: number;
  complianceScore: number;
  rationale: string;
  isProtectedAssignment: boolean;
}

export interface AutoBuildPreview {
  targetWeekStart: Date;
  targetWeekEnd: Date;
  suggestions: BlockSuggestion[];
  totalBlocks: number;
  highConfidence: number;
  mediumConfidence: number;
  lowConfidence: number;
  unassignable: BlockSuggestion[];
  warnings: string[];
}

/**
 * Calculate workload score for a driver
 * Score is higher (better) when driver is underutilized or at ideal load
 * Score is lower (worse) when driver is overloaded
 * 
 * Target: 4-5 days per week
 * Preferred max: 5 days
 * Hard limit: 6 days
 */
function calculateWorkloadScore(currentDaysWorked: number, proposedDaysWorked: number): number {
  // If assignment would exceed 6 days, score is 0 (invalid)
  if (proposedDaysWorked > 6) return 0;
  
  // Ideal range: 4-5 days
  if (proposedDaysWorked >= 4 && proposedDaysWorked <= 5) return 1.0;
  
  // Underutilized (1-3 days): good, but not ideal
  if (proposedDaysWorked <= 3) return 0.8;
  
  // Overload warning (6 days): still valid, but discouraged
  if (proposedDaysWorked === 6) return 0.3;
  
  return 0.5;
}

/**
 * Calculate compliance score for a driver-block assignment
 * Returns 1.0 if compliant, 0.0 if non-compliant
 */
async function calculateComplianceScore(
  driver: Driver,
  block: Block,
  existingAssignments: Array<typeof blockAssignments.$inferSelect & { block: Block }>,
  protectedRules: typeof protectedDriverRules.$inferSelect[],
  allBlockAssignments: typeof blockAssignments.$inferSelect[]
): Promise<number> {
  const validation = await validateBlockAssignment(
    driver,
    block,
    existingAssignments,
    protectedRules,
    allBlockAssignments
  );
  
  return validation.canAssign ? 1.0 : 0.0;
}

/**
 * Check if a block is protected and must be assigned to a specific driver
 */
async function getProtectedDriverForBlock(
  tenantId: string,
  block: Block
): Promise<{ driverId: string; driverName: string } | null> {
  const blockDate = new Date(block.startTimestamp);
  const dayName = format(blockDate, "EEEE");
  const startTime = format(blockDate, "HH:mm");
  
  // Fetch all active protected driver rules
  const rules = await db
    .select({
      rule: protectedDriverRules,
      driver: drivers,
    })
    .from(protectedDriverRules)
    .innerJoin(drivers, eq(protectedDriverRules.driverId, drivers.id))
    .where(eq(protectedDriverRules.tenantId, tenantId));

  for (const { rule, driver } of rules) {
    // Check if rule is currently effective
    if (rule.effectiveFrom && new Date(rule.effectiveFrom) > blockDate) continue;
    if (rule.effectiveTo && new Date(rule.effectiveTo) < blockDate) continue;
    
    // Check day restrictions
    if (rule.allowedDays && rule.allowedDays.length > 0) {
      if (!rule.allowedDays.includes(dayName)) continue;
    }
    if (rule.blockedDays && rule.blockedDays.length > 0) {
      if (rule.blockedDays.includes(dayName)) continue;
    }
    
    // Check solo type restrictions
    if (rule.allowedSoloTypes && rule.allowedSoloTypes.length > 0) {
      if (!rule.allowedSoloTypes.includes(block.soloType)) continue;
    }
    
    // Check time restrictions
    if (rule.allowedStartTimes && rule.allowedStartTimes.length > 0) {
      if (!rule.allowedStartTimes.includes(startTime)) continue;
    }
    if (rule.maxStartTime) {
      if (startTime > rule.maxStartTime) continue;
    }
    
    // If we made it here, this driver matches the protection criteria
    if (rule.isProtected) {
      return {
        driverId: driver.id,
        driverName: `${driver.firstName} ${driver.lastName}`,
      };
    }
  }
  
  return null;
}

/**
 * Generate auto-build suggestions for a target week
 */
export async function generateAutoBuildPreview(
  tenantId: string,
  targetWeekStart: Date,
  userId?: string
): Promise<AutoBuildPreview> {
  const weekStart = startOfWeek(targetWeekStart, { weekStartsOn: 0 });
  const weekEnd = endOfWeek(targetWeekStart, { weekStartsOn: 0 });
  
  // Fetch all blocks for the target week
  const weekBlocks = await db
    .select()
    .from(blocks)
    .where(
      and(
        eq(blocks.tenantId, tenantId),
        gte(blocks.startTimestamp, weekStart),
        lt(blocks.startTimestamp, weekEnd)
      )
    );

  // Fetch all drivers for the tenant
  const allDrivers = await db
    .select()
    .from(drivers)
    .where(
      and(
        eq(drivers.tenantId, tenantId),
        eq(drivers.status, "active"),
        eq(drivers.loadEligible, true)
      )
    );

  // Fetch all block assignments for the week with block data
  const weekAssignments = await db
    .select({
      assignment: blockAssignments,
      block: blocks,
    })
    .from(blockAssignments)
    .innerJoin(blocks, eq(blockAssignments.blockId, blocks.id))
    .where(
      and(
        eq(blockAssignments.tenantId, tenantId),
        gte(blocks.startTimestamp, weekStart),
        lt(blocks.startTimestamp, weekEnd)
      )
    );

  // Fetch protected driver rules
  const allProtectedRules = await db
    .select()
    .from(protectedDriverRules)
    .where(eq(protectedDriverRules.tenantId, tenantId));

  // Fetch all block assignments (for conflict detection)
  const allBlockAssignments = await db
    .select()
    .from(blockAssignments)
    .where(eq(blockAssignments.tenantId, tenantId));

  // Calculate current workload for each driver
  const driverWorkloads = new Map<string, number>();
  for (const driver of allDrivers) {
    const driverAssignments = weekAssignments
      .filter(a => a.assignment.driverId === driver.id)
      .map(a => ({ ...a.assignment, block: a.block }));
    const workload = await getDriverWorkloadForWeek(driver, weekStart, driverAssignments);
    driverWorkloads.set(driver.id, workload.daysWorked);
  }

  const suggestions: BlockSuggestion[] = [];
  const unassignable: BlockSuggestion[] = [];
  const warnings: string[] = [];
  
  let highConfidence = 0;
  let mediumConfidence = 0;
  let lowConfidence = 0;

  // Process each block
  for (const block of weekBlocks) {
    // Check if block is protected
    const protectedDriver = await getProtectedDriverForBlock(tenantId, block);
    
    if (protectedDriver) {
      // Protected block - must assign to specific driver
      suggestions.push({
        blockId: block.id,
        blockDisplayId: block.blockId,
        driverId: protectedDriver.driverId,
        driverName: protectedDriver.driverName,
        confidence: 1.0,
        compositeScore: 1.0,
        patternScore: 1.0,
        workloadScore: 1.0,
        complianceScore: 1.0,
        rationale: "Protected assignment - required by driver rules",
        isProtectedAssignment: true,
      });
      
      // Update workload for protected driver
      const currentWorkload = driverWorkloads.get(protectedDriver.driverId) || 0;
      driverWorkloads.set(protectedDriver.driverId, currentWorkload + 1);
      
      highConfidence++;
      continue;
    }

    // Generate block signature for pattern matching
    const signature = generateBlockSignature(
      block.contractId,
      block.soloType,
      new Date(block.startTimestamp),
      block.tractorId
    );

    // Get patterns for this block signature
    const patterns = await getPatternsForSignature(tenantId, signature);

    if (patterns.length === 0) {
      warnings.push(`No historical patterns found for block ${block.blockId} (${signature})`);
    }

    // Score each driver for this block
    const driverScores: Array<{
      driver: Driver;
      patternScore: number;
      workloadScore: number;
      complianceScore: number;
      compositeScore: number;
    }> = [];

    for (const driver of allDrivers) {
      // Find pattern for this driver
      const pattern = patterns.find(p => p.driverId === driver.id);
      const patternScore = pattern ? parseFloat(pattern.confidence as string) : 0;

      // Calculate workload score
      const currentDays = driverWorkloads.get(driver.id) || 0;
      const proposedDays = currentDays + 1;
      const workloadScore = calculateWorkloadScore(currentDays, proposedDays);

      // If workload score is 0, skip this driver (would exceed 6 days)
      if (workloadScore === 0) continue;

      // Get driver's existing assignments
      const driverAssignments = weekAssignments
        .filter(a => a.assignment.driverId === driver.id)
        .map(a => ({ ...a.assignment, block: a.block }));

      // Calculate compliance score
      const complianceScore = await calculateComplianceScore(
        driver,
        block,
        driverAssignments,
        allProtectedRules,
        allBlockAssignments
      );

      // If compliance score is 0, skip this driver (DOT violation)
      if (complianceScore === 0) continue;

      // Calculate composite score: pattern (50%) + workload (30%) + compliance (20%)
      const compositeScore =
        patternScore * 0.5 +
        workloadScore * 0.3 +
        complianceScore * 0.2;

      driverScores.push({
        driver,
        patternScore,
        workloadScore,
        complianceScore,
        compositeScore,
      });
    }

    // Sort drivers by composite score (descending)
    driverScores.sort((a, b) => b.compositeScore - a.compositeScore);

    if (driverScores.length === 0) {
      // No valid drivers for this block
      unassignable.push({
        blockId: block.id,
        blockDisplayId: block.blockId,
        driverId: "",
        driverName: "UNASSIGNABLE",
        confidence: 0,
        compositeScore: 0,
        patternScore: 0,
        workloadScore: 0,
        complianceScore: 0,
        rationale: "No eligible drivers available (all would violate workload or DOT limits)",
        isProtectedAssignment: false,
      });
      warnings.push(`Block ${block.blockId} has no eligible drivers`);
      continue;
    }

    // Select best driver
    const best = driverScores[0];
    const pattern = patterns.find(p => p.driverId === best.driver.id);
    const confidence = pattern ? parseFloat(pattern.confidence as string) : 0;

    // Build rationale
    let rationale = "";
    if (confidence >= CONFIDENCE_THRESHOLDS.HIGH) {
      rationale = `High confidence (${(confidence * 100).toFixed(0)}%) - driver frequently assigned this block`;
    } else if (confidence >= CONFIDENCE_THRESHOLDS.MEDIUM) {
      rationale = `Medium confidence (${(confidence * 100).toFixed(0)}%) - driver sometimes assigned this block`;
    } else if (confidence > 0) {
      rationale = `Low confidence (${(confidence * 100).toFixed(0)}%) - limited history for this block`;
    } else {
      rationale = `No pattern history - selected based on workload balance`;
    }

    suggestions.push({
      blockId: block.id,
      blockDisplayId: block.blockId,
      driverId: best.driver.id,
      driverName: `${best.driver.firstName} ${best.driver.lastName}`,
      confidence,
      compositeScore: best.compositeScore,
      patternScore: best.patternScore,
      workloadScore: best.workloadScore,
      complianceScore: best.complianceScore,
      rationale,
      isProtectedAssignment: false,
    });

    // Update workload tracker
    const currentWorkload = driverWorkloads.get(best.driver.id) || 0;
    driverWorkloads.set(best.driver.id, currentWorkload + 1);

    // Categorize by confidence
    if (confidence >= CONFIDENCE_THRESHOLDS.HIGH) highConfidence++;
    else if (confidence >= CONFIDENCE_THRESHOLDS.MEDIUM) mediumConfidence++;
    else lowConfidence++;
  }

  return {
    targetWeekStart: weekStart,
    targetWeekEnd: weekEnd,
    suggestions,
    totalBlocks: weekBlocks.length,
    highConfidence,
    mediumConfidence,
    lowConfidence,
    unassignable,
    warnings,
  };
}

/**
 * Save auto-build run to database
 */
export async function saveAutoBuildRun(
  tenantId: string,
  preview: AutoBuildPreview,
  userId?: string
): Promise<AutoBuildRun> {
  const runData: InsertAutoBuildRun = {
    tenantId,
    targetWeekStart: preview.targetWeekStart,
    targetWeekEnd: preview.targetWeekEnd,
    status: "pending",
    suggestions: JSON.stringify(preview.suggestions),
    totalBlocks: preview.totalBlocks,
    highConfidence: preview.highConfidence,
    mediumConfidence: preview.mediumConfidence,
    lowConfidence: preview.lowConfidence,
    createdBy: userId,
    notes: preview.warnings.join("\n"),
  };

  const [run] = await db.insert(autoBuildRuns).values(runData).returning();
  return run;
}

/**
 * Commit approved auto-build run
 * Creates block assignments for all approved suggestions
 */
export async function commitAutoBuildRun(
  runId: string,
  approvedBlockIds: string[],
  userId?: string
): Promise<{ created: number; failed: number; errors: string[] }> {
  // Fetch the run
  const [run] = await db
    .select()
    .from(autoBuildRuns)
    .where(eq(autoBuildRuns.id, runId));

  if (!run) {
    throw new Error("Auto-build run not found");
  }

  const suggestions: BlockSuggestion[] = JSON.parse(run.suggestions);
  const errors: string[] = [];
  let created = 0;
  let failed = 0;

  // Filter to only approved suggestions
  const approvedSuggestions = suggestions.filter(s =>
    approvedBlockIds.includes(s.blockId)
  );

  for (const suggestion of approvedSuggestions) {
    try {
      // Create block assignment
      await db.insert(blockAssignments).values({
        tenantId: run.tenantId,
        blockId: suggestion.blockId,
        driverId: suggestion.driverId,
        assignedAt: new Date(),
      });
      created++;
    } catch (error) {
      failed++;
      errors.push(`Failed to assign block ${suggestion.blockDisplayId}: ${error}`);
    }
  }

  // Update run status
  const newStatus = failed > 0 ? "partial" : "approved";
  await db
    .update(autoBuildRuns)
    .set({
      status: newStatus,
      reviewedBy: userId,
      reviewedAt: new Date(),
      approvedBlockIds,
      updatedAt: new Date(),
    })
    .where(eq(autoBuildRuns.id, runId));

  return { created, failed, errors };
}

/**
 * Get auto-build runs for a tenant
 */
export async function getAutoBuildRuns(tenantId: string): Promise<AutoBuildRun[]> {
  return db
    .select()
    .from(autoBuildRuns)
    .where(eq(autoBuildRuns.tenantId, tenantId))
    .orderBy(sql`${autoBuildRuns.createdAt} DESC`);
}
