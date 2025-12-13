/**
 * Gemini Scheduler - DISABLED
 *
 * Original file moved to: server/disabled/gemini-scheduler.ts.bak
 * Reason: Replacing custom pattern recognition with scikit-learn
 * See: PLAN-bolt-on-scheduler.md
 */

// Stub implementations
export async function optimizeWithGemini(
  tenantId: string,
  weekStart: Date,
  contractTypeFilter?: "solo1" | "solo2" | "team",
  minDays: number = 3
): Promise<{
  suggestions: Array<{
    blockId: string;
    driverId: string;
    driverName: string;
    confidence: number;
    matchType: string;
    preferredTime: string;
    actualTime: string;
  }>;
  unassigned: string[];
  stats: {
    totalBlocks: number;
    totalDrivers: number;
    assigned: number;
    unassigned: number;
    solverStatus: string;
  };
}> {
  console.warn("[Gemini Scheduler] DISABLED - pending sklearn replacement");
  return {
    suggestions: [],
    unassigned: [],
    stats: {
      totalBlocks: 0,
      totalDrivers: 0,
      assigned: 0,
      unassigned: 0,
      solverStatus: "DISABLED",
    },
  };
}

export async function applyGeminiSchedule(
  tenantId: string,
  assignments: Array<{ blockId: string; driverId: string }>
): Promise<{ applied: number; errors: string[] }> {
  console.warn("[Gemini Scheduler] DISABLED - pending sklearn replacement");
  return {
    applied: 0,
    errors: ["Gemini Scheduler disabled - pending sklearn replacement"],
  };
}
