/**
 * Memory System
 *
 * The hippocampus of the Milo Neural Intelligence System.
 * Provides 6-week living memory with pattern learning and entity profiles.
 */

export {
  MemoryManager,
  getMemoryManager,
  type MemoryQuery,
  type MemoryContext,
  type ThoughtMemory,
  type PatternMemory,
  type ProfileMemory,
  type DecisionMemory
} from "./memory-manager";

export {
  PatternTracker,
  getPatternTracker,
  type PatternType,
  type PatternCandidate,
  type PatternAnalysis,
  type DriverPattern,
  type SchedulePattern
} from "./pattern-tracker";

export {
  ProfileBuilder,
  getProfileBuilder,
  type DriverProfile,
  type BlockProfile,
  type UserProfile
} from "./profile-builder";

export {
  MemoryCleanupJob,
  startScheduledCleanup,
  stopScheduledCleanup,
  runCleanupOnce,
  type CleanupResult,
  type CleanupConfig
} from "./cleanup-job";
