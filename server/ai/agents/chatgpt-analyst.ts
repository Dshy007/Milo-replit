/**
 * ChatGPT Analyst Agent
 *
 * The pattern recognition mind of the Milo Neural Intelligence System.
 * Handles data analysis, workload distribution, and driver-block matching.
 *
 * "I see patterns where others see chaos. I analyze, hypothesize, and present possibilities."
 */

import OpenAI from "openai";
import {
  BaseAgent,
  AgentRequest,
  AgentResponse,
  AgentContext,
  ThoughtBranch,
  Pattern
} from "./base-agent";

// ═══════════════════════════════════════════════════════════════════════════════
//                              ANALYSIS TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface WorkloadAnalysis {
  driverId: string;
  driverName: string;
  hoursThisWeek: number;
  blocksThisWeek: number;
  workloadScore: number; // 0-100, lower means less loaded
  recommendation: string;
}

export interface CompatibilityScore {
  driverId: string;
  blockId: string;
  score: number; // 0-100
  factors: {
    factor: string;
    impact: number; // -20 to +20
    reason: string;
  }[];
}

export interface PatternInsight {
  pattern: string;
  confidence: number;
  observations: number;
  type: "driver" | "route" | "schedule" | "operational";
  subjectId?: string;
  recommendation?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
//                              CHATGPT ANALYST
// ═══════════════════════════════════════════════════════════════════════════════

export class ChatGPTAnalyst extends BaseAgent {
  private client: OpenAI;

  constructor() {
    super("analyst");
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
  }

  /**
   * Process a request as the Analyst
   */
  async process(request: AgentRequest): Promise<AgentResponse> {
    const startTime = Date.now();

    try {
      // Build messages for ChatGPT
      const messages = this.buildMessages(request);

      // Add analysis instructions
      const systemContent = this.formatSystemPrompt(request.context) + `\n\n## ANALYSIS INSTRUCTION
When analyzing data:
1. Look for patterns in the information provided
2. Calculate scores and metrics where relevant
3. Present multiple possibilities with confidence levels
4. Format insights clearly:
   - PATTERN: [What you observed] (confidence: X%, observations: N)
   - ANALYSIS: [Your detailed analysis]
   - OPTIONS: List each option with pros/cons
5. Do NOT make final decisions - present options to the Architect`;

      // Call OpenAI API
      const response = await this.client.chat.completions.create({
        model: this.model || "gpt-4o",
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
        messages: [
          { role: "system", content: systemContent },
          ...messages.filter(m => m.role !== "system").map(m => ({
            role: m.role as "user" | "assistant",
            content: m.content
          }))
        ]
      });

      const responseText = response.choices[0]?.message?.content || "";

      // Extract confidence from response
      const confidence = this.extractAnalystConfidence(responseText);

      // Parse patterns from response
      const patterns = this.parsePatterns(responseText, request.context.tenantId);

      // Parse branches/options from response
      const branches = this.parseBranches(responseText, "", request.context.tenantId);

      // Create thought record
      const thoughtId = await this.createThought(
        request.context.tenantId,
        "hypothesis",
        responseText,
        confidence,
        {
          parentId: request.parentThoughtId,
          sessionId: request.context.sessionId,
          evidence: patterns.length > 0 ? { patternsFound: patterns } : undefined,
          metadata: {
            model: this.model || "gpt-4o",
            responseTimeMs: Date.now() - startTime,
            tokensUsed: response.usage
          }
        }
      );

      // Log routing
      await this.logRouting(
        request.context.tenantId,
        request.input,
        this.classifyIntent(request.input),
        "Analyst performing pattern analysis",
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
        patterns: patterns.length > 0 ? patterns : undefined,
        suggestedNextAgent: "architect", // Return to Architect with analysis
        shouldConverge: false, // Analyst presents options, doesn't converge
        metadata: {
          model: this.model || "gpt-4o",
          tokensUsed: response.usage,
          responseTimeMs: Date.now() - startTime,
          patternsFound: patterns.length
        }
      };
    } catch (error) {
      console.error("ChatGPT Analyst error:", error);

      // Log the failure
      await this.logRouting(
        request.context.tenantId,
        request.input,
        "error",
        "Analyst encountered an error",
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
    const analystKeywords = [
      "analyze", "analysis", "pattern", "trend",
      "workload", "balance", "distribution",
      "compare", "match", "score", "rank",
      "history", "performance", "metrics",
      "summary", "synthesize", "overview"
    ];

    const lowerInput = input.toLowerCase();
    return analystKeywords.some(keyword => lowerInput.includes(keyword));
  }

  /**
   * Analyze workload distribution across drivers
   */
  async analyzeWorkload(drivers: {
    id: string;
    name: string;
    hoursThisWeek: number;
    blocksThisWeek: number;
  }[]): Promise<WorkloadAnalysis[]> {
    const totalHours = drivers.reduce((sum, d) => sum + d.hoursThisWeek, 0);
    const avgHours = totalHours / drivers.length;

    return drivers.map(driver => {
      // Calculate workload score (lower = less loaded)
      const hoursDeviation = driver.hoursThisWeek - avgHours;
      const workloadScore = Math.max(0, Math.min(100, 50 + (hoursDeviation / avgHours) * 50));

      let recommendation = "";
      if (workloadScore < 30) {
        recommendation = "Available for additional blocks";
      } else if (workloadScore > 70) {
        recommendation = "Approaching workload limit - consider redistributing";
      } else {
        recommendation = "Balanced workload";
      }

      return {
        driverId: driver.id,
        driverName: driver.name,
        hoursThisWeek: driver.hoursThisWeek,
        blocksThisWeek: driver.blocksThisWeek,
        workloadScore,
        recommendation
      };
    }).sort((a, b) => a.workloadScore - b.workloadScore);
  }

  /**
   * Score driver-block compatibility
   */
  async scoreCompatibility(
    driver: {
      id: string;
      name: string;
      preferredSoloTypes?: string[];
      preferredDays?: string[];
      patternGroup?: string;
      strengths?: string[];
    },
    block: {
      id: string;
      soloType: string;
      day: string;
      startTime: string;
      requirements?: string[];
    }
  ): Promise<CompatibilityScore> {
    const factors: CompatibilityScore["factors"] = [];
    let baseScore = 50;

    // Check solo type preference
    if (driver.preferredSoloTypes?.includes(block.soloType)) {
      factors.push({
        factor: "Solo Type Match",
        impact: 15,
        reason: `Driver prefers ${block.soloType} blocks`
      });
      baseScore += 15;
    } else if (driver.preferredSoloTypes && driver.preferredSoloTypes.length > 0) {
      factors.push({
        factor: "Solo Type Mismatch",
        impact: -10,
        reason: `Driver prefers ${driver.preferredSoloTypes.join(", ")}`
      });
      baseScore -= 10;
    }

    // Check day preference
    if (driver.preferredDays?.includes(block.day)) {
      factors.push({
        factor: "Day Match",
        impact: 10,
        reason: `Driver prefers ${block.day}`
      });
      baseScore += 10;
    }

    // Check pattern group alignment
    const sunWedDays = ["Sunday", "Monday", "Tuesday", "Wednesday"];
    const wedSatDays = ["Wednesday", "Thursday", "Friday", "Saturday"];

    if (driver.patternGroup === "sunWed" && sunWedDays.includes(block.day)) {
      factors.push({
        factor: "Pattern Group Alignment",
        impact: 15,
        reason: "Block aligns with Sun-Wed pattern"
      });
      baseScore += 15;
    } else if (driver.patternGroup === "wedSat" && wedSatDays.includes(block.day)) {
      factors.push({
        factor: "Pattern Group Alignment",
        impact: 15,
        reason: "Block aligns with Wed-Sat pattern"
      });
      baseScore += 15;
    }

    // Check strength matching
    if (driver.strengths && block.requirements) {
      const matchedStrengths = driver.strengths.filter(s =>
        block.requirements!.some(r => r.toLowerCase().includes(s.toLowerCase()))
      );

      if (matchedStrengths.length > 0) {
        factors.push({
          factor: "Skill Match",
          impact: 10 * matchedStrengths.length,
          reason: `Driver strengths match: ${matchedStrengths.join(", ")}`
        });
        baseScore += 10 * matchedStrengths.length;
      }
    }

    return {
      driverId: driver.id,
      blockId: block.id,
      score: Math.max(0, Math.min(100, baseScore)),
      factors
    };
  }

  /**
   * Extract confidence from Analyst response
   */
  private extractAnalystConfidence(response: string): number {
    const lowerResponse = response.toLowerCase();

    // Look for explicit confidence mentions
    const confidenceMatch = response.match(/confidence[:\s]+(\d+)%?/i);
    if (confidenceMatch) {
      return parseInt(confidenceMatch[1], 10);
    }

    // Analyze language for confidence indicators
    let confidence = 50;

    // High confidence indicators
    const highIndicators = [
      "clear pattern", "strong correlation", "consistently",
      "data shows", "based on evidence", "historical trend"
    ];

    // Low confidence indicators
    const lowIndicators = [
      "insufficient data", "unclear", "mixed results",
      "need more information", "inconclusive", "limited observations"
    ];

    for (const indicator of highIndicators) {
      if (lowerResponse.includes(indicator)) {
        confidence += 10;
      }
    }

    for (const indicator of lowIndicators) {
      if (lowerResponse.includes(indicator)) {
        confidence -= 10;
      }
    }

    return Math.max(0, Math.min(100, confidence));
  }

  /**
   * Parse patterns from response text
   */
  private parsePatterns(response: string, _tenantId: string): Pattern[] {
    const patterns: Pattern[] = [];

    // Look for pattern markers
    const patternRegex = /PATTERN:\s*([^\n]+)(?:\s*\(confidence:\s*(\d+)%?,?\s*observations?:\s*(\d+)\))?/gi;

    let match;
    while ((match = patternRegex.exec(response)) !== null) {
      const patternText = match[1].trim();
      const confidence = match[2] ? parseInt(match[2], 10) : 50;
      const observations = match[3] ? parseInt(match[3], 10) : 1;

      patterns.push({
        id: `pattern-${Date.now()}-${patterns.length}`,
        type: this.classifyPatternType(patternText),
        pattern: patternText,
        confidence,
        observations
      });
    }

    return patterns;
  }

  /**
   * Classify the type of pattern
   */
  private classifyPatternType(pattern: string): string {
    const lowerPattern = pattern.toLowerCase();

    if (lowerPattern.includes("driver") || lowerPattern.includes("prefer")) {
      return "driver";
    }
    if (lowerPattern.includes("route") || lowerPattern.includes("location")) {
      return "route";
    }
    if (lowerPattern.includes("schedule") || lowerPattern.includes("time")) {
      return "schedule";
    }

    return "operational";
  }

  /**
   * Parse branches/options from response
   */
  private parseBranches(
    response: string,
    parentThoughtId: string,
    _tenantId: string
  ): ThoughtBranch[] {
    const branches: ThoughtBranch[] = [];

    // Look for option markers
    const optionRegex = /(?:OPTION|BRANCH|POSSIBILITY)\s*(\d+|[A-Z])[:.]?\s*([^\n]+)(?:\n(?!(?:OPTION|BRANCH|POSSIBILITY))([^]*?)(?=(?:OPTION|BRANCH|POSSIBILITY|\n\n|$)))?/gi;

    let match;
    while ((match = optionRegex.exec(response)) !== null) {
      const optionId = match[1];
      const title = match[2].trim();
      const content = match[3]?.trim() || "";

      const confidence = this.extractAnalystConfidence(title + " " + content);

      branches.push({
        id: `${parentThoughtId}-option-${optionId}`,
        parentId: parentThoughtId,
        agentId: "analyst",
        type: "hypothesis",
        content: `${title}\n${content}`.trim(),
        confidence,
        status: confidence >= 70 ? "promising" : "exploring",
        children: []
      });
    }

    return branches;
  }

  /**
   * Classify the intent of user input
   */
  private classifyIntent(input: string): string {
    const lowerInput = input.toLowerCase();

    if (lowerInput.includes("workload") || lowerInput.includes("balance")) {
      return "workload_analysis";
    }
    if (lowerInput.includes("pattern") || lowerInput.includes("trend")) {
      return "pattern_detection";
    }
    if (lowerInput.includes("compare") || lowerInput.includes("match")) {
      return "compatibility_analysis";
    }
    if (lowerInput.includes("summary") || lowerInput.includes("overview")) {
      return "synthesis";
    }

    return "general_analysis";
  }
}

// Export singleton instance
let analystInstance: ChatGPTAnalyst | null = null;

export async function getAnalyst(): Promise<ChatGPTAnalyst> {
  if (!analystInstance) {
    analystInstance = new ChatGPTAnalyst();
    await analystInstance.initialize();
  }
  return analystInstance;
}
