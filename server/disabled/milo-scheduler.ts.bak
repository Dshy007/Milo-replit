/**
 * MILO Scheduler - Enhanced Claude Integration
 *
 * Uses the comprehensive MILO system prompt with:
 * - DOT compliance rules
 * - 6-tier match scoring
 * - Cascading lookback windows (12/8/3/2/1 weeks)
 * - Full validation pipeline
 *
 * This is a NEW scheduler that does NOT replace claude-scheduler.ts.
 * The original prompt and logic are preserved in claude-scheduler.ts.
 */

import Anthropic from "@anthropic-ai/sdk";
import { db } from "./db";
import { blockAssignments } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { format, endOfWeek } from "date-fns";
import { buildMiloPrompt, type MiloDriverSummary, type MiloBlockSummary } from "./milo-system-prompt";
import { getMiloData } from "./milo-data-fetcher";

interface MiloScheduleSuggestion {
  blockId: string;
  driverId: string;
  driverName: string;
  confidence: number;
  matchTier: number;
  matchScore: number;
  matchType: string;
  reason: string;
}

interface MiloScheduleResult {
  suggestions: MiloScheduleSuggestion[];
  unassigned: string[];
  stats: {
    totalBlocks: number;
    totalDrivers: number;
    assigned: number;
    unassigned: number;
    solverStatus: string;
    matchTierBreakdown: Record<number, number>;
    avgMatchScore: number;
  };
  validation: {
    errors: string[];
    warnings: string[];
    driverCategories: {
      established: number;
      new: number;
      unknown: number;
    };
  };
}

/**
 * MiloScheduler - Enhanced AI-powered schedule optimization
 */
class MiloScheduler {
  private client: Anthropic;

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY || "";
    if (!apiKey) {
      console.warn("[MiloScheduler] No ANTHROPIC_API_KEY found");
    }
    this.client = new Anthropic({ apiKey });
  }

  /**
   * Main optimization using MILO prompt
   */
  async optimizeSchedule(
    drivers: MiloDriverSummary[],
    blocks: MiloBlockSummary[],
    contractType: string,
    minDays: number = 3
  ): Promise<{
    suggestions: MiloScheduleSuggestion[];
    unassigned: string[];
    matchTierBreakdown: Record<number, number>;
    avgMatchScore: number;
  }> {

    if (blocks.length === 0 || drivers.length === 0) {
      return {
        suggestions: [],
        unassigned: blocks.map(b => b.id),
        matchTierBreakdown: {},
        avgMatchScore: 0
      };
    }

    // Build the comprehensive MILO prompt
    const prompt = buildMiloPrompt(contractType, drivers, blocks, minDays);

    console.log(`[MiloScheduler] Calling Claude with MILO prompt for ${contractType}...`);
    console.log(`[MiloScheduler] Prompt length: ${prompt.length} characters`);

    try {
      const response = await this.client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8192,
        messages: [{
          role: "user",
          content: prompt
        }]
      });

      // Extract text response
      const textBlock = response.content.find(block => block.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        throw new Error("No text response from Claude");
      }

      const responseText = textBlock.text;

      // Parse JSON from response
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        console.error("[MiloScheduler] No JSON array in response:", responseText.slice(0, 500));
        throw new Error("No JSON array found in MILO response");
      }

      const assignments = JSON.parse(jsonMatch[0]) as Array<{
        blockId: string;
        driverId: string;
        driverName: string;
        matchTier: number;
        matchScore: number;
        reason: string;
      }>;

      console.log(`[MiloScheduler] Claude returned ${assignments.length} assignments`);

      // Convert to suggestions with tier breakdown
      const suggestions: MiloScheduleSuggestion[] = [];
      const assignedBlockIds = new Set<string>();
      const driverDateAssignments: Record<string, Set<string>> = {};
      const matchTierBreakdown: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
      let totalScore = 0;

      for (const assignment of assignments) {
        const block = blocks.find(b => b.id === assignment.blockId);
        const driver = drivers.find(d => d.id === assignment.driverId);

        if (!block || !driver) {
          console.warn(`[MiloScheduler] Invalid assignment: block=${assignment.blockId?.slice(0, 8)}, driver=${assignment.driverId?.slice(0, 8)}`);
          continue;
        }

        if (assignedBlockIds.has(block.id)) {
          console.warn(`[MiloScheduler] Block ${block.id.slice(0, 8)} already assigned`);
          continue;
        }

        if (!driverDateAssignments[driver.id]) {
          driverDateAssignments[driver.id] = new Set();
        }
        if (driverDateAssignments[driver.id].has(block.serviceDate)) {
          console.warn(`[MiloScheduler] Driver ${driver.name} already assigned on ${block.serviceDate}`);
          continue;
        }

        // Map tier to match type
        const tierToMatchType: Record<number, string> = {
          1: "holy_grail",
          2: "strong_match",
          3: "moderate_match",
          4: "acceptable",
          5: "weak_match",
          6: "emergency_fill"
        };

        const tier = assignment.matchTier || 5;
        const score = assignment.matchScore || 50;

        suggestions.push({
          blockId: block.id,
          driverId: driver.id,
          driverName: driver.name,
          confidence: score / 100,
          matchTier: tier,
          matchScore: score,
          matchType: tierToMatchType[tier] || "assigned",
          reason: assignment.reason || "MILO assignment"
        });

        assignedBlockIds.add(block.id);
        driverDateAssignments[driver.id].add(block.serviceDate);
        matchTierBreakdown[tier] = (matchTierBreakdown[tier] || 0) + 1;
        totalScore += score;
      }

      const unassigned = blocks
        .filter(b => !assignedBlockIds.has(b.id))
        .map(b => b.id);

      return {
        suggestions,
        unassigned,
        matchTierBreakdown,
        avgMatchScore: suggestions.length > 0 ? totalScore / suggestions.length : 0
      };

    } catch (error: any) {
      console.error("[MiloScheduler] API error:", error.message || error);
      throw error;
    }
  }
}

// Singleton instance
let miloInstance: MiloScheduler | null = null;

function getMiloScheduler(): MiloScheduler {
  if (!miloInstance) {
    miloInstance = new MiloScheduler();
  }
  return miloInstance;
}

/**
 * Main export - optimize using MILO enhanced prompt
 *
 * Pipeline:
 * 1. Static MILO system prompt (Step 1)
 * 2. Cascading data fetch: 12/8/3/2/1 weeks (Step 2)
 * 3. Data validation per window (Step 3)
 * 4. Prompt + data merge (Step 4)
 * 5. Claude API call (Step 5)
 */
export async function optimizeWithMilo(
  tenantId: string,
  weekStart: Date,
  contractTypeFilter?: "solo1" | "solo2",
  minDays: number = 3
): Promise<MiloScheduleResult> {

  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 0 });
  console.log(`[MiloScheduler] Starting MILO optimization for ${format(weekStart, "yyyy-MM-dd")} to ${format(weekEnd, "yyyy-MM-dd")}`);

  // Step 2 & 3: Get data with cascading lookback and validation
  const { drivers, blocks, validationSummary } = await getMiloData(tenantId, weekStart, contractTypeFilter);

  console.log(`[MiloScheduler] Validation summary:`);
  console.log(`  - Total drivers: ${validationSummary.totalDrivers}`);
  console.log(`  - Established: ${validationSummary.established}`);
  console.log(`  - New: ${validationSummary.new}`);
  console.log(`  - Unknown: ${validationSummary.unknown}`);
  console.log(`  - Errors: ${validationSummary.errors.length}`);
  console.log(`  - Warnings: ${validationSummary.warnings.length}`);

  if (drivers.length === 0 || blocks.length === 0) {
    return {
      suggestions: [],
      unassigned: blocks.map(b => b.id),
      stats: {
        totalBlocks: blocks.length,
        totalDrivers: drivers.length,
        assigned: 0,
        unassigned: blocks.length,
        solverStatus: "NO_DATA",
        matchTierBreakdown: {},
        avgMatchScore: 0
      },
      validation: {
        errors: validationSummary.errors,
        warnings: validationSummary.warnings,
        driverCategories: {
          established: validationSummary.established,
          new: validationSummary.new,
          unknown: validationSummary.unknown
        }
      }
    };
  }

  // Group by contract type and process
  const allSuggestions: MiloScheduleSuggestion[] = [];
  const allUnassigned: string[] = [];
  let totalMatchTierBreakdown: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  let totalAvgScore = 0;
  let processedTypes = 0;

  const scheduler = getMiloScheduler();

  // Process solo1 if applicable
  const solo1Drivers = drivers.filter(d => d.contractType === "solo1");
  const solo1Blocks = blocks.filter(b => b.contractType === "solo1");

  if (solo1Blocks.length > 0 && solo1Drivers.length > 0) {
    console.log(`[MiloScheduler] Processing ${solo1Drivers.length} solo1 drivers, ${solo1Blocks.length} blocks`);
    const result = await scheduler.optimizeSchedule(solo1Drivers, solo1Blocks, "solo1", minDays);
    allSuggestions.push(...result.suggestions);
    allUnassigned.push(...result.unassigned);
    for (const [tier, count] of Object.entries(result.matchTierBreakdown)) {
      totalMatchTierBreakdown[Number(tier)] += count;
    }
    totalAvgScore += result.avgMatchScore;
    processedTypes++;
  } else if (solo1Blocks.length > 0) {
    allUnassigned.push(...solo1Blocks.map(b => b.id));
  }

  // Process solo2 if applicable
  const solo2Drivers = drivers.filter(d => d.contractType === "solo2");
  const solo2Blocks = blocks.filter(b => b.contractType === "solo2");

  if (solo2Blocks.length > 0 && solo2Drivers.length > 0) {
    console.log(`[MiloScheduler] Processing ${solo2Drivers.length} solo2 drivers, ${solo2Blocks.length} blocks`);
    const result = await scheduler.optimizeSchedule(solo2Drivers, solo2Blocks, "solo2", minDays);
    allSuggestions.push(...result.suggestions);
    allUnassigned.push(...result.unassigned);
    for (const [tier, count] of Object.entries(result.matchTierBreakdown)) {
      totalMatchTierBreakdown[Number(tier)] += count;
    }
    totalAvgScore += result.avgMatchScore;
    processedTypes++;
  } else if (solo2Blocks.length > 0) {
    allUnassigned.push(...solo2Blocks.map(b => b.id));
  }

  const avgMatchScore = processedTypes > 0 ? totalAvgScore / processedTypes : 0;

  console.log(`[MiloScheduler] MILO optimization complete:`);
  console.log(`  - Assigned: ${allSuggestions.length}/${blocks.length}`);
  console.log(`  - Average match score: ${avgMatchScore.toFixed(1)}%`);
  console.log(`  - Tier breakdown:`, totalMatchTierBreakdown);

  return {
    suggestions: allSuggestions.map(s => ({
      ...s,
      preferredTime: blocks.find(b => b.id === s.blockId)?.time || "",
      actualTime: blocks.find(b => b.id === s.blockId)?.time || ""
    })) as any,
    unassigned: allUnassigned,
    stats: {
      totalBlocks: blocks.length,
      totalDrivers: drivers.length,
      assigned: allSuggestions.length,
      unassigned: allUnassigned.length,
      solverStatus: "MILO_OPTIMAL",
      matchTierBreakdown: totalMatchTierBreakdown,
      avgMatchScore
    },
    validation: {
      errors: validationSummary.errors,
      warnings: validationSummary.warnings,
      driverCategories: {
        established: validationSummary.established,
        new: validationSummary.new,
        unknown: validationSummary.unknown
      }
    }
  };
}

/**
 * Apply MILO-optimized assignments to database (same as claude-scheduler)
 */
export async function applyMiloSchedule(
  tenantId: string,
  assignments: Array<{ blockId: string; driverId: string }>
): Promise<{ applied: number; errors: string[] }> {
  let applied = 0;
  const errors: string[] = [];

  for (const assignment of assignments) {
    try {
      const existing = await db
        .select()
        .from(blockAssignments)
        .where(
          and(
            eq(blockAssignments.blockId, assignment.blockId),
            eq(blockAssignments.isActive, true)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        errors.push(`Block ${assignment.blockId} already assigned`);
        continue;
      }

      await db.insert(blockAssignments).values({
        tenantId,
        blockId: assignment.blockId,
        driverId: assignment.driverId,
        isActive: true,
        assignedAt: new Date(),
        assignedBy: null
      });

      applied++;
    } catch (e: any) {
      errors.push(`Failed to assign ${assignment.blockId}: ${e.message}`);
    }
  }

  console.log(`[MiloScheduler] Applied ${applied} assignments, ${errors.length} errors`);
  return { applied, errors };
}
