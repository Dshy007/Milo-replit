/**
 * Schedule Pipeline - Unified Orchestrator
 *
 * Connects all scheduling systems into ONE pipeline:
 *
 * XGBoost Ownership → Auto-Assignment Bump Logic → Constraint Filter → OR-Tools → LLM Explanation
 *
 * Step 1: XGBoost outputs scores for all (driver, slot) pairs
 * Step 2: Auto-Assignment adds bump penalties (±2h logic)
 * Step 3: Code filters out invalid options (6 days max, double-booking, rest periods)
 * Step 4: OR-Tools uses filtered scores for global optimization
 * Step 5: LLM explains the final assignments (future)
 */

import { spawn } from "child_process";
import path from "path";
import { db } from "./db";
import { contracts } from "../shared/schema";
import { eq, and } from "drizzle-orm";

// =============================================================================
// CONSTANTS
// =============================================================================

const DAY_NAME_TO_INDEX: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

const MIN_DAYS_PER_WEEK = 4;  // Fairness floor - everyone gets minimum work
const MAX_DAYS_PER_WEEK = 6;  // Safety cap - no one works 7 days

/**
 * Compute target days per week with fairness floor and safety cap.
 * Formula: targetDays = max(4, min(xgboostPattern, 6))
 *
 * - 4-day minimum ensures fair distribution of work
 * - 6-day maximum prevents driver burnout (7-day weeks)
 * - Unknown patterns default to fairness floor
 */
function computeTargetDays(pattern: number | undefined): number {
  if (pattern === undefined || pattern === null) {
    return MIN_DAYS_PER_WEEK;  // Unknown driver gets fairness floor
  }
  return Math.max(MIN_DAYS_PER_WEEK, Math.min(pattern, MAX_DAYS_PER_WEEK));
}

// =============================================================================
// TYPES
// =============================================================================

export interface SlotKey {
  soloType: string;      // "solo1" | "solo2"
  tractorId: string;     // "Tractor_1"
  canonicalTime: string; // "16:30"
  dayOfWeek: string;     // "saturday"
}

export interface DriverScore {
  driverId: string;
  driverName: string;
  score: number;         // 0-1, combined score
  ownershipScore: number; // from XGBoost
  bumpPenalty: number;   // from Auto-Assignment logic
  bumpMinutes: number;   // actual bump amount
  method: "ownership" | "bump" | "fallback";
  reason: string;
}

export interface BlockCandidate {
  blockId: string;
  slot: SlotKey;
  candidates: DriverScore[];  // ranked by score
}

export interface SchedulingSettings {
  predictability: number;    // 0.2 to 1.0 (how closely to follow patterns)
  timeFlexibility: number;   // 0, 1, 2, 3, or 4 hours (bump tolerance)
  memoryLength: number;      // 3, 5, 7, 9, or 12 weeks (history lookback)
}

export interface PipelineInput {
  tenantId: string;
  blocks: Array<{
    id: string;
    soloType: string;
    tractorId: string;
    canonicalTime: string;
    dayOfWeek: string;
    serviceDate: string;
  }>;
  availableDriverIds: string[];
  driverHistories: Record<string, any[]>; // driverId -> assignment history
  assignedSlots: Map<string, string>; // slotKey -> driverId (already taken)
  settings: SchedulingSettings; // User-controlled sliders
}

export interface PipelineOutput {
  assignments: Array<{
    blockId: string;
    driverId: string;
    driverName: string;
    score: number;
    method: string;
    reason: string;
  }>;
  unassigned: string[];
  stats: {
    totalBlocks: number;
    totalDrivers: number;
    assigned: number;
    xgboostHits: number;
    bumpFallbacks: number;
  };
}

// =============================================================================
// STEP 1: XGBoost Ownership + Availability Scores
// =============================================================================

interface OwnershipResult {
  driver: string;
  confidence: number;
  slot: string;
}

interface AvailabilityResult {
  driverId: string;
  date: string;
  probability: number;
}

/**
 * Slot ownership distribution - classifies slot as OWNED vs ROTATING
 */
interface SlotDistribution {
  slot_type: "owned" | "rotating" | "unknown";
  owner: string | null;        // Driver name if owned, null if rotating
  owner_share: number;         // 0.0-1.0, highest share
  shares: Record<string, number>; // All drivers' shares
  total_assignments: number;
  slot: string;
}

/**
 * Call XGBoost Ownership model to predict slot owner
 */
async function predictSlotOwner(slot: SlotKey): Promise<OwnershipResult> {
  return new Promise((resolve) => {
    const input = JSON.stringify({
      action: "predict",
      soloType: slot.soloType,
      tractorId: slot.tractorId,
      dayOfWeek: DAY_NAME_TO_INDEX[slot.dayOfWeek.toLowerCase()] ?? 0,
      canonicalTime: slot.canonicalTime,
    });

    const pythonProcess = spawn("python", ["python/xgboost_ownership.py"], {
      cwd: process.cwd(),
    });

    let stdout = "";
    let stderr = "";

    pythonProcess.stdin.write(input);
    pythonProcess.stdin.end();

    pythonProcess.stdout.on("data", (data) => { stdout += data.toString(); });
    pythonProcess.stderr.on("data", (data) => { stderr += data.toString(); });

    pythonProcess.on("close", (code) => {
      if (code !== 0 || !stdout.trim()) {
        console.error(`[Ownership] Error: ${stderr}`);
        resolve({ driver: "Unknown", confidence: 0, slot: "" });
        return;
      }
      try {
        const result = JSON.parse(stdout.trim());
        resolve({
          driver: result.driver || "Unknown",
          confidence: result.confidence || 0,
          slot: result.slot || "",
        });
      } catch (e) {
        resolve({ driver: "Unknown", confidence: 0, slot: "" });
      }
    });
  });
}

/**
 * Get ownership distribution for a slot - classifies as OWNED (70%+) vs ROTATING
 */
async function getSlotDistribution(slot: SlotKey): Promise<SlotDistribution> {
  return new Promise((resolve) => {
    const input = JSON.stringify({
      action: "get_distribution",
      soloType: slot.soloType,
      tractorId: slot.tractorId,
      dayOfWeek: DAY_NAME_TO_INDEX[slot.dayOfWeek.toLowerCase()] ?? 0,
      canonicalTime: slot.canonicalTime,
    });

    const pythonProcess = spawn("python", ["python/xgboost_ownership.py"], {
      cwd: process.cwd(),
    });

    let stdout = "";
    let stderr = "";

    pythonProcess.stdin.write(input);
    pythonProcess.stdin.end();

    pythonProcess.stdout.on("data", (data) => { stdout += data.toString(); });
    pythonProcess.stderr.on("data", (data) => { stderr += data.toString(); });

    pythonProcess.on("close", (code) => {
      if (code !== 0 || !stdout.trim()) {
        console.error(`[Distribution] Error: ${stderr}`);
        resolve({
          slot_type: "unknown",
          owner: null,
          owner_share: 0,
          shares: {},
          total_assignments: 0,
          slot: makeSlotKey(slot),
        });
        return;
      }
      try {
        const result = JSON.parse(stdout.trim());
        resolve(result as SlotDistribution);
      } catch (e) {
        resolve({
          slot_type: "unknown",
          owner: null,
          owner_share: 0,
          shares: {},
          total_assignments: 0,
          slot: makeSlotKey(slot),
        });
      }
    });
  });
}

/**
 * Driver pattern from XGBoost ownership model
 */
interface DriverPattern {
  driver: string;
  typical_days: number;     // e.g., 5 for Josh
  day_list: string[];       // e.g., ['Tuesday', 'Monday', 'Sunday', ...]
  day_counts: Record<string, number>;
  confidence: number;
}

/**
 * Get a driver's typical work pattern from XGBoost ownership model.
 * Used to cap assignments at their pattern rather than a blanket 6-day max.
 */
async function getDriverPattern(driverName: string): Promise<DriverPattern> {
  return new Promise((resolve) => {
    const input = JSON.stringify({
      action: "get_driver_pattern",
      driverName,
    });

    const pythonProcess = spawn("python", ["python/xgboost_ownership.py"], {
      cwd: process.cwd(),
    });

    let stdout = "";

    pythonProcess.stdin.write(input);
    pythonProcess.stdin.end();

    pythonProcess.stdout.on("data", (data) => { stdout += data.toString(); });

    pythonProcess.on("close", (code) => {
      if (code !== 0 || !stdout.trim()) {
        resolve({
          driver: driverName,
          typical_days: 6,  // Default to safety max
          day_list: [],
          day_counts: {},
          confidence: 0,
        });
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()) as DriverPattern);
      } catch (e) {
        resolve({
          driver: driverName,
          typical_days: 6,
          day_list: [],
          day_counts: {},
          confidence: 0,
        });
      }
    });
  });
}

/**
 * Get patterns for all drivers (batch call)
 */
async function getAllDriverPatterns(): Promise<Record<string, DriverPattern>> {
  return new Promise((resolve) => {
    const input = JSON.stringify({ action: "get_all_patterns" });

    const pythonProcess = spawn("python", ["python/xgboost_ownership.py"], {
      cwd: process.cwd(),
    });

    let stdout = "";

    pythonProcess.stdin.write(input);
    pythonProcess.stdin.end();

    pythonProcess.stdout.on("data", (data) => { stdout += data.toString(); });

    pythonProcess.on("close", (code) => {
      if (code !== 0 || !stdout.trim()) {
        resolve({});
        return;
      }
      try {
        const result = JSON.parse(stdout.trim());
        resolve(result.patterns || {});
      } catch (e) {
        resolve({});
      }
    });
  });
}

/**
 * Call XGBoost Availability model for a single (driver, date) pair
 */
async function predictAvailability(
  driverId: string,
  date: string,
  history: any[]
): Promise<number> {
  return new Promise((resolve) => {
    const input = JSON.stringify({
      action: "predict",
      driverId,
      date,
      history,
    });

    const pythonProcess = spawn("python", ["python/xgboost_availability.py"], {
      cwd: process.cwd(),
    });

    let stdout = "";
    let stderr = "";

    pythonProcess.stdin.write(input);
    pythonProcess.stdin.end();

    pythonProcess.stdout.on("data", (data) => { stdout += data.toString(); });
    pythonProcess.stderr.on("data", (data) => { stderr += data.toString(); });

    pythonProcess.on("close", (code) => {
      if (code !== 0 || !stdout.trim()) {
        // Silent fallback - availability model may not be trained
        resolve(0.5);
        return;
      }
      try {
        const result = JSON.parse(stdout.trim());
        resolve(result.probability ?? 0.5);
      } catch (e) {
        resolve(0.5);
      }
    });
  });
}

/**
 * Call XGBoost Availability model for multiple (driver, date) pairs
 * Processes in parallel with concurrency limit
 */
async function predictAvailabilityBatch(
  requests: Array<{ driverId: string; date: string; history: any[] }>
): Promise<AvailabilityResult[]> {
  const BATCH_SIZE = 10; // Limit concurrent Python processes
  const results: AvailabilityResult[] = [];

  for (let i = 0; i < requests.length; i += BATCH_SIZE) {
    const batch = requests.slice(i, i + BATCH_SIZE);
    const promises = batch.map(async (req) => {
      const probability = await predictAvailability(req.driverId, req.date, req.history);
      return {
        driverId: req.driverId,
        date: req.date,
        probability,
      };
    });
    const batchResults = await Promise.all(promises);
    results.push(...batchResults);
  }

  return results;
}

/**
 * Call XGBRanker to rank backup drivers when owner is unavailable
 */
interface RankerResult {
  rankings: Array<[string, number]>; // [driverId, score]
}

async function rankBackupDrivers(
  block: {
    id: string;
    soloType: string;
    tractorId: string;
    startTime: string;
    serviceDate: string;
  },
  candidateDrivers: Array<{ id: string; contractType: string }>,
  driverHistories: Record<string, any[]>,
  availabilityScores: Record<string, number>
): Promise<RankerResult> {
  return new Promise((resolve) => {
    const input = JSON.stringify({
      action: "rank",
      block: {
        id: block.id,
        contractType: block.soloType,
        soloType: block.soloType,
        startTime: block.startTime,
        serviceDate: block.serviceDate,
      },
      candidates: candidateDrivers,
      histories: driverHistories,
      availabilityScores,
    });

    const pythonProcess = spawn("python", ["python/xgboost_ranker.py"], {
      cwd: process.cwd(),
    });

    let stdout = "";
    let stderr = "";

    pythonProcess.stdin.write(input);
    pythonProcess.stdin.end();

    pythonProcess.stdout.on("data", (data) => { stdout += data.toString(); });
    pythonProcess.stderr.on("data", (data) => { stderr += data.toString(); });

    pythonProcess.on("close", (code) => {
      if (stderr) {
        console.log(`[Ranker] ${stderr.trim()}`);
      }
      if (code !== 0 || !stdout.trim()) {
        console.log(`[Ranker] Failed to rank backup drivers`);
        resolve({ rankings: [] });
        return;
      }
      try {
        const result = JSON.parse(stdout.trim());
        resolve({ rankings: result.rankings || [] });
      } catch (e) {
        console.log(`[Ranker] Parse error: ${e}`);
        resolve({ rankings: [] });
      }
    });
  });
}

/**
 * Build slot key string for map lookups
 */
function makeSlotKey(slot: SlotKey): string {
  return `${slot.soloType}_${slot.tractorId}_${slot.canonicalTime}_${slot.dayOfWeek}`;
}

/**
 * Calculate consistency score for a driver based on their history.
 *
 * Consistency measures how reliably a driver shows up on their assigned days.
 * Based on day frequency variance - consistent drivers work the same days each week.
 *
 * Formula: 1.0 - (stddev / mean) of day-of-week frequencies
 *   - 100% consistency = works same days every week (low variance)
 *   - 0% consistency = erratic schedule (high variance)
 *
 * Returns: consistency score 0.0 to 1.0
 */
function calculateConsistency(history: any[]): number {
  if (!history || history.length < 2) {
    return 0.5; // Default for new drivers
  }

  // Count assignments per day of week (0=Sun, 6=Sat)
  const dayFreq: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };

  for (const entry of history) {
    const dateStr = entry.serviceDate || entry.date;
    if (!dateStr) continue;

    try {
      const date = new Date(dateStr);
      const dow = date.getDay(); // 0=Sun, 6=Sat
      dayFreq[dow]++;
    } catch {
      continue;
    }
  }

  // Calculate variance-based consistency
  const counts = Object.values(dayFreq).filter(c => c > 0);
  if (counts.length === 0) return 0.5;

  const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
  if (mean === 0) return 0.5;

  const variance = counts.reduce((sum, c) => sum + Math.pow(c - mean, 2), 0) / counts.length;
  const stddev = Math.sqrt(variance);

  // Consistency = 1 - (stddev / mean), clamped to [0, 1]
  const consistency = Math.max(0, Math.min(1, 1 - (stddev / mean)));

  return consistency;
}

/**
 * Calculate consistency scores for all drivers and cache them.
 */
function calculateAllConsistencies(
  driverHistories: Record<string, any[]>
): Map<string, number> {
  const consistencyMap = new Map<string, number>();

  for (const [driverId, history] of Object.entries(driverHistories)) {
    consistencyMap.set(driverId, calculateConsistency(history));
  }

  return consistencyMap;
}

/**
 * Filter driver histories to only include entries within memoryLength weeks.
 *
 * The Memory Length slider controls how much history the AI learns from:
 *   - 3 weeks = Recent patterns only (more responsive to changes)
 *   - 7 weeks = Balanced history (default)
 *   - 12 weeks = Full pattern analysis (more stable, less responsive)
 *
 * Each history entry must have a serviceDate field (YYYY-MM-DD format).
 */
function filterHistoriesByMemoryLength(
  driverHistories: Record<string, any[]>,
  memoryLengthWeeks: number,
  referenceDate: Date = new Date()
): Record<string, any[]> {
  const cutoffDate = new Date(referenceDate);
  cutoffDate.setDate(cutoffDate.getDate() - (memoryLengthWeeks * 7));
  const cutoffStr = cutoffDate.toISOString().split('T')[0]; // YYYY-MM-DD

  const filtered: Record<string, any[]> = {};
  let totalBefore = 0;
  let totalAfter = 0;

  for (const [driverId, history] of Object.entries(driverHistories)) {
    totalBefore += history.length;

    filtered[driverId] = history.filter(entry => {
      // Support both serviceDate and date fields
      const entryDate = entry.serviceDate || entry.date;
      if (!entryDate) return true; // Keep entries without dates (shouldn't happen)
      return entryDate >= cutoffStr;
    });

    totalAfter += filtered[driverId].length;
  }

  console.log(`[Pipeline] Memory filter: ${memoryLengthWeeks} weeks → kept ${totalAfter}/${totalBefore} history entries (cutoff: ${cutoffStr})`);

  return filtered;
}

/**
 * STEP 1: Get combined XGBoost scores (Ownership + Availability)
 *
 * For each slot:
 *   1. Get ownership prediction (who owns this slot?)
 *   2. Get availability predictions (which drivers are available on this day?)
 *   3. Combine: ownership_score * predictability + availability_score * (1 - predictability)
 *
 * The predictability slider controls how much weight is given to pattern ownership:
 *   - 1.0 (100%) = Strictly follow established patterns (ownership dominates)
 *   - 0.6 (60%)  = Balanced approach (default)
 *   - 0.2 (20%)  = Flexible, availability matters more than patterns
 *
 * Returns: slotKey -> (driverId -> combinedScore)
 */
interface XGBoostResult {
  scoreMatrix: Map<string, Map<string, number>>;
  distributionMap: Map<string, SlotDistribution>;
}

async function getXGBoostScores(
  slots: SlotKey[],
  driverIds: string[],
  driverHistories: Record<string, any[]>,
  serviceDates: Record<string, string>, // slotKey -> serviceDate
  predictability: number = 0.6, // from settings slider
  weekDayCounts: Record<string, number> = {} // driverId -> days assigned this week (for fairness)
): Promise<XGBoostResult> {
  console.log(`[Pipeline Step 1] XGBoost scores for ${slots.length} slots, ${driverIds.length} drivers`);
  console.log(`[Pipeline Step 1] Predictability: ${(predictability * 100).toFixed(0)}% ownership, ${((1 - predictability) * 100).toFixed(0)}% availability`);

  const scoreMatrix = new Map<string, Map<string, number>>();

  // 1. Get slot distributions (OWNED vs ROTATING classification)
  const distributionPromises = slots.map(slot => getSlotDistribution(slot));
  const distributionResults = await Promise.all(distributionPromises);

  // Also get ownership predictions for backward compatibility
  const ownershipPromises = slots.map(slot => predictSlotOwner(slot));
  const ownershipResults = await Promise.all(ownershipPromises);

  console.log(`[Pipeline Step 1] Got ${distributionResults.length} slot distributions`);

  // Build distribution map: slotKey -> SlotDistribution
  const distributionMap = new Map<string, SlotDistribution>();
  slots.forEach((slot, idx) => {
    const key = makeSlotKey(slot);
    distributionMap.set(key, distributionResults[idx]);
  });

  // Count owned vs rotating slots
  const ownedCount = distributionResults.filter(d => d.slot_type === "owned").length;
  const rotatingCount = distributionResults.filter(d => d.slot_type === "rotating").length;
  console.log(`[Pipeline Step 1] Slot classification: ${ownedCount} OWNED, ${rotatingCount} ROTATING`);

  // Build ownership map: slotKey -> { owner, confidence }
  const ownershipMap = new Map<string, { owner: string; confidence: number }>();
  slots.forEach((slot, idx) => {
    const key = makeSlotKey(slot);
    ownershipMap.set(key, {
      owner: ownershipResults[idx].driver,
      confidence: ownershipResults[idx].confidence,
    });
  });

  // 2. Get availability predictions for all (driver, date) pairs
  // Build batch requests
  const availRequests: Array<{ driverId: string; date: string; history: any[] }> = [];
  const requestIndex = new Map<string, number>(); // "driverId_date" -> index

  for (const slot of slots) {
    const slotKey = makeSlotKey(slot);
    const serviceDate = serviceDates[slotKey];
    if (!serviceDate) continue;

    for (const driverId of driverIds) {
      const reqKey = `${driverId}_${serviceDate}`;
      if (!requestIndex.has(reqKey)) {
        requestIndex.set(reqKey, availRequests.length);
        availRequests.push({
          driverId,
          date: serviceDate,
          history: driverHistories[driverId] || [],
        });
      }
    }
  }

  // Call availability model (batch)
  let availResults: AvailabilityResult[] = [];
  if (availRequests.length > 0) {
    availResults = await predictAvailabilityBatch(availRequests);
    console.log(`[Pipeline Step 1] Got ${availResults.length} availability predictions`);
  }

  // Build availability map: "driverId_date" -> probability
  const availMap = new Map<string, number>();
  for (const result of availResults) {
    availMap.set(`${result.driverId}_${result.date}`, result.probability);
  }

  // 2b. Calculate consistency scores for all drivers
  const consistencyMap = calculateAllConsistencies(driverHistories);
  console.log(`[Pipeline Step 1] Calculated consistency for ${consistencyMap.size} drivers`);

  // Log sample consistencies
  const sampleConsistencies = [...consistencyMap.entries()].slice(0, 3);
  for (const [driverId, consistency] of sampleConsistencies) {
    console.log(`  ${driverId}: ${(consistency * 100).toFixed(0)}% consistency`);
  }

  // 3. Combine scores for each (slot, driver) pair
  // Track slots where owner is unavailable for ranker fallback
  const slotsNeedingRanker: Array<{ slot: SlotKey; slotKey: string; owner: string }> = [];

  for (const slot of slots) {
    const slotKey = makeSlotKey(slot);
    const serviceDate = serviceDates[slotKey];
    const ownership = ownershipMap.get(slotKey);

    const driverScores = new Map<string, number>();

    // Check if owner is available (availability >= 0.5 threshold)
    const ownerAvailKey = ownership ? `${ownership.owner}_${serviceDate}` : "";
    const ownerAvailScore = ownerAvailKey ? (availMap.get(ownerAvailKey) ?? 0.5) : 0;
    const ownerIsAvailable = ownerAvailScore >= 0.5;

    // If owner is NOT available, flag this slot for ranker
    if (ownership && ownership.owner && !ownerIsAvailable) {
      slotsNeedingRanker.push({ slot, slotKey, owner: ownership.owner });
      console.log(`[Pipeline Step 1] Owner ${ownership.owner} unavailable for ${slotKey} (avail=${(ownerAvailScore * 100).toFixed(0)}%) → will use Ranker`);
    }

    // Get slot distribution to determine if OWNED or ROTATING
    const distribution = distributionMap.get(slotKey);
    const isRotatingSlot = distribution?.slot_type === "rotating";

    for (const driverId of driverIds) {
      // Get availability score for this driver on this date
      const availKey = `${driverId}_${serviceDate}`;
      const availScore = availMap.get(availKey) ?? 0.5; // default 0.5 if unknown

      // Get ownership score (high if this driver is the owner, low otherwise)
      let ownershipScore = 0.1; // base score for non-owners
      if (ownership && ownership.owner === driverId) {
        ownershipScore = ownership.confidence;
      }

      // Get consistency score for this driver
      const consistency = consistencyMap.get(driverId) ?? 0.5;

      // Consistency boost: 0% consistency -> 0.8x, 100% consistency -> 1.0x
      const consistencyBoost = 0.8 + (consistency * 0.2);

      // Combined score with consistency boost:
      // (ownership * predictability + availability * (1-predictability)) * consistency_boost
      let baseScore = ownershipScore * predictability + availScore * (1 - predictability);

      // FAIRNESS LOGIC FOR ROTATING SLOTS:
      // For rotating slots (no 70%+ owner), fairness is PRIMARY, history is SECONDARY
      if (isRotatingSlot && Object.keys(weekDayCounts).length > 0) {
        const daysThisWeek = weekDayCounts[driverId] ?? 0;
        const maxDays = Math.max(...Object.values(weekDayCounts), 1);
        const minDays = Math.min(...Object.values(weekDayCounts));

        // Fairness score: fewer days = higher score (normalized 0-1)
        // Driver with fewest days gets 1.0, most days gets 0.2
        const fairnessScore = maxDays > minDays
          ? 0.2 + 0.8 * ((maxDays - daysThisWeek) / (maxDays - minDays))
          : 0.6; // All equal days

        // Historical share as tie-breaker (0-0.3 bonus)
        const driverShare = distribution?.shares?.[driverId] ?? 0;
        const historyBonus = driverShare * 0.3;

        // For rotating slots: 70% fairness, 30% history+availability
        // This makes fairness the PRIMARY factor
        baseScore = fairnessScore * 0.7 + (baseScore + historyBonus) * 0.3;
      }

      const combinedScore = baseScore * consistencyBoost;

      driverScores.set(driverId, combinedScore);
    }

    // Log rotating slot fairness details
    if (isRotatingSlot && Object.keys(weekDayCounts).length > 0) {
      const topDrivers = [...driverScores.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);
      console.log(`[Pipeline Step 1] ROTATING slot ${slotKey}: top candidates = ${topDrivers.map(([id, score]) => `${id.slice(0, 8)}(${(score * 100).toFixed(0)}%, ${weekDayCounts[id] ?? 0}d)`).join(", ")}`);
    }

    scoreMatrix.set(slotKey, driverScores);
  }

  // 3b. Call XGBRanker for slots where owner is unavailable
  if (slotsNeedingRanker.length > 0) {
    console.log(`[Pipeline Step 1] Calling XGBRanker for ${slotsNeedingRanker.length} slots with unavailable owners`);

    for (const { slot, slotKey, owner } of slotsNeedingRanker) {
      const serviceDate = serviceDates[slotKey];

      // Build candidate list (all drivers except unavailable owner)
      const candidates = driverIds
        .filter(id => id !== owner)
        .map(id => ({ id, contractType: slot.soloType }));

      // Build availability scores for ranker
      const availScoresForRanker: Record<string, number> = {};
      for (const driverId of driverIds) {
        const availKey = `${driverId}_${serviceDate}`;
        availScoresForRanker[driverId] = availMap.get(availKey) ?? 0.5;
      }

      // Call ranker
      const rankerResult = await rankBackupDrivers(
        {
          id: slotKey,
          soloType: slot.soloType,
          tractorId: slot.tractorId,
          startTime: slot.canonicalTime,
          serviceDate,
        },
        candidates,
        driverHistories,
        availScoresForRanker
      );

      // Apply ranker scores (override base scores for backup drivers)
      if (rankerResult.rankings.length > 0) {
        const driverScores = scoreMatrix.get(slotKey)!;

        // Normalize ranker scores to 0-1 range and apply as new scores
        const maxRankerScore = Math.max(...rankerResult.rankings.map(r => r[1]));
        const minRankerScore = Math.min(...rankerResult.rankings.map(r => r[1]));
        const scoreRange = maxRankerScore - minRankerScore || 1;

        for (const [driverId, rankerScore] of rankerResult.rankings) {
          // Normalize to 0.3-0.9 range (below owner's typical score but competitive)
          const normalizedScore = 0.3 + 0.6 * ((rankerScore - minRankerScore) / scoreRange);
          driverScores.set(driverId, normalizedScore);
        }

        // Set unavailable owner's score very low
        driverScores.set(owner, 0.05);

        console.log(`[Pipeline Step 1] Ranker updated ${slotKey}: top backup = ${rankerResult.rankings[0]?.[0]} (${(rankerResult.rankings[0]?.[1] || 0).toFixed(2)})`);
      }
    }
  }

  // Log sample scores
  const sampleSlot = slots[0];
  if (sampleSlot) {
    const sampleKey = makeSlotKey(sampleSlot);
    const sampleScores = scoreMatrix.get(sampleKey);
    const ownership = ownershipMap.get(sampleKey);
    console.log(`[Pipeline Step 1] Sample slot ${sampleKey}:`);
    console.log(`  Owner: ${ownership?.owner} (${((ownership?.confidence || 0) * 100).toFixed(0)}%)`);
    if (sampleScores) {
      const top3 = [...sampleScores.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);
      for (const [driverId, score] of top3) {
        console.log(`  ${driverId}: ${(score * 100).toFixed(0)}%`);
      }
    }
  }

  return { scoreMatrix, distributionMap };
}

// =============================================================================
// STEP 2: Apply Bump Penalties
// =============================================================================

/**
 * Convert time string (HH:MM) to minutes since midnight
 */
function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + (minutes || 0);
}

/**
 * Convert minutes since midnight to time string (HH:MM)
 */
function minutesToTime(minutes: number): string {
  // Handle wrap-around (e.g., -60 -> 23:00, 1500 -> 01:00)
  const normalized = ((minutes % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const mins = normalized % 60;
  return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}`;
}

/**
 * Get all canonical times for a given contract type from the contracts table.
 * This is SaaS-ready - each tenant has their own contract times.
 *
 * @param tenantId - The tenant ID to query contracts for
 * @param soloType - The contract type (solo1, solo2, team)
 * @returns Array of { startTime, tractorId } from contracts table
 */
async function getCanonicalTimesFromContracts(
  tenantId: string,
  soloType: string
): Promise<Array<{ startTime: string; tractorId: string }>> {
  const contractRecords = await db
    .select({
      startTime: contracts.startTime,
      tractorId: contracts.tractorId,
    })
    .from(contracts)
    .where(
      and(
        eq(contracts.tenantId, tenantId),
        eq(contracts.type, soloType),
        eq(contracts.status, "active")
      )
    );

  console.log(`[Bump] Found ${contractRecords.length} contracts for ${soloType} in tenant ${tenantId}`);

  return contractRecords;
}

/**
 * Find bump slot candidates within ±flexibilityHours of the original time.
 * Queries the contracts table to get available canonical times (SaaS-ready).
 *
 * @param originalSlot - The slot that is taken/unavailable
 * @param flexibilityHours - How many hours to look for alternatives (±)
 * @param tenantId - Tenant ID to query contracts from
 * @param assignedSlots - Map of already-assigned slots
 * @param distributionMap - Ownership distribution for each slot
 * @returns Array of bump candidates sorted by preference
 */
async function findBumpCandidates(
  originalSlot: SlotKey,
  flexibilityHours: number,
  tenantId: string,
  assignedSlots: Map<string, string>,
  distributionMap: Map<string, SlotDistribution>
): Promise<Array<{
  slot: SlotKey;
  slotKey: string;
  bumpMinutes: number;
  isOpen: boolean;
  slotType: "owned" | "rotating" | "unknown";
  ownerName: string | null;
  conflictPenalty: number;
}>> {
  // Step 1: Query contracts table for this tenant's canonical times
  const contractTimes = await getCanonicalTimesFromContracts(tenantId, originalSlot.soloType);

  const originalMinutes = timeToMinutes(originalSlot.canonicalTime);
  const flexibilityMinutes = flexibilityHours * 60;

  const candidates: Array<{
    slot: SlotKey;
    slotKey: string;
    bumpMinutes: number;
    isOpen: boolean;
    slotType: "owned" | "rotating" | "unknown";
    ownerName: string | null;
    conflictPenalty: number;
  }> = [];

  // Step 2: Filter contracts within ±Xhr of original time
  for (const contract of contractTimes) {
    const slotMinutes = timeToMinutes(contract.startTime);

    // Calculate time difference (handle wrap-around for overnight shifts)
    let diff = slotMinutes - originalMinutes;
    if (diff > 720) diff -= 1440; // e.g., 23:00 to 01:00 = +2h, not -22h
    if (diff < -720) diff += 1440;

    const absDiff = Math.abs(diff);

    // Check if within flexibility range
    if (absDiff > flexibilityMinutes) {
      continue;
    }

    // Step 3: Build a SlotKey for this bump candidate
    // Note: We keep the original dayOfWeek since bump is same-day
    const bumpSlot: SlotKey = {
      soloType: originalSlot.soloType,
      tractorId: contract.tractorId,
      canonicalTime: contract.startTime,
      dayOfWeek: originalSlot.dayOfWeek,
    };

    const slotKey = makeSlotKey(bumpSlot);

    // Step 4: Check if this slot is open on this day
    const isOpen = !assignedSlots.has(slotKey);
    const distribution = distributionMap.get(slotKey);
    const slotType = distribution?.slot_type || "unknown";
    const ownerName = distribution?.owner || null;

    // Conflict penalty:
    // - Open slot with no owner (rotating): 0
    // - Open slot with owner (bumping into someone else's slot): 0.2
    // - Taken slot: 0.5 (will be filtered out but keep for logging)
    let conflictPenalty = 0;
    if (!isOpen) {
      conflictPenalty = 0.5;
    } else if (slotType === "owned" && ownerName) {
      conflictPenalty = 0.2; // Bumping into someone else's owned slot
    }

    candidates.push({
      slot: bumpSlot,
      slotKey,
      bumpMinutes: diff,
      isOpen,
      slotType,
      ownerName,
      conflictPenalty,
    });
  }

  // Step 5: Sort by preference - open first, then by penalty, then by distance
  candidates.sort((a, b) => {
    if (a.isOpen !== b.isOpen) return a.isOpen ? -1 : 1;
    if (a.conflictPenalty !== b.conflictPenalty) return a.conflictPenalty - b.conflictPenalty;
    return Math.abs(a.bumpMinutes) - Math.abs(b.bumpMinutes);
  });

  console.log(`[Bump] Found ${candidates.length} bump candidates within ±${flexibilityHours}hr for ${originalSlot.canonicalTime}`);
  if (candidates.length > 0) {
    const openCount = candidates.filter(c => c.isOpen).length;
    console.log(`[Bump]   ${openCount} open, ${candidates.length - openCount} taken`);
  }

  return candidates;
}

/**
 * Apply bump penalties to XGBoost scores.
 *
 * For each driver's preferred slot:
 * 1. If slot is open → use base score (no penalty)
 * 2. If slot is taken → find ±Xhr alternatives and apply penalties
 *
 * Bump scoring:
 * - Distance penalty: -0.1 per hour of bump
 * - Conflict penalty: -0.2 if bumping into someone else's owned slot
 * - Priority: Same-owner bump > Rotating slot > Other-owner slot
 *
 * Now queries contracts table for canonical times (SaaS-ready).
 */
async function applyBumpPenalties(
  xgboostScores: Map<string, Map<string, number>>,
  slots: SlotKey[],
  assignedSlots: Map<string, string>,
  distributionMap: Map<string, SlotDistribution>,
  tenantId: string,
  timeFlexibility: number = 2 // hours
): Promise<BlockCandidate[]> {
  console.log(`[Pipeline Step 2] Applying bump penalties (±${timeFlexibility}hr flexibility)`);
  console.log(`[Pipeline Step 2] Tenant: ${tenantId} (querying contracts table for canonical times)`);

  const results: BlockCandidate[] = [];
  let bumpCount = 0;
  let directCount = 0;

  for (const slot of slots) {
    const slotKey = makeSlotKey(slot);
    const driverScores = xgboostScores.get(slotKey);
    if (!driverScores) continue;

    const distribution = distributionMap.get(slotKey);
    const isSlotTaken = assignedSlots.has(slotKey);
    const takenBy = assignedSlots.get(slotKey);

    const candidates: DriverScore[] = [];

    for (const [driverId, baseScore] of driverScores) {
      // Check if this driver is the owner of this slot
      const isOwner = distribution?.owner === driverId ||
        (distribution?.shares?.[driverId] ?? 0) > 0.3;

      if (!isSlotTaken) {
        // Slot is open - direct assignment, no bump needed
        candidates.push({
          driverId,
          driverName: driverId, // Will be resolved later
          score: baseScore,
          ownershipScore: baseScore,
          bumpPenalty: 0,
          bumpMinutes: 0,
          method: "ownership",
          reason: "Direct assignment (slot open)",
        });
        directCount++;
      } else if (takenBy === driverId) {
        // This driver already has this slot - skip
        continue;
      } else if (isOwner && timeFlexibility > 0) {
        // Owner's slot is taken - find bump alternatives from contracts table
        const bumpCandidates = await findBumpCandidates(
          slot,
          timeFlexibility,
          tenantId,
          assignedSlots,
          distributionMap
        );

        // Find best available bump slot for this driver
        const openBumps = bumpCandidates.filter(b => b.isOpen);

        if (openBumps.length > 0) {
          const bestBump = openBumps[0];

          // Distance penalty: -0.1 per hour
          const distancePenalty = Math.abs(bestBump.bumpMinutes) / 60 * 0.1;

          // Total penalty
          const totalPenalty = distancePenalty + bestBump.conflictPenalty;
          const bumpedScore = Math.max(0, baseScore - totalPenalty);

          // Determine reason
          let reason = `Bumped ${bestBump.bumpMinutes > 0 ? "+" : ""}${bestBump.bumpMinutes}min`;
          if (bestBump.slotType === "rotating") {
            reason += " to rotating slot";
          } else if (bestBump.ownerName) {
            reason += ` (conflicts with ${bestBump.ownerName}'s slot)`;
          }

          candidates.push({
            driverId,
            driverName: driverId,
            score: bumpedScore,
            ownershipScore: baseScore,
            bumpPenalty: totalPenalty,
            bumpMinutes: bestBump.bumpMinutes,
            method: "bump",
            reason,
          });
          bumpCount++;
        } else {
          // No bump slots available - fallback with heavy penalty
          candidates.push({
            driverId,
            driverName: driverId,
            score: baseScore * 0.3, // 70% penalty
            ownershipScore: baseScore,
            bumpPenalty: 0.7,
            bumpMinutes: 0,
            method: "fallback",
            reason: "No bump slots available",
          });
        }
      } else {
        // Not an owner, slot is taken - skip or use low score
        candidates.push({
          driverId,
          driverName: driverId,
          score: baseScore * 0.5,
          ownershipScore: baseScore,
          bumpPenalty: 0.5,
          bumpMinutes: 0,
          method: "fallback",
          reason: "Non-owner, slot taken",
        });
      }
    }

    // Sort candidates by score
    candidates.sort((a, b) => b.score - a.score);

    results.push({
      blockId: slotKey, // Will be replaced with actual block ID
      slot,
      candidates,
    });
  }

  console.log(`[Pipeline Step 2] Processed ${results.length} slots: ${directCount} direct, ${bumpCount} bumped`);

  return results;
}

// =============================================================================
// STEP 3: Filter Invalid Options
// =============================================================================

interface DriverConstraints {
  driverId: string;
  contractType: string;           // solo1, solo2, team
  daysThisWeek: Set<string>;      // Set of service dates already assigned
  shiftsThisWeek: Array<{         // For rest period calculation
    date: string;
    startTime: string;            // HH:MM
    endTime: string;              // HH:MM (estimated)
  }>;
  typicalDaysPerWeek?: number;    // From XGBoost pattern (e.g., 5 for Josh)
  preferredDays?: string[];       // From XGBoost pattern (e.g., ['sunday', 'monday', ...])
}

interface FilterResult {
  valid: boolean;
  reason: string;
}

/**
 * Check if a driver can be assigned to a slot based on all constraints.
 * Returns { valid: true } if OK, or { valid: false, reason: "..." } if blocked.
 */
function checkConstraints(
  driverId: string,
  slot: SlotKey,
  serviceDate: string,
  driverConstraints: Map<string, DriverConstraints>,
  maxDaysPerWeek: number,
  minRestHours: number
): FilterResult {
  const constraints = driverConstraints.get(driverId);

  if (!constraints) {
    // No constraints data - assume valid
    return { valid: true, reason: "" };
  }

  // 1. CONTRACT TYPE MATCH
  // solo1 driver can only work solo1 blocks, etc.
  if (constraints.contractType !== slot.soloType) {
    return {
      valid: false,
      reason: `Contract mismatch: driver is ${constraints.contractType}, block is ${slot.soloType}`,
    };
  }

  // 2. MAX DAYS PER WEEK
  // Apply computeTargetDays: max(4, min(pattern, 6))
  // - 4-day minimum fairness floor ensures everyone gets fair share of work
  // - 6-day maximum safety cap prevents 7-day weeks
  const driverMaxDays = computeTargetDays(constraints.typicalDaysPerWeek);

  // Count unique dates including this potential assignment
  const daysIfAssigned = new Set(constraints.daysThisWeek);
  daysIfAssigned.add(serviceDate);

  if (daysIfAssigned.size > driverMaxDays) {
    const patternNote = constraints.typicalDaysPerWeek !== undefined
      ? `(XGBoost: ${constraints.typicalDaysPerWeek} → clamped to ${driverMaxDays} days)`
      : `(no pattern → fairness floor: ${driverMaxDays} days)`;
    return {
      valid: false,
      reason: `Day limit: driver already has ${constraints.daysThisWeek.size}/${driverMaxDays} days this week ${patternNote}`,
    };
  }

  // Note: Safety cap (max 6 days) is now enforced by computeTargetDays() above
  // No redundant check needed since driverMaxDays <= MAX_DAYS_PER_WEEK (6)

  // 3. DOUBLE-BOOKING (same day, overlapping time)
  // Check if driver already has a shift that overlaps with this new slot
  const newStartMinutes = timeToMinutes(slot.canonicalTime);
  const newEndMinutes = newStartMinutes + 480; // 8-hour shift

  for (const existingShift of constraints.shiftsThisWeek) {
    const existingStartMinutes = timeToMinutes(existingShift.startTime);
    let existingEndMinutes = timeToMinutes(existingShift.endTime);

    // Handle overnight shifts (end time < start time means next day)
    const isOvernightShift = existingEndMinutes < existingStartMinutes;

    if (existingShift.date === serviceDate) {
      // Same day - check for overlap
      if (isOvernightShift) {
        // Existing shift goes overnight (e.g., 17:30-01:30)
        existingEndMinutes = 1440 + existingEndMinutes; // Extend to next day
      }

      if (newStartMinutes < existingEndMinutes && newEndMinutes > existingStartMinutes) {
        return {
          valid: false,
          reason: `Double-booking: driver already has ${existingShift.startTime} shift on ${serviceDate}`,
        };
      }
    }

    // Also check if new shift overlaps with overnight portion of previous day's shift
    const prevDate = new Date(serviceDate);
    prevDate.setDate(prevDate.getDate() - 1);
    const prevDateStr = prevDate.toISOString().split('T')[0];

    if (existingShift.date === prevDateStr && isOvernightShift) {
      // Previous day's overnight shift extends into this day
      if (newStartMinutes < existingEndMinutes) {
        return {
          valid: false,
          reason: `Double-booking: driver's ${existingShift.startTime} shift from ${prevDateStr} extends into this day`,
        };
      }
    }
  }

  // 4. REST PERIOD (typically 10 hours between shifts)
  const thisDate = new Date(serviceDate);
  const prevDate2 = new Date(thisDate);
  prevDate2.setDate(prevDate2.getDate() - 1);
  const nextDate = new Date(thisDate);
  nextDate.setDate(nextDate.getDate() + 1);

  const prevDateStr2 = prevDate2.toISOString().split('T')[0];
  const nextDateStr = nextDate.toISOString().split('T')[0];

  // Check rest from previous day's shifts
  const prevDayShifts = constraints.shiftsThisWeek.filter(s => s.date === prevDateStr2);
  for (const prevShift of prevDayShifts) {
    const prevStartMinutes = timeToMinutes(prevShift.startTime);
    const prevEndMinutes = timeToMinutes(prevShift.endTime);

    // Handle overnight shift (end < start means next day)
    const isOvernightShift = prevEndMinutes < prevStartMinutes;

    if (isOvernightShift) {
      // Shift ends on THIS day at prevEndMinutes
      const restMinutes = newStartMinutes - prevEndMinutes;
      const restHours = restMinutes / 60;

      if (restHours < minRestHours) {
        return {
          valid: false,
          reason: `Rest violation: only ${restHours.toFixed(1)}hr rest after ${prevDateStr2} shift (ended ${prevShift.endTime} today, need ${minRestHours}hr)`,
        };
      }
    } else {
      // Normal shift ends same day
      const restMinutes = (1440 - prevEndMinutes) + newStartMinutes;
      const restHours = restMinutes / 60;

      if (restHours < minRestHours) {
        return {
          valid: false,
          reason: `Rest violation: only ${restHours.toFixed(1)}hr rest after ${prevDateStr2} ${prevShift.endTime} shift (need ${minRestHours}hr)`,
        };
      }
    }
  }

  // Check rest before next day's shifts
  const nextDayShifts = constraints.shiftsThisWeek.filter(s => s.date === nextDateStr);
  for (const nextShift of nextDayShifts) {
    const nextStartMinutes = timeToMinutes(nextShift.startTime);
    const newShiftIsOvernight = newEndMinutes > 1440;

    if (newShiftIsOvernight) {
      // New shift ends on next day
      const actualEndMinutes = newEndMinutes - 1440;
      const restMinutes = nextStartMinutes - actualEndMinutes;
      const restHours = restMinutes / 60;

      if (restHours < minRestHours) {
        return {
          valid: false,
          reason: `Rest violation: only ${restHours.toFixed(1)}hr rest before ${nextDateStr} ${nextShift.startTime} shift (need ${minRestHours}hr)`,
        };
      }
    } else {
      // New shift ends same day
      const restMinutes = (1440 - newEndMinutes) + nextStartMinutes;
      const restHours = restMinutes / 60;

      if (restHours < minRestHours) {
        return {
          valid: false,
          reason: `Rest violation: only ${restHours.toFixed(1)}hr rest before ${nextDateStr} ${nextShift.startTime} shift (need ${minRestHours}hr)`,
        };
      }
    }
  }

  // All constraints passed
  return { valid: true, reason: "" };
}

/**
 * Filter out invalid driver-slot combinations based on constraints.
 *
 * Constraints checked:
 * 1. Contract type match (solo1 driver → solo1 blocks only)
 * 2. Max 6 days per driver per week
 * 3. No double-booking (driver can't work 2 blocks same time)
 * 4. 10-hour rest between shifts
 */
function filterInvalidOptions(
  candidates: BlockCandidate[],
  driverConstraints: Map<string, DriverConstraints>,
  serviceDates: Record<string, string>, // slotKey -> serviceDate
  maxDaysPerWeek: number = 6,
  minRestHours: number = 10
): { filtered: BlockCandidate[]; violations: Array<{ blockId: string; driverId: string; reason: string }> } {
  console.log(`[Pipeline Step 3] Filtering invalid options`);
  console.log(`[Pipeline Step 3] Constraints: maxDays=${maxDaysPerWeek}, minRest=${minRestHours}hr`);

  const filtered: BlockCandidate[] = [];
  const violations: Array<{ blockId: string; driverId: string; reason: string }> = [];

  let totalCandidates = 0;
  let removedCount = 0;
  let contractMismatch = 0;
  let sixDayLimit = 0;
  let doubleBooking = 0;
  let restViolation = 0;

  for (const block of candidates) {
    const slotKey = makeSlotKey(block.slot);
    const serviceDate = serviceDates[slotKey] || serviceDates[block.blockId];

    const validCandidates: DriverScore[] = [];

    for (const candidate of block.candidates) {
      totalCandidates++;

      const result = checkConstraints(
        candidate.driverId,
        block.slot,
        serviceDate,
        driverConstraints,
        maxDaysPerWeek,
        minRestHours
      );

      if (result.valid) {
        validCandidates.push(candidate);
      } else {
        removedCount++;
        violations.push({
          blockId: block.blockId,
          driverId: candidate.driverId,
          reason: result.reason,
        });

        // Track violation types
        if (result.reason.includes("Contract mismatch")) contractMismatch++;
        else if (result.reason.includes("Day limit") || result.reason.includes("Safety limit")) sixDayLimit++;
        else if (result.reason.includes("Double-booking")) doubleBooking++;
        else if (result.reason.includes("Rest violation")) restViolation++;
      }
    }

    filtered.push({
      ...block,
      candidates: validCandidates,
    });
  }

  console.log(`[Pipeline Step 3] Filtered ${removedCount}/${totalCandidates} candidates:`);
  console.log(`[Pipeline Step 3]   Contract mismatch: ${contractMismatch}`);
  console.log(`[Pipeline Step 3]   Day limit (pattern-based): ${sixDayLimit}`);
  console.log(`[Pipeline Step 3]   Double-booking: ${doubleBooking}`);
  console.log(`[Pipeline Step 3]   Rest violation: ${restViolation}`);

  return { filtered, violations };
}

// =============================================================================
// STEP 4: OR-Tools Global Optimization
// =============================================================================

async function runORToolsOptimization(
  candidates: BlockCandidate[],
  minDaysPerDriver: number
): Promise<Map<string, string>> {
  // Converts candidates to OR-Tools input format
  // Calls schedule_optimizer.py with PRE-COMPUTED scores from pipeline
  // Returns: blockId -> driverId

  console.log(`[Pipeline Step 4] OR-Tools optimization`);
  console.log(`  Input: ${candidates.length} blocks with pre-filtered candidates`);

  if (candidates.length === 0) {
    console.log(`  No candidates to optimize`);
    return new Map();
  }

  // Build score matrix from pipeline's pre-computed scores
  // Format: { blockId: { driverId: score } }
  const scoreMatrix: Record<string, Record<string, number>> = {};
  const allDriverIds = new Set<string>();
  const allDriverNames: Record<string, string> = {};

  for (const candidate of candidates) {
    scoreMatrix[candidate.blockId] = {};
    for (const driver of candidate.candidates) {
      // Use the pipeline's combined score (already includes ownership + bump)
      scoreMatrix[candidate.blockId][driver.driverId] = driver.score;
      allDriverIds.add(driver.driverId);
      allDriverNames[driver.driverId] = driver.driverName;
    }
  }

  // Build blocks array for OR-Tools
  const blocks = candidates.map(c => ({
    id: c.blockId,
    day: c.slot.dayOfWeek,
    time: c.slot.canonicalTime,
    contractType: c.slot.soloType,
    serviceDate: c.slot.dayOfWeek, // OR-Tools uses this for one-block-per-day constraint
  }));

  // Build drivers array (only drivers that passed constraint filtering)
  const drivers = Array.from(allDriverIds).map(id => ({
    id,
    name: allDriverNames[id] || id,
    contractType: "solo1", // Contract already filtered by pipeline
  }));

  console.log(`  Score matrix: ${Object.keys(scoreMatrix).length} blocks × ${drivers.length} drivers`);

  // Call OR-Tools Python script with pre-computed scores
  const input = {
    action: "optimize_with_scores",
    blocks,
    drivers,
    scoreMatrix,  // Pre-computed scores from pipeline (NOT slot_history!)
    minDays: minDaysPerDriver,
  };

  return new Promise((resolve) => {
    // Use process.cwd() for ESM compatibility (tsx runs from project root)
    const pythonScript = path.join(process.cwd(), "python", "schedule_optimizer.py");
    const python = spawn("python", [pythonScript]);

    let stdout = "";
    let stderr = "";

    python.stdin.write(JSON.stringify(input));
    python.stdin.end();

    python.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    python.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    python.on("close", (code) => {
      if (stderr) {
        console.log(`  [OR-Tools stderr]:\n${stderr.split('\n').map(l => '    ' + l).join('\n')}`);
      }

      if (code !== 0) {
        console.log(`  OR-Tools exited with code ${code}`);
        resolve(new Map());
        return;
      }

      try {
        const result = JSON.parse(stdout);
        const assignments = new Map<string, string>();

        if (result.assignments && Array.isArray(result.assignments)) {
          for (const a of result.assignments) {
            assignments.set(a.blockId, a.driverId);
          }
          console.log(`  OR-Tools result: ${assignments.size} assignments`);
        }

        resolve(assignments);
      } catch (e) {
        console.log(`  Failed to parse OR-Tools output: ${e}`);
        resolve(new Map());
      }
    });
  });
}

// =============================================================================
// STEP 5: LLM Explanation (Future)
// =============================================================================

async function generateLLMExplanation(
  assignments: Map<string, string>,
  candidates: BlockCandidate[]
): Promise<Map<string, string>> {
  // Returns: blockId -> explanation string

  // TODO: Call LLM to explain why each assignment was made

  console.log(`[Pipeline Step 5] LLM explanation (future)`);

  // STUB: Return empty map for now
  return new Map();
}

// =============================================================================
// MAIN PIPELINE
// =============================================================================

export async function runSchedulePipeline(
  input: PipelineInput
): Promise<PipelineOutput> {
  const { settings } = input;

  console.log(`\n========================================`);
  console.log(`[Pipeline] Starting schedule pipeline`);
  console.log(`[Pipeline] ${input.blocks.length} blocks, ${input.availableDriverIds.length} drivers`);
  console.log(`[Pipeline] Settings: predictability=${(settings.predictability * 100).toFixed(0)}%, timeFlex=±${settings.timeFlexibility}hr, memory=${settings.memoryLength}wk`);
  console.log(`========================================\n`);

  // Extract slots from blocks
  const slots: SlotKey[] = input.blocks.map(b => ({
    soloType: b.soloType,
    tractorId: b.tractorId,
    canonicalTime: b.canonicalTime,
    dayOfWeek: b.dayOfWeek,
  }));

  // Build serviceDates map: slotKey -> serviceDate
  const serviceDates: Record<string, string> = {};
  for (const block of input.blocks) {
    const slotKey = makeSlotKey({
      soloType: block.soloType,
      tractorId: block.tractorId,
      canonicalTime: block.canonicalTime,
      dayOfWeek: block.dayOfWeek,
    });
    serviceDates[slotKey] = block.serviceDate;
  }

  // Apply Memory Length filter to driver histories
  const filteredHistories = filterHistoriesByMemoryLength(
    input.driverHistories,
    settings.memoryLength
  );

  // Step 1: Get XGBoost ownership + availability scores
  const { scoreMatrix: xgboostScores, distributionMap } = await getXGBoostScores(
    slots,
    input.availableDriverIds,
    filteredHistories, // Use filtered histories
    serviceDates,
    settings.predictability // Pass slider value
  );

  // Step 2: Apply bump penalties
  const candidatesWithBump = await applyBumpPenalties(
    xgboostScores,
    slots,
    input.assignedSlots,
    distributionMap,
    input.tenantId,
    settings.timeFlexibility
  );

  // Step 3: Filter invalid options
  // Build driver constraints from history (contract types, current week assignments)
  const driverConstraints = new Map<string, DriverConstraints>();
  for (const driverId of input.availableDriverIds) {
    // Get contract type from history (default to solo1)
    const history = filteredHistories[driverId] || [];
    const contractType = history[0]?.soloType || 'solo1';

    // Get days this driver already worked this week
    const daysThisWeek = new Set<string>();
    const shiftsThisWeek: Array<{ date: string; startTime: string; endTime: string }> = [];

    // Get XGBoost pattern for this driver (if available)
    const typicalDaysPerWeek = undefined; // TODO: get from XGBoost get_driver_pattern

    driverConstraints.set(driverId, {
      contractType,
      daysThisWeek,
      shiftsThisWeek,
      typicalDaysPerWeek,
    });
  }

  const filteredResult = filterInvalidOptions(
    candidatesWithBump,
    driverConstraints,
    serviceDates,
    6,  // maxDaysPerWeek
    10  // minRestHours
  );
  const filteredCandidates = filteredResult.filtered;

  // Step 4: Run OR-Tools optimization
  const assignments = await runORToolsOptimization(filteredCandidates, 3);

  // Step 5: Generate LLM explanations (future)
  const explanations = await generateLLMExplanation(assignments, filteredCandidates);

  // Build output
  const output: PipelineOutput = {
    assignments: [],
    unassigned: [],
    stats: {
      totalBlocks: input.blocks.length,
      totalDrivers: input.availableDriverIds.length,
      assigned: assignments.size,
      xgboostHits: 0,  // TODO: count
      bumpFallbacks: 0, // TODO: count
    },
  };

  // Populate assignments
  for (const [blockId, driverId] of assignments) {
    output.assignments.push({
      blockId,
      driverId,
      driverName: "", // TODO: lookup
      score: 0,       // TODO: lookup from candidates
      method: "",     // TODO: lookup
      reason: explanations.get(blockId) || "",
    });
  }

  // Populate unassigned
  for (const block of input.blocks) {
    if (!assignments.has(block.id)) {
      output.unassigned.push(block.id);
    }
  }

  console.log(`\n========================================`);
  console.log(`[Pipeline] Complete: ${output.stats.assigned} assigned, ${output.unassigned.length} unassigned`);
  console.log(`========================================\n`);

  return output;
}
