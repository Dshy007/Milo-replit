/**
 * Milo Neural Intelligence System
 *
 * "Where Silicon Minds Learn to Dispatch"
 *
 * This module exports the complete neural intelligence system including:
 * - The Orchestrator (main brain)
 * - Four specialized agents (Architect, Scout, Analyst, Executor)
 * - Memory management utilities
 * - Type definitions
 */

// ═══════════════════════════════════════════════════════════════════════════════
//                              ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════════════════════

export {
  NeuralOrchestrator,
  getOrchestrator,
  type OrchestratorRequest,
  type OrchestratorResponse,
  type IntentClassification
} from "./orchestrator";

// ═══════════════════════════════════════════════════════════════════════════════
//                              AGENTS
// ═══════════════════════════════════════════════════════════════════════════════

export {
  BaseAgent,
  AgentRegistry,
  type AgentId,
  type AgentConfig,
  type AgentContext,
  type AgentRequest,
  type AgentResponse,
  type ThoughtBranch,
  type ThoughtType,
  type ThoughtStatus,
  type Pattern,
  type EntityProfile,
  type DOTStatus,
  type ProtectedRuleCheck
} from "./agents/base-agent";

export {
  ClaudeArchitect,
  getArchitect
} from "./agents/claude-architect";

export {
  GeminiScout,
  getScout,
  type WeatherCondition,
  type SafetyAlert,
  type AlertSeverity
} from "./agents/gemini-scout";

export {
  ChatGPTAnalyst,
  getAnalyst,
  type WorkloadAnalysis,
  type CompatibilityScore,
  type PatternInsight
} from "./agents/chatgpt-analyst";

export {
  ManusExecutor,
  getExecutor,
  type ExecutionRequest,
  type ExecutionResult,
  type RollbackPlan,
  type RollbackStep
} from "./agents/manus-executor";

// ═══════════════════════════════════════════════════════════════════════════════
//                              MEMORY SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════

export {
  MemoryManager,
  getMemoryManager,
  PatternTracker,
  getPatternTracker,
  ProfileBuilder,
  getProfileBuilder,
  MemoryCleanupJob,
  startScheduledCleanup,
  stopScheduledCleanup,
  runCleanupOnce,
  type MemoryQuery,
  type MemoryContext,
  type ThoughtMemory,
  type PatternMemory,
  type ProfileMemory,
  type DecisionMemory,
  type PatternType,
  type PatternCandidate,
  type PatternAnalysis,
  type DriverPattern,
  type SchedulePattern,
  type DriverProfile,
  type BlockProfile,
  type UserProfile,
  type CleanupResult,
  type CleanupConfig
} from "./memory";

// ═══════════════════════════════════════════════════════════════════════════════
//                              BRANCHING SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════

export {
  BranchManager,
  getBranchManager,
  ConfidenceCalculator,
  getConfidenceCalculator,
  ConvergenceEngine,
  getConvergenceEngine,
  type Branch,
  type BranchTree,
  type BranchStatus,
  type BranchType,
  type BranchingDecision,
  type BranchEvaluation,
  type ConfidenceFactor,
  type ConfidenceScore,
  type ConfidenceContext,
  type AgentOpinion,
  type ConvergenceResult,
  type ConvergenceCheck,
  type ConvergenceThresholds,
  type DecisionCriticality,
  type DecisionContext
} from "./branching";
