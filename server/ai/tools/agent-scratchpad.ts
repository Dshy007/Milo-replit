/**
 * Agent Scratchpad - Stateful memory for the scheduling agent
 *
 * Maintains context between tool calls so the agent can:
 * 1. Track what blocks need assignment
 * 2. Cache driver patterns (avoid repeated XGBoost calls)
 * 3. Track assignments made during this session
 * 4. Log decisions with reasoning
 */

import { db } from "../../db";
import { blocks, drivers, blockAssignments, specialRequests, protectedDriverRules } from "@shared/schema";
import { eq, and, gte, lte, or, isNull } from "drizzle-orm";
import { format, startOfWeek, endOfWeek, eachDayOfInterval } from "date-fns";
import { getAllDriverPatterns, getBatchSlotAffinity, DriverPattern, DriverHistoryItem, BlockSlotInfo } from "../../python-bridge";

// Types
export interface UnassignedBlock {
  id: string;
  blockId: string;
  serviceDate: string;
  dayOfWeek: number;
  dayName: string;
  soloType: string;
  tractorId: string;
  startTime: string;
  endTime: string;
  startTimestamp: Date;
  endTimestamp: Date;
}

export interface DriverInfo {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  daysOff: string[];
}

export interface Decision {
  blockId: string;
  blockInfo: string;
  driverId: string | null;
  driverName: string | null;
  action: 'assigned' | 'skipped' | 'failed';
  reasoning: string;
  timestamp: Date;
  checks?: {
    dot?: { passed: boolean; restHours?: number };
    rolling6?: { passed: boolean; currentHours?: number; maxHours?: number };
    protected?: { passed: boolean; violations?: string[] };
    timeOff?: { passed: boolean; reason?: string };
    ownership?: { score: number; isOwner: boolean };
    affinity?: { score: number };
  };
}

export interface ProtectedRule {
  id: string;
  driverId: string;
  ruleType: string;
  blockedDays?: string[];
  allowedDays?: string[];
  blockedSoloTypes?: string[];
  allowedSoloTypes?: string[];
  notes?: string;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Agent Scratchpad - stateful memory for scheduling agent
 */
export class AgentScratchpad {
  private tenantId: string = "";
  private weekStart: Date = new Date();
  private weekEnd: Date = new Date();
  private initialized: boolean = false;

  // Cached data (loaded once at start)
  public unassignedBlocks: UnassignedBlock[] = [];
  public allDrivers: DriverInfo[] = [];
  public driverPatterns: Map<string, DriverPattern> = new Map();
  public affinityCache: Map<string, number> = new Map(); // "driverId_slotKey" → score
  public unavailableDates: Map<string, Set<string>> = new Map(); // driverId → Set of "yyyy-MM-dd"
  public protectedRules: ProtectedRule[] = [];

  // Existing assignments (for DOT validation)
  public existingAssignments: Map<string, Array<{
    blockId: string;
    startTimestamp: Date;
    endTimestamp: Date;
    soloType: string;
  }>> = new Map(); // driverId → assignments

  // Running state (updated during execution)
  public assignedThisSession: Map<string, string> = new Map(); // blockId → driverId
  public driverDayCounts: Map<string, number> = new Map(); // driverId → blocks this week
  public decisions: Decision[] = [];

  /**
   * Initialize the scratchpad with all data for a week
   */
  async initialize(tenantId: string, weekStart: Date): Promise<void> {
    if (this.initialized && this.tenantId === tenantId &&
        format(this.weekStart, 'yyyy-MM-dd') === format(weekStart, 'yyyy-MM-dd')) {
      console.log(`[Scratchpad] Already initialized for ${format(weekStart, 'yyyy-MM-dd')}`);
      return;
    }

    console.log(`[Scratchpad] Initializing for tenant ${tenantId}, week ${format(weekStart, 'yyyy-MM-dd')}`);

    this.tenantId = tenantId;
    this.weekStart = startOfWeek(weekStart, { weekStartsOn: 0 });
    this.weekEnd = endOfWeek(weekStart, { weekStartsOn: 0 });

    // Load all data in parallel
    await Promise.all([
      this.loadUnassignedBlocks(),
      this.loadDrivers(),
      this.loadDriverPatterns(),
      this.loadSpecialRequests(),
      this.loadProtectedRules(),
      this.loadExistingAssignments(),
    ]);

    // Pre-compute affinity scores
    await this.precomputeAffinityScores();

    // Count existing assignments per driver this week
    this.countDriverAssignments();

    this.initialized = true;
    console.log(`[Scratchpad] Initialized: ${this.unassignedBlocks.length} blocks, ${this.allDrivers.length} drivers, ${this.driverPatterns.size} patterns`);
  }

  /**
   * Load unassigned blocks for the week
   */
  private async loadUnassignedBlocks(): Promise<void> {
    const allBlocks = await db
      .select()
      .from(blocks)
      .where(
        and(
          eq(blocks.tenantId, this.tenantId),
          gte(blocks.serviceDate, this.weekStart),
          lte(blocks.serviceDate, this.weekEnd)
        )
      );

    // Get assigned block IDs
    const assignments = await db
      .select({ blockId: blockAssignments.blockId })
      .from(blockAssignments)
      .where(
        and(
          eq(blockAssignments.tenantId, this.tenantId),
          eq(blockAssignments.isActive, true)
        )
      );

    const assignedIds = new Set(assignments.map(a => a.blockId));

    this.unassignedBlocks = allBlocks
      .filter(b => !assignedIds.has(b.id))
      .map(b => {
        const serviceDate = new Date(b.serviceDate);
        const dayOfWeek = serviceDate.getDay();
        return {
          id: b.id,
          blockId: b.blockId || b.id,
          serviceDate: format(serviceDate, 'yyyy-MM-dd'),
          dayOfWeek,
          dayName: DAY_NAMES[dayOfWeek],
          soloType: (b.soloType || 'solo1').toLowerCase(),
          tractorId: b.tractorId || 'Tractor_1',
          startTime: b.startTimestamp ? format(new Date(b.startTimestamp), 'HH:mm') : '00:00',
          endTime: b.endTimestamp ? format(new Date(b.endTimestamp), 'HH:mm') : '23:59',
          startTimestamp: new Date(b.startTimestamp),
          endTimestamp: new Date(b.endTimestamp),
        };
      })
      .sort((a, b) => a.serviceDate.localeCompare(b.serviceDate) || a.startTime.localeCompare(b.startTime));
  }

  /**
   * Load all active drivers
   */
  private async loadDrivers(): Promise<void> {
    const driverList = await db
      .select()
      .from(drivers)
      .where(
        and(
          eq(drivers.tenantId, this.tenantId),
          eq(drivers.status, "active"),
          or(isNull(drivers.isActive), eq(drivers.isActive, true))
        )
      );

    this.allDrivers = driverList.map(d => ({
      id: d.id,
      name: `${d.firstName} ${d.lastName}`.trim(),
      firstName: d.firstName,
      lastName: d.lastName,
      isActive: d.isActive !== false,
      daysOff: (d.daysOff || []).map(day => day.toLowerCase()),
    }));
  }

  /**
   * Load driver patterns from XGBoost
   */
  private async loadDriverPatterns(): Promise<void> {
    const result = await getAllDriverPatterns();

    if (result.success && result.data?.patterns) {
      this.driverPatterns = new Map(Object.entries(result.data.patterns));
    } else {
      console.warn(`[Scratchpad] Failed to load driver patterns: ${result.error || 'unknown'}`);
      this.driverPatterns = new Map();
    }
  }

  /**
   * Load approved special requests (time-off)
   */
  private async loadSpecialRequests(): Promise<void> {
    const requests = await db
      .select()
      .from(specialRequests)
      .where(
        and(
          eq(specialRequests.tenantId, this.tenantId),
          eq(specialRequests.status, "approved")
        )
      );

    this.unavailableDates = new Map();

    for (const req of requests) {
      if (!req.startDate || req.availabilityType !== "unavailable") continue;

      const reqStart = new Date(req.startDate);
      const reqEnd = req.endDate ? new Date(req.endDate) : reqStart;

      // Check if request overlaps with the week
      if (reqEnd < this.weekStart || reqStart > this.weekEnd) continue;

      // Handle recurring unavailability
      if (req.isRecurring && req.recurringDays && req.recurringDays.length > 0) {
        // For recurring, check each day of the week
        const weekDays = eachDayOfInterval({ start: this.weekStart, end: this.weekEnd });
        for (const day of weekDays) {
          const dayName = DAY_NAMES[day.getDay()].toLowerCase();
          if (req.recurringDays.includes(dayName)) {
            let unavail = this.unavailableDates.get(req.driverId);
            if (!unavail) {
              unavail = new Set();
              this.unavailableDates.set(req.driverId, unavail);
            }
            unavail.add(format(day, 'yyyy-MM-dd'));
          }
        }
      } else {
        // Non-recurring: add all dates in range
        const dates = eachDayOfInterval({
          start: reqStart < this.weekStart ? this.weekStart : reqStart,
          end: reqEnd > this.weekEnd ? this.weekEnd : reqEnd,
        });

        let unavail = this.unavailableDates.get(req.driverId);
        if (!unavail) {
          unavail = new Set();
          this.unavailableDates.set(req.driverId, unavail);
        }

        for (const d of dates) {
          unavail.add(format(d, 'yyyy-MM-dd'));
        }
      }
    }
  }

  /**
   * Load protected driver rules
   */
  private async loadProtectedRules(): Promise<void> {
    const rules = await db
      .select()
      .from(protectedDriverRules)
      .where(eq(protectedDriverRules.tenantId, this.tenantId));

    this.protectedRules = rules.map(r => ({
      id: r.id,
      driverId: r.driverId,
      ruleType: r.ruleType,
      blockedDays: r.blockedDays || undefined,
      allowedDays: r.allowedDays || undefined,
      blockedSoloTypes: undefined, // Not in schema - use allowedSoloTypes for "only these types"
      allowedSoloTypes: r.allowedSoloTypes || undefined,
      notes: undefined,
    }));
  }

  /**
   * Load existing assignments for DOT validation
   */
  private async loadExistingAssignments(): Promise<void> {
    // Look back 7 days for DOT compliance
    const lookbackStart = new Date(this.weekStart);
    lookbackStart.setDate(lookbackStart.getDate() - 7);

    const assignments = await db
      .select({
        assignment: blockAssignments,
        block: blocks,
      })
      .from(blockAssignments)
      .innerJoin(blocks, eq(blockAssignments.blockId, blocks.id))
      .where(
        and(
          eq(blockAssignments.tenantId, this.tenantId),
          eq(blockAssignments.isActive, true),
          gte(blocks.serviceDate, lookbackStart)
        )
      );

    this.existingAssignments = new Map();

    for (const row of assignments) {
      const driverId = row.assignment.driverId;
      if (!this.existingAssignments.has(driverId)) {
        this.existingAssignments.set(driverId, []);
      }
      this.existingAssignments.get(driverId)!.push({
        blockId: row.block.id,
        startTimestamp: new Date(row.block.startTimestamp),
        endTimestamp: new Date(row.block.endTimestamp),
        soloType: (row.block.soloType || 'solo1').toLowerCase(),
      });
    }
  }

  /**
   * Pre-compute affinity scores for all driver×block combinations
   */
  private async precomputeAffinityScores(): Promise<void> {
    if (this.unassignedBlocks.length === 0 || this.allDrivers.length === 0) {
      return;
    }

    const blockSlots: BlockSlotInfo[] = this.unassignedBlocks.map(b => ({
      date: b.serviceDate,
      soloType: b.soloType,
      tractorId: b.tractorId,
    }));

    // Build driver history from existing assignments
    const driversWithHistory = this.allDrivers.map(driver => {
      const driverAssignments = this.existingAssignments.get(driver.id) || [];
      const history: DriverHistoryItem[] = driverAssignments.map(a => ({
        serviceDate: format(a.startTimestamp, 'yyyy-MM-dd'),
        soloType: a.soloType,
        tractorId: undefined, // TODO: add tractorId to assignments
      }));

      return {
        id: driver.id,
        name: driver.name,
        history,
      };
    });

    console.log(`[Scratchpad] Pre-computing affinity: ${driversWithHistory.length} drivers × ${blockSlots.length} slots`);

    const result = await getBatchSlotAffinity(driversWithHistory, blockSlots);

    if (result.success && result.data?.predictions) {
      for (const [driverId, slotScores] of Object.entries(result.data.predictions)) {
        for (const [slotKey, score] of Object.entries(slotScores as Record<string, number>)) {
          this.affinityCache.set(`${driverId}_${slotKey}`, score);
        }
      }
      console.log(`[Scratchpad] Cached ${this.affinityCache.size} affinity scores`);
    }
  }

  /**
   * Count existing assignments per driver for fairness
   */
  private countDriverAssignments(): void {
    this.driverDayCounts = new Map();

    for (const [driverId, assignments] of this.existingAssignments) {
      // Only count assignments within this week
      const weekAssignments = assignments.filter(a => {
        const date = format(a.startTimestamp, 'yyyy-MM-dd');
        return date >= format(this.weekStart, 'yyyy-MM-dd') &&
               date <= format(this.weekEnd, 'yyyy-MM-dd');
      });
      this.driverDayCounts.set(driverId, weekAssignments.length);
    }
  }

  /**
   * Record a decision (assignment, skip, or failure)
   */
  recordDecision(
    blockId: string,
    blockInfo: string,
    driverId: string | null,
    driverName: string | null,
    action: 'assigned' | 'skipped' | 'failed',
    reasoning: string,
    checks?: Decision['checks']
  ): void {
    this.decisions.push({
      blockId,
      blockInfo,
      driverId,
      driverName,
      action,
      reasoning,
      timestamp: new Date(),
      checks,
    });

    // Update tracking
    if (action === 'assigned' && driverId) {
      this.assignedThisSession.set(blockId, driverId);
      this.driverDayCounts.set(driverId, (this.driverDayCounts.get(driverId) || 0) + 1);

      // Remove from unassigned list
      this.unassignedBlocks = this.unassignedBlocks.filter(b => b.id !== blockId);
    }
  }

  /**
   * Get a driver by ID
   */
  getDriver(driverId: string): DriverInfo | undefined {
    return this.allDrivers.find(d => d.id === driverId);
  }

  /**
   * Get a driver by name (fuzzy match)
   */
  getDriverByName(name: string): DriverInfo | undefined {
    const normalized = name.toLowerCase().replace(/\s+/g, ' ').trim();
    return this.allDrivers.find(d =>
      d.name.toLowerCase().replace(/\s+/g, ' ').trim() === normalized ||
      d.name.toLowerCase().includes(normalized)
    );
  }

  /**
   * Get pattern for a driver
   */
  getDriverPattern(driverName: string): DriverPattern | undefined {
    // Try exact match first
    if (this.driverPatterns.has(driverName)) {
      return this.driverPatterns.get(driverName);
    }

    // Try normalized match
    const normalized = driverName.toLowerCase().replace(/\s+/g, ' ').trim();
    for (const [key, pattern] of this.driverPatterns) {
      if (key.toLowerCase().replace(/\s+/g, ' ').trim() === normalized) {
        return pattern;
      }
    }

    return undefined;
  }

  /**
   * Get affinity score for a driver-slot pair
   */
  getAffinityScore(driverId: string, block: UnassignedBlock): number {
    const slotKey = `${block.soloType}|${block.tractorId}|${block.serviceDate}`;
    const cacheKey = `${driverId}_${slotKey}`;
    return this.affinityCache.get(cacheKey) ?? 0;
  }

  /**
   * Check if driver is unavailable on a date
   */
  isDriverUnavailable(driverId: string, date: string): { unavailable: boolean; reason?: string } {
    const unavail = this.unavailableDates.get(driverId);
    if (unavail && unavail.has(date)) {
      return { unavailable: true, reason: "Time-off approved" };
    }
    return { unavailable: false };
  }

  /**
   * Get remaining unassigned blocks
   */
  getRemainingBlocks(): UnassignedBlock[] {
    return this.unassignedBlocks;
  }

  /**
   * Get summary of session
   */
  getSummary(): {
    totalBlocks: number;
    assigned: number;
    unassigned: number;
    decisions: Decision[];
  } {
    const assigned = this.assignedThisSession.size;
    return {
      totalBlocks: assigned + this.unassignedBlocks.length,
      assigned,
      unassigned: this.unassignedBlocks.length,
      decisions: this.decisions,
    };
  }

  /**
   * Reset session state (keep cached data)
   */
  resetSession(): void {
    this.assignedThisSession.clear();
    this.decisions = [];
    // Re-count from existing assignments
    this.countDriverAssignments();
  }
}

// Singleton instance per tenant-week
const scratchpadCache = new Map<string, AgentScratchpad>();

export async function getScratchpad(tenantId: string, weekStart: Date): Promise<AgentScratchpad> {
  const key = `${tenantId}_${format(weekStart, 'yyyy-MM-dd')}`;

  if (!scratchpadCache.has(key)) {
    const scratchpad = new AgentScratchpad();
    await scratchpad.initialize(tenantId, weekStart);
    scratchpadCache.set(key, scratchpad);
  }

  return scratchpadCache.get(key)!;
}

export function clearScratchpadCache(): void {
  scratchpadCache.clear();
}
