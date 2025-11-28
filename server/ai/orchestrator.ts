/**
 * Neural Orchestrator
 *
 * The main brain of the Milo Neural Intelligence System.
 * Routes requests to specialized agents, manages branching, and synthesizes decisions.
 *
 * "Where Silicon Minds Learn to Dispatch"
 */

import { db } from "../db";
import { neuralPatterns, neuralProfiles, neuralThoughts } from "../../shared/schema";
import { eq, and, gte, desc } from "drizzle-orm";

import {
  AgentId,
  AgentContext,
  AgentRequest,
  AgentResponse,
  ThoughtBranch,
  Pattern,
  EntityProfile
} from "./agents/base-agent";

import { ClaudeArchitect, getArchitect } from "./agents/claude-architect";
import { GeminiScout, getScout } from "./agents/gemini-scout";
import { ChatGPTAnalyst, getAnalyst } from "./agents/chatgpt-analyst";
import { ManusExecutor, getExecutor } from "./agents/manus-executor";

// Memory System
import { getMemoryManager, getPatternTracker, getProfileBuilder } from "./memory";

// ═══════════════════════════════════════════════════════════════════════════════
//                              ORCHESTRATOR TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface OrchestratorRequest {
  input: string;
  tenantId: string;
  sessionId?: string;
  userId?: string;
  conversationHistory?: { role: "user" | "assistant"; content: string }[];
  forceAgent?: AgentId;
}

export interface OrchestratorResponse {
  output: string;
  confidence: number;
  agentUsed: AgentId;
  thoughtPath: string[];
  branches?: ThoughtBranch[];
  patterns?: Pattern[];
  converged: boolean;
  metadata?: Record<string, unknown>;
}

export interface IntentClassification {
  primaryIntent: string;
  suggestedAgent: AgentId;
  confidence: number;
  keywords: string[];
}

// ═══════════════════════════════════════════════════════════════════════════════
//                              NEURAL ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════════════════════

export class NeuralOrchestrator {
  private architect: ClaudeArchitect | null = null;
  private scout: GeminiScout | null = null;
  private analyst: ChatGPTAnalyst | null = null;
  private executor: ManusExecutor | null = null;
  private initialized: boolean = false;

  // Fallback chains for each agent type
  private fallbackChains: Record<AgentId, AgentId[]> = {
    architect: ["analyst", "scout"],
    scout: ["architect", "analyst"],
    analyst: ["architect", "scout"],
    executor: ["architect"]
  };

  /**
   * Initialize all agents
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    console.log("🧠 Initializing Neural Intelligence System...\n");

    try {
      // Initialize architect (synchronous getter, async initialize)
      const architect = getArchitect();
      await architect.initialize();
      this.architect = architect;

      // Initialize other agents in parallel (they have async getters)
      const [scout, analyst, executor] = await Promise.all([
        getScout(),
        getAnalyst(),
        getExecutor()
      ]);

      this.scout = scout;
      this.analyst = analyst;
      this.executor = executor;

      this.initialized = true;

      console.log("╔══════════════════════════════════════════════════════════════════╗");
      console.log("║           NEURAL INTELLIGENCE SYSTEM ONLINE                       ║");
      console.log("╠══════════════════════════════════════════════════════════════════╣");
      console.log("║  🧠 Architect (Claude)     ✓ Ready                               ║");
      console.log("║  👁️  Scout (Gemini)         ✓ Ready                               ║");
      console.log("║  📊 Analyst (ChatGPT)      ✓ Ready                               ║");
      console.log("║  ⚡ Executor (Manus)       ✓ Ready                               ║");
      console.log("╚══════════════════════════════════════════════════════════════════╝\n");
    } catch (error) {
      console.error("Failed to initialize Neural Intelligence System:", error);
      throw error;
    }
  }

  /**
   * Process a request through the neural system
   */
  async process(request: OrchestratorRequest): Promise<OrchestratorResponse> {
    if (!this.initialized) {
      await this.initialize();
    }

    const startTime = Date.now();
    const thoughtPath: string[] = [];
    let allBranches: ThoughtBranch[] = [];
    let allPatterns: Pattern[] = [];

    try {
      // Build context with memory
      const context = await this.buildContext(request);

      // Classify intent and determine initial routing
      const intent = this.classifyIntent(request.input);
      thoughtPath.push(`Intent: ${intent.primaryIntent} (${intent.confidence}% confident)`);

      // Determine which agent to use
      const targetAgent = request.forceAgent || intent.suggestedAgent;
      thoughtPath.push(`Routing to: ${targetAgent}`);

      // Build agent request
      const agentRequest: AgentRequest = {
        input: request.input,
        context,
        requiresBranching: intent.confidence < 85
      };

      // Process through selected agent
      let response = await this.routeToAgent(targetAgent, agentRequest);
      thoughtPath.push(`${targetAgent}: ${response.confidence}% confidence`);

      // Collect branches and patterns
      if (response.branches) {
        allBranches.push(...response.branches);
      }
      if (response.patterns) {
        allPatterns.push(...response.patterns);
      }

      // If not converged and another agent is suggested, continue the chain
      let iterations = 0;
      const maxIterations = 3;

      while (!response.shouldConverge && response.suggestedNextAgent && iterations < maxIterations) {
        iterations++;
        const nextAgent = response.suggestedNextAgent;
        thoughtPath.push(`Continuing to: ${nextAgent}`);

        // Build new request with previous response as context
        const chainedRequest: AgentRequest = {
          input: `Previous analysis from ${targetAgent}:\n${response.output}\n\nOriginal query: ${request.input}`,
          context: {
            ...context,
            currentThoughts: allBranches
          },
          parentThoughtId: response.thoughtId,
          requiresBranching: response.confidence < 85
        };

        response = await this.routeToAgent(nextAgent, chainedRequest);
        thoughtPath.push(`${nextAgent}: ${response.confidence}% confidence`);

        if (response.branches) {
          allBranches.push(...response.branches);
        }
        if (response.patterns) {
          allPatterns.push(...response.patterns);
        }
      }

      // Store any discovered patterns
      if (allPatterns.length > 0) {
        await this.storePatterns(request.tenantId, allPatterns);
      }

      return {
        output: response.output,
        confidence: response.confidence,
        agentUsed: targetAgent,
        thoughtPath,
        branches: allBranches.length > 0 ? allBranches : undefined,
        patterns: allPatterns.length > 0 ? allPatterns : undefined,
        converged: response.shouldConverge,
        metadata: {
          responseTimeMs: Date.now() - startTime,
          iterations,
          ...response.metadata
        }
      };
    } catch (error) {
      console.error("Orchestrator error:", error);

      // Try fallback chain
      const fallbackResponse = await this.tryFallbackChain(
        request,
        this.fallbackChains["architect"],
        error
      );

      if (fallbackResponse) {
        return fallbackResponse;
      }

      throw error;
    }
  }

  /**
   * Classify the intent of user input
   */
  private classifyIntent(input: string): IntentClassification {
    const lowerInput = input.toLowerCase();
    const keywords: string[] = [];

    // Real-time data indicators (Scout)
    const scoutKeywords = [
      "weather", "forecast", "temperature", "rain", "snow", "fog",
      "traffic", "road conditions", "current", "right now"
    ];

    // Analysis indicators (Analyst)
    const analystKeywords = [
      "analyze", "pattern", "trend", "workload", "balance",
      "compare", "history", "performance", "metrics"
    ];

    // Execution indicators (Executor)
    const executorKeywords = [
      "execute", "assign now", "do it", "proceed",
      "make the assignment", "confirm", "apply"
    ];

    // Architect handles everything else (default)
    const architectKeywords = [
      "assign", "driver", "block", "schedule", "dot",
      "who should", "recommend", "help", "think"
    ];

    // Score each agent
    let scoutScore = 0;
    let analystScore = 0;
    let executorScore = 0;
    let architectScore = 0;

    for (const kw of scoutKeywords) {
      if (lowerInput.includes(kw)) {
        scoutScore += 20;
        keywords.push(kw);
      }
    }

    for (const kw of analystKeywords) {
      if (lowerInput.includes(kw)) {
        analystScore += 20;
        keywords.push(kw);
      }
    }

    for (const kw of executorKeywords) {
      if (lowerInput.includes(kw)) {
        executorScore += 25;
        keywords.push(kw);
      }
    }

    for (const kw of architectKeywords) {
      if (lowerInput.includes(kw)) {
        architectScore += 15;
        keywords.push(kw);
      }
    }

    // Architect is default if no strong match
    if (scoutScore === 0 && analystScore === 0 && executorScore === 0) {
      architectScore += 30;
    }

    // Determine winner
    const scores = [
      { agent: "architect" as AgentId, score: architectScore },
      { agent: "scout" as AgentId, score: scoutScore },
      { agent: "analyst" as AgentId, score: analystScore },
      { agent: "executor" as AgentId, score: executorScore }
    ];

    scores.sort((a, b) => b.score - a.score);
    const winner = scores[0];

    // Calculate confidence based on score difference
    const confidence = Math.min(95, winner.score + 30);

    return {
      primaryIntent: this.getIntentLabel(winner.agent, keywords),
      suggestedAgent: winner.agent,
      confidence,
      keywords
    };
  }

  /**
   * Get human-readable intent label
   */
  private getIntentLabel(agent: AgentId, keywords: string[]): string {
    if (agent === "scout") {
      return "real_time_data";
    }
    if (agent === "analyst") {
      return "pattern_analysis";
    }
    if (agent === "executor") {
      return "task_execution";
    }

    // More specific architect intents
    if (keywords.includes("assign") || keywords.includes("who should")) {
      return "driver_assignment";
    }
    if (keywords.includes("dot") || keywords.includes("compliance")) {
      return "dot_validation";
    }
    if (keywords.includes("schedule") || keywords.includes("block")) {
      return "scheduling";
    }

    return "general_query";
  }

  /**
   * Route request to specific agent
   */
  private async routeToAgent(agentId: AgentId, request: AgentRequest): Promise<AgentResponse> {
    switch (agentId) {
      case "architect":
        if (!this.architect) throw new Error("Architect not initialized");
        return this.architect.process(request);

      case "scout":
        if (!this.scout) throw new Error("Scout not initialized");
        return this.scout.process(request);

      case "analyst":
        if (!this.analyst) throw new Error("Analyst not initialized");
        return this.analyst.process(request);

      case "executor":
        if (!this.executor) throw new Error("Executor not initialized");
        return this.executor.process(request);

      default:
        throw new Error(`Unknown agent: ${agentId}`);
    }
  }

  /**
   * Try fallback chain if primary agent fails
   */
  private async tryFallbackChain(
    request: OrchestratorRequest,
    fallbackChain: AgentId[],
    originalError: unknown
  ): Promise<OrchestratorResponse | null> {
    console.log("Attempting fallback chain:", fallbackChain);

    for (const fallbackAgent of fallbackChain) {
      try {
        const context = await this.buildContext(request);

        const agentRequest: AgentRequest = {
          input: request.input,
          context,
          requiresBranching: true
        };

        const response = await this.routeToAgent(fallbackAgent, agentRequest);

        console.log(`Fallback to ${fallbackAgent} succeeded`);

        return {
          output: response.output,
          confidence: response.confidence,
          agentUsed: fallbackAgent,
          thoughtPath: [`Fallback from error: ${originalError}`, `Routed to: ${fallbackAgent}`],
          converged: response.shouldConverge,
          metadata: {
            fallback: true,
            originalError: originalError instanceof Error ? originalError.message : "Unknown error"
          }
        };
      } catch (fallbackError) {
        console.error(`Fallback to ${fallbackAgent} failed:`, fallbackError);
        continue;
      }
    }

    return null;
  }

  /**
   * Build context with memory and profiles
   */
  private async buildContext(request: OrchestratorRequest): Promise<AgentContext> {
    const sixWeeksAgo = new Date();
    sixWeeksAgo.setDate(sixWeeksAgo.getDate() - 42);

    // Fetch relevant patterns
    const patterns = await db
      .select()
      .from(neuralPatterns)
      .where(
        and(
          eq(neuralPatterns.tenantId, request.tenantId),
          gte(neuralPatterns.expiresAt, new Date())
        )
      )
      .orderBy(desc(neuralPatterns.confidence))
      .limit(20);

    // Fetch relevant profiles
    const profiles = await db
      .select()
      .from(neuralProfiles)
      .where(
        and(
          eq(neuralProfiles.tenantId, request.tenantId),
          gte(neuralProfiles.expiresAt, new Date())
        )
      )
      .orderBy(desc(neuralProfiles.interactionCount))
      .limit(10);

    // Fetch recent thoughts from this session
    let currentThoughts: ThoughtBranch[] = [];
    if (request.sessionId) {
      const recentThoughts = await db
        .select()
        .from(neuralThoughts)
        .where(
          and(
            eq(neuralThoughts.tenantId, request.tenantId),
            eq(neuralThoughts.sessionId, request.sessionId)
          )
        )
        .orderBy(desc(neuralThoughts.createdAt))
        .limit(10);

      currentThoughts = recentThoughts.map(t => ({
        id: t.id,
        parentId: t.parentId,
        agentId: t.agentId as AgentId,
        type: t.thoughtType as "question" | "hypothesis" | "observation" | "conclusion" | "action",
        content: t.content,
        confidence: t.confidence,
        status: t.status as "exploring" | "promising" | "converged" | "ruled_out",
        evidence: t.evidence as Record<string, unknown> | undefined,
        metadata: t.metadata as Record<string, unknown> | undefined,
        children: []
      }));
    }

    return {
      tenantId: request.tenantId,
      sessionId: request.sessionId,
      userId: request.userId,
      conversationHistory: request.conversationHistory?.map(m => ({
        role: m.role,
        content: m.content
      })),
      currentThoughts,
      patterns: patterns.map(p => ({
        id: p.id,
        type: p.patternType,
        pattern: p.pattern,
        confidence: p.confidence,
        observations: p.observations,
        subjectId: p.subjectId || undefined,
        subjectType: p.subjectType || undefined
      })),
      profiles: profiles.map(p => ({
        entityType: p.entityType,
        entityId: p.entityId,
        learnedTraits: p.learnedTraits as Record<string, unknown>,
        interactionCount: p.interactionCount
      }))
    };
  }

  /**
   * Store discovered patterns to memory
   */
  private async storePatterns(tenantId: string, patterns: Pattern[]): Promise<void> {
    const sixWeeksFromNow = new Date();
    sixWeeksFromNow.setDate(sixWeeksFromNow.getDate() + 42);

    for (const pattern of patterns) {
      // Check if pattern already exists
      const existing = await db
        .select()
        .from(neuralPatterns)
        .where(
          and(
            eq(neuralPatterns.tenantId, tenantId),
            eq(neuralPatterns.pattern, pattern.pattern)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        // Update existing pattern
        const current = existing[0];
        await db
          .update(neuralPatterns)
          .set({
            confidence: Math.min(100, current.confidence + 5),
            observations: current.observations + 1,
            lastObserved: new Date(),
            expiresAt: sixWeeksFromNow,
            status: current.confidence + 5 >= 80 ? "confirmed" : current.status
          })
          .where(eq(neuralPatterns.id, current.id));
      } else {
        // Insert new pattern
        await db.insert(neuralPatterns).values({
          tenantId,
          patternType: pattern.type,
          subjectId: pattern.subjectId || null,
          subjectType: pattern.subjectType || null,
          pattern: pattern.pattern,
          confidence: pattern.confidence,
          observations: pattern.observations,
          expiresAt: sixWeeksFromNow
        });
      }
    }
  }

  /**
   * Get agent health status
   */
  getAgentStatus(): Record<AgentId, string> {
    return {
      architect: this.architect?.getStatus() || "not_initialized",
      scout: this.scout?.getStatus() || "not_initialized",
      analyst: this.analyst?.getStatus() || "not_initialized",
      executor: this.executor?.getStatus() || "not_initialized"
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//                              SINGLETON INSTANCE
// ═══════════════════════════════════════════════════════════════════════════════

let orchestratorInstance: NeuralOrchestrator | null = null;

export async function getOrchestrator(): Promise<NeuralOrchestrator> {
  if (!orchestratorInstance) {
    orchestratorInstance = new NeuralOrchestrator();
    await orchestratorInstance.initialize();
  }
  return orchestratorInstance;
}
