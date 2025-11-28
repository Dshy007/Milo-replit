/**
 * Convergence Engine
 *
 * Determines when branching thoughts have reached sufficient confidence to converge
 * into a decision. Uses adaptive thresholds based on decision criticality.
 *
 * "Like rivers finding the sea, thoughts flow toward certainty."
 */

import { Branch, BranchTree, BranchStatus, getBranchManager } from "./branch-manager";
import { ConfidenceScore, getConfidenceCalculator } from "./confidence-calc";
import { AgentId } from "../agents/base-agent";

// ═══════════════════════════════════════════════════════════════════════════════
//                              TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type DecisionCriticality = "low" | "medium" | "high" | "critical";

export interface ConvergenceThresholds {
  minimum: number;          // Below this, never converge
  standard: number;         // Normal convergence point
  requireUnanimity: number; // Above this, need all agents to agree
}

export interface ConvergenceResult {
  canConverge: boolean;
  confidence: number;
  threshold: number;
  gap: number;
  recommendation: "converge" | "explore" | "branch" | "escalate";
  reasoning: string;
  bestPath: Branch[];
  alternativePaths: Branch[][];
}

export interface ConvergenceCheck {
  branchId: string;
  confidence: number;
  status: BranchStatus;
  meetsThreshold: boolean;
  blockers: string[];
}

export interface DecisionContext {
  criticality: DecisionCriticality;
  hasDOTImplications: boolean;
  hasProtectedDriver: boolean;
  affectedEntities: number;
  isReversible: boolean;
  timeConstraint?: Date;
}

// ═══════════════════════════════════════════════════════════════════════════════
//                              THRESHOLD CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

const CRITICALITY_THRESHOLDS: Record<DecisionCriticality, ConvergenceThresholds> = {
  low: {
    minimum: 60,
    standard: 75,
    requireUnanimity: 95
  },
  medium: {
    minimum: 70,
    standard: 85,
    requireUnanimity: 95
  },
  high: {
    minimum: 80,
    standard: 90,
    requireUnanimity: 98
  },
  critical: {
    minimum: 85,
    standard: 95,
    requireUnanimity: 99
  }
};

// Special modifiers for dispatch-specific concerns
const MODIFIERS = {
  DOT_IMPLICATION: 5,      // Raise threshold by 5% if DOT rules involved
  PROTECTED_DRIVER: 5,     // Raise threshold by 5% for protected drivers
  MULTI_ENTITY: 2,         // Per entity above 1
  IRREVERSIBLE: 10,        // Raise threshold by 10% if can't undo
  TIME_PRESSURE: -5        // Lower threshold if urgent (with caution)
};

// ═══════════════════════════════════════════════════════════════════════════════
//                              CONVERGENCE ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

export class ConvergenceEngine {
  private branchManager = getBranchManager();
  private confidenceCalc = getConfidenceCalculator();

  /**
   * Evaluate if a thought tree is ready to converge
   */
  async evaluateTree(
    rootId: string,
    context: DecisionContext
  ): Promise<ConvergenceResult> {
    const tree = await this.branchManager.getTree(rootId);

    if (!tree) {
      return {
        canConverge: false,
        confidence: 0,
        threshold: 85,
        gap: 85,
        recommendation: "explore",
        reasoning: "No thought tree found",
        bestPath: [],
        alternativePaths: []
      };
    }

    // Calculate effective threshold based on context
    const threshold = this.calculateThreshold(context);

    // Get the best path through the tree
    const bestPath = await this.branchManager.getBestPath(rootId);

    // Calculate current confidence from best path
    const confidence = this.calculatePathConfidence(bestPath, tree);

    // Find alternative paths that might also converge
    const alternativePaths = this.findAlternativePaths(tree, bestPath);

    // Check for blockers
    const blockers = this.identifyBlockers(tree, context);

    // Determine recommendation
    const gap = threshold - confidence;
    let recommendation: ConvergenceResult["recommendation"];
    let reasoning: string;

    if (blockers.length > 0) {
      recommendation = "escalate";
      reasoning = `Cannot converge: ${blockers.join(", ")}`;
    } else if (confidence >= threshold) {
      recommendation = "converge";
      reasoning = `Confidence ${confidence}% meets threshold ${threshold}%`;
    } else if (gap <= 10 && bestPath.length < 5) {
      recommendation = "explore";
      reasoning = `Close to threshold (gap: ${gap}%), continue current path`;
    } else if (gap > 30) {
      recommendation = "branch";
      reasoning = `Significant gap (${gap}%), explore alternative approaches`;
    } else {
      recommendation = "explore";
      reasoning = `Moderate gap (${gap}%), gather more evidence`;
    }

    return {
      canConverge: confidence >= threshold && blockers.length === 0,
      confidence,
      threshold,
      gap: Math.max(0, gap),
      recommendation,
      reasoning,
      bestPath,
      alternativePaths
    };
  }

  /**
   * Check individual branch convergence status
   */
  async checkBranch(
    branchId: string,
    context: DecisionContext
  ): Promise<ConvergenceCheck> {
    const tree = await this.branchManager.getTree(branchId);
    const branch = tree?.branches.get(branchId);

    if (!branch) {
      return {
        branchId,
        confidence: 0,
        status: "exploring",
        meetsThreshold: false,
        blockers: ["Branch not found"]
      };
    }

    const threshold = this.calculateThreshold(context);
    const blockers: string[] = [];

    // Check for hard blockers
    if (branch.status === "ruled_out") {
      blockers.push("Branch has been ruled out");
    }

    // Check for missing critical evidence
    if (context.hasDOTImplications && !branch.evidence?.dotChecked) {
      blockers.push("DOT compliance not verified");
    }

    if (context.hasProtectedDriver && !branch.evidence?.protectedRulesChecked) {
      blockers.push("Protected driver rules not verified");
    }

    return {
      branchId,
      confidence: branch.confidence,
      status: branch.status,
      meetsThreshold: branch.confidence >= threshold && blockers.length === 0,
      blockers
    };
  }

  /**
   * Force convergence on a branch (for time-critical decisions)
   */
  async forceConverge(
    branchId: string,
    agentId: AgentId,
    reason: string
  ): Promise<Branch> {
    const updated = await this.branchManager.updateBranch(branchId, {
      status: "converged",
      evidence: {
        forcedConvergence: true,
        forcedBy: agentId,
        forcedReason: reason,
        forcedAt: new Date().toISOString()
      }
    });

    return updated;
  }

  /**
   * Get suggested actions to reach convergence
   */
  getSuggestions(result: ConvergenceResult): string[] {
    const suggestions: string[] = [];

    switch (result.recommendation) {
      case "converge":
        suggestions.push("Ready to make decision");
        suggestions.push(`Best path confidence: ${result.confidence}%`);
        break;

      case "explore":
        suggestions.push("Continue gathering evidence on current path");
        if (result.gap <= 10) {
          suggestions.push("Consider validating with additional agent");
        }
        break;

      case "branch":
        suggestions.push("Create alternative exploration paths");
        suggestions.push("Consider different driver/block combinations");
        if (result.alternativePaths.length > 0) {
          suggestions.push(
            `${result.alternativePaths.length} alternative paths available`
          );
        }
        break;

      case "escalate":
        suggestions.push("Manual review recommended");
        suggestions.push("Verify DOT and protected rules manually");
        break;
    }

    return suggestions;
  }

  /**
   * Calculate adaptive threshold based on decision context
   */
  calculateThreshold(context: DecisionContext): number {
    // Start with base threshold for criticality level
    const base = CRITICALITY_THRESHOLDS[context.criticality];
    let threshold = base.standard;

    // Apply modifiers
    if (context.hasDOTImplications) {
      threshold += MODIFIERS.DOT_IMPLICATION;
    }

    if (context.hasProtectedDriver) {
      threshold += MODIFIERS.PROTECTED_DRIVER;
    }

    if (context.affectedEntities > 1) {
      threshold += MODIFIERS.MULTI_ENTITY * (context.affectedEntities - 1);
    }

    if (!context.isReversible) {
      threshold += MODIFIERS.IRREVERSIBLE;
    }

    // Time pressure can lower threshold, but never below minimum
    if (context.timeConstraint) {
      const hoursUntil = (context.timeConstraint.getTime() - Date.now()) / (1000 * 60 * 60);
      if (hoursUntil < 1) {
        threshold = Math.max(base.minimum, threshold + MODIFIERS.TIME_PRESSURE);
      }
    }

    // Cap at 100
    return Math.min(100, threshold);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //                              PRIVATE METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  private calculatePathConfidence(path: Branch[], tree: BranchTree): number {
    if (path.length === 0) return 0;

    // Use weighted average favoring deeper branches (more refined)
    let weightedSum = 0;
    let totalWeight = 0;

    for (let i = 0; i < path.length; i++) {
      const branch = path[i];
      const weight = i + 1; // Later branches in path weighted higher
      weightedSum += branch.confidence * weight;
      totalWeight += weight;
    }

    const pathConfidence = weightedSum / totalWeight;

    // Bonus for reaching conclusion type
    const lastBranch = path[path.length - 1];
    if (lastBranch.type === "conclusion") {
      return Math.min(100, pathConfidence * 1.1);
    }

    return Math.round(pathConfidence);
  }

  private findAlternativePaths(
    tree: BranchTree,
    bestPath: Branch[]
  ): Branch[][] {
    const alternatives: Branch[][] = [];
    const bestPathIds = new Set(bestPath.map(b => b.id));

    // Find promising branches not in best path
    for (const branch of tree.branches.values()) {
      if (
        !bestPathIds.has(branch.id) &&
        branch.status === "promising" &&
        branch.confidence >= 50
      ) {
        // Build path from this promising branch back to root
        const path = this.buildPathToRoot(tree, branch.id);
        if (path.length > 0) {
          alternatives.push(path);
        }
      }
    }

    // Sort by average confidence
    alternatives.sort((a, b) => {
      const avgA = a.reduce((s, br) => s + br.confidence, 0) / a.length;
      const avgB = b.reduce((s, br) => s + br.confidence, 0) / b.length;
      return avgB - avgA;
    });

    // Return top 3 alternatives
    return alternatives.slice(0, 3);
  }

  private buildPathToRoot(tree: BranchTree, branchId: string): Branch[] {
    const path: Branch[] = [];
    let currentId: string | null = branchId;

    while (currentId) {
      const branch = tree.branches.get(currentId);
      if (!branch) break;
      path.unshift(branch);
      currentId = branch.parentId;
    }

    return path;
  }

  private identifyBlockers(tree: BranchTree, context: DecisionContext): string[] {
    const blockers: string[] = [];

    // Check for DOT violations in any active branch
    if (context.hasDOTImplications) {
      for (const branch of tree.branches.values()) {
        if (branch.status !== "ruled_out") {
          const evidence = branch.evidence as Record<string, unknown> | undefined;
          if (evidence?.dotViolation) {
            blockers.push(`DOT violation in branch ${branch.id.slice(0, 8)}`);
          }
        }
      }
    }

    // Check for protected rule violations
    if (context.hasProtectedDriver) {
      for (const branch of tree.branches.values()) {
        if (branch.status !== "ruled_out") {
          const evidence = branch.evidence as Record<string, unknown> | undefined;
          if (evidence?.protectedRuleViolation) {
            blockers.push(`Protected rule violation in branch ${branch.id.slice(0, 8)}`);
          }
        }
      }
    }

    // Check for conflicting converged branches
    const convergedBranches = Array.from(tree.branches.values()).filter(
      b => b.status === "converged"
    );

    if (convergedBranches.length > 1) {
      // Check if they have conflicting conclusions
      const conclusions = convergedBranches.filter(b => b.type === "conclusion");
      if (conclusions.length > 1) {
        // Simple conflict detection - different content in conclusions
        const uniqueContents = new Set(conclusions.map(c => c.content));
        if (uniqueContents.size > 1) {
          blockers.push("Conflicting conclusions detected");
        }
      }
    }

    return blockers;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//                              SINGLETON
// ═══════════════════════════════════════════════════════════════════════════════

let engineInstance: ConvergenceEngine | null = null;

export function getConvergenceEngine(): ConvergenceEngine {
  if (!engineInstance) {
    engineInstance = new ConvergenceEngine();
  }
  return engineInstance;
}
