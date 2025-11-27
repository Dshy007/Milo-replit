/**
 * Claude Architect Agent
 *
 * The Senior Architect of the Milo Neural Intelligence System.
 * Orchestrates queries, validates DOT rules, and synthesizes decisions.
 *
 * "I am Claude. I orchestrate. I reason. I never guess."
 */

import Anthropic from "@anthropic-ai/sdk";
import {
  BaseAgent,
  AgentRequest,
  AgentResponse,
  AgentContext,
  ThoughtBranch,
  AgentId,
  DOTStatus,
  ProtectedRuleCheck
} from "./base-agent";

// ═══════════════════════════════════════════════════════════════════════════════
//                              CLAUDE ARCHITECT
// ═══════════════════════════════════════════════════════════════════════════════

export class ClaudeArchitect extends BaseAgent {
  private client: Anthropic;

  constructor() {
    super("architect");
    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    });
  }

  /**
   * Process a request as the Architect
   */
  async process(request: AgentRequest): Promise<AgentResponse> {
    const startTime = Date.now();

    try {
      // Build messages for Claude
      const messages = this.buildMessages(request);

      // Add branching instructions if needed
      let systemContent = this.formatSystemPrompt(request.context);
      if (request.requiresBranching) {
        systemContent += `\n\n## BRANCHING INSTRUCTION
You are exploring this query. Think through multiple possibilities.
For each major consideration, clearly label it as a branch.
Format branches like:
- **BRANCH A: [Topic]** - [Your exploration of this possibility]
- **BRANCH B: [Topic]** - [Your exploration of this possibility]

After exploring branches, indicate your confidence level (0-100%).
If confidence < 85%, say "I'm still exploring..." and suggest what additional information would help.
If confidence >= 85%, you may converge to a recommendation.`;
      }

      // Call Claude API
      const response = await this.client.messages.create({
        model: this.model || "claude-sonnet-4-20250514",
        max_tokens: this.config.maxTokens,
        system: systemContent,
        messages: messages.filter(m => m.role !== "system").map(m => ({
          role: m.role as "user" | "assistant",
          content: m.content
        }))
      });

      const responseText = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map(block => block.text)
        .join("\n");

      // Extract confidence from response
      const confidence = this.extractArchitectConfidence(responseText);

      // Create thought record
      const thoughtId = await this.createThought(
        request.context.tenantId,
        confidence >= 85 ? "conclusion" : "hypothesis",
        responseText,
        confidence,
        {
          parentId: request.parentThoughtId,
          sessionId: request.context.sessionId,
          metadata: {
            model: this.model,
            responseTimeMs: Date.now() - startTime,
            tokensUsed: response.usage
          }
        }
      );

      // Parse branches from response
      const branches = this.parseBranches(responseText, thoughtId, request.context.tenantId);

      // Determine if we should suggest routing to another agent
      const suggestedNextAgent = this.suggestNextAgent(responseText, request.input);

      // Log routing
      await this.logRouting(
        request.context.tenantId,
        request.input,
        this.classifyIntent(request.input),
        "Architect processing query",
        {
          sessionId: request.context.sessionId,
          responseTimeMs: Date.now() - startTime,
          success: true
        }
      );

      return {
        output: responseText,
        confidence,
        thoughtId,
        branches: branches.length > 0 ? branches : undefined,
        suggestedNextAgent,
        shouldConverge: this.shouldConverge(confidence),
        metadata: {
          model: this.model,
          tokensUsed: response.usage,
          responseTimeMs: Date.now() - startTime
        }
      };
    } catch (error) {
      console.error("Claude Architect error:", error);

      // Log the failure
      await this.logRouting(
        request.context.tenantId,
        request.input,
        "error",
        "Architect encountered an error",
        {
          sessionId: request.context.sessionId,
          responseTimeMs: Date.now() - startTime,
          success: false,
          errorMessage: error instanceof Error ? error.message : "Unknown error"
        }
      );

      throw error;
    }
  }

  /**
   * Check if this agent can handle the given input
   */
  canHandle(input: string, _context: AgentContext): boolean {
    // Architect can handle anything, but is primary for:
    // - Complex dispatch decisions
    // - DOT compliance questions
    // - Driver assignments
    // - Protected rule questions
    // - Orchestration and synthesis
    const architectKeywords = [
      "assign", "dispatch", "driver", "block", "schedule",
      "dot", "hours", "compliance", "protected", "rule",
      "who should", "recommend", "decision", "help",
      "analyze", "think", "consider"
    ];

    const lowerInput = input.toLowerCase();
    return architectKeywords.some(keyword => lowerInput.includes(keyword)) ||
           !this.isRealTimeQuery(input) && !this.isExecutionRequest(input);
  }

  /**
   * Validate DOT compliance for a driver assignment
   */
  async validateDOT(
    driverId: string,
    proposedBlockHours: number,
    soloType: "solo1" | "solo2",
    recentHours: number
  ): Promise<DOTStatus> {
    const limits = {
      solo1: { max: 14, window: 24, warning: 12.6 },
      solo2: { max: 38, window: 48, warning: 34.2 }
    };

    const limit = limits[soloType];
    const totalHours = recentHours + proposedBlockHours;

    if (totalHours > limit.max) {
      return {
        status: "violation",
        hoursUsed: totalHours,
        maxHours: limit.max,
        windowHours: limit.window,
        message: `VIOLATION: ${totalHours.toFixed(1)}h exceeds ${limit.max}h limit for ${soloType.toUpperCase()} in ${limit.window}h window`
      };
    }

    if (totalHours >= limit.warning) {
      return {
        status: "warning",
        hoursUsed: totalHours,
        maxHours: limit.max,
        windowHours: limit.window,
        message: `WARNING: ${totalHours.toFixed(1)}h approaching ${limit.max}h limit (90% threshold)`
      };
    }

    return {
      status: "valid",
      hoursUsed: totalHours,
      maxHours: limit.max,
      windowHours: limit.window,
      message: `VALID: ${totalHours.toFixed(1)}h within ${limit.max}h limit for ${soloType.toUpperCase()}`
    };
  }

  /**
   * Validate protected driver rules
   */
  validateProtectedRules(
    driver: {
      blockedDays?: string[];
      allowedDays?: string[];
      allowedSoloTypes?: string[];
      allowedStartTimes?: string[];
      maxStartTime?: string;
      isProtected?: boolean;
    },
    proposedDay: string,
    proposedSoloType: string,
    proposedStartTime: string
  ): ProtectedRuleCheck {
    const violations: string[] = [];
    const warnings: string[] = [];

    // Check blocked days
    if (driver.blockedDays?.includes(proposedDay)) {
      violations.push(`Driver is blocked from working on ${proposedDay}`);
    }

    // Check allowed days
    if (driver.allowedDays && driver.allowedDays.length > 0) {
      if (!driver.allowedDays.includes(proposedDay)) {
        violations.push(`Driver can only work on: ${driver.allowedDays.join(", ")}`);
      }
    }

    // Check allowed solo types
    if (driver.allowedSoloTypes && driver.allowedSoloTypes.length > 0) {
      if (!driver.allowedSoloTypes.includes(proposedSoloType)) {
        violations.push(`Driver can only be assigned to: ${driver.allowedSoloTypes.join(", ")}`);
      }
    }

    // Check allowed start times
    if (driver.allowedStartTimes && driver.allowedStartTimes.length > 0) {
      if (!driver.allowedStartTimes.includes(proposedStartTime)) {
        warnings.push(`Driver prefers start times: ${driver.allowedStartTimes.join(", ")}`);
      }
    }

    // Check max start time
    if (driver.maxStartTime) {
      if (proposedStartTime > driver.maxStartTime) {
        violations.push(`Driver cannot start later than ${driver.maxStartTime}`);
      }
    }

    return {
      passed: violations.length === 0,
      violations,
      warnings
    };
  }

  /**
   * Extract confidence from Architect response
   */
  private extractArchitectConfidence(response: string): number {
    const lowerResponse = response.toLowerCase();

    // Look for explicit confidence mentions
    const confidenceMatch = response.match(/confidence[:\s]+(\d+)/i);
    if (confidenceMatch) {
      return parseInt(confidenceMatch[1], 10);
    }

    // Look for percentage mentions
    const percentMatch = response.match(/(\d+)%\s*(confident|certain|sure)/i);
    if (percentMatch) {
      return parseInt(percentMatch[1], 10);
    }

    // Analyze language for confidence indicators
    let confidence = 50;

    // High confidence indicators
    const highIndicators = [
      "i recommend", "should assign", "the best choice",
      "clearly", "definitely", "confidently recommend",
      "based on the evidence", "converged", "conclusion"
    ];

    // Low confidence indicators
    const lowIndicators = [
      "i'm exploring", "still investigating", "need more information",
      "uncertain", "multiple possibilities", "branches",
      "don't know yet", "can't determine"
    ];

    for (const indicator of highIndicators) {
      if (lowerResponse.includes(indicator)) {
        confidence += 12;
      }
    }

    for (const indicator of lowIndicators) {
      if (lowerResponse.includes(indicator)) {
        confidence -= 12;
      }
    }

    return Math.max(0, Math.min(100, confidence));
  }

  /**
   * Parse branches from response text
   */
  private parseBranches(
    response: string,
    parentThoughtId: string,
    tenantId: string
  ): ThoughtBranch[] {
    const branches: ThoughtBranch[] = [];

    // Look for branch patterns
    const branchPattern = /\*\*BRANCH\s+([A-Z]):\s*([^*]+)\*\*\s*[-–]\s*([^\n*]+(?:\n(?!\*\*BRANCH)[^\n*]+)*)/gi;

    let match;
    while ((match = branchPattern.exec(response)) !== null) {
      const branchLetter = match[1];
      const topic = match[2].trim();
      const content = match[3].trim();

      // Estimate confidence for this branch based on language
      const branchConfidence = this.extractArchitectConfidence(content);

      branches.push({
        id: `${parentThoughtId}-branch-${branchLetter}`,
        parentId: parentThoughtId,
        agentId: "architect",
        type: "hypothesis",
        content: `${topic}: ${content}`,
        confidence: branchConfidence,
        status: branchConfidence >= 85 ? "converged" : branchConfidence >= 50 ? "promising" : "exploring",
        children: []
      });
    }

    return branches;
  }

  /**
   * Suggest next agent based on response content
   */
  private suggestNextAgent(response: string, input: string): AgentId | undefined {
    const lowerResponse = response.toLowerCase();
    const lowerInput = input.toLowerCase();

    // Need weather information
    if (lowerResponse.includes("weather") ||
        lowerResponse.includes("need to check conditions") ||
        lowerInput.includes("weather") ||
        lowerInput.includes("forecast")) {
      return "scout";
    }

    // Need pattern analysis
    if (lowerResponse.includes("analyze patterns") ||
        lowerResponse.includes("workload distribution") ||
        lowerResponse.includes("need more analysis")) {
      return "analyst";
    }

    // Ready for execution
    if (lowerResponse.includes("ready to execute") ||
        lowerResponse.includes("proceed with assignment") ||
        lowerResponse.includes("execute this")) {
      return "executor";
    }

    return undefined;
  }

  /**
   * Classify the intent of user input
   */
  private classifyIntent(input: string): string {
    const lowerInput = input.toLowerCase();

    if (lowerInput.includes("assign") || lowerInput.includes("who should")) {
      return "assignment";
    }
    if (lowerInput.includes("dot") || lowerInput.includes("hours") || lowerInput.includes("compliance")) {
      return "dot_validation";
    }
    if (lowerInput.includes("schedule") || lowerInput.includes("block")) {
      return "scheduling";
    }
    if (lowerInput.includes("driver") && (lowerInput.includes("find") || lowerInput.includes("available"))) {
      return "driver_lookup";
    }
    if (lowerInput.includes("why") || lowerInput.includes("explain")) {
      return "reasoning";
    }

    return "general";
  }

  /**
   * Check if query needs real-time data
   */
  private isRealTimeQuery(input: string): boolean {
    const realTimeKeywords = ["weather", "traffic", "current", "right now", "today's forecast"];
    return realTimeKeywords.some(kw => input.toLowerCase().includes(kw));
  }

  /**
   * Check if this is an execution request
   */
  private isExecutionRequest(input: string): boolean {
    const executionKeywords = ["execute", "do it", "assign now", "make the change", "update"];
    return executionKeywords.some(kw => input.toLowerCase().includes(kw));
  }
}

// Export singleton instance
let architectInstance: ClaudeArchitect | null = null;

export function getArchitect(): ClaudeArchitect {
  if (!architectInstance) {
    architectInstance = new ClaudeArchitect();
  }
  return architectInstance;
}
