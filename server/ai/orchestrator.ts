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

// Branching System
import {
  getBranchManager,
  getConfidenceCalculator,
  getConvergenceEngine,
  type Branch,
  type DecisionContext,
  type ConvergenceResult
} from "./branching";

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
  convergenceResult?: ConvergenceResult;
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

  // Branching system components
  private branchManager = getBranchManager();
  private confidenceCalc = getConfidenceCalculator();
  private convergenceEngine = getConvergenceEngine();

  // Fallback chains for each agent type
  private fallbackChains: Record<AgentId, AgentId[]> = {
    architect: ["analyst", "scout"],
    scout: ["architect", "analyst"],
    analyst: ["architect", "scout"],
    executor: ["architect"]
  };

  /**
   * Initialize all agents (graceful degradation if API keys missing)
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    console.log("🧠 Initializing Neural Intelligence System...\n");

    const agentStatus: Record<string, string> = {};

    // Initialize architect (requires ANTHROPIC_API_KEY)
    try {
      if (process.env.ANTHROPIC_API_KEY) {
        const architect = getArchitect();
        await architect.initialize();
        this.architect = architect;
        agentStatus.architect = "✓ Ready";
      } else {
        agentStatus.architect = "⚠ No API key";
      }
    } catch (error: any) {
      agentStatus.architect = `✗ ${error.message.slice(0, 30)}`;
    }

    // Initialize scout (requires GOOGLE_AI_API_KEY)
    try {
      if (process.env.GOOGLE_AI_API_KEY) {
        const scout = await getScout();
        this.scout = scout;
        agentStatus.scout = "✓ Ready";
      } else {
        agentStatus.scout = "⚠ No API key";
      }
    } catch (error: any) {
      agentStatus.scout = `✗ ${error.message.slice(0, 30)}`;
    }

    // Initialize analyst (requires OPENAI_API_KEY)
    try {
      if (process.env.OPENAI_API_KEY) {
        const analyst = await getAnalyst();
        this.analyst = analyst;
        agentStatus.analyst = "✓ Ready";
      } else {
        agentStatus.analyst = "⚠ No API key";
      }
    } catch (error: any) {
      agentStatus.analyst = `✗ ${error.message.slice(0, 30)}`;
    }

    // Initialize executor (requires MANUS_API_KEY - optional)
    try {
      if (process.env.MANUS_API_KEY) {
        const executor = await getExecutor();
        this.executor = executor;
        agentStatus.executor = "✓ Ready";
      } else {
        agentStatus.executor = "⚠ No API key (optional)";
      }
    } catch (error: any) {
      agentStatus.executor = `✗ ${error.message.slice(0, 30)}`;
    }

    // Check if at least one agent is available
    const hasAgent = this.architect || this.scout || this.analyst;
    if (!hasAgent) {
      throw new Error("No AI agents available. Set at least one API key: ANTHROPIC_API_KEY, GOOGLE_AI_API_KEY, or OPENAI_API_KEY");
    }

    this.initialized = true;

    console.log("╔══════════════════════════════════════════════════════════════════╗");
    console.log("║           NEURAL INTELLIGENCE SYSTEM ONLINE                       ║");
    console.log("╠══════════════════════════════════════════════════════════════════╣");
    console.log(`║  🧠 Architect (Claude)     ${agentStatus.architect.padEnd(38)}║`);
    console.log(`║  👁️  Scout (Gemini)         ${agentStatus.scout.padEnd(38)}║`);
    console.log(`║  📊 Analyst (ChatGPT)      ${agentStatus.analyst.padEnd(38)}║`);
    console.log(`║  ⚡ Executor (Manus)       ${agentStatus.executor.padEnd(38)}║`);
    console.log("╚══════════════════════════════════════════════════════════════════╝\n");
  }

  /**
   * Process a request through the neural system with organic branching
   */
  async process(request: OrchestratorRequest): Promise<OrchestratorResponse> {
    if (!this.initialized) {
      await this.initialize();
    }

    const startTime = Date.now();
    const thoughtPath: string[] = [];
    let allBranches: ThoughtBranch[] = [];
    let allPatterns: Pattern[] = [];
    let convergenceResult: ConvergenceResult | undefined;

    try {
      // Build context with memory
      const context = await this.buildContext(request);

      // Classify intent and determine initial routing
      const intent = this.classifyIntent(request.input);
      thoughtPath.push(`Intent: ${intent.primaryIntent} (${intent.confidence}% confident)`);

      // Determine which agent to use
      const targetAgent = request.forceAgent || intent.suggestedAgent;
      thoughtPath.push(`Routing to: ${targetAgent}`);

      // Create root branch for this thought tree
      const rootBranch = await this.branchManager.createRoot(
        request.tenantId,
        targetAgent,
        request.input,
        {
          sessionId: request.sessionId,
          type: "question",
          confidence: intent.confidence
        }
      );
      thoughtPath.push(`Created thought tree: ${rootBranch.id.slice(0, 8)}`);

      // Build agent request
      const agentRequest: AgentRequest = {
        input: request.input,
        context,
        requiresBranching: intent.confidence < 85
      };

      // Process through selected agent
      let response = await this.routeToAgent(targetAgent, agentRequest);
      thoughtPath.push(`${targetAgent}: ${response.confidence}% confidence`);

      // Create branch for agent's response
      const responseBranch = await this.branchManager.createBranch(
        request.tenantId,
        rootBranch.id,
        targetAgent,
        response.output.substring(0, 500), // Truncate for storage
        {
          sessionId: request.sessionId,
          type: "hypothesis",
          confidence: response.confidence,
          evidence: { agentId: targetAgent }
        }
      );

      // Collect branches and patterns
      if (response.branches) {
        allBranches.push(...response.branches);
      }
      if (response.patterns) {
        allPatterns.push(...response.patterns);
      }

      // Determine decision context for convergence
      const decisionContext = this.buildDecisionContext(request.input, context);

      // Check if we should branch or continue exploring
      let iterations = 0;
      const maxIterations = 3;
      let currentBranchId = responseBranch.id;

      while (!response.shouldConverge && iterations < maxIterations) {
        // Evaluate convergence
        convergenceResult = await this.convergenceEngine.evaluateTree(
          rootBranch.id,
          decisionContext
        );

        thoughtPath.push(`Convergence check: ${convergenceResult.recommendation} (${convergenceResult.confidence}%)`);

        // If converged, we're done
        if (convergenceResult.canConverge) {
          await this.branchManager.updateBranch(currentBranchId, {
            status: "converged",
            confidence: convergenceResult.confidence
          });
          break;
        }

        // Decide whether to branch or continue
        const branchingDecision = this.branchManager.decideBranching(
          response.confidence,
          iterations + 1,
          allBranches.length
        );

        if (!branchingDecision.shouldBranch && !response.suggestedNextAgent) {
          thoughtPath.push(`No more branching: ${branchingDecision.reason}`);
          break;
        }

        iterations++;

        // If agent suggests next agent, follow the chain
        if (response.suggestedNextAgent) {
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

          // Create branch for this agent's response
          const agentBranch = await this.branchManager.createBranch(
            request.tenantId,
            currentBranchId,
            nextAgent,
            response.output.substring(0, 500),
            {
              sessionId: request.sessionId,
              type: response.shouldConverge ? "conclusion" : "observation",
              confidence: response.confidence,
              evidence: { agentId: nextAgent, iteration: iterations }
            }
          );
          currentBranchId = agentBranch.id;

          if (response.branches) {
            allBranches.push(...response.branches);
          }
          if (response.patterns) {
            allPatterns.push(...response.patterns);
          }
        } else if (branchingDecision.shouldBranch) {
          // Create exploration branches
          thoughtPath.push(`Branching: ${branchingDecision.suggestedBranches.length} new paths`);

          for (const suggestion of branchingDecision.suggestedBranches) {
            await this.branchManager.createBranch(
              request.tenantId,
              currentBranchId,
              targetAgent,
              suggestion.focus,
              {
                sessionId: request.sessionId,
                type: suggestion.type,
                confidence: suggestion.estimatedConfidence
              }
            );
          }
          break;
        }
      }

      // Final convergence check
      if (!convergenceResult) {
        convergenceResult = await this.convergenceEngine.evaluateTree(
          rootBranch.id,
          decisionContext
        );
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
        converged: convergenceResult?.canConverge || response.shouldConverge,
        convergenceResult,
        metadata: {
          responseTimeMs: Date.now() - startTime,
          iterations,
          rootBranchId: rootBranch.id,
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
   * Build decision context for convergence evaluation
   */
  private buildDecisionContext(input: string, context: AgentContext): DecisionContext {
    const lowerInput = input.toLowerCase();

    // Detect criticality based on keywords
    let criticality: "low" | "medium" | "high" | "critical" = "medium";

    if (lowerInput.includes("urgent") || lowerInput.includes("emergency") || lowerInput.includes("now")) {
      criticality = "high";
    } else if (lowerInput.includes("critical") || lowerInput.includes("immediate")) {
      criticality = "critical";
    } else if (lowerInput.includes("when possible") || lowerInput.includes("eventually")) {
      criticality = "low";
    }

    // Check for DOT implications
    const hasDOTImplications =
      lowerInput.includes("dot") ||
      lowerInput.includes("hours") ||
      lowerInput.includes("drive") ||
      lowerInput.includes("solo");

    // Check for protected driver mentions
    const hasProtectedDriver =
      lowerInput.includes("protected") ||
      lowerInput.includes("preference") ||
      lowerInput.includes("only works") ||
      lowerInput.includes("can't work");

    // Count affected entities (rough estimate)
    const driverMentions = (input.match(/driver/gi) || []).length;
    const blockMentions = (input.match(/block/gi) || []).length;
    const affectedEntities = Math.max(1, driverMentions + blockMentions);

    return {
      criticality,
      hasDOTImplications,
      hasProtectedDriver,
      affectedEntities,
      isReversible: true // Most dispatch decisions can be undone
    };
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
        if (!this.architect) {
          // Try fallback
          return this.routeToAvailableAgent(request, ["analyst", "scout"]);
        }
        return this.architect.process(request);

      case "scout":
        if (!this.scout) {
          return this.routeToAvailableAgent(request, ["architect", "analyst"]);
        }
        return this.scout.process(request);

      case "analyst":
        if (!this.analyst) {
          return this.routeToAvailableAgent(request, ["architect", "scout"]);
        }
        return this.analyst.process(request);

      case "executor":
        if (!this.executor) {
          return this.routeToAvailableAgent(request, ["architect"]);
        }
        return this.executor.process(request);

      default:
        throw new Error(`Unknown agent: ${agentId}`);
    }
  }

  /**
   * Route to first available agent in fallback list
   */
  private async routeToAvailableAgent(
    request: AgentRequest,
    fallbacks: AgentId[]
  ): Promise<AgentResponse> {
    for (const agentId of fallbacks) {
      const agent = agentId === "architect" ? this.architect :
                    agentId === "scout" ? this.scout :
                    agentId === "analyst" ? this.analyst :
                    this.executor;

      if (agent) {
        return agent.process(request);
      }
    }
    throw new Error("No agents available for request");
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
