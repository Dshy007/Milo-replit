/**
 * Milo Scheduling Agent - Agentic scheduling system
 *
 * This module provides a ReAct-style agent that can:
 * 1. Reason about constrained optimization (limited drivers, varying demand)
 * 2. Execute actual schedule changes (not just answer questions)
 * 3. Explain every decision with clear reasoning
 *
 * Uses the 10 granular scheduling tools from scheduling-tools.ts
 */

import { GoogleGenerativeAI, GenerativeModel } from "@google/generative-ai";
import { startOfWeek, format, addWeeks } from "date-fns";
import { getScratchpad, AgentScratchpad, Decision } from "./tools/agent-scratchpad";
import {
  getUnassignedBlocks,
  getDriverPatterns,
  checkDotCompliance,
  checkRolling6Hours,
  checkProtectedRules,
  checkTimeOff,
  getOwnershipScore,
  getAffinityScore,
  assignDriverToBlock,
  unassignBlock,
  runAllChecks,
  SCHEDULING_TOOLS_DESCRIPTION,
  ToolResult,
  AllChecksResult,
} from "./tools/scheduling-tools";

// ============================================================================
// Types
// ============================================================================

export interface SchedulingResult {
  success: boolean;
  message: string;
  totalBlocks: number;
  assigned: number;
  unassigned: number;
  decisions: Decision[];
  reasoning: string[];
}

interface ToolCall {
  tool: string;
  params: Record<string, unknown>;
}

// ============================================================================
// System Prompt for Scheduling Agent
// ============================================================================

const SCHEDULING_SYSTEM_PROMPT = `You are Milo, an AI scheduling agent for Freedom Transportation.

## YOUR JOB
Build driver schedules by matching the RIGHT driver to each block.

## HOW SCORING WORKS
- Ownership (70%): XGBoost learned who "owns" each slot from history
- Affinity (30%): How well does slot match driver's work pattern?
- Fairness: Prefer drivers with fewer blocks this week

## HARD CONSTRAINTS (must pass ALL)
1. DOT 10-Hour Rest: Driver needs 10hrs between shifts
2. Rolling-6 Hours: Solo1 max 14hrs/24hrs, Solo2 max 38hrs/48hrs
3. Protected Rules: Some drivers blocked from certain days/times
4. Time-Off: Respect approved unavailability

${SCHEDULING_TOOLS_DESCRIPTION}

## YOUR PROCESS
For each unassigned block:
1. Get ownership scores for all eligible drivers using get_ownership_score
2. For top candidates, verify constraints using run_all_checks
3. Pick highest scoring driver that passes ALL checks
4. Call assign_driver_to_block with clear reasoning
5. If none pass, leave unassigned and explain why

## OUTPUT FORMAT
For each assignment, explain your reasoning:
"[Block: Tractor_1 Tuesday 16:30]
 Candidates: Firas (0.85 owner), Ahmed (0.42), Carlos (0.38)
 Checking Firas: DOT ✓ Rolling6 ✓ Protected ✓ Available ✓
 → ASSIGNED to Firas (slot owner, all checks passed)"

## IMPORTANT RULES
- You CAN directly assign drivers (use assign_driver_to_block tool)
- You MUST check all 4 constraints before assigning
- You MUST explain why each assignment was made
- If a block can't be assigned, explain what constraints failed
- Work through blocks one by one systematically

## TOOL CALL FORMAT
When you need to use a tool, respond with:
[TOOL_CALL]{"tool": "tool_name", "params": {...}}[/TOOL_CALL]

The system will execute the tool and provide results.

Today's date is ${new Date().toISOString().split('T')[0]}.
`;

// ============================================================================
// Scheduling Agent Class
// ============================================================================

export class SchedulingAgent {
  private client: GoogleGenerativeAI;
  private model: GenerativeModel;
  private scratchpad: AgentScratchpad | null = null;
  private tenantId: string = "";
  private reasoning: string[] = [];

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || "";
    if (!apiKey) {
      console.warn("[SchedulingAgent] No Gemini API key found");
    }
    this.client = new GoogleGenerativeAI(apiKey);
    this.model = this.client.getGenerativeModel({ model: "gemini-2.5-flash" });
  }

  /**
   * Run the scheduling agent to build a week's schedule
   */
  async buildSchedule(
    tenantId: string,
    weekStart: Date,
    options: {
      maxIterations?: number;
      minConfidence?: number;
    } = {}
  ): Promise<SchedulingResult> {
    const { maxIterations = 100, minConfidence = 0.3 } = options;

    console.log(`[SchedulingAgent] Starting schedule build for ${format(weekStart, 'yyyy-MM-dd')}`);

    this.tenantId = tenantId;
    this.reasoning = [];

    // Initialize scratchpad with all data
    this.scratchpad = await getScratchpad(tenantId, weekStart);
    const initialBlocks = this.scratchpad.getRemainingBlocks().length;

    this.reasoning.push(`📊 Starting with ${initialBlocks} unassigned blocks`);
    this.reasoning.push(`👥 ${this.scratchpad.allDrivers.length} active drivers available`);
    this.reasoning.push(`🧠 ${this.scratchpad.driverPatterns.size} driver patterns loaded`);

    // Process blocks systematically
    let iterations = 0;
    const blocks = [...this.scratchpad.getRemainingBlocks()];

    for (const block of blocks) {
      if (iterations >= maxIterations) {
        this.reasoning.push(`⚠️ Reached max iterations (${maxIterations})`);
        break;
      }

      iterations++;
      await this.processBlock(block, minConfidence);
    }

    // Get summary
    const summary = this.scratchpad.getSummary();

    this.reasoning.push(`\n📈 SUMMARY:`);
    this.reasoning.push(`✅ Assigned: ${summary.assigned}/${summary.totalBlocks} blocks`);
    this.reasoning.push(`❌ Unassigned: ${summary.unassigned} blocks`);

    return {
      success: true,
      message: `Schedule built: ${summary.assigned}/${summary.totalBlocks} blocks assigned`,
      totalBlocks: summary.totalBlocks,
      assigned: summary.assigned,
      unassigned: summary.unassigned,
      decisions: summary.decisions,
      reasoning: this.reasoning,
    };
  }

  /**
   * Process a single block - find best driver and assign
   */
  private async processBlock(
    block: { id: string; blockId: string; serviceDate: string; dayName: string; soloType: string; tractorId: string; startTime: string },
    minConfidence: number
  ): Promise<void> {
    if (!this.scratchpad) return;

    const blockDesc = `${block.tractorId} ${block.dayName} ${block.startTime}`;
    this.reasoning.push(`\n🔲 [${blockDesc}]`);

    // Get all eligible drivers and score them
    const candidates: Array<{
      driverId: string;
      driverName: string;
      combinedScore: number;
      checks: AllChecksResult;
    }> = [];

    for (const driver of this.scratchpad.allDrivers) {
      // Run all checks for this driver-block pair
      const checksResult = await runAllChecks(this.scratchpad, driver.id, block.id);

      if (!checksResult.success || !checksResult.data) {
        continue;
      }

      const checks = checksResult.data;

      // Skip if doesn't pass hard constraints
      if (!checks.canAssign) {
        continue;
      }

      // Skip if below minimum confidence
      if (checks.combinedScore < minConfidence) {
        continue;
      }

      candidates.push({
        driverId: driver.id,
        driverName: driver.name,
        combinedScore: checks.combinedScore,
        checks,
      });
    }

    // Sort by score descending
    candidates.sort((a, b) => b.combinedScore - a.combinedScore);

    if (candidates.length === 0) {
      this.reasoning.push(`  ❌ No eligible drivers found`);
      this.scratchpad.recordDecision(
        block.id,
        blockDesc,
        null,
        null,
        'skipped',
        'No eligible drivers passed all constraints'
      );
      return;
    }

    // Log top 3 candidates
    const top3 = candidates.slice(0, 3);
    const candidateStr = top3
      .map(c => `${c.driverName} (${Math.round(c.combinedScore * 100)}%)`)
      .join(', ');
    this.reasoning.push(`  Candidates: ${candidateStr}`);

    // Pick the best candidate
    const winner = candidates[0];
    const checks = winner.checks;

    // Log check results
    const checkStr = [
      `DOT ${checks.dot.compliant ? '✓' : '✗'}`,
      `Rolling6 ${checks.rolling6.compliant ? '✓' : '✗'}`,
      `Protected ${checks.protected.allowed ? '✓' : '✗'}`,
      `TimeOff ${checks.timeOff.available ? '✓' : '✗'}`,
    ].join(' ');
    this.reasoning.push(`  ${winner.driverName}: ${checkStr}`);

    // Determine match type for reasoning
    let matchType = 'pattern match';
    if (checks.ownership.isOwner) {
      matchType = 'slot owner';
    } else if (checks.ownership.score >= 0.3) {
      matchType = 'shared slot';
    }

    // Assign the driver
    const reason = `${matchType} (${Math.round(winner.combinedScore * 100)}% score)`;
    const assignResult = await assignDriverToBlock(
      this.scratchpad,
      this.tenantId,
      winner.driverId,
      block.id,
      reason
    );

    if (assignResult.success) {
      this.reasoning.push(`  → ASSIGNED to ${winner.driverName} (${reason})`);
    } else {
      this.reasoning.push(`  → FAILED: ${assignResult.error}`);
      this.scratchpad.recordDecision(
        block.id,
        blockDesc,
        winner.driverId,
        winner.driverName,
        'failed',
        assignResult.error || 'Assignment failed'
      );
    }
  }

  /**
   * Use AI to explain the schedule decisions
   */
  async explainDecisions(tenantId: string, weekStart: Date): Promise<string> {
    const scratchpad = await getScratchpad(tenantId, weekStart);
    const summary = scratchpad.getSummary();

    if (summary.decisions.length === 0) {
      return "No scheduling decisions have been made yet. Run buildSchedule first.";
    }

    const prompt = `${SCHEDULING_SYSTEM_PROMPT}

The following assignments were made for the week of ${format(weekStart, 'MMM d, yyyy')}:

${summary.decisions.slice(0, 20).map(d => {
  return `- ${d.blockInfo}: ${d.action === 'assigned' ? `Assigned to ${d.driverName}` : 'Unassigned'} - ${d.reasoning}`;
}).join('\n')}

Total: ${summary.assigned} assigned, ${summary.unassigned} unassigned

Please provide a brief summary of the scheduling decisions:
1. What patterns did you notice?
2. Were there any problematic areas?
3. Any recommendations for improvement?`;

    try {
      const result = await this.model.generateContent(prompt);
      return result.response.text();
    } catch (error) {
      console.error("[SchedulingAgent] Explain error:", error);
      return `Schedule summary: ${summary.assigned}/${summary.totalBlocks} blocks assigned.`;
    }
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Run the scheduling agent to build a week's schedule
 */
export async function runSchedulingAgent(
  tenantId: string,
  weekStart: string | Date,
  options?: {
    maxIterations?: number;
    minConfidence?: number;
  }
): Promise<SchedulingResult> {
  const agent = new SchedulingAgent();
  const weekDate = typeof weekStart === 'string' ? new Date(weekStart) : weekStart;
  return agent.buildSchedule(tenantId, startOfWeek(weekDate, { weekStartsOn: 0 }), options);
}

/**
 * Build next week's schedule
 */
export async function buildNextWeekSchedule(
  tenantId: string,
  weeksAhead: number = 1
): Promise<SchedulingResult> {
  const targetWeek = startOfWeek(addWeeks(new Date(), weeksAhead), { weekStartsOn: 0 });
  return runSchedulingAgent(tenantId, targetWeek);
}

/**
 * Get scheduling agent instance
 */
let schedulingAgentInstance: SchedulingAgent | null = null;

export function getSchedulingAgent(): SchedulingAgent {
  if (!schedulingAgentInstance) {
    schedulingAgentInstance = new SchedulingAgent();
  }
  return schedulingAgentInstance;
}
