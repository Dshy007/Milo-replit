/**
 * Base Agent Interface
 *
 * All neural agents (Architect, Scout, Analyst, Executor) implement this interface.
 * Defines the contract for how agents communicate within the Milo Neural Intelligence System.
 */

import { db } from "../../db";
import { neuralAgents, neuralThoughts, neuralDecisions, neuralRouting } from "../../../shared/schema";
import { eq } from "drizzle-orm";

// ═══════════════════════════════════════════════════════════════════════════════
//                              TYPE DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════════

export type AgentId = "architect" | "scout" | "analyst" | "executor";

export type ThoughtType = "question" | "hypothesis" | "observation" | "conclusion" | "action";

export type ThoughtStatus = "exploring" | "promising" | "converged" | "ruled_out";

export type AgentStatus = "active" | "degraded" | "offline";

export interface AgentConfig {
  temperature: number;
  maxTokens: number;
  timeout: number;
  requiresApproval?: boolean;
}

export interface ThoughtBranch {
  id: string;
  parentId: string | null;
  agentId: AgentId;
  type: ThoughtType;
  content: string;
  confidence: number;
  status: ThoughtStatus;
  evidence?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  children: ThoughtBranch[];
}

export interface AgentContext {
  tenantId: string;
  sessionId?: string;
  userId?: string;
  conversationHistory?: Message[];
  currentThoughts?: ThoughtBranch[];
  patterns?: Pattern[];
  profiles?: EntityProfile[];
}

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: Date;
}

export interface Pattern {
  id: string;
  type: string;
  pattern: string;
  confidence: number;
  observations: number;
  subjectId?: string;
  subjectType?: string;
}

export interface EntityProfile {
  entityType: string;
  entityId: string;
  learnedTraits: Record<string, unknown>;
  interactionCount: number;
}

export interface AgentRequest {
  input: string;
  context: AgentContext;
  parentThoughtId?: string;
  requiresBranching?: boolean;
}

export interface AgentResponse {
  output: string;
  confidence: number;
  thoughtId: string;
  branches?: ThoughtBranch[];
  suggestedNextAgent?: AgentId;
  patterns?: Pattern[];
  shouldConverge: boolean;
  metadata?: Record<string, unknown>;
}

export interface DOTStatus {
  status: "valid" | "warning" | "violation";
  hoursUsed: number;
  maxHours: number;
  windowHours: number;
  message: string;
}

export interface ProtectedRuleCheck {
  passed: boolean;
  violations: string[];
  warnings: string[];
}

// ═══════════════════════════════════════════════════════════════════════════════
//                              BASE AGENT CLASS
// ═══════════════════════════════════════════════════════════════════════════════

export abstract class BaseAgent {
  protected agentId: AgentId;
  protected displayName: string;
  protected provider: string;
  protected model: string;
  protected systemPrompt: string;
  protected capabilities: string[];
  protected config: AgentConfig;
  protected status: AgentStatus = "active";

  constructor(agentId: AgentId) {
    this.agentId = agentId;
    this.displayName = "";
    this.provider = "";
    this.model = "";
    this.systemPrompt = "";
    this.capabilities = [];
    this.config = {
      temperature: 0.7,
      maxTokens: 2048,
      timeout: 30000
    };
  }

  /**
   * Initialize agent from database configuration
   */
  async initialize(): Promise<void> {
    const [agent] = await db
      .select()
      .from(neuralAgents)
      .where(eq(neuralAgents.id, this.agentId))
      .limit(1);

    if (!agent) {
      throw new Error(`Agent ${this.agentId} not found in database`);
    }

    this.displayName = agent.displayName;
    this.provider = agent.provider;
    this.model = agent.model;
    this.systemPrompt = agent.systemPrompt;
    this.capabilities = agent.capabilities || [];
    this.status = agent.status as AgentStatus;

    if (agent.config) {
      this.config = {
        ...this.config,
        ...(agent.config as Partial<AgentConfig>)
      };
    }
  }

  /**
   * Process a request - must be implemented by each agent
   */
  abstract process(request: AgentRequest): Promise<AgentResponse>;

  /**
   * Check if this agent can handle the given input
   */
  abstract canHandle(input: string, context: AgentContext): boolean;

  /**
   * Get the agent's current health status
   */
  getStatus(): AgentStatus {
    return this.status;
  }

  /**
   * Get agent capabilities
   */
  getCapabilities(): string[] {
    return this.capabilities;
  }

  /**
   * Create a new thought branch
   */
  protected async createThought(
    tenantId: string,
    type: ThoughtType,
    content: string,
    confidence: number,
    options: {
      parentId?: string;
      sessionId?: string;
      evidence?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
    } = {}
  ): Promise<string> {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 42); // 6 weeks

    const [thought] = await db
      .insert(neuralThoughts)
      .values({
        tenantId,
        parentId: options.parentId || null,
        agentId: this.agentId,
        sessionId: options.sessionId || null,
        thoughtType: type,
        content,
        confidence,
        status: confidence >= 85 ? "converged" : confidence >= 50 ? "promising" : "exploring",
        evidence: options.evidence || null,
        metadata: options.metadata || null,
        expiresAt
      })
      .returning({ id: neuralThoughts.id });

    return thought.id;
  }

  /**
   * Update thought confidence and status
   */
  protected async updateThought(
    thoughtId: string,
    updates: {
      confidence?: number;
      status?: ThoughtStatus;
      evidence?: Record<string, unknown>;
    }
  ): Promise<void> {
    const updateData: Record<string, unknown> = {};

    if (updates.confidence !== undefined) {
      updateData.confidence = updates.confidence;
    }
    if (updates.status) {
      updateData.status = updates.status;
    }
    if (updates.evidence) {
      updateData.evidence = updates.evidence;
    }

    await db
      .update(neuralThoughts)
      .set(updateData)
      .where(eq(neuralThoughts.id, thoughtId));
  }

  /**
   * Record a decision for audit trail
   */
  protected async recordDecision(
    tenantId: string,
    decision: string,
    reasoning: Record<string, unknown>,
    options: {
      sessionId?: string;
      thoughtId?: string;
      actionTaken?: Record<string, unknown>;
      dotStatus?: DOTStatus;
      protectedRuleCheck?: ProtectedRuleCheck;
    } = {}
  ): Promise<string> {
    const [record] = await db
      .insert(neuralDecisions)
      .values({
        tenantId,
        sessionId: options.sessionId || null,
        thoughtId: options.thoughtId || null,
        agentId: this.agentId,
        decision,
        reasoning,
        actionTaken: options.actionTaken || null,
        dotStatus: options.dotStatus?.status || null,
        protectedRuleCheck: options.protectedRuleCheck || null,
        outcome: "pending"
      })
      .returning({ id: neuralDecisions.id });

    return record.id;
  }

  /**
   * Log routing information
   */
  protected async logRouting(
    tenantId: string,
    userInput: string,
    intent: string,
    reason: string,
    options: {
      sessionId?: string;
      fallbackChain?: AgentId[];
      responseTimeMs?: number;
      success?: boolean;
      errorMessage?: string;
    } = {}
  ): Promise<void> {
    await db.insert(neuralRouting).values({
      tenantId,
      sessionId: options.sessionId || null,
      userInput,
      detectedIntent: intent,
      routedTo: this.agentId,
      routingReason: reason,
      fallbackChain: options.fallbackChain || null,
      responseTimeMs: options.responseTimeMs || null,
      success: options.success ?? true,
      errorMessage: options.errorMessage || null
    });
  }

  /**
   * Determine if confidence is high enough to converge
   */
  protected shouldConverge(confidence: number): boolean {
    return confidence >= 85;
  }

  /**
   * Format the system prompt with current context
   */
  protected formatSystemPrompt(context: AgentContext): string {
    let prompt = this.systemPrompt;

    // Add any active patterns to context
    if (context.patterns && context.patterns.length > 0) {
      const highConfidencePatterns = context.patterns
        .filter(p => p.confidence >= 70)
        .slice(0, 10);

      if (highConfidencePatterns.length > 0) {
        prompt += "\n\n## ACTIVE PATTERNS FROM MEMORY\n";
        for (const pattern of highConfidencePatterns) {
          prompt += `- ${pattern.pattern} (confidence: ${pattern.confidence}%, observed ${pattern.observations} times)\n`;
        }
      }
    }

    // Add relevant entity profiles
    if (context.profiles && context.profiles.length > 0) {
      prompt += "\n\n## ENTITY KNOWLEDGE\n";
      for (const profile of context.profiles.slice(0, 5)) {
        prompt += `- ${profile.entityType}[${profile.entityId}]: ${JSON.stringify(profile.learnedTraits)}\n`;
      }
    }

    return prompt;
  }

  /**
   * Build conversation messages for API call
   */
  protected buildMessages(request: AgentRequest): Message[] {
    const messages: Message[] = [
      { role: "system", content: this.formatSystemPrompt(request.context) }
    ];

    // Add conversation history if available
    if (request.context.conversationHistory) {
      messages.push(...request.context.conversationHistory);
    }

    // Add the current input
    messages.push({
      role: "user",
      content: request.input
    });

    return messages;
  }

  /**
   * Extract confidence from response (to be overridden by implementations)
   */
  protected extractConfidence(response: string): number {
    // Default implementation: look for confidence indicators
    const lowConfidenceIndicators = [
      "i don't know",
      "i'm not sure",
      "uncertain",
      "exploring",
      "might be",
      "could be",
      "possibly"
    ];

    const highConfidenceIndicators = [
      "i'm confident",
      "definitely",
      "certainly",
      "recommend",
      "should",
      "based on the data"
    ];

    const lowerResponse = response.toLowerCase();

    let confidence = 50; // Base confidence

    for (const indicator of lowConfidenceIndicators) {
      if (lowerResponse.includes(indicator)) {
        confidence -= 15;
      }
    }

    for (const indicator of highConfidenceIndicators) {
      if (lowerResponse.includes(indicator)) {
        confidence += 15;
      }
    }

    return Math.max(0, Math.min(100, confidence));
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//                              AGENT REGISTRY
// ═══════════════════════════════════════════════════════════════════════════════

export class AgentRegistry {
  private static instance: AgentRegistry;
  private agents: Map<AgentId, BaseAgent> = new Map();

  private constructor() {}

  static getInstance(): AgentRegistry {
    if (!AgentRegistry.instance) {
      AgentRegistry.instance = new AgentRegistry();
    }
    return AgentRegistry.instance;
  }

  register(agent: BaseAgent): void {
    this.agents.set(agent["agentId"], agent);
  }

  get(agentId: AgentId): BaseAgent | undefined {
    return this.agents.get(agentId);
  }

  getAll(): BaseAgent[] {
    return Array.from(this.agents.values());
  }

  async initializeAll(): Promise<void> {
    for (const agent of this.agents.values()) {
      await agent.initialize();
    }
  }
}
