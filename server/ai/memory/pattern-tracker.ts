/**
 * Pattern Tracker
 *
 * The learning engine of the Milo Neural Intelligence System.
 * Detects, tracks, and strengthens patterns over time.
 *
 * Pattern Types:
 * - driver: Driver behaviors and preferences
 * - route: Route-specific insights
 * - schedule: Scheduling patterns
 * - weather: Weather impact patterns
 * - operational: General operational insights
 */

import { getMemoryManager, PatternMemory } from "./memory-manager";
import { db } from "../../db";
import { neuralPatterns, neuralDecisions } from "../../../shared/schema";
import { eq, and, gte, desc, sql } from "drizzle-orm";

// ═══════════════════════════════════════════════════════════════════════════════
//                              TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type PatternType = "driver" | "route" | "schedule" | "weather" | "operational";

export interface PatternCandidate {
  type: PatternType;
  pattern: string;
  confidence: number;
  subjectId?: string;
  subjectType?: string;
  evidence?: Record<string, unknown>;
}

export interface PatternAnalysis {
  patterns: PatternCandidate[];
  insights: string[];
}

export interface DriverPattern {
  driverId: string;
  driverName?: string;
  strengths: string[];
  preferences: string[];
  concerns: string[];
  bestFor: string[];
  avoid: string[];
  reliabilityScore: number;
}

export interface SchedulePattern {
  dayOfWeek: string;
  timeSlot: string;
  observation: string;
  frequency: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
//                              PATTERN TRACKER
// ═══════════════════════════════════════════════════════════════════════════════

export class PatternTracker {
  private memoryManager = getMemoryManager();

  /**
   * Analyze text for patterns
   */
  async analyzeForPatterns(
    tenantId: string,
    text: string,
    context?: {
      entityId?: string;
      entityType?: string;
      sessionId?: string;
    }
  ): Promise<PatternAnalysis> {
    const patterns: PatternCandidate[] = [];
    const insights: string[] = [];

    // Analyze for driver patterns
    const driverPatterns = this.extractDriverPatterns(text, context?.entityId);
    patterns.push(...driverPatterns);

    // Analyze for schedule patterns
    const schedulePatterns = this.extractSchedulePatterns(text);
    patterns.push(...schedulePatterns);

    // Analyze for weather patterns
    const weatherPatterns = this.extractWeatherPatterns(text);
    patterns.push(...weatherPatterns);

    // Analyze for operational patterns
    const operationalPatterns = this.extractOperationalPatterns(text);
    patterns.push(...operationalPatterns);

    // Store discovered patterns
    for (const pattern of patterns) {
      if (pattern.confidence >= 40) { // Only store patterns with reasonable confidence
        await this.memoryManager.recordPattern(tenantId, {
          type: pattern.type,
          pattern: pattern.pattern,
          confidence: pattern.confidence,
          subjectId: pattern.subjectId || context?.entityId,
          subjectType: pattern.subjectType || context?.entityType,
          evidence: pattern.evidence
        });
        insights.push(`Learned: ${pattern.pattern} (${pattern.confidence}% confident)`);
      }
    }

    return { patterns, insights };
  }

  /**
   * Extract driver-related patterns from text
   */
  private extractDriverPatterns(text: string, driverId?: string): PatternCandidate[] {
    const patterns: PatternCandidate[] = [];
    const lowerText = text.toLowerCase();

    // Performance patterns
    const performanceIndicators = [
      { keyword: "on-time", pattern: "consistently on-time", confidence: 70 },
      { keyword: "reliable", pattern: "highly reliable", confidence: 65 },
      { keyword: "efficient", pattern: "works efficiently", confidence: 60 },
      { keyword: "fast", pattern: "completes routes quickly", confidence: 55 },
      { keyword: "careful", pattern: "careful and thorough", confidence: 60 },
      { keyword: "experienced", pattern: "highly experienced", confidence: 70 },
    ];

    for (const indicator of performanceIndicators) {
      if (lowerText.includes(indicator.keyword)) {
        patterns.push({
          type: "driver",
          pattern: `Driver ${indicator.pattern}`,
          confidence: indicator.confidence,
          subjectId: driverId,
          subjectType: "driver",
          evidence: { keyword: indicator.keyword, source: "text_analysis" }
        });
      }
    }

    // Preference patterns
    const preferenceIndicators = [
      { regex: /prefer(?:s|red)?\s+(morning|afternoon|evening|night)/i, patternFn: (m: string) => `Prefers ${m} shifts` },
      { regex: /best\s+(?:at|for|with)\s+(\w+(?:\s+\w+)?)/i, patternFn: (m: string) => `Best at ${m}` },
      { regex: /avoid(?:s|ed)?\s+(\w+(?:\s+\w+)?)/i, patternFn: (m: string) => `Avoids ${m}` },
    ];

    for (const indicator of preferenceIndicators) {
      const match = text.match(indicator.regex);
      if (match) {
        patterns.push({
          type: "driver",
          pattern: indicator.patternFn(match[1]),
          confidence: 55,
          subjectId: driverId,
          subjectType: "driver",
          evidence: { match: match[0], source: "regex_extraction" }
        });
      }
    }

    // Concern patterns
    const concernIndicators = [
      { keyword: "late", pattern: "sometimes runs late", confidence: 50 },
      { keyword: "fatigue", pattern: "may experience fatigue on long shifts", confidence: 55 },
      { keyword: "issue", pattern: "has had issues", confidence: 45 },
    ];

    for (const indicator of concernIndicators) {
      if (lowerText.includes(indicator.keyword)) {
        patterns.push({
          type: "driver",
          pattern: `Driver ${indicator.pattern}`,
          confidence: indicator.confidence,
          subjectId: driverId,
          subjectType: "driver",
          evidence: { keyword: indicator.keyword, source: "concern_detection" }
        });
      }
    }

    return patterns;
  }

  /**
   * Extract schedule-related patterns from text
   */
  private extractSchedulePatterns(text: string): PatternCandidate[] {
    const patterns: PatternCandidate[] = [];
    const lowerText = text.toLowerCase();

    // Day-based patterns
    const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    for (const day of days) {
      if (lowerText.includes(day)) {
        // Look for context around the day
        const dayRegex = new RegExp(`${day}[^.]*?(busy|slow|heavy|light|problematic|ideal)`, "i");
        const match = text.match(dayRegex);
        if (match) {
          patterns.push({
            type: "schedule",
            pattern: `${day.charAt(0).toUpperCase() + day.slice(1)} tends to be ${match[1]}`,
            confidence: 50,
            evidence: { day, adjective: match[1], source: "day_analysis" }
          });
        }
      }
    }

    // Time-based patterns
    const timePatterns = [
      { regex: /peak\s+hours?.*?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i, patternFn: (m: string) => `Peak hours around ${m}` },
      { regex: /rush\s+(?:hour|time).*?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i, patternFn: (m: string) => `Rush time around ${m}` },
      { regex: /quiet\s+(?:period|time).*?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i, patternFn: (m: string) => `Quiet period around ${m}` },
    ];

    for (const tp of timePatterns) {
      const match = text.match(tp.regex);
      if (match) {
        patterns.push({
          type: "schedule",
          pattern: tp.patternFn(match[1]),
          confidence: 55,
          evidence: { match: match[0], source: "time_extraction" }
        });
      }
    }

    return patterns;
  }

  /**
   * Extract weather-related patterns from text
   */
  private extractWeatherPatterns(text: string): PatternCandidate[] {
    const patterns: PatternCandidate[] = [];
    const lowerText = text.toLowerCase();

    const weatherConditions = [
      { keyword: "rain", impacts: ["delays", "caution", "slower", "careful"] },
      { keyword: "snow", impacts: ["delays", "dangerous", "avoid", "chains"] },
      { keyword: "fog", impacts: ["visibility", "slow", "delay", "caution"] },
      { keyword: "ice", impacts: ["dangerous", "avoid", "critical", "hazard"] },
      { keyword: "wind", impacts: ["gusts", "dangerous", "caution", "high-profile"] },
      { keyword: "storm", impacts: ["avoid", "delay", "dangerous", "cancel"] },
    ];

    for (const condition of weatherConditions) {
      if (lowerText.includes(condition.keyword)) {
        for (const impact of condition.impacts) {
          if (lowerText.includes(impact)) {
            patterns.push({
              type: "weather",
              pattern: `${condition.keyword.charAt(0).toUpperCase() + condition.keyword.slice(1)} conditions cause ${impact}`,
              confidence: 60,
              evidence: { condition: condition.keyword, impact, source: "weather_analysis" }
            });
            break; // Only one pattern per condition
          }
        }
      }
    }

    return patterns;
  }

  /**
   * Extract operational patterns from text
   */
  private extractOperationalPatterns(text: string): PatternCandidate[] {
    const patterns: PatternCandidate[] = [];
    const lowerText = text.toLowerCase();

    // Workload patterns
    if (lowerText.includes("overloaded") || lowerText.includes("too many")) {
      patterns.push({
        type: "operational",
        pattern: "Workload imbalance detected",
        confidence: 55,
        evidence: { indicator: "overload", source: "operational_analysis" }
      });
    }

    if (lowerText.includes("balanced") || lowerText.includes("well distributed")) {
      patterns.push({
        type: "operational",
        pattern: "Workload is well balanced",
        confidence: 60,
        evidence: { indicator: "balance", source: "operational_analysis" }
      });
    }

    // DOT patterns
    if (lowerText.includes("dot") && (lowerText.includes("warning") || lowerText.includes("limit"))) {
      patterns.push({
        type: "operational",
        pattern: "DOT compliance requires attention",
        confidence: 70,
        evidence: { indicator: "dot_warning", source: "compliance_analysis" }
      });
    }

    // Assignment patterns
    const assignmentRegex = /block\s+(\d+|[a-z]+).*?(works well|problematic|difficult|easy)/i;
    const match = text.match(assignmentRegex);
    if (match) {
      patterns.push({
        type: "operational",
        pattern: `Block ${match[1]} is ${match[2]}`,
        confidence: 50,
        evidence: { block: match[1], assessment: match[2], source: "block_analysis" }
      });
    }

    return patterns;
  }

  /**
   * Get driver patterns summary
   */
  async getDriverPatternSummary(tenantId: string, driverId: string): Promise<DriverPattern> {
    const patterns = await this.memoryManager.getRelevantPatterns({
      tenantId,
      entityType: "driver",
      entityId: driverId,
      minConfidence: 40
    });

    const strengths: string[] = [];
    const preferences: string[] = [];
    const concerns: string[] = [];
    const bestFor: string[] = [];
    const avoid: string[] = [];

    for (const pattern of patterns) {
      const lowerPattern = pattern.pattern.toLowerCase();

      if (lowerPattern.includes("reliable") || lowerPattern.includes("on-time") ||
          lowerPattern.includes("efficient") || lowerPattern.includes("experienced")) {
        strengths.push(pattern.pattern);
      } else if (lowerPattern.includes("prefer")) {
        preferences.push(pattern.pattern);
      } else if (lowerPattern.includes("concern") || lowerPattern.includes("issue") ||
                 lowerPattern.includes("late") || lowerPattern.includes("fatigue")) {
        concerns.push(pattern.pattern);
      } else if (lowerPattern.includes("best")) {
        bestFor.push(pattern.pattern);
      } else if (lowerPattern.includes("avoid")) {
        avoid.push(pattern.pattern);
      }
    }

    // Calculate reliability score based on patterns
    const positivePatterns = strengths.length + bestFor.length;
    const negativePatterns = concerns.length + avoid.length;
    const totalPatterns = positivePatterns + negativePatterns;
    const reliabilityScore = totalPatterns > 0
      ? Math.round((positivePatterns / totalPatterns) * 100)
      : 50; // Default to neutral if no patterns

    return {
      driverId,
      strengths,
      preferences,
      concerns,
      bestFor,
      avoid,
      reliabilityScore
    };
  }

  /**
   * Learn from decision outcome
   */
  async learnFromOutcome(
    tenantId: string,
    decisionId: string,
    outcome: "success" | "partial" | "failed",
    feedback?: string
  ): Promise<PatternCandidate[]> {
    const learnedPatterns: PatternCandidate[] = [];

    // Get the decision details
    const [decision] = await db
      .select()
      .from(neuralDecisions)
      .where(eq(neuralDecisions.id, decisionId))
      .limit(1);

    if (!decision) return learnedPatterns;

    const reasoning = decision.reasoning as Record<string, unknown>;

    // Strengthen or weaken patterns based on outcome
    if (outcome === "success") {
      // If decision was successful, strengthen related patterns
      const pattern: PatternCandidate = {
        type: "operational",
        pattern: `Decision approach "${decision.decision.substring(0, 50)}..." works well`,
        confidence: 65,
        evidence: { decisionId, outcome, feedback }
      };
      learnedPatterns.push(pattern);

      await this.memoryManager.recordPattern(tenantId, {
        type: pattern.type,
        pattern: pattern.pattern,
        confidence: pattern.confidence,
        evidence: pattern.evidence
      });
    } else if (outcome === "failed") {
      // If decision failed, record what not to do
      const pattern: PatternCandidate = {
        type: "operational",
        pattern: `Avoid: "${decision.decision.substring(0, 50)}..." - led to failure`,
        confidence: 70,
        evidence: { decisionId, outcome, feedback }
      };
      learnedPatterns.push(pattern);

      await this.memoryManager.recordPattern(tenantId, {
        type: pattern.type,
        pattern: pattern.pattern,
        confidence: pattern.confidence,
        evidence: pattern.evidence
      });
    }

    // Update the decision with outcome
    await this.memoryManager.updateDecisionOutcome(decisionId, outcome, undefined, feedback);

    return learnedPatterns;
  }

  /**
   * Get pattern statistics
   */
  async getPatternStats(tenantId: string): Promise<{
    byType: Record<PatternType, number>;
    avgConfidence: Record<PatternType, number>;
    topPatterns: PatternMemory[];
  }> {
    const patterns = await this.memoryManager.getRelevantPatterns({
      tenantId,
      limit: 100
    });

    const byType: Record<string, number> = {};
    const confidenceSum: Record<string, number> = {};
    const confidenceCount: Record<string, number> = {};

    for (const pattern of patterns) {
      const type = pattern.type as PatternType;
      byType[type] = (byType[type] || 0) + 1;
      confidenceSum[type] = (confidenceSum[type] || 0) + pattern.confidence;
      confidenceCount[type] = (confidenceCount[type] || 0) + 1;
    }

    const avgConfidence: Record<string, number> = {};
    for (const type of Object.keys(confidenceSum)) {
      avgConfidence[type] = Math.round(confidenceSum[type] / confidenceCount[type]);
    }

    // Get top patterns by confidence
    const topPatterns = patterns
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 10);

    return {
      byType: byType as Record<PatternType, number>,
      avgConfidence: avgConfidence as Record<PatternType, number>,
      topPatterns
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//                              SINGLETON
// ═══════════════════════════════════════════════════════════════════════════════

let patternTrackerInstance: PatternTracker | null = null;

export function getPatternTracker(): PatternTracker {
  if (!patternTrackerInstance) {
    patternTrackerInstance = new PatternTracker();
  }
  return patternTrackerInstance;
}
