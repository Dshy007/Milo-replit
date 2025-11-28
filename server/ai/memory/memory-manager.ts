/**
 * Memory Manager
 *
 * The hippocampus of the Milo Neural Intelligence System.
 * Handles storage, retrieval, and lifecycle of neural memories.
 *
 * Memory Layers:
 * - Immediate: Current session thoughts
 * - Short-term: Last 24 hours
 * - Weekly: Last 7 days (compressed)
 * - Institutional: 6 weeks (high-confidence patterns only)
 */

import { db } from "../../db";
import {
  neuralThoughts,
  neuralPatterns,
  neuralProfiles,
  neuralDecisions,
  neuralRouting
} from "../../../shared/schema";
import { eq, and, gte, lte, desc, sql, or } from "drizzle-orm";

// ═══════════════════════════════════════════════════════════════════════════════
//                              TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface MemoryQuery {
  tenantId: string;
  sessionId?: string;
  entityType?: string;
  entityId?: string;
  patternType?: string;
  minConfidence?: number;
  limit?: number;
  includeExpired?: boolean;
}

export interface ThoughtMemory {
  id: string;
  agentId: string;
  type: string;
  content: string;
  confidence: number;
  status: string;
  createdAt: Date;
  parentId?: string;
}

export interface PatternMemory {
  id: string;
  type: string;
  pattern: string;
  confidence: number;
  observations: number;
  subjectId?: string;
  subjectType?: string;
  lastObserved: Date;
  firstObserved: Date;
}

export interface ProfileMemory {
  id: string;
  entityType: string;
  entityId: string;
  learnedTraits: Record<string, unknown>;
  interactionCount: number;
  lastUpdated: Date;
}

export interface DecisionMemory {
  id: string;
  agentId: string;
  decision: string;
  reasoning: Record<string, unknown>;
  outcome: string;
  createdAt: Date;
}

export interface MemoryContext {
  recentThoughts: ThoughtMemory[];
  relevantPatterns: PatternMemory[];
  entityProfiles: ProfileMemory[];
  pastDecisions: DecisionMemory[];
}

// ═══════════════════════════════════════════════════════════════════════════════
//                              MEMORY MANAGER
// ═══════════════════════════════════════════════════════════════════════════════

export class MemoryManager {
  private static readonly SIX_WEEKS_MS = 42 * 24 * 60 * 60 * 1000;
  private static readonly ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  private static readonly ONE_DAY_MS = 24 * 60 * 60 * 1000;

  /**
   * Get full memory context for a query
   */
  async getMemoryContext(query: MemoryQuery): Promise<MemoryContext> {
    const [recentThoughts, relevantPatterns, entityProfiles, pastDecisions] = await Promise.all([
      this.getRecentThoughts(query),
      this.getRelevantPatterns(query),
      this.getEntityProfiles(query),
      this.getPastDecisions(query)
    ]);

    return {
      recentThoughts,
      relevantPatterns,
      entityProfiles,
      pastDecisions
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //                              THOUGHTS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get recent thoughts from memory
   */
  async getRecentThoughts(query: MemoryQuery): Promise<ThoughtMemory[]> {
    const conditions = [eq(neuralThoughts.tenantId, query.tenantId)];

    if (!query.includeExpired) {
      conditions.push(gte(neuralThoughts.expiresAt, new Date()));
    }

    if (query.sessionId) {
      conditions.push(eq(neuralThoughts.sessionId, query.sessionId));
    }

    const thoughts = await db
      .select({
        id: neuralThoughts.id,
        agentId: neuralThoughts.agentId,
        type: neuralThoughts.thoughtType,
        content: neuralThoughts.content,
        confidence: neuralThoughts.confidence,
        status: neuralThoughts.status,
        createdAt: neuralThoughts.createdAt,
        parentId: neuralThoughts.parentId
      })
      .from(neuralThoughts)
      .where(and(...conditions))
      .orderBy(desc(neuralThoughts.createdAt))
      .limit(query.limit || 50);

    return thoughts.map(t => ({
      ...t,
      parentId: t.parentId || undefined
    }));
  }

  /**
   * Get thought tree (parent and children)
   */
  async getThoughtTree(thoughtId: string): Promise<ThoughtMemory[]> {
    // Get the thought and its children
    const thoughts = await db
      .select({
        id: neuralThoughts.id,
        agentId: neuralThoughts.agentId,
        type: neuralThoughts.thoughtType,
        content: neuralThoughts.content,
        confidence: neuralThoughts.confidence,
        status: neuralThoughts.status,
        createdAt: neuralThoughts.createdAt,
        parentId: neuralThoughts.parentId
      })
      .from(neuralThoughts)
      .where(
        or(
          eq(neuralThoughts.id, thoughtId),
          eq(neuralThoughts.parentId, thoughtId)
        )
      )
      .orderBy(neuralThoughts.createdAt);

    return thoughts.map(t => ({
      ...t,
      parentId: t.parentId || undefined
    }));
  }

  /**
   * Store a new thought
   */
  async storeThought(
    tenantId: string,
    agentId: string,
    thought: {
      type: string;
      content: string;
      confidence: number;
      parentId?: string;
      sessionId?: string;
      evidence?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
    }
  ): Promise<string> {
    const expiresAt = new Date(Date.now() + MemoryManager.SIX_WEEKS_MS);

    const [result] = await db
      .insert(neuralThoughts)
      .values({
        tenantId,
        agentId,
        parentId: thought.parentId || null,
        sessionId: thought.sessionId || null,
        thoughtType: thought.type,
        content: thought.content,
        confidence: thought.confidence,
        status: thought.confidence >= 85 ? "converged" : thought.confidence >= 50 ? "promising" : "exploring",
        evidence: thought.evidence || null,
        metadata: thought.metadata || null,
        expiresAt
      })
      .returning({ id: neuralThoughts.id });

    return result.id;
  }

  /**
   * Update thought status and confidence
   */
  async updateThought(
    thoughtId: string,
    updates: {
      confidence?: number;
      status?: string;
      evidence?: Record<string, unknown>;
    }
  ): Promise<void> {
    await db
      .update(neuralThoughts)
      .set(updates)
      .where(eq(neuralThoughts.id, thoughtId));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //                              PATTERNS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get relevant patterns from memory
   */
  async getRelevantPatterns(query: MemoryQuery): Promise<PatternMemory[]> {
    const conditions = [eq(neuralPatterns.tenantId, query.tenantId)];

    if (!query.includeExpired) {
      conditions.push(gte(neuralPatterns.expiresAt, new Date()));
    }

    if (query.patternType) {
      conditions.push(eq(neuralPatterns.patternType, query.patternType));
    }

    if (query.minConfidence) {
      conditions.push(gte(neuralPatterns.confidence, query.minConfidence));
    }

    if (query.entityId) {
      conditions.push(eq(neuralPatterns.subjectId, query.entityId));
    }

    if (query.entityType) {
      conditions.push(eq(neuralPatterns.subjectType, query.entityType));
    }

    const patterns = await db
      .select({
        id: neuralPatterns.id,
        type: neuralPatterns.patternType,
        pattern: neuralPatterns.pattern,
        confidence: neuralPatterns.confidence,
        observations: neuralPatterns.observations,
        subjectId: neuralPatterns.subjectId,
        subjectType: neuralPatterns.subjectType,
        lastObserved: neuralPatterns.lastObserved,
        firstObserved: neuralPatterns.firstObserved
      })
      .from(neuralPatterns)
      .where(and(...conditions))
      .orderBy(desc(neuralPatterns.confidence), desc(neuralPatterns.observations))
      .limit(query.limit || 20);

    return patterns.map(p => ({
      ...p,
      subjectId: p.subjectId || undefined,
      subjectType: p.subjectType || undefined
    }));
  }

  /**
   * Store or update a pattern
   */
  async recordPattern(
    tenantId: string,
    pattern: {
      type: string;
      pattern: string;
      confidence: number;
      subjectId?: string;
      subjectType?: string;
      evidence?: Record<string, unknown>;
    }
  ): Promise<string> {
    const expiresAt = new Date(Date.now() + MemoryManager.SIX_WEEKS_MS);

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
      // Update existing pattern - strengthen it
      const current = existing[0];
      const newConfidence = Math.min(100, current.confidence + 5);
      const newObservations = current.observations + 1;

      await db
        .update(neuralPatterns)
        .set({
          confidence: newConfidence,
          observations: newObservations,
          lastObserved: new Date(),
          expiresAt, // Refresh expiration
          status: newConfidence >= 80 ? "confirmed" : current.status,
          evidence: pattern.evidence || current.evidence
        })
        .where(eq(neuralPatterns.id, current.id));

      return current.id;
    } else {
      // Create new pattern
      const [result] = await db
        .insert(neuralPatterns)
        .values({
          tenantId,
          patternType: pattern.type,
          pattern: pattern.pattern,
          confidence: pattern.confidence,
          observations: 1,
          subjectId: pattern.subjectId || null,
          subjectType: pattern.subjectType || null,
          evidence: pattern.evidence || null,
          status: "hypothesis",
          expiresAt
        })
        .returning({ id: neuralPatterns.id });

      return result.id;
    }
  }

  /**
   * Weaken a pattern (when it's contradicted)
   */
  async weakenPattern(patternId: string, amount: number = 10): Promise<void> {
    const [pattern] = await db
      .select()
      .from(neuralPatterns)
      .where(eq(neuralPatterns.id, patternId))
      .limit(1);

    if (pattern) {
      const newConfidence = Math.max(0, pattern.confidence - amount);

      await db
        .update(neuralPatterns)
        .set({
          confidence: newConfidence,
          status: newConfidence < 30 ? "deprecated" : pattern.status
        })
        .where(eq(neuralPatterns.id, patternId));
    }
  }

  /**
   * Deprecate a pattern (mark as wrong)
   */
  async deprecatePattern(patternId: string, reason?: string): Promise<void> {
    await db
      .update(neuralPatterns)
      .set({
        status: "deprecated",
        evidence: reason ? { deprecationReason: reason } : undefined
      })
      .where(eq(neuralPatterns.id, patternId));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //                              PROFILES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get entity profiles from memory
   */
  async getEntityProfiles(query: MemoryQuery): Promise<ProfileMemory[]> {
    const conditions = [eq(neuralProfiles.tenantId, query.tenantId)];

    if (!query.includeExpired) {
      conditions.push(gte(neuralProfiles.expiresAt, new Date()));
    }

    if (query.entityType) {
      conditions.push(eq(neuralProfiles.entityType, query.entityType));
    }

    if (query.entityId) {
      conditions.push(eq(neuralProfiles.entityId, query.entityId));
    }

    const profiles = await db
      .select({
        id: neuralProfiles.id,
        entityType: neuralProfiles.entityType,
        entityId: neuralProfiles.entityId,
        learnedTraits: neuralProfiles.learnedTraits,
        interactionCount: neuralProfiles.interactionCount,
        lastUpdated: neuralProfiles.lastUpdated
      })
      .from(neuralProfiles)
      .where(and(...conditions))
      .orderBy(desc(neuralProfiles.interactionCount))
      .limit(query.limit || 10);

    return profiles.map(p => ({
      ...p,
      learnedTraits: p.learnedTraits as Record<string, unknown>
    }));
  }

  /**
   * Get or create a profile for an entity
   */
  async getOrCreateProfile(
    tenantId: string,
    entityType: string,
    entityId: string
  ): Promise<ProfileMemory> {
    const existing = await db
      .select()
      .from(neuralProfiles)
      .where(
        and(
          eq(neuralProfiles.tenantId, tenantId),
          eq(neuralProfiles.entityType, entityType),
          eq(neuralProfiles.entityId, entityId)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      return {
        id: existing[0].id,
        entityType: existing[0].entityType,
        entityId: existing[0].entityId,
        learnedTraits: existing[0].learnedTraits as Record<string, unknown>,
        interactionCount: existing[0].interactionCount,
        lastUpdated: existing[0].lastUpdated
      };
    }

    // Create new profile
    const expiresAt = new Date(Date.now() + MemoryManager.SIX_WEEKS_MS);

    const [result] = await db
      .insert(neuralProfiles)
      .values({
        tenantId,
        entityType,
        entityId,
        learnedTraits: {},
        interactionCount: 0,
        expiresAt
      })
      .returning();

    return {
      id: result.id,
      entityType: result.entityType,
      entityId: result.entityId,
      learnedTraits: result.learnedTraits as Record<string, unknown>,
      interactionCount: result.interactionCount,
      lastUpdated: result.lastUpdated
    };
  }

  /**
   * Update a profile with new traits
   */
  async updateProfile(
    profileId: string,
    traits: Record<string, unknown>,
    merge: boolean = true
  ): Promise<void> {
    const expiresAt = new Date(Date.now() + MemoryManager.SIX_WEEKS_MS);

    if (merge) {
      // Get existing traits and merge
      const [existing] = await db
        .select()
        .from(neuralProfiles)
        .where(eq(neuralProfiles.id, profileId))
        .limit(1);

      if (existing) {
        const mergedTraits = {
          ...(existing.learnedTraits as Record<string, unknown>),
          ...traits
        };

        await db
          .update(neuralProfiles)
          .set({
            learnedTraits: mergedTraits,
            interactionCount: existing.interactionCount + 1,
            lastUpdated: new Date(),
            expiresAt
          })
          .where(eq(neuralProfiles.id, profileId));
      }
    } else {
      await db
        .update(neuralProfiles)
        .set({
          learnedTraits: traits,
          lastUpdated: new Date(),
          expiresAt
        })
        .where(eq(neuralProfiles.id, profileId));
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //                              DECISIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get past decisions from memory
   */
  async getPastDecisions(query: MemoryQuery): Promise<DecisionMemory[]> {
    const conditions = [eq(neuralDecisions.tenantId, query.tenantId)];

    if (query.sessionId) {
      conditions.push(eq(neuralDecisions.sessionId, query.sessionId));
    }

    const decisions = await db
      .select({
        id: neuralDecisions.id,
        agentId: neuralDecisions.agentId,
        decision: neuralDecisions.decision,
        reasoning: neuralDecisions.reasoning,
        outcome: neuralDecisions.outcome,
        createdAt: neuralDecisions.createdAt
      })
      .from(neuralDecisions)
      .where(and(...conditions))
      .orderBy(desc(neuralDecisions.createdAt))
      .limit(query.limit || 20);

    return decisions.map(d => ({
      ...d,
      reasoning: d.reasoning as Record<string, unknown>
    }));
  }

  /**
   * Record a decision
   */
  async recordDecision(
    tenantId: string,
    agentId: string,
    decision: {
      decision: string;
      reasoning: Record<string, unknown>;
      sessionId?: string;
      thoughtId?: string;
      actionTaken?: Record<string, unknown>;
      dotStatus?: string;
      protectedRuleCheck?: Record<string, unknown>;
    }
  ): Promise<string> {
    const [result] = await db
      .insert(neuralDecisions)
      .values({
        tenantId,
        agentId,
        sessionId: decision.sessionId || null,
        thoughtId: decision.thoughtId || null,
        decision: decision.decision,
        reasoning: decision.reasoning,
        actionTaken: decision.actionTaken || null,
        dotStatus: decision.dotStatus || null,
        protectedRuleCheck: decision.protectedRuleCheck || null,
        outcome: "pending"
      })
      .returning({ id: neuralDecisions.id });

    return result.id;
  }

  /**
   * Update decision outcome
   */
  async updateDecisionOutcome(
    decisionId: string,
    outcome: "success" | "partial" | "failed",
    notes?: string,
    userFeedback?: string
  ): Promise<void> {
    await db
      .update(neuralDecisions)
      .set({
        outcome,
        outcomeNotes: notes || null,
        userFeedback: userFeedback || null
      })
      .where(eq(neuralDecisions.id, decisionId));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //                              CLEANUP
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Clean up expired memories
   */
  async cleanupExpiredMemories(): Promise<{
    thoughts: number;
    patterns: number;
    profiles: number;
  }> {
    const now = new Date();

    // Delete expired thoughts
    const thoughtsResult = await db
      .delete(neuralThoughts)
      .where(lte(neuralThoughts.expiresAt, now))
      .returning({ id: neuralThoughts.id });

    // Delete expired patterns (except confirmed ones with high confidence)
    const patternsResult = await db
      .delete(neuralPatterns)
      .where(
        and(
          lte(neuralPatterns.expiresAt, now),
          or(
            sql`${neuralPatterns.status} != 'confirmed'`,
            lte(neuralPatterns.confidence, 70)
          )
        )
      )
      .returning({ id: neuralPatterns.id });

    // Delete expired profiles
    const profilesResult = await db
      .delete(neuralProfiles)
      .where(lte(neuralProfiles.expiresAt, now))
      .returning({ id: neuralProfiles.id });

    return {
      thoughts: thoughtsResult.length,
      patterns: patternsResult.length,
      profiles: profilesResult.length
    };
  }

  /**
   * Get memory statistics
   */
  async getMemoryStats(tenantId: string): Promise<{
    totalThoughts: number;
    totalPatterns: number;
    totalProfiles: number;
    totalDecisions: number;
    confirmedPatterns: number;
    avgPatternConfidence: number;
  }> {
    const [thoughtCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(neuralThoughts)
      .where(eq(neuralThoughts.tenantId, tenantId));

    const [patternCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(neuralPatterns)
      .where(eq(neuralPatterns.tenantId, tenantId));

    const [confirmedCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(neuralPatterns)
      .where(
        and(
          eq(neuralPatterns.tenantId, tenantId),
          eq(neuralPatterns.status, "confirmed")
        )
      );

    const [avgConfidence] = await db
      .select({ avg: sql<number>`avg(${neuralPatterns.confidence})` })
      .from(neuralPatterns)
      .where(eq(neuralPatterns.tenantId, tenantId));

    const [profileCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(neuralProfiles)
      .where(eq(neuralProfiles.tenantId, tenantId));

    const [decisionCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(neuralDecisions)
      .where(eq(neuralDecisions.tenantId, tenantId));

    return {
      totalThoughts: Number(thoughtCount.count) || 0,
      totalPatterns: Number(patternCount.count) || 0,
      totalProfiles: Number(profileCount.count) || 0,
      totalDecisions: Number(decisionCount.count) || 0,
      confirmedPatterns: Number(confirmedCount.count) || 0,
      avgPatternConfidence: Math.round(Number(avgConfidence.avg) || 0)
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//                              SINGLETON
// ═══════════════════════════════════════════════════════════════════════════════

let memoryManagerInstance: MemoryManager | null = null;

export function getMemoryManager(): MemoryManager {
  if (!memoryManagerInstance) {
    memoryManagerInstance = new MemoryManager();
  }
  return memoryManagerInstance;
}
