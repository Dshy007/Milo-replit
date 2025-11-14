import { db } from "./db";
import { drivers, blocks, blockAssignments, assignmentHistory, driverContractStats, protectedDriverRules } from "@shared/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { validateBumpTolerance, validateRestPeriod } from "./bump-validation";
import { validateBlockAssignment, blockToAssignmentSubject } from "./rolling6-calculator";

export interface DriverSuggestion {
  driver: {
    id: string;
    firstName: string;
    lastName: string;
  };
  confidenceScore: number;
  reason: string;
  bumpInfo: {
    bumpMinutes: number;
    bumpHours: number;
    withinTolerance: boolean;
  };
  patternCompatibility: {
    samePattern: boolean;
    previousPattern: string | null;
  };
  restCompliance: {
    isValid: boolean;
    actualRestHours: number;
  };
  rolling6Status: {
    isValid: boolean;
    messages: string[];
  };
  stats: {
    totalAssignments: number;
    streakCount: number;
    avgBumpMinutes: number;
    lastWorked: Date | null;
  } | null;
}

/**
 * Auto-assignment engine with pattern-aware confidence scoring
 * 
 * Scoring tiers:
 * 1. Exact Block ID match (historical): ~95% confidence
 * 2. Contract + time + day + pattern: ~80% confidence
 * 3. Route/operator pattern: ~60% confidence
 * 
 * Bump logic integration:
 * - ±2h within same pattern → acceptable
 * - Cross-pattern → requires review (confidence penalty)
 * - Validates 10-hour rest and rolling-6 compliance
 */
export async function getAssignmentSuggestions(
  tenantId: string,
  blockId: string
): Promise<DriverSuggestion[]> {
  // Fetch the block
  const block = await db
    .select()
    .from(blocks)
    .where(and(eq(blocks.tenantId, tenantId), eq(blocks.id, blockId)))
    .limit(1);

  if (!block[0]) {
    throw new Error("Block not found");
  }

  const targetBlock = block[0];

  if (!targetBlock.patternGroup || !targetBlock.canonicalStart) {
    throw new Error("Block missing pattern metadata - run migration first");
  }

  // Fetch all drivers for this tenant
  const allDrivers = await db
    .select()
    .from(drivers)
    .where(eq(drivers.tenantId, tenantId));

  // Fetch driver contract stats for this contract + pattern
  const stats = await db
    .select()
    .from(driverContractStats)
    .where(
      and(
        eq(driverContractStats.tenantId, tenantId),
        eq(driverContractStats.contractId, targetBlock.contractId),
        eq(driverContractStats.patternGroup, targetBlock.patternGroup)
      )
    );

  // Fetch assignment history for bump validation
  const historyRecords = await db
    .select()
    .from(assignmentHistory)
    .where(
      and(
        eq(assignmentHistory.tenantId, tenantId),
        eq(assignmentHistory.contractId, targetBlock.contractId)
      )
    )
    .orderBy(desc(assignmentHistory.assignedAt));

  // Fetch existing assignments
  const existingAssignments = await db
    .select()
    .from(blockAssignments)
    .where(eq(blockAssignments.tenantId, tenantId));

  // Fetch protected rules
  const protectedRules = await db
    .select()
    .from(protectedDriverRules)
    .where(eq(protectedDriverRules.tenantId, tenantId));

  const suggestions: DriverSuggestion[] = [];

  for (const driver of allDrivers) {
    // Skip if driver not eligible
    if (!driver.loadEligible || driver.status !== "active") {
      continue;
    }

    // Get driver's stats for this contract+pattern
    const driverStats = stats.find((s) => s.driverId === driver.id);

    // Get driver's history for bump validation
    const driverHistory = historyRecords.filter((h) => h.driverId === driver.id);

    // Validate bump tolerance
    const bumpValidation = validateBumpTolerance(targetBlock, driverHistory);

    // Note: We don't skip drivers with bumps outside tolerance
    // Instead, we include them but with lowered confidence and "requires review" flag
    // This ensures suggestions are always available, especially for new systems with no history

    // Check rest period (10-hour requirement)
    let restValidation = { isValid: true, actualRestHours: 10, reason: "No previous shifts" };
    
    const driverAssignments = existingAssignments.filter((a) => a.driverId === driver.id);
    if (driverAssignments.length > 0) {
      // Fetch blocks for existing assignments
      const assignmentBlockIds = driverAssignments.map((a) => a.blockId);
      const assignmentBlocks = await db
        .select()
        .from(blocks)
        .where(inArray(blocks.id, assignmentBlockIds));

      // Find most recent assignment
      const sortedBlocks = assignmentBlocks.sort(
        (a, b) => new Date(b.endTimestamp).getTime() - new Date(a.endTimestamp).getTime()
      );

      if (sortedBlocks.length > 0) {
        const lastBlock = sortedBlocks[0];
        restValidation = validateRestPeriod(
          new Date(lastBlock.endTimestamp),
          new Date(targetBlock.startTimestamp)
        );

        if (!restValidation.isValid) {
          continue; // Skip drivers without adequate rest
        }
      }
    }

    // Validate rolling-6 and protected rules
    const blockMap = new Map<string, any>();
    const driverExistingAssignments = driverAssignments.map((assignment) => {
      const assignmentBlock = blockMap.get(assignment.blockId);
      return {
        ...assignment,
        block: assignmentBlock || targetBlock,
      };
    });

    const validation = await validateBlockAssignment(
      driver,
      blockToAssignmentSubject(targetBlock),
      driverExistingAssignments,
      protectedRules,
      existingAssignments,
      targetBlock.id
    );

    // Skip if DOT violation or protected rule violation
    if (!validation.canAssign || validation.validationResult.validationStatus === "violation") {
      continue;
    }

    // Calculate confidence score
    let confidence = 0;
    let reason = "";

    // Tier 1: Has worked this exact contract+pattern before
    if (driverStats && driverStats.totalAssignments > 0) {
      // Base confidence from historical pattern
      confidence = 70;
      reason = `Worked this ${targetBlock.patternGroup} contract ${driverStats.totalAssignments} times`;

      // Bonus for streak
      if (driverStats.streakCount > 0) {
        confidence += Math.min(10, driverStats.streakCount * 2);
        reason += `, ${driverStats.streakCount}-week streak`;
      }

      // Bonus for low avg bump (driver is consistent)
      if (Math.abs(driverStats.avgBumpMinutes) < 30) {
        confidence += 10;
        reason += `, consistent timing`;
      }
    } else {
      // Tier 2: No history for this pattern, but has general experience
      confidence = 50;
      reason = `Available for ${targetBlock.patternGroup} pattern`;
    }

    // Penalty for cross-pattern (if they worked different pattern recently)
    if (bumpValidation.requiresReview) {
      confidence -= 20;
      reason += " (requires review)";
    }

    // Bonus for exact time match (no bump)
    if (Math.abs(bumpValidation.bumpMinutes) === 0) {
      confidence += 10;
      reason += ", exact time match";
    }

    // Penalty for large bumps
    const absBumpMinutes = Math.abs(bumpValidation.bumpMinutes);
    if (absBumpMinutes > 120) {
      // Very large bump (>2h) - significant penalty
      confidence -= 30;
      reason += `, large ${bumpValidation.bumpHours}h bump`;
    } else if (absBumpMinutes > 60) {
      // Moderate bump (1-2h) - small penalty
      confidence -= 10;
      reason += `, ${bumpValidation.bumpHours}h bump`;
    }

    // Cap confidence at 95 (never 100% - always leave room for human review)
    confidence = Math.min(95, Math.max(0, confidence));

    suggestions.push({
      driver: {
        id: driver.id,
        firstName: driver.firstName,
        lastName: driver.lastName,
      },
      confidenceScore: confidence,
      reason,
      bumpInfo: {
        bumpMinutes: bumpValidation.bumpMinutes,
        bumpHours: bumpValidation.bumpHours,
        withinTolerance: bumpValidation.withinTolerance,
      },
      patternCompatibility: {
        samePattern: driverHistory.some((h) => h.patternGroup === targetBlock.patternGroup),
        previousPattern: driverHistory[0]?.patternGroup || null,
      },
      restCompliance: {
        isValid: restValidation.isValid,
        actualRestHours: restValidation.actualRestHours,
      },
      rolling6Status: {
        isValid: validation.validationResult.validationStatus !== "violation",
        messages: validation.validationResult.messages,
      },
      stats: driverStats
        ? {
            totalAssignments: driverStats.totalAssignments,
            streakCount: driverStats.streakCount,
            avgBumpMinutes: driverStats.avgBumpMinutes,
            lastWorked: driverStats.lastWorked,
          }
        : null,
    });
  }

  // Sort by confidence score (descending)
  return suggestions.sort((a, b) => b.confidenceScore - a.confidenceScore);
}
