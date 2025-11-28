/**
 * Branching System
 *
 * Organic thought branching inspired by neural pathways.
 * Each decision spawns branches that explore possibilities independently,
 * converging only when confidence reaches the threshold.
 *
 * "Like veins in a leaf, thoughts spread seeking truth."
 */

// Branch Manager - Creates and navigates thought trees
export {
  BranchManager,
  getBranchManager,
  type Branch,
  type BranchTree,
  type BranchStatus,
  type BranchType,
  type BranchingDecision,
  type BranchEvaluation
} from "./branch-manager";

// Confidence Calculator - Scores decisions with weighted factors
export {
  ConfidenceCalculator,
  getConfidenceCalculator,
  type ConfidenceFactor,
  type ConfidenceScore,
  type ConfidenceContext,
  type AgentOpinion
} from "./confidence-calc";

// Convergence Engine - Determines when to finalize decisions
export {
  ConvergenceEngine,
  getConvergenceEngine,
  type ConvergenceResult,
  type ConvergenceCheck,
  type ConvergenceThresholds,
  type DecisionCriticality,
  type DecisionContext
} from "./convergence";
