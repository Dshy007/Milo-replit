/**
 * Profile Builder
 *
 * Builds and maintains knowledge profiles for entities in the system.
 * Learns from interactions to create rich behavioral models.
 *
 * Entity Types:
 * - driver: Driver profiles with preferences, strengths, patterns
 * - block: Block characteristics and history
 * - route: Route-specific knowledge
 * - user: Dispatcher preferences and habits
 */

import { getMemoryManager, ProfileMemory } from "./memory-manager";
import { getPatternTracker, DriverPattern } from "./pattern-tracker";
import { db } from "../../db";
import { drivers, blocks, users } from "../../../shared/schema";
import { eq } from "drizzle-orm";

// ═══════════════════════════════════════════════════════════════════════════════
//                              TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface DriverProfile {
  id: string;
  name: string;
  // From database
  cdlNumber?: string;
  status?: string;
  // Learned traits
  strengths: string[];
  weaknesses: string[];
  preferences: {
    soloTypes?: string[];
    patternGroup?: string;
    preferredDays?: string[];
    preferredStartTimes?: string[];
    avoidConditions?: string[];
  };
  performance: {
    reliabilityScore: number;
    onTimeRate?: number;
    completionRate?: number;
  };
  specializations: string[];
  interactionCount: number;
  lastUpdated: Date;
}

export interface BlockProfile {
  id: string;
  name: string;
  // Learned traits
  difficulty: "easy" | "moderate" | "challenging" | "unknown";
  bestDriverTypes: string[];
  commonIssues: string[];
  optimalConditions: string[];
  historicalSuccessRate?: number;
  interactionCount: number;
  lastUpdated: Date;
}

export interface UserProfile {
  id: string;
  name: string;
  // Learned preferences
  communicationStyle: "detailed" | "concise" | "visual" | "unknown";
  preferredFeatures: string[];
  commonActions: string[];
  expertiseLevel: "beginner" | "intermediate" | "advanced" | "unknown";
  interactionCount: number;
  lastUpdated: Date;
}

// ═══════════════════════════════════════════════════════════════════════════════
//                              PROFILE BUILDER
// ═══════════════════════════════════════════════════════════════════════════════

export class ProfileBuilder {
  private memoryManager = getMemoryManager();
  private patternTracker = getPatternTracker();

  /**
   * Get or build a driver profile
   */
  async getDriverProfile(tenantId: string, driverId: string): Promise<DriverProfile | null> {
    // Get driver from database
    const [driver] = await db
      .select()
      .from(drivers)
      .where(eq(drivers.id, driverId))
      .limit(1);

    if (!driver) return null;

    // Get or create neural profile
    const neuralProfile = await this.memoryManager.getOrCreateProfile(
      tenantId,
      "driver",
      driverId
    );

    // Get pattern summary
    const patternSummary = await this.patternTracker.getDriverPatternSummary(tenantId, driverId);

    // Merge learned traits with existing data
    const traits = neuralProfile.learnedTraits as Record<string, unknown>;

    return {
      id: driverId,
      name: driver.name,
      cdlNumber: driver.cdlNumber || undefined,
      status: driver.status || undefined,
      strengths: patternSummary.strengths,
      weaknesses: patternSummary.concerns,
      preferences: {
        soloTypes: traits.preferredSoloTypes as string[] || [],
        patternGroup: traits.patternGroup as string || undefined,
        preferredDays: traits.preferredDays as string[] || [],
        preferredStartTimes: traits.preferredStartTimes as string[] || [],
        avoidConditions: patternSummary.avoid
      },
      performance: {
        reliabilityScore: patternSummary.reliabilityScore,
        onTimeRate: traits.onTimeRate as number || undefined,
        completionRate: traits.completionRate as number || undefined
      },
      specializations: patternSummary.bestFor,
      interactionCount: neuralProfile.interactionCount,
      lastUpdated: neuralProfile.lastUpdated
    };
  }

  /**
   * Update driver profile with new observations
   */
  async updateDriverProfile(
    tenantId: string,
    driverId: string,
    observations: {
      performance?: {
        onTime?: boolean;
        completed?: boolean;
        issues?: string[];
      };
      preferences?: {
        soloType?: string;
        day?: string;
        startTime?: string;
      };
      feedback?: string;
    }
  ): Promise<void> {
    const profile = await this.memoryManager.getOrCreateProfile(tenantId, "driver", driverId);
    const traits = profile.learnedTraits as Record<string, unknown>;

    // Update performance metrics
    if (observations.performance) {
      if (observations.performance.onTime !== undefined) {
        const currentOnTimeCount = (traits.onTimeCount as number) || 0;
        const currentTotalCount = (traits.totalDeliveries as number) || 0;
        const newOnTimeCount = currentOnTimeCount + (observations.performance.onTime ? 1 : 0);
        const newTotalCount = currentTotalCount + 1;

        traits.onTimeCount = newOnTimeCount;
        traits.totalDeliveries = newTotalCount;
        traits.onTimeRate = Math.round((newOnTimeCount / newTotalCount) * 100);
      }

      if (observations.performance.completed !== undefined) {
        const currentCompletedCount = (traits.completedCount as number) || 0;
        const currentAssignedCount = (traits.assignedCount as number) || 0;
        const newCompletedCount = currentCompletedCount + (observations.performance.completed ? 1 : 0);
        const newAssignedCount = currentAssignedCount + 1;

        traits.completedCount = newCompletedCount;
        traits.assignedCount = newAssignedCount;
        traits.completionRate = Math.round((newCompletedCount / newAssignedCount) * 100);
      }

      if (observations.performance.issues && observations.performance.issues.length > 0) {
        const currentIssues = (traits.recentIssues as string[]) || [];
        traits.recentIssues = [...observations.performance.issues, ...currentIssues].slice(0, 10);
      }
    }

    // Update preferences
    if (observations.preferences) {
      if (observations.preferences.soloType) {
        const soloTypes = (traits.preferredSoloTypes as string[]) || [];
        if (!soloTypes.includes(observations.preferences.soloType)) {
          traits.preferredSoloTypes = [...soloTypes, observations.preferences.soloType];
        }
      }

      if (observations.preferences.day) {
        const days = (traits.preferredDays as string[]) || [];
        if (!days.includes(observations.preferences.day)) {
          traits.preferredDays = [...days, observations.preferences.day];
        }
      }

      if (observations.preferences.startTime) {
        const times = (traits.preferredStartTimes as string[]) || [];
        if (!times.includes(observations.preferences.startTime)) {
          traits.preferredStartTimes = [...times, observations.preferences.startTime];
        }
      }
    }

    // Analyze feedback for patterns
    if (observations.feedback) {
      await this.patternTracker.analyzeForPatterns(tenantId, observations.feedback, {
        entityId: driverId,
        entityType: "driver"
      });
    }

    // Save updated profile
    await this.memoryManager.updateProfile(profile.id, traits, false);
  }

  /**
   * Get or build a block profile
   */
  async getBlockProfile(tenantId: string, blockId: string): Promise<BlockProfile | null> {
    // Get block from database
    const [block] = await db
      .select()
      .from(blocks)
      .where(eq(blocks.id, blockId))
      .limit(1);

    if (!block) return null;

    // Get or create neural profile
    const neuralProfile = await this.memoryManager.getOrCreateProfile(
      tenantId,
      "block",
      blockId
    );

    const traits = neuralProfile.learnedTraits as Record<string, unknown>;

    // Determine difficulty based on learned traits
    let difficulty: BlockProfile["difficulty"] = "unknown";
    const successRate = traits.successRate as number;
    if (successRate !== undefined) {
      if (successRate >= 90) difficulty = "easy";
      else if (successRate >= 70) difficulty = "moderate";
      else difficulty = "challenging";
    }

    return {
      id: blockId,
      name: block.name,
      difficulty,
      bestDriverTypes: (traits.bestDriverTypes as string[]) || [],
      commonIssues: (traits.commonIssues as string[]) || [],
      optimalConditions: (traits.optimalConditions as string[]) || [],
      historicalSuccessRate: successRate,
      interactionCount: neuralProfile.interactionCount,
      lastUpdated: neuralProfile.lastUpdated
    };
  }

  /**
   * Update block profile with assignment outcome
   */
  async updateBlockProfile(
    tenantId: string,
    blockId: string,
    outcome: {
      driverType?: string;
      success: boolean;
      issues?: string[];
      conditions?: string[];
    }
  ): Promise<void> {
    const profile = await this.memoryManager.getOrCreateProfile(tenantId, "block", blockId);
    const traits = profile.learnedTraits as Record<string, unknown>;

    // Update success rate
    const currentSuccessCount = (traits.successCount as number) || 0;
    const currentTotalCount = (traits.totalAssignments as number) || 0;
    const newSuccessCount = currentSuccessCount + (outcome.success ? 1 : 0);
    const newTotalCount = currentTotalCount + 1;

    traits.successCount = newSuccessCount;
    traits.totalAssignments = newTotalCount;
    traits.successRate = Math.round((newSuccessCount / newTotalCount) * 100);

    // Track successful driver types
    if (outcome.success && outcome.driverType) {
      const driverTypes = (traits.bestDriverTypes as string[]) || [];
      const typeCount = (traits.driverTypeSuccess as Record<string, number>) || {};
      typeCount[outcome.driverType] = (typeCount[outcome.driverType] || 0) + 1;
      traits.driverTypeSuccess = typeCount;

      // Update best driver types based on success count
      const sortedTypes = Object.entries(typeCount)
        .sort((a, b) => b[1] - a[1])
        .map(([type]) => type);
      traits.bestDriverTypes = sortedTypes.slice(0, 5);
    }

    // Track issues
    if (outcome.issues && outcome.issues.length > 0) {
      const currentIssues = (traits.commonIssues as string[]) || [];
      const issueFrequency = (traits.issueFrequency as Record<string, number>) || {};

      for (const issue of outcome.issues) {
        issueFrequency[issue] = (issueFrequency[issue] || 0) + 1;
      }
      traits.issueFrequency = issueFrequency;

      // Update common issues based on frequency
      const sortedIssues = Object.entries(issueFrequency)
        .sort((a, b) => b[1] - a[1])
        .map(([issue]) => issue);
      traits.commonIssues = sortedIssues.slice(0, 5);
    }

    // Track optimal conditions
    if (outcome.success && outcome.conditions) {
      const currentConditions = (traits.optimalConditions as string[]) || [];
      const conditionSuccess = (traits.conditionSuccess as Record<string, number>) || {};

      for (const condition of outcome.conditions) {
        conditionSuccess[condition] = (conditionSuccess[condition] || 0) + 1;
      }
      traits.conditionSuccess = conditionSuccess;

      // Update optimal conditions
      const sortedConditions = Object.entries(conditionSuccess)
        .sort((a, b) => b[1] - a[1])
        .map(([condition]) => condition);
      traits.optimalConditions = sortedConditions.slice(0, 5);
    }

    await this.memoryManager.updateProfile(profile.id, traits, false);
  }

  /**
   * Get or build a user (dispatcher) profile
   */
  async getUserProfile(tenantId: string, userId: string): Promise<UserProfile | null> {
    // Get user from database
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) return null;

    // Get or create neural profile
    const neuralProfile = await this.memoryManager.getOrCreateProfile(
      tenantId,
      "user",
      userId
    );

    const traits = neuralProfile.learnedTraits as Record<string, unknown>;

    // Determine communication style
    let communicationStyle: UserProfile["communicationStyle"] = "unknown";
    const messageLength = traits.avgMessageLength as number;
    if (messageLength !== undefined) {
      if (messageLength > 100) communicationStyle = "detailed";
      else if (messageLength < 30) communicationStyle = "concise";
    }

    // Determine expertise level
    let expertiseLevel: UserProfile["expertiseLevel"] = "unknown";
    const interactions = neuralProfile.interactionCount;
    const complexQueries = (traits.complexQueryCount as number) || 0;
    if (interactions > 50 && complexQueries > 20) expertiseLevel = "advanced";
    else if (interactions > 20) expertiseLevel = "intermediate";
    else if (interactions > 0) expertiseLevel = "beginner";

    return {
      id: userId,
      name: user.name || "Unknown User",
      communicationStyle,
      preferredFeatures: (traits.preferredFeatures as string[]) || [],
      commonActions: (traits.commonActions as string[]) || [],
      expertiseLevel,
      interactionCount: neuralProfile.interactionCount,
      lastUpdated: neuralProfile.lastUpdated
    };
  }

  /**
   * Record user interaction
   */
  async recordUserInteraction(
    tenantId: string,
    userId: string,
    interaction: {
      action: string;
      feature?: string;
      messageLength?: number;
      isComplexQuery?: boolean;
    }
  ): Promise<void> {
    const profile = await this.memoryManager.getOrCreateProfile(tenantId, "user", userId);
    const traits = profile.learnedTraits as Record<string, unknown>;

    // Track common actions
    const actionCounts = (traits.actionCounts as Record<string, number>) || {};
    actionCounts[interaction.action] = (actionCounts[interaction.action] || 0) + 1;
    traits.actionCounts = actionCounts;

    // Update common actions list
    const sortedActions = Object.entries(actionCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([action]) => action);
    traits.commonActions = sortedActions.slice(0, 10);

    // Track preferred features
    if (interaction.feature) {
      const featureCounts = (traits.featureCounts as Record<string, number>) || {};
      featureCounts[interaction.feature] = (featureCounts[interaction.feature] || 0) + 1;
      traits.featureCounts = featureCounts;

      const sortedFeatures = Object.entries(featureCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([feature]) => feature);
      traits.preferredFeatures = sortedFeatures.slice(0, 5);
    }

    // Track message length for communication style
    if (interaction.messageLength !== undefined) {
      const totalLength = (traits.totalMessageLength as number) || 0;
      const messageCount = (traits.messageCount as number) || 0;
      traits.totalMessageLength = totalLength + interaction.messageLength;
      traits.messageCount = messageCount + 1;
      traits.avgMessageLength = Math.round(traits.totalMessageLength as number / traits.messageCount as number);
    }

    // Track complex queries
    if (interaction.isComplexQuery) {
      traits.complexQueryCount = ((traits.complexQueryCount as number) || 0) + 1;
    }

    await this.memoryManager.updateProfile(profile.id, traits, false);
  }

  /**
   * Find similar drivers based on profiles
   */
  async findSimilarDrivers(
    tenantId: string,
    driverId: string,
    limit: number = 5
  ): Promise<{ driverId: string; similarity: number }[]> {
    const targetProfile = await this.getDriverProfile(tenantId, driverId);
    if (!targetProfile) return [];

    // Get all driver profiles
    const allProfiles = await this.memoryManager.getEntityProfiles({
      tenantId,
      entityType: "driver"
    });

    const similarities: { driverId: string; similarity: number }[] = [];

    for (const profile of allProfiles) {
      if (profile.entityId === driverId) continue;

      const otherDriver = await this.getDriverProfile(tenantId, profile.entityId);
      if (!otherDriver) continue;

      // Calculate similarity score
      let score = 0;
      let factors = 0;

      // Compare specializations
      const sharedSpecializations = targetProfile.specializations.filter(
        s => otherDriver.specializations.includes(s)
      );
      score += sharedSpecializations.length * 20;
      factors++;

      // Compare preferences
      const sharedSoloTypes = (targetProfile.preferences.soloTypes || []).filter(
        s => (otherDriver.preferences.soloTypes || []).includes(s)
      );
      score += sharedSoloTypes.length * 15;
      factors++;

      // Compare reliability
      const reliabilityDiff = Math.abs(
        targetProfile.performance.reliabilityScore - otherDriver.performance.reliabilityScore
      );
      score += Math.max(0, 100 - reliabilityDiff);
      factors++;

      const similarity = Math.round(score / factors);
      similarities.push({ driverId: profile.entityId, similarity });
    }

    return similarities
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//                              SINGLETON
// ═══════════════════════════════════════════════════════════════════════════════

let profileBuilderInstance: ProfileBuilder | null = null;

export function getProfileBuilder(): ProfileBuilder {
  if (!profileBuilderInstance) {
    profileBuilderInstance = new ProfileBuilder();
  }
  return profileBuilderInstance;
}
