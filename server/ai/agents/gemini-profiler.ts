/**
 * Gemini Profiler Agent
 *
 * Uses Google's Gemini AI to analyze driver assignment history and generate
 * "DNA profiles" - AI-inferred scheduling preferences based on historical patterns.
 *
 * "I read the story of past assignments. I find the hidden patterns. I give each driver their DNA."
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { format } from "date-fns";

// ═══════════════════════════════════════════════════════════════════════════════
//                              TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface HistoricalAssignment {
  driverId: string;
  driverName: string;
  blockId: string;
  serviceDate: Date;
  dayOfWeek: number; // 0 = Sunday, 6 = Saturday
  startTime: string; // "HH:MM" format
  endTime?: string;
  tractorId?: string;
  contractType: string; // solo1, solo2, team
}

export interface DNAAnalysisInput {
  driverId: string;
  driverName: string;
  assignments: HistoricalAssignment[];
  analysisStartDate: Date;
  analysisEndDate: Date;
}

export interface DNAProfile {
  driverId: string;
  driverName: string;

  // Structured preferences
  preferredDays: string[]; // ['sunday', 'monday', ...]
  preferredStartTimes: string[]; // ['04:00', '04:30', ...]
  preferredTractors: string[]; // ['Tractor_3', 'Tractor_5', ...]
  preferredContractType: string; // 'solo1', 'solo2', 'team'
  homeBlocks: string[]; // Block IDs driver consistently runs

  // Pattern analysis
  patternGroup: 'sunWed' | 'wedSat' | 'mixed';
  consistencyScore: number; // 0.0 to 1.0

  // AI-generated content
  aiSummary: string;
  insights: string[];

  // Metadata
  weeksAnalyzed: number;
  assignmentsAnalyzed: number;
}

// Day names for pattern matching
const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// ═══════════════════════════════════════════════════════════════════════════════
//                              GEMINI PROFILER
// ═══════════════════════════════════════════════════════════════════════════════

export class GeminiProfiler {
  private client: GoogleGenerativeAI;
  private model: any;
  private initialized: boolean = false;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY || "";
    if (!apiKey) {
      console.warn("[GeminiProfiler] No GEMINI_API_KEY found - AI summaries will be disabled");
    }
    this.client = new GoogleGenerativeAI(apiKey);
  }

  /**
   * Initialize the Gemini model
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      this.model = this.client.getGenerativeModel({
        model: "gemini-1.5-flash" // Free tier, fast responses
      });
      this.initialized = true;
      console.log("[GeminiProfiler] Initialized with gemini-1.5-flash");
    } catch (error) {
      console.error("[GeminiProfiler] Failed to initialize:", error);
      throw error;
    }
  }

  /**
   * Analyze a driver's historical assignments and generate their DNA profile
   */
  async analyzeDriverHistory(input: DNAAnalysisInput): Promise<DNAProfile> {
    const { driverId, driverName, assignments, analysisStartDate, analysisEndDate } = input;

    // First, compute structured patterns from the data
    const structuredProfile = this.computeStructuredPatterns(assignments);

    // Then, use Gemini to generate natural language summary and insights
    let aiSummary = "";
    let insights: string[] = [];

    if (this.model && assignments.length > 0) {
      try {
        const aiResult = await this.generateAISummary(driverName, assignments, structuredProfile);
        aiSummary = aiResult.summary;
        insights = aiResult.insights;
      } catch (error) {
        console.error("[GeminiProfiler] AI summary generation failed:", error);
        // Fall back to computed summary
        aiSummary = this.generateFallbackSummary(driverName, structuredProfile);
        insights = this.generateFallbackInsights(structuredProfile);
      }
    } else {
      // No Gemini or no assignments - use computed summary
      aiSummary = this.generateFallbackSummary(driverName, structuredProfile);
      insights = this.generateFallbackInsights(structuredProfile);
    }

    // Calculate weeks analyzed
    const weeksAnalyzed = Math.ceil(
      (analysisEndDate.getTime() - analysisStartDate.getTime()) / (7 * 24 * 60 * 60 * 1000)
    );

    return {
      driverId,
      driverName,
      ...structuredProfile,
      aiSummary,
      insights,
      weeksAnalyzed,
      assignmentsAnalyzed: assignments.length,
    };
  }

  /**
   * Compute structured patterns from assignment history
   */
  private computeStructuredPatterns(assignments: HistoricalAssignment[]): {
    preferredDays: string[];
    preferredStartTimes: string[];
    preferredTractors: string[];
    preferredContractType: string;
    homeBlocks: string[];
    patternGroup: 'sunWed' | 'wedSat' | 'mixed';
    consistencyScore: number;
  } {
    if (assignments.length === 0) {
      return {
        preferredDays: [],
        preferredStartTimes: [],
        preferredTractors: [],
        preferredContractType: 'solo1',
        homeBlocks: [],
        patternGroup: 'mixed',
        consistencyScore: 0,
      };
    }

    // Count day frequencies
    const dayFrequency = new Map<number, number>();
    const timeFrequency = new Map<string, number>();
    const tractorFrequency = new Map<string, number>();
    const contractFrequency = new Map<string, number>();
    const blockFrequency = new Map<string, number>();

    for (const assignment of assignments) {
      // Days
      dayFrequency.set(
        assignment.dayOfWeek,
        (dayFrequency.get(assignment.dayOfWeek) || 0) + 1
      );

      // Start times
      if (assignment.startTime) {
        timeFrequency.set(
          assignment.startTime,
          (timeFrequency.get(assignment.startTime) || 0) + 1
        );
      }

      // Tractors
      if (assignment.tractorId) {
        tractorFrequency.set(
          assignment.tractorId,
          (tractorFrequency.get(assignment.tractorId) || 0) + 1
        );
      }

      // Contract types
      if (assignment.contractType) {
        contractFrequency.set(
          assignment.contractType,
          (contractFrequency.get(assignment.contractType) || 0) + 1
        );
      }

      // Blocks
      if (assignment.blockId) {
        blockFrequency.set(
          assignment.blockId,
          (blockFrequency.get(assignment.blockId) || 0) + 1
        );
      }
    }

    // Get top preferences
    const preferredDays = this.getTopN(dayFrequency, 4)
      .map(d => DAY_NAMES[d as number]);

    const preferredStartTimes = this.getTopN(timeFrequency, 3);
    const preferredTractors = this.getTopN(tractorFrequency, 2);

    // Get most common contract type
    const preferredContractType = this.getTopN(contractFrequency, 1)[0] || 'solo1';

    // Get home blocks (run 3+ times)
    const homeBlocks = Array.from(blockFrequency.entries())
      .filter(([_, count]) => count >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([blockId]) => blockId);

    // Determine pattern group
    const patternGroup = this.determinePatternGroup(dayFrequency);

    // Calculate consistency score
    const consistencyScore = this.calculateConsistencyScore(assignments, dayFrequency);

    return {
      preferredDays,
      preferredStartTimes,
      preferredTractors,
      preferredContractType,
      homeBlocks,
      patternGroup,
      consistencyScore,
    };
  }

  /**
   * Get top N items from a frequency map
   */
  private getTopN<T>(frequencyMap: Map<T, number>, n: number): T[] {
    return Array.from(frequencyMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([item]) => item);
  }

  /**
   * Determine if driver follows Sun-Wed, Wed-Sat, or mixed pattern
   */
  private determinePatternGroup(dayFrequency: Map<number, number>): 'sunWed' | 'wedSat' | 'mixed' {
    const sunWedDays = [0, 1, 2, 3]; // Sun-Wed
    const wedSatDays = [3, 4, 5, 6]; // Wed-Sat

    let sunWedCount = 0;
    let wedSatCount = 0;
    let totalCount = 0;

    for (const [day, count] of dayFrequency) {
      totalCount += count;
      if (sunWedDays.includes(day)) sunWedCount += count;
      if (wedSatDays.includes(day)) wedSatCount += count;
    }

    // Subtract Wednesday overlap (counted in both)
    const wedCount = dayFrequency.get(3) || 0;
    sunWedCount -= wedCount / 2;
    wedSatCount -= wedCount / 2;

    const sunWedRatio = sunWedCount / totalCount;
    const wedSatRatio = wedSatCount / totalCount;

    if (sunWedRatio >= 0.7) return 'sunWed';
    if (wedSatRatio >= 0.7) return 'wedSat';
    return 'mixed';
  }

  /**
   * Calculate pattern match score - how well the driver matches their detected pattern group
   *
   * For Sun-Wed drivers: % of assignments on Sun, Mon, Tue, Wed
   * For Wed-Sat drivers: % of assignments on Wed, Thu, Fri, Sat
   * For mixed drivers: Uses time consistency (how regular are their start times)
   */
  private calculateConsistencyScore(
    assignments: HistoricalAssignment[],
    dayFrequency: Map<number, number>
  ): number {
    if (assignments.length < 3) return 0;

    const totalAssignments = assignments.length;

    // First determine pattern group
    const patternGroup = this.determinePatternGroup(dayFrequency);

    // For mixed pattern, use time consistency as the "match" score
    if (patternGroup === 'mixed') {
      const timeMinutes = assignments
        .filter(a => a.startTime)
        .map(a => {
          const [h, m] = a.startTime.split(':').map(Number);
          return h * 60 + m;
        });

      if (timeMinutes.length === 0) return 0.5;

      const mean = timeMinutes.reduce((a, b) => a + b, 0) / timeMinutes.length;
      const variance = timeMinutes.reduce((sum, t) => sum + Math.pow(t - mean, 2), 0) / timeMinutes.length;
      const stdDev = Math.sqrt(variance);
      // 60 minutes std dev = 0.5 score, 0 minutes = 1.0
      return Math.round(Math.max(0, 1 - (stdDev / 120)) * 100) / 100;
    }

    // For Sun-Wed or Wed-Sat patterns, calculate % of assignments matching the pattern
    const sunWedDays = [0, 1, 2, 3]; // Sun, Mon, Tue, Wed
    const wedSatDays = [3, 4, 5, 6]; // Wed, Thu, Fri, Sat
    const targetDays = patternGroup === 'sunWed' ? sunWedDays : wedSatDays;

    let matchingAssignments = 0;
    for (const assignment of assignments) {
      if (targetDays.includes(assignment.dayOfWeek)) {
        matchingAssignments++;
      }
    }

    const patternMatch = matchingAssignments / totalAssignments;
    return Math.round(patternMatch * 100) / 100;
  }

  /**
   * Calculate Shannon entropy
   */
  private calculateEntropy(frequencyMap: Map<number, number>, total: number): number {
    let entropy = 0;
    for (const count of frequencyMap.values()) {
      if (count > 0) {
        const p = count / total;
        entropy -= p * Math.log2(p);
      }
    }
    return entropy;
  }

  /**
   * Generate AI summary using Gemini
   */
  private async generateAISummary(
    driverName: string,
    assignments: HistoricalAssignment[],
    structuredProfile: {
      preferredDays: string[];
      preferredStartTimes: string[];
      preferredTractors: string[];
      preferredContractType: string;
      patternGroup: 'sunWed' | 'wedSat' | 'mixed';
      consistencyScore: number;
    }
  ): Promise<{ summary: string; insights: string[] }> {
    if (!this.model) {
      throw new Error("Gemini model not initialized");
    }

    // Format assignments for the prompt
    const assignmentSummary = this.formatAssignmentsForPrompt(assignments);

    const prompt = `You are analyzing a commercial truck driver's schedule history to create a preference profile.

DRIVER: ${driverName}
ASSIGNMENT HISTORY (last 12 weeks):
${assignmentSummary}

COMPUTED PATTERNS:
- Pattern Group: ${structuredProfile.patternGroup} (${structuredProfile.patternGroup === 'sunWed' ? 'Sunday-Wednesday' : structuredProfile.patternGroup === 'wedSat' ? 'Wednesday-Saturday' : 'Mixed'})
- Preferred Days: ${structuredProfile.preferredDays.join(', ') || 'None detected'}
- Preferred Start Times: ${structuredProfile.preferredStartTimes.join(', ') || 'Varied'}
- Preferred Tractors: ${structuredProfile.preferredTractors.join(', ') || 'Flexible'}
- Contract Type: ${structuredProfile.preferredContractType}
- Consistency Score: ${Math.round(structuredProfile.consistencyScore * 100)}%

Generate a JSON response with:
1. "summary": A 2-3 sentence natural language description of this driver's typical schedule and preferences. Write as if describing them to a dispatcher. Be specific about days and times.
2. "insights": An array of 3-5 short, specific insights about patterns you noticed. Each should be one sentence, highlighting something useful for scheduling.

Example format:
{
  "summary": "Maria is a highly consistent Solo1 driver who prefers early morning shifts (4-5 AM) on the Sun-Wed pattern. She has worked Tractor_3 exclusively for the past 8 weeks and rarely deviates from her routine.",
  "insights": [
    "Has worked Tractor_3 on Sundays for 8 consecutive weeks",
    "Never scheduled after 07:00 start time",
    "95% on-time rate over last 12 weeks",
    "Prefers MKC domicile routes"
  ]
}

Return ONLY valid JSON, no additional text.`;

    const result = await this.model.generateContent(prompt);
    const responseText = result.response.text();

    // Parse JSON from response
    try {
      // Extract JSON from response (handle potential markdown code blocks)
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in response");
      }

      const parsed = JSON.parse(jsonMatch[0]);
      return {
        summary: parsed.summary || this.generateFallbackSummary(driverName, structuredProfile),
        insights: Array.isArray(parsed.insights) ? parsed.insights : [],
      };
    } catch (parseError) {
      console.error("[GeminiProfiler] Failed to parse AI response:", parseError);
      throw parseError;
    }
  }

  /**
   * Format assignments for the AI prompt
   */
  private formatAssignmentsForPrompt(assignments: HistoricalAssignment[]): string {
    // Group by week
    const weekMap = new Map<string, HistoricalAssignment[]>();

    for (const assignment of assignments) {
      const weekKey = format(assignment.serviceDate, 'yyyy-MM-dd');
      if (!weekMap.has(weekKey)) {
        weekMap.set(weekKey, []);
      }
      weekMap.get(weekKey)!.push(assignment);
    }

    // Format each week
    const lines: string[] = [];
    const sortedWeeks = Array.from(weekMap.keys()).sort().slice(-12); // Last 12 weeks

    for (const week of sortedWeeks) {
      const weekAssignments = weekMap.get(week)!;
      const days = weekAssignments.map(a =>
        `${DAY_NAMES[a.dayOfWeek]} ${a.startTime} (${a.tractorId || 'no tractor'}, ${a.contractType})`
      ).join(', ');
      lines.push(`Week of ${week}: ${days}`);
    }

    return lines.join('\n');
  }

  /**
   * Generate fallback summary when Gemini is unavailable
   */
  private generateFallbackSummary(
    driverName: string,
    profile: {
      preferredDays: string[];
      preferredStartTimes: string[];
      preferredTractors: string[];
      preferredContractType: string;
      patternGroup: 'sunWed' | 'wedSat' | 'mixed';
      consistencyScore: number;
    }
  ): string {
    const patternDesc = profile.patternGroup === 'sunWed'
      ? 'Sun-Wed pattern'
      : profile.patternGroup === 'wedSat'
        ? 'Wed-Sat pattern'
        : 'flexible schedule';

    const consistencyDesc = profile.consistencyScore >= 0.8
      ? 'highly consistent'
      : profile.consistencyScore >= 0.5
        ? 'moderately consistent'
        : 'flexible';

    const firstName = driverName.split(' ')[0];
    const timeRange = profile.preferredStartTimes.length > 0
      ? profile.preferredStartTimes.slice(0, 2).join('-')
      : 'varied';

    return `${firstName} is a ${consistencyDesc} ${profile.preferredContractType.toUpperCase()} driver who typically works the ${patternDesc}. Preferred start times are around ${timeRange}.`;
  }

  /**
   * Generate fallback insights when Gemini is unavailable
   */
  private generateFallbackInsights(profile: {
    preferredDays: string[];
    preferredStartTimes: string[];
    preferredTractors: string[];
    homeBlocks: string[];
    consistencyScore: number;
  }): string[] {
    const insights: string[] = [];

    if (profile.preferredDays.length > 0) {
      insights.push(`Most commonly works on ${profile.preferredDays.slice(0, 3).join(', ')}`);
    }

    if (profile.preferredTractors.length > 0) {
      insights.push(`Prefers ${profile.preferredTractors[0]} for assignments`);
    }

    if (profile.homeBlocks.length > 0) {
      insights.push(`Has ${profile.homeBlocks.length} "home" blocks run consistently`);
    }

    if (profile.consistencyScore >= 0.8) {
      insights.push(`Very predictable schedule - ${Math.round(profile.consistencyScore * 100)}% consistency`);
    }

    return insights;
  }

  /**
   * Batch analyze multiple drivers
   */
  async analyzeMultipleDrivers(
    inputs: DNAAnalysisInput[],
    onProgress?: (completed: number, total: number) => void
  ): Promise<DNAProfile[]> {
    const results: DNAProfile[] = [];
    const total = inputs.length;

    for (let i = 0; i < inputs.length; i++) {
      try {
        const profile = await this.analyzeDriverHistory(inputs[i]);
        results.push(profile);
      } catch (error) {
        console.error(`[GeminiProfiler] Failed to analyze driver ${inputs[i].driverId}:`, error);
        // Create minimal profile on error
        results.push({
          driverId: inputs[i].driverId,
          driverName: inputs[i].driverName,
          preferredDays: [],
          preferredStartTimes: [],
          preferredTractors: [],
          preferredContractType: 'solo1',
          homeBlocks: [],
          patternGroup: 'mixed',
          consistencyScore: 0,
          aiSummary: 'Analysis failed - insufficient data or API error',
          insights: [],
          weeksAnalyzed: 0,
          assignmentsAnalyzed: inputs[i].assignments.length,
        });
      }

      if (onProgress) {
        onProgress(i + 1, total);
      }

      // Rate limiting: small delay between API calls
      if (this.model && i < inputs.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    return results;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//                              SINGLETON
// ═══════════════════════════════════════════════════════════════════════════════

let profilerInstance: GeminiProfiler | null = null;

export async function getGeminiProfiler(): Promise<GeminiProfiler> {
  if (!profilerInstance) {
    profilerInstance = new GeminiProfiler();
    await profilerInstance.initialize();
  }
  return profilerInstance;
}
