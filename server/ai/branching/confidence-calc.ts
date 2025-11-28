/**
 * Confidence Calculator
 *
 * Calculates confidence scores for neural decisions using multiple weighted factors.
 * The system uses organic confidence growth - scores evolve as more evidence accumulates.
 *
 * "Confidence is earned through evidence, not assumed through hope."
 */

import { Branch, BranchType, BranchStatus } from "./branch-manager";
import { AgentId, DOTStatus, ProtectedRuleCheck } from "../agents/base-agent";

// ═══════════════════════════════════════════════════════════════════════════════
//                              TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface ConfidenceFactor {
  name: string;
  weight: number;        // 0-1, how much this factor matters
  value: number;         // 0-100, the score for this factor
  contribution: number;  // Calculated: weight * value
  description?: string;
}

export interface ConfidenceScore {
  overall: number;       // 0-100 final confidence
  factors: ConfidenceFactor[];
  breakdown: {
    dotCompliance: number;
    protectedRules: number;
    dataCompleteness: number;
    patternMatch: number;
    agentAgreement: number;
    historicalSuccess: number;
  };
  warnings: string[];
  boosts: string[];
}

export interface AgentOpinion {
  agentId: AgentId;
  confidence: number;
  reasoning?: string;
}

export interface ConfidenceContext {
  dotStatus?: DOTStatus;
  protectedRules?: ProtectedRuleCheck;
  hasDriverData: boolean;
  hasBlockData: boolean;
  hasHistoricalData: boolean;
  patternMatches: number;
  agentOpinions: AgentOpinion[];
  previousDecisionSuccess?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
//                              FACTOR WEIGHTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Factor weights determine how much each component contributes to overall confidence.
 * These weights are calibrated for dispatch decision-making.
 */
const FACTOR_WEIGHTS = {
  DOT_COMPLIANCE: 0.30,      // DOT rules are non-negotiable - highest weight
  PROTECTED_RULES: 0.20,     // Protected driver rules are critical
  DATA_COMPLETENESS: 0.15,   // Can't be confident without data
  PATTERN_MATCH: 0.15,       // Historical patterns increase confidence
  AGENT_AGREEMENT: 0.12,     // Multi-agent consensus matters
  HISTORICAL_SUCCESS: 0.08   // Past success with similar decisions
};

// Ensure weights sum to 1.0
const TOTAL_WEIGHT = Object.values(FACTOR_WEIGHTS).reduce((sum, w) => sum + w, 0);
if (Math.abs(TOTAL_WEIGHT - 1.0) > 0.001) {
  console.warn(`Factor weights sum to ${TOTAL_WEIGHT}, should be 1.0`);
}

// ═══════════════════════════════════════════════════════════════════════════════
//                              CONFIDENCE CALCULATOR
// ═══════════════════════════════════════════════════════════════════════════════

export class ConfidenceCalculator {
  /**
   * Calculate overall confidence score from context
   */
  calculate(context: ConfidenceContext): ConfidenceScore {
    const factors: ConfidenceFactor[] = [];
    const warnings: string[] = [];
    const boosts: string[] = [];

    // 1. DOT Compliance Factor (highest weight)
    const dotScore = this.calculateDOTScore(context.dotStatus);
    factors.push({
      name: "DOT Compliance",
      weight: FACTOR_WEIGHTS.DOT_COMPLIANCE,
      value: dotScore.value,
      contribution: FACTOR_WEIGHTS.DOT_COMPLIANCE * dotScore.value,
      description: dotScore.description
    });
    if (dotScore.warning) warnings.push(dotScore.warning);
    if (dotScore.boost) boosts.push(dotScore.boost);

    // 2. Protected Rules Factor
    const protectedScore = this.calculateProtectedScore(context.protectedRules);
    factors.push({
      name: "Protected Rules",
      weight: FACTOR_WEIGHTS.PROTECTED_RULES,
      value: protectedScore.value,
      contribution: FACTOR_WEIGHTS.PROTECTED_RULES * protectedScore.value,
      description: protectedScore.description
    });
    if (protectedScore.warning) warnings.push(protectedScore.warning);
    if (protectedScore.boost) boosts.push(protectedScore.boost);

    // 3. Data Completeness Factor
    const dataScore = this.calculateDataScore(
      context.hasDriverData,
      context.hasBlockData,
      context.hasHistoricalData
    );
    factors.push({
      name: "Data Completeness",
      weight: FACTOR_WEIGHTS.DATA_COMPLETENESS,
      value: dataScore.value,
      contribution: FACTOR_WEIGHTS.DATA_COMPLETENESS * dataScore.value,
      description: dataScore.description
    });
    if (dataScore.warning) warnings.push(dataScore.warning);

    // 4. Pattern Match Factor
    const patternScore = this.calculatePatternScore(context.patternMatches);
    factors.push({
      name: "Pattern Match",
      weight: FACTOR_WEIGHTS.PATTERN_MATCH,
      value: patternScore.value,
      contribution: FACTOR_WEIGHTS.PATTERN_MATCH * patternScore.value,
      description: patternScore.description
    });
    if (patternScore.boost) boosts.push(patternScore.boost);

    // 5. Agent Agreement Factor
    const agentScore = this.calculateAgentAgreement(context.agentOpinions);
    factors.push({
      name: "Agent Agreement",
      weight: FACTOR_WEIGHTS.AGENT_AGREEMENT,
      value: agentScore.value,
      contribution: FACTOR_WEIGHTS.AGENT_AGREEMENT * agentScore.value,
      description: agentScore.description
    });
    if (agentScore.warning) warnings.push(agentScore.warning);
    if (agentScore.boost) boosts.push(agentScore.boost);

    // 6. Historical Success Factor
    const historyScore = this.calculateHistoricalScore(context.previousDecisionSuccess);
    factors.push({
      name: "Historical Success",
      weight: FACTOR_WEIGHTS.HISTORICAL_SUCCESS,
      value: historyScore.value,
      contribution: FACTOR_WEIGHTS.HISTORICAL_SUCCESS * historyScore.value,
      description: historyScore.description
    });
    if (historyScore.boost) boosts.push(historyScore.boost);

    // Calculate overall score
    const overall = Math.round(
      factors.reduce((sum, f) => sum + f.contribution, 0)
    );

    return {
      overall,
      factors,
      breakdown: {
        dotCompliance: factors[0].value,
        protectedRules: factors[1].value,
        dataCompleteness: factors[2].value,
        patternMatch: factors[3].value,
        agentAgreement: factors[4].value,
        historicalSuccess: factors[5].value
      },
      warnings,
      boosts
    };
  }

  /**
   * Calculate confidence for a branch based on its current state
   */
  calculateBranchConfidence(
    branch: Branch,
    children: Branch[],
    context: Partial<ConfidenceContext>
  ): number {
    // Base confidence from branch's own assessment
    let confidence = branch.confidence;

    // Adjust based on branch type
    const typeMultiplier = this.getBranchTypeMultiplier(branch.type);
    confidence *= typeMultiplier;

    // Boost if children have high confidence (evidence supports)
    if (children.length > 0) {
      const activeChildren = children.filter(c =>
        c.status !== "ruled_out" && c.status !== "merged"
      );

      if (activeChildren.length > 0) {
        const avgChildConfidence = activeChildren.reduce(
          (sum, c) => sum + c.confidence, 0
        ) / activeChildren.length;

        // Child evidence can boost parent by up to 20%
        const boost = (avgChildConfidence / 100) * 20;
        confidence += boost;
      }
    }

    // Penalize if branch has been exploring too long without progress
    if (branch.status === "exploring") {
      const age = Date.now() - branch.createdAt.getTime();
      const hoursOld = age / (1000 * 60 * 60);
      if (hoursOld > 24) {
        // Slight decay for stale exploring branches
        confidence *= 0.95;
      }
    }

    // Cap at 100
    return Math.min(100, Math.round(confidence));
  }

  /**
   * Calculate aggregated confidence from multiple branches
   */
  aggregateConfidence(branches: Branch[]): number {
    if (branches.length === 0) return 0;

    // Filter out pruned branches
    const activeBranches = branches.filter(
      b => b.status !== "ruled_out"
    );

    if (activeBranches.length === 0) return 0;

    // Use weighted average favoring converged branches
    let totalWeight = 0;
    let weightedSum = 0;

    for (const branch of activeBranches) {
      const weight = this.getBranchStatusWeight(branch.status);
      totalWeight += weight;
      weightedSum += branch.confidence * weight;
    }

    return Math.round(weightedSum / totalWeight);
  }

  /**
   * Determine if confidence should increase based on new evidence
   */
  calculateConfidenceAdjustment(
    currentConfidence: number,
    evidence: {
      type: "supporting" | "contradicting" | "neutral";
      strength: number; // 0-100
      source: string;
    }
  ): number {
    const { type, strength } = evidence;

    // Base adjustment is proportional to evidence strength
    let adjustment = (strength / 100) * 15; // Max 15% per evidence

    switch (type) {
      case "supporting":
        // Diminishing returns as confidence gets higher
        const room = 100 - currentConfidence;
        adjustment = Math.min(adjustment, room * 0.3);
        return currentConfidence + adjustment;

      case "contradicting":
        // Contradicting evidence has more impact at high confidence
        adjustment *= (currentConfidence / 100);
        return Math.max(0, currentConfidence - adjustment);

      case "neutral":
        // Neutral evidence provides small boost (at least we checked)
        return currentConfidence + (adjustment * 0.1);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //                              PRIVATE METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  private calculateDOTScore(dotStatus?: DOTStatus): {
    value: number;
    description: string;
    warning?: string;
    boost?: string;
  } {
    if (!dotStatus) {
      return {
        value: 50, // Unknown - neutral
        description: "DOT status not provided"
      };
    }

    if (dotStatus.status === "violation") {
      return {
        value: 0,
        description: "DOT violation detected",
        warning: `DOT VIOLATION: ${dotStatus.message || "Hours exceeded"}`
      };
    }

    // Score based on remaining hours buffer
    const remainingHours = dotStatus.maxHours - dotStatus.hoursUsed;
    const { windowHours } = dotStatus;
    const utilizationPercent = ((windowHours - remainingHours) / windowHours) * 100;

    if (utilizationPercent < 50) {
      return {
        value: 100,
        description: "Plenty of DOT hours remaining",
        boost: "Driver has significant DOT hours buffer"
      };
    } else if (utilizationPercent < 75) {
      return {
        value: 85,
        description: "Adequate DOT hours remaining"
      };
    } else if (utilizationPercent < 90) {
      return {
        value: 65,
        description: "Limited DOT hours remaining",
        warning: "Driver approaching DOT limit"
      };
    } else {
      return {
        value: 40,
        description: "Very limited DOT hours",
        warning: "Driver nearly at DOT limit - consider alternatives"
      };
    }
  }

  private calculateProtectedScore(rules?: ProtectedRuleCheck): {
    value: number;
    description: string;
    warning?: string;
    boost?: string;
  } {
    if (!rules) {
      return {
        value: 80, // Assume OK if not protected
        description: "No protected rules apply"
      };
    }

    if (!rules.passed) {
      return {
        value: 0,
        description: "Protected rule violation",
        warning: `PROTECTED RULE VIOLATION: ${rules.violations.join(", ")}`
      };
    }

    // All rules passed
    return {
      value: 100,
      description: "All protected rules satisfied",
      boost: "Driver schedule preferences fully respected"
    };
  }

  private calculateDataScore(
    hasDriverData: boolean,
    hasBlockData: boolean,
    hasHistoricalData: boolean
  ): {
    value: number;
    description: string;
    warning?: string;
  } {
    let score = 0;
    const missing: string[] = [];

    if (hasDriverData) {
      score += 40;
    } else {
      missing.push("driver data");
    }

    if (hasBlockData) {
      score += 40;
    } else {
      missing.push("block data");
    }

    if (hasHistoricalData) {
      score += 20;
    } else {
      missing.push("historical data");
    }

    if (missing.length === 0) {
      return {
        value: 100,
        description: "All data available"
      };
    }

    return {
      value: score,
      description: `Missing: ${missing.join(", ")}`,
      warning: missing.length > 1 ? "Significant data gaps" : undefined
    };
  }

  private calculatePatternScore(patternMatches: number): {
    value: number;
    description: string;
    boost?: string;
  } {
    if (patternMatches === 0) {
      return {
        value: 50,
        description: "No historical patterns matched"
      };
    }

    if (patternMatches === 1) {
      return {
        value: 70,
        description: "One pattern match found"
      };
    }

    if (patternMatches <= 3) {
      return {
        value: 85,
        description: `${patternMatches} pattern matches found`,
        boost: "Multiple supporting patterns"
      };
    }

    return {
      value: 95,
      description: `Strong pattern support (${patternMatches} matches)`,
      boost: "Decision strongly supported by historical patterns"
    };
  }

  private calculateAgentAgreement(opinions: AgentOpinion[]): {
    value: number;
    description: string;
    warning?: string;
    boost?: string;
  } {
    if (opinions.length === 0) {
      return {
        value: 50,
        description: "No agent consensus data"
      };
    }

    if (opinions.length === 1) {
      return {
        value: opinions[0].confidence,
        description: `Single agent opinion: ${opinions[0].agentId}`
      };
    }

    // Calculate agreement metrics
    const confidences = opinions.map(o => o.confidence);
    const avg = confidences.reduce((a, b) => a + b, 0) / confidences.length;
    const variance = confidences.reduce(
      (sum, c) => sum + Math.pow(c - avg, 2), 0
    ) / confidences.length;
    const stdDev = Math.sqrt(variance);

    // High agreement (low std dev) boosts confidence
    if (stdDev < 10) {
      return {
        value: Math.min(100, avg + 10),
        description: "Strong agent consensus",
        boost: `All ${opinions.length} agents in agreement`
      };
    }

    if (stdDev < 20) {
      return {
        value: avg,
        description: "Moderate agent agreement"
      };
    }

    // Agents disagree - use cautious average
    return {
      value: Math.max(30, avg - 15),
      description: "Agents disagree on assessment",
      warning: "Multi-agent disagreement detected - review recommended"
    };
  }

  private calculateHistoricalScore(previousSuccess?: boolean): {
    value: number;
    description: string;
    boost?: string;
  } {
    if (previousSuccess === undefined) {
      return {
        value: 50,
        description: "No historical outcome data"
      };
    }

    if (previousSuccess) {
      return {
        value: 90,
        description: "Similar past decision succeeded",
        boost: "Positive historical precedent"
      };
    }

    return {
      value: 30,
      description: "Similar past decision had issues"
    };
  }

  private getBranchTypeMultiplier(type: BranchType): number {
    switch (type) {
      case "conclusion":
        return 1.2; // Conclusions are higher confidence by nature
      case "observation":
        return 1.1; // Observations are factual
      case "hypothesis":
        return 0.9; // Hypotheses need validation
      case "question":
        return 0.7; // Questions are exploratory
      case "action":
        return 1.0; // Actions are neutral
      default:
        return 1.0;
    }
  }

  private getBranchStatusWeight(status: BranchStatus): number {
    switch (status) {
      case "converged":
        return 3.0; // Converged branches carry most weight
      case "promising":
        return 2.0;
      case "exploring":
        return 1.0;
      case "merged":
        return 0.5; // Merged branches have been absorbed
      case "ruled_out":
        return 0.0; // Ruled out branches don't count
      default:
        return 1.0;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//                              SINGLETON
// ═══════════════════════════════════════════════════════════════════════════════

let calculatorInstance: ConfidenceCalculator | null = null;

export function getConfidenceCalculator(): ConfidenceCalculator {
  if (!calculatorInstance) {
    calculatorInstance = new ConfidenceCalculator();
  }
  return calculatorInstance;
}
