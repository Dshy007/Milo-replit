/**
 * Branch Manager
 *
 * Manages the organic branching thought process of the Neural Intelligence System.
 * Creates, tracks, and navigates thought trees that grow like neural veins.
 *
 * "Each branch explores a possibility. Only the confident ones converge."
 */

import { db } from "../../db";
import { neuralThoughts } from "../../../shared/schema";
import { eq, and, desc, isNull } from "drizzle-orm";
import { AgentId } from "../agents/base-agent";

// ═══════════════════════════════════════════════════════════════════════════════
//                              TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type BranchStatus = "exploring" | "promising" | "converged" | "ruled_out" | "merged";

export type BranchType = "question" | "hypothesis" | "observation" | "conclusion" | "action";

export interface Branch {
  id: string;
  parentId: string | null;
  agentId: AgentId;
  type: BranchType;
  content: string;
  confidence: number;
  status: BranchStatus;
  depth: number;
  children: Branch[];
  evidence?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export interface BranchTree {
  rootId: string;
  tenantId: string;
  sessionId?: string;
  branches: Map<string, Branch>;
  maxDepth: number;
  totalBranches: number;
  convergencePath: string[];
}

export interface BranchingDecision {
  shouldBranch: boolean;
  suggestedBranches: {
    type: BranchType;
    focus: string;
    estimatedConfidence: number;
  }[];
  reason: string;
}

export interface BranchEvaluation {
  branchId: string;
  score: number;
  factors: {
    name: string;
    weight: number;
    value: number;
    contribution: number;
  }[];
  recommendation: "explore" | "promising" | "converge" | "prune";
}

// ═══════════════════════════════════════════════════════════════════════════════
//                              BRANCH MANAGER
// ═══════════════════════════════════════════════════════════════════════════════

export class BranchManager {
  private static readonly MAX_DEPTH = 5;
  private static readonly MAX_BRANCHES_PER_PARENT = 4;
  private static readonly CONVERGENCE_THRESHOLD = 85;

  /**
   * Create a new root branch (start of a thought tree)
   */
  async createRoot(
    tenantId: string,
    agentId: AgentId,
    content: string,
    options: {
      sessionId?: string;
      type?: BranchType;
      confidence?: number;
      evidence?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
    } = {}
  ): Promise<Branch> {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 42); // 6 weeks

    const [result] = await db
      .insert(neuralThoughts)
      .values({
        tenantId,
        parentId: null,
        agentId,
        sessionId: options.sessionId || null,
        thoughtType: options.type || "question",
        content,
        confidence: options.confidence || 0,
        status: "exploring",
        evidence: options.evidence || null,
        metadata: { ...options.metadata, depth: 0, isRoot: true },
        expiresAt
      })
      .returning();

    return {
      id: result.id,
      parentId: null,
      agentId: agentId,
      type: (result.thoughtType as BranchType) || "question",
      content: result.content,
      confidence: result.confidence,
      status: result.status as BranchStatus,
      depth: 0,
      children: [],
      evidence: result.evidence as Record<string, unknown> | undefined,
      metadata: result.metadata as Record<string, unknown> | undefined,
      createdAt: result.createdAt
    };
  }

  /**
   * Create a child branch
   */
  async createBranch(
    tenantId: string,
    parentId: string,
    agentId: AgentId,
    content: string,
    options: {
      sessionId?: string;
      type?: BranchType;
      confidence?: number;
      evidence?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
    } = {}
  ): Promise<Branch> {
    // Get parent to determine depth
    const [parent] = await db
      .select()
      .from(neuralThoughts)
      .where(eq(neuralThoughts.id, parentId))
      .limit(1);

    if (!parent) {
      throw new Error(`Parent branch ${parentId} not found`);
    }

    const parentMeta = parent.metadata as Record<string, unknown> || {};
    const parentDepth = (parentMeta.depth as number) || 0;
    const newDepth = parentDepth + 1;

    // Check depth limit
    if (newDepth > BranchManager.MAX_DEPTH) {
      throw new Error(`Maximum branch depth (${BranchManager.MAX_DEPTH}) exceeded`);
    }

    // Check sibling limit
    const siblingCount = await this.getSiblingCount(parentId);
    if (siblingCount >= BranchManager.MAX_BRANCHES_PER_PARENT) {
      throw new Error(`Maximum branches per parent (${BranchManager.MAX_BRANCHES_PER_PARENT}) exceeded`);
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 42);

    const [result] = await db
      .insert(neuralThoughts)
      .values({
        tenantId,
        parentId,
        agentId,
        sessionId: options.sessionId || parent.sessionId,
        thoughtType: options.type || "hypothesis",
        content,
        confidence: options.confidence || 0,
        status: "exploring",
        evidence: options.evidence || null,
        metadata: { ...options.metadata, depth: newDepth },
        expiresAt
      })
      .returning();

    return {
      id: result.id,
      parentId,
      agentId: agentId,
      type: (result.thoughtType as BranchType) || "hypothesis",
      content: result.content,
      confidence: result.confidence,
      status: result.status as BranchStatus,
      depth: newDepth,
      children: [],
      evidence: result.evidence as Record<string, unknown> | undefined,
      metadata: result.metadata as Record<string, unknown> | undefined,
      createdAt: result.createdAt
    };
  }

  /**
   * Get the full branch tree for a root
   */
  async getTree(rootId: string): Promise<BranchTree | null> {
    // Get the root
    const [root] = await db
      .select()
      .from(neuralThoughts)
      .where(eq(neuralThoughts.id, rootId))
      .limit(1);

    if (!root) return null;

    // Get all descendants
    const allBranches = await this.getAllDescendants(rootId);
    allBranches.unshift(root); // Add root to the list

    // Build the tree structure
    const branchMap = new Map<string, Branch>();
    let maxDepth = 0;

    // First pass: create all branch objects
    for (const b of allBranches) {
      const meta = b.metadata as Record<string, unknown> || {};
      const depth = (meta.depth as number) || 0;
      maxDepth = Math.max(maxDepth, depth);

      branchMap.set(b.id, {
        id: b.id,
        parentId: b.parentId,
        agentId: b.agentId as AgentId,
        type: b.thoughtType as BranchType,
        content: b.content,
        confidence: b.confidence,
        status: b.status as BranchStatus,
        depth,
        children: [],
        evidence: b.evidence as Record<string, unknown> | undefined,
        metadata: meta,
        createdAt: b.createdAt
      });
    }

    // Second pass: build parent-child relationships
    for (const branch of branchMap.values()) {
      if (branch.parentId) {
        const parent = branchMap.get(branch.parentId);
        if (parent) {
          parent.children.push(branch);
        }
      }
    }

    // Find convergence path (highest confidence path to a converged branch)
    const convergencePath = this.findConvergencePath(branchMap, rootId);

    return {
      rootId,
      tenantId: root.tenantId,
      sessionId: root.sessionId || undefined,
      branches: branchMap,
      maxDepth,
      totalBranches: branchMap.size,
      convergencePath
    };
  }

  /**
   * Update branch status and confidence
   */
  async updateBranch(
    branchId: string,
    updates: {
      confidence?: number;
      status?: BranchStatus;
      content?: string;
      evidence?: Record<string, unknown>;
    }
  ): Promise<Branch> {
    const updateData: Record<string, unknown> = {};

    if (updates.confidence !== undefined) {
      updateData.confidence = updates.confidence;
      // Auto-update status based on confidence
      if (updates.confidence >= BranchManager.CONVERGENCE_THRESHOLD) {
        updateData.status = "converged";
      } else if (updates.confidence >= 50) {
        updateData.status = "promising";
      }
    }

    if (updates.status) {
      updateData.status = updates.status;
    }

    if (updates.content) {
      updateData.content = updates.content;
    }

    if (updates.evidence) {
      updateData.evidence = updates.evidence;
    }

    const [result] = await db
      .update(neuralThoughts)
      .set(updateData)
      .where(eq(neuralThoughts.id, branchId))
      .returning();

    const meta = result.metadata as Record<string, unknown> || {};

    return {
      id: result.id,
      parentId: result.parentId,
      agentId: result.agentId as AgentId,
      type: result.thoughtType as BranchType,
      content: result.content,
      confidence: result.confidence,
      status: result.status as BranchStatus,
      depth: (meta.depth as number) || 0,
      children: [],
      evidence: result.evidence as Record<string, unknown> | undefined,
      metadata: meta,
      createdAt: result.createdAt
    };
  }

  /**
   * Prune a branch (mark as ruled out)
   */
  async pruneBranch(branchId: string, reason?: string): Promise<void> {
    await db
      .update(neuralThoughts)
      .set({
        status: "ruled_out",
        metadata: { prunedAt: new Date().toISOString(), pruneReason: reason }
      })
      .where(eq(neuralThoughts.id, branchId));

    // Also prune all descendants
    const descendants = await this.getAllDescendants(branchId);
    for (const d of descendants) {
      await db
        .update(neuralThoughts)
        .set({
          status: "ruled_out",
          metadata: { prunedAt: new Date().toISOString(), pruneReason: "Parent pruned" }
        })
        .where(eq(neuralThoughts.id, d.id));
    }
  }

  /**
   * Merge branches (combine insights from multiple branches)
   */
  async mergeBranches(
    tenantId: string,
    branchIds: string[],
    agentId: AgentId,
    mergedContent: string,
    options: {
      sessionId?: string;
      confidence?: number;
    } = {}
  ): Promise<Branch> {
    // Get all branches to merge
    const branches: Branch[] = [];
    let commonParentId: string | null = null;

    for (const id of branchIds) {
      const [branch] = await db
        .select()
        .from(neuralThoughts)
        .where(eq(neuralThoughts.id, id))
        .limit(1);

      if (branch) {
        const meta = branch.metadata as Record<string, unknown> || {};
        branches.push({
          id: branch.id,
          parentId: branch.parentId,
          agentId: branch.agentId as AgentId,
          type: branch.thoughtType as BranchType,
          content: branch.content,
          confidence: branch.confidence,
          status: branch.status as BranchStatus,
          depth: (meta.depth as number) || 0,
          children: [],
          evidence: branch.evidence as Record<string, unknown> | undefined,
          metadata: meta,
          createdAt: branch.createdAt
        });

        if (!commonParentId) {
          commonParentId = branch.parentId;
        }
      }
    }

    if (branches.length === 0) {
      throw new Error("No valid branches to merge");
    }

    // Calculate merged confidence (weighted average)
    const totalConfidence = branches.reduce((sum, b) => sum + b.confidence, 0);
    const avgConfidence = options.confidence || Math.round(totalConfidence / branches.length);

    // Create merged branch
    const mergedBranch = await this.createBranch(
      tenantId,
      commonParentId || branches[0].id,
      agentId,
      mergedContent,
      {
        sessionId: options.sessionId,
        type: "conclusion",
        confidence: avgConfidence,
        evidence: {
          mergedFrom: branchIds,
          originalConfidences: branches.map(b => ({ id: b.id, confidence: b.confidence }))
        }
      }
    );

    // Mark original branches as merged
    for (const branch of branches) {
      await db
        .update(neuralThoughts)
        .set({
          status: "merged",
          metadata: { mergedInto: mergedBranch.id, mergedAt: new Date().toISOString() }
        })
        .where(eq(neuralThoughts.id, branch.id));
    }

    return mergedBranch;
  }

  /**
   * Decide whether to branch based on current state
   */
  decideBranching(
    currentConfidence: number,
    depth: number,
    existingBranches: number
  ): BranchingDecision {
    // Don't branch if already confident enough
    if (currentConfidence >= BranchManager.CONVERGENCE_THRESHOLD) {
      return {
        shouldBranch: false,
        suggestedBranches: [],
        reason: `Confidence ${currentConfidence}% is above threshold (${BranchManager.CONVERGENCE_THRESHOLD}%)`
      };
    }

    // Don't branch if at max depth
    if (depth >= BranchManager.MAX_DEPTH) {
      return {
        shouldBranch: false,
        suggestedBranches: [],
        reason: `Maximum depth (${BranchManager.MAX_DEPTH}) reached`
      };
    }

    // Don't branch if already have max branches
    if (existingBranches >= BranchManager.MAX_BRANCHES_PER_PARENT) {
      return {
        shouldBranch: false,
        suggestedBranches: [],
        reason: `Maximum branches per parent (${BranchManager.MAX_BRANCHES_PER_PARENT}) reached`
      };
    }

    // Calculate how many branches to suggest based on confidence gap
    const confidenceGap = BranchManager.CONVERGENCE_THRESHOLD - currentConfidence;
    let suggestedCount = 1;

    if (confidenceGap > 60) {
      suggestedCount = 3; // Very uncertain - explore multiple paths
    } else if (confidenceGap > 30) {
      suggestedCount = 2; // Moderately uncertain
    }

    const suggestedBranches: BranchingDecision["suggestedBranches"] = [];

    // Suggest different types of branches based on depth
    if (depth === 0) {
      // At root, branch into different aspects
      suggestedBranches.push(
        { type: "hypothesis", focus: "Driver analysis", estimatedConfidence: 30 },
        { type: "hypothesis", focus: "Block analysis", estimatedConfidence: 30 },
        { type: "observation", focus: "Constraint check", estimatedConfidence: 40 }
      );
    } else if (depth === 1) {
      // At first level, get more specific
      suggestedBranches.push(
        { type: "hypothesis", focus: "Specific option 1", estimatedConfidence: 45 },
        { type: "hypothesis", focus: "Specific option 2", estimatedConfidence: 45 }
      );
    } else {
      // Deeper levels, focus on verification
      suggestedBranches.push(
        { type: "observation", focus: "Verify constraints", estimatedConfidence: 60 },
        { type: "conclusion", focus: "Synthesize findings", estimatedConfidence: 70 }
      );
    }

    return {
      shouldBranch: true,
      suggestedBranches: suggestedBranches.slice(0, suggestedCount),
      reason: `Confidence gap of ${confidenceGap}% suggests branching to explore possibilities`
    };
  }

  /**
   * Get the best path through the tree (highest confidence path)
   */
  async getBestPath(rootId: string): Promise<Branch[]> {
    const tree = await this.getTree(rootId);
    if (!tree) return [];

    const path: Branch[] = [];
    let currentId = rootId;

    while (currentId) {
      const branch = tree.branches.get(currentId);
      if (!branch) break;

      path.push(branch);

      // Find best child
      if (branch.children.length === 0) break;

      const activeBranches = branch.children.filter(
        c => c.status !== "ruled_out" && c.status !== "merged"
      );

      if (activeBranches.length === 0) break;

      // Pick highest confidence child
      const bestChild = activeBranches.reduce((best, current) =>
        current.confidence > best.confidence ? current : best
      );

      currentId = bestChild.id;
    }

    return path;
  }

  /**
   * Get all root branches for a session
   */
  async getSessionRoots(tenantId: string, sessionId: string): Promise<Branch[]> {
    const roots = await db
      .select()
      .from(neuralThoughts)
      .where(
        and(
          eq(neuralThoughts.tenantId, tenantId),
          eq(neuralThoughts.sessionId, sessionId),
          isNull(neuralThoughts.parentId)
        )
      )
      .orderBy(desc(neuralThoughts.createdAt));

    return roots.map(r => {
      const meta = r.metadata as Record<string, unknown> || {};
      return {
        id: r.id,
        parentId: null,
        agentId: r.agentId as AgentId,
        type: r.thoughtType as BranchType,
        content: r.content,
        confidence: r.confidence,
        status: r.status as BranchStatus,
        depth: 0,
        children: [],
        evidence: r.evidence as Record<string, unknown> | undefined,
        metadata: meta,
        createdAt: r.createdAt
      };
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //                              PRIVATE METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  private async getSiblingCount(parentId: string): Promise<number> {
    const siblings = await db
      .select()
      .from(neuralThoughts)
      .where(eq(neuralThoughts.parentId, parentId));

    return siblings.length;
  }

  private async getAllDescendants(branchId: string): Promise<typeof neuralThoughts.$inferSelect[]> {
    const descendants: typeof neuralThoughts.$inferSelect[] = [];

    const children = await db
      .select()
      .from(neuralThoughts)
      .where(eq(neuralThoughts.parentId, branchId));

    for (const child of children) {
      descendants.push(child);
      const childDescendants = await this.getAllDescendants(child.id);
      descendants.push(...childDescendants);
    }

    return descendants;
  }

  private findConvergencePath(branches: Map<string, Branch>, rootId: string): string[] {
    const path: string[] = [];

    // Find the converged branch with highest confidence
    let bestConverged: Branch | null = null;
    for (const branch of branches.values()) {
      if (branch.status === "converged") {
        if (!bestConverged || branch.confidence > bestConverged.confidence) {
          bestConverged = branch;
        }
      }
    }

    if (!bestConverged) return [];

    // Trace path back to root
    let current: Branch | undefined = bestConverged;
    while (current) {
      path.unshift(current.id);
      if (current.parentId) {
        current = branches.get(current.parentId);
      } else {
        break;
      }
    }

    return path;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//                              SINGLETON
// ═══════════════════════════════════════════════════════════════════════════════

let branchManagerInstance: BranchManager | null = null;

export function getBranchManager(): BranchManager {
  if (!branchManagerInstance) {
    branchManagerInstance = new BranchManager();
  }
  return branchManagerInstance;
}
