/**
 * Memory Cleanup Job
 *
 * Handles nightly cleanup of expired neural memories.
 * Maintains the 6-week memory lifecycle while preserving high-value patterns.
 *
 * Schedule: Run nightly at 2:00 AM (or configurable)
 */

import { getMemoryManager } from "./memory-manager";
import { db } from "../../db";
import { neuralThoughts, neuralPatterns, neuralProfiles, neuralDecisions, neuralRouting } from "../../../shared/schema";
import { lte, and, or, eq, sql, gte, desc } from "drizzle-orm";

// ═══════════════════════════════════════════════════════════════════════════════
//                              TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface CleanupResult {
  startedAt: Date;
  completedAt: Date;
  deleted: {
    thoughts: number;
    patterns: number;
    profiles: number;
    decisions: number;
    routing: number;
  };
  preserved: {
    confirmedPatterns: number;
    activeProfiles: number;
  };
  compressed: {
    thoughts: number;
  };
  errors: string[];
}

export interface CleanupConfig {
  preserveConfirmedPatterns: boolean;
  preserveHighInteractionProfiles: boolean;
  compressOldThoughts: boolean;
  maxDecisionAge: number; // days
  maxRoutingAge: number; // days
  dryRun: boolean;
}

const DEFAULT_CONFIG: CleanupConfig = {
  preserveConfirmedPatterns: true,
  preserveHighInteractionProfiles: true,
  compressOldThoughts: true,
  maxDecisionAge: 90, // 3 months
  maxRoutingAge: 30, // 1 month
  dryRun: false
};

// ═══════════════════════════════════════════════════════════════════════════════
//                              CLEANUP JOB
// ═══════════════════════════════════════════════════════════════════════════════

export class MemoryCleanupJob {
  private memoryManager = getMemoryManager();
  private config: CleanupConfig;

  constructor(config: Partial<CleanupConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Run the full cleanup job
   */
  async run(): Promise<CleanupResult> {
    const startedAt = new Date();
    const errors: string[] = [];
    let deletedThoughts = 0;
    let deletedPatterns = 0;
    let deletedProfiles = 0;
    let deletedDecisions = 0;
    let deletedRouting = 0;
    let preservedPatterns = 0;
    let preservedProfiles = 0;
    let compressedThoughts = 0;

    console.log("🧹 Starting Neural Memory Cleanup Job...\n");

    try {
      // 1. Clean up expired thoughts
      console.log("   Step 1: Cleaning expired thoughts...");
      const thoughtResult = await this.cleanupExpiredThoughts();
      deletedThoughts = thoughtResult.deleted;
      if (this.config.compressOldThoughts) {
        compressedThoughts = await this.compressOldThoughts();
      }
      console.log(`   ✓ Deleted ${deletedThoughts} thoughts, compressed ${compressedThoughts}`);

      // 2. Clean up expired patterns (preserving confirmed ones)
      console.log("   Step 2: Cleaning expired patterns...");
      const patternResult = await this.cleanupExpiredPatterns();
      deletedPatterns = patternResult.deleted;
      preservedPatterns = patternResult.preserved;
      console.log(`   ✓ Deleted ${deletedPatterns} patterns, preserved ${preservedPatterns} confirmed`);

      // 3. Clean up expired profiles (preserving high-interaction ones)
      console.log("   Step 3: Cleaning expired profiles...");
      const profileResult = await this.cleanupExpiredProfiles();
      deletedProfiles = profileResult.deleted;
      preservedProfiles = profileResult.preserved;
      console.log(`   ✓ Deleted ${deletedProfiles} profiles, preserved ${preservedProfiles} active`);

      // 4. Clean up old decisions
      console.log("   Step 4: Cleaning old decisions...");
      deletedDecisions = await this.cleanupOldDecisions();
      console.log(`   ✓ Deleted ${deletedDecisions} old decisions`);

      // 5. Clean up old routing logs
      console.log("   Step 5: Cleaning old routing logs...");
      deletedRouting = await this.cleanupOldRouting();
      console.log(`   ✓ Deleted ${deletedRouting} old routing logs`);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      errors.push(errorMessage);
      console.error("   ❌ Cleanup error:", errorMessage);
    }

    const completedAt = new Date();
    const duration = (completedAt.getTime() - startedAt.getTime()) / 1000;

    console.log("\n╔══════════════════════════════════════════════════════════════════╗");
    console.log("║           MEMORY CLEANUP COMPLETE                                 ║");
    console.log("╠══════════════════════════════════════════════════════════════════╣");
    console.log(`║   Duration: ${duration.toFixed(2)}s                                              ║`);
    console.log(`║   Thoughts deleted: ${deletedThoughts.toString().padEnd(44)}║`);
    console.log(`║   Patterns deleted: ${deletedPatterns.toString().padEnd(44)}║`);
    console.log(`║   Profiles deleted: ${deletedProfiles.toString().padEnd(44)}║`);
    console.log(`║   Decisions deleted: ${deletedDecisions.toString().padEnd(43)}║`);
    console.log(`║   Routing deleted: ${deletedRouting.toString().padEnd(45)}║`);
    console.log(`║   Errors: ${errors.length.toString().padEnd(54)}║`);
    console.log("╚══════════════════════════════════════════════════════════════════╝\n");

    return {
      startedAt,
      completedAt,
      deleted: {
        thoughts: deletedThoughts,
        patterns: deletedPatterns,
        profiles: deletedProfiles,
        decisions: deletedDecisions,
        routing: deletedRouting
      },
      preserved: {
        confirmedPatterns: preservedPatterns,
        activeProfiles: preservedProfiles
      },
      compressed: {
        thoughts: compressedThoughts
      },
      errors
    };
  }

  /**
   * Clean up expired thoughts
   */
  private async cleanupExpiredThoughts(): Promise<{ deleted: number }> {
    if (this.config.dryRun) {
      const count = await db
        .select({ count: sql<number>`count(*)` })
        .from(neuralThoughts)
        .where(lte(neuralThoughts.expiresAt, new Date()));
      return { deleted: Number(count[0].count) };
    }

    const result = await db
      .delete(neuralThoughts)
      .where(lte(neuralThoughts.expiresAt, new Date()))
      .returning({ id: neuralThoughts.id });

    return { deleted: result.length };
  }

  /**
   * Compress old thoughts into summaries
   */
  private async compressOldThoughts(): Promise<number> {
    // Get thoughts older than 7 days that are "exploring" status
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    if (this.config.dryRun) {
      const count = await db
        .select({ count: sql<number>`count(*)` })
        .from(neuralThoughts)
        .where(
          and(
            lte(neuralThoughts.createdAt, oneWeekAgo),
            eq(neuralThoughts.status, "exploring")
          )
        );
      return Number(count[0].count);
    }

    // Mark old exploring thoughts as "ruled_out" to save space
    // In a more sophisticated system, we could summarize them
    const result = await db
      .update(neuralThoughts)
      .set({
        status: "ruled_out",
        metadata: { compressed: true, compressedAt: new Date().toISOString() }
      })
      .where(
        and(
          lte(neuralThoughts.createdAt, oneWeekAgo),
          eq(neuralThoughts.status, "exploring")
        )
      )
      .returning({ id: neuralThoughts.id });

    return result.length;
  }

  /**
   * Clean up expired patterns
   */
  private async cleanupExpiredPatterns(): Promise<{ deleted: number; preserved: number }> {
    const now = new Date();

    // Count preserved patterns (confirmed with high confidence)
    const preservedCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(neuralPatterns)
      .where(
        and(
          lte(neuralPatterns.expiresAt, now),
          eq(neuralPatterns.status, "confirmed"),
          gte(neuralPatterns.confidence, 70)
        )
      );
    const preserved = Number(preservedCount[0].count);

    if (this.config.dryRun) {
      const deleteCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(neuralPatterns)
        .where(
          and(
            lte(neuralPatterns.expiresAt, now),
            or(
              sql`${neuralPatterns.status} != 'confirmed'`,
              lte(neuralPatterns.confidence, 70)
            )
          )
        );
      return { deleted: Number(deleteCount[0].count), preserved };
    }

    // Extend expiration for preserved patterns
    if (this.config.preserveConfirmedPatterns) {
      const sixWeeksFromNow = new Date();
      sixWeeksFromNow.setDate(sixWeeksFromNow.getDate() + 42);

      await db
        .update(neuralPatterns)
        .set({ expiresAt: sixWeeksFromNow })
        .where(
          and(
            lte(neuralPatterns.expiresAt, now),
            eq(neuralPatterns.status, "confirmed"),
            gte(neuralPatterns.confidence, 70)
          )
        );
    }

    // Delete non-preserved expired patterns
    const result = await db
      .delete(neuralPatterns)
      .where(
        and(
          lte(neuralPatterns.expiresAt, now),
          or(
            sql`${neuralPatterns.status} != 'confirmed'`,
            lte(neuralPatterns.confidence, 70)
          )
        )
      )
      .returning({ id: neuralPatterns.id });

    return { deleted: result.length, preserved };
  }

  /**
   * Clean up expired profiles
   */
  private async cleanupExpiredProfiles(): Promise<{ deleted: number; preserved: number }> {
    const now = new Date();

    // Count profiles with high interaction (preserve these)
    const preservedCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(neuralProfiles)
      .where(
        and(
          lte(neuralProfiles.expiresAt, now),
          gte(neuralProfiles.interactionCount, 10)
        )
      );
    const preserved = Number(preservedCount[0].count);

    if (this.config.dryRun) {
      const deleteCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(neuralProfiles)
        .where(
          and(
            lte(neuralProfiles.expiresAt, now),
            lte(neuralProfiles.interactionCount, 10)
          )
        );
      return { deleted: Number(deleteCount[0].count), preserved };
    }

    // Extend expiration for high-interaction profiles
    if (this.config.preserveHighInteractionProfiles) {
      const sixWeeksFromNow = new Date();
      sixWeeksFromNow.setDate(sixWeeksFromNow.getDate() + 42);

      await db
        .update(neuralProfiles)
        .set({
          expiresAt: sixWeeksFromNow,
          lastUpdated: now
        })
        .where(
          and(
            lte(neuralProfiles.expiresAt, now),
            gte(neuralProfiles.interactionCount, 10)
          )
        );
    }

    // Delete low-interaction expired profiles
    const result = await db
      .delete(neuralProfiles)
      .where(
        and(
          lte(neuralProfiles.expiresAt, now),
          lte(neuralProfiles.interactionCount, 10)
        )
      )
      .returning({ id: neuralProfiles.id });

    return { deleted: result.length, preserved };
  }

  /**
   * Clean up old decisions
   */
  private async cleanupOldDecisions(): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.maxDecisionAge);

    if (this.config.dryRun) {
      const count = await db
        .select({ count: sql<number>`count(*)` })
        .from(neuralDecisions)
        .where(lte(neuralDecisions.createdAt, cutoffDate));
      return Number(count[0].count);
    }

    const result = await db
      .delete(neuralDecisions)
      .where(lte(neuralDecisions.createdAt, cutoffDate))
      .returning({ id: neuralDecisions.id });

    return result.length;
  }

  /**
   * Clean up old routing logs
   */
  private async cleanupOldRouting(): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.maxRoutingAge);

    if (this.config.dryRun) {
      const count = await db
        .select({ count: sql<number>`count(*)` })
        .from(neuralRouting)
        .where(lte(neuralRouting.createdAt, cutoffDate));
      return Number(count[0].count);
    }

    const result = await db
      .delete(neuralRouting)
      .where(lte(neuralRouting.createdAt, cutoffDate))
      .returning({ id: neuralRouting.id });

    return result.length;
  }

  /**
   * Get cleanup statistics (preview what would be cleaned)
   */
  async getCleanupStats(): Promise<{
    expiredThoughts: number;
    expiredPatterns: number;
    expiredProfiles: number;
    oldDecisions: number;
    oldRouting: number;
    preservablePatterns: number;
    preservableProfiles: number;
  }> {
    const now = new Date();
    const decisionCutoff = new Date();
    decisionCutoff.setDate(decisionCutoff.getDate() - this.config.maxDecisionAge);
    const routingCutoff = new Date();
    routingCutoff.setDate(routingCutoff.getDate() - this.config.maxRoutingAge);

    const [thoughts, patterns, profiles, decisions, routing, preservablePatterns, preservableProfiles] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(neuralThoughts).where(lte(neuralThoughts.expiresAt, now)),
      db.select({ count: sql<number>`count(*)` }).from(neuralPatterns).where(lte(neuralPatterns.expiresAt, now)),
      db.select({ count: sql<number>`count(*)` }).from(neuralProfiles).where(lte(neuralProfiles.expiresAt, now)),
      db.select({ count: sql<number>`count(*)` }).from(neuralDecisions).where(lte(neuralDecisions.createdAt, decisionCutoff)),
      db.select({ count: sql<number>`count(*)` }).from(neuralRouting).where(lte(neuralRouting.createdAt, routingCutoff)),
      db.select({ count: sql<number>`count(*)` }).from(neuralPatterns).where(
        and(lte(neuralPatterns.expiresAt, now), eq(neuralPatterns.status, "confirmed"), gte(neuralPatterns.confidence, 70))
      ),
      db.select({ count: sql<number>`count(*)` }).from(neuralProfiles).where(
        and(lte(neuralProfiles.expiresAt, now), gte(neuralProfiles.interactionCount, 10))
      )
    ]);

    return {
      expiredThoughts: Number(thoughts[0].count),
      expiredPatterns: Number(patterns[0].count),
      expiredProfiles: Number(profiles[0].count),
      oldDecisions: Number(decisions[0].count),
      oldRouting: Number(routing[0].count),
      preservablePatterns: Number(preservablePatterns[0].count),
      preservableProfiles: Number(preservableProfiles[0].count)
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//                              SCHEDULED RUNNER
// ═══════════════════════════════════════════════════════════════════════════════

let cleanupInterval: NodeJS.Timeout | null = null;

/**
 * Start the scheduled cleanup job
 */
export function startScheduledCleanup(intervalHours: number = 24): void {
  if (cleanupInterval) {
    console.log("Cleanup job already running");
    return;
  }

  const job = new MemoryCleanupJob();

  // Run immediately
  job.run().catch(console.error);

  // Then run on schedule
  const intervalMs = intervalHours * 60 * 60 * 1000;
  cleanupInterval = setInterval(() => {
    job.run().catch(console.error);
  }, intervalMs);

  console.log(`✅ Memory cleanup job scheduled to run every ${intervalHours} hours`);
}

/**
 * Stop the scheduled cleanup job
 */
export function stopScheduledCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    console.log("Memory cleanup job stopped");
  }
}

/**
 * Run cleanup once
 */
export async function runCleanupOnce(config?: Partial<CleanupConfig>): Promise<CleanupResult> {
  const job = new MemoryCleanupJob(config);
  return job.run();
}
