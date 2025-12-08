/**
 * Gemini Schedule Optimizer
 *
 * Uses Google's Gemini AI to intelligently match drivers to blocks.
 * Similar to how DNA Analysis works - let AI figure out the best matches.
 *
 * "I see the drivers. I see the blocks. I find the perfect match."
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { db } from "./db";
import { blocks, drivers, driverDnaProfiles, blockAssignments } from "@shared/schema";
import { eq, and, gte, lte, isNull } from "drizzle-orm";
import { format, startOfWeek, endOfWeek } from "date-fns";

// Canonical start times - the Holy Grail lookup
const CANONICAL_START_TIMES: Record<string, string> = {
  "solo1_Tractor_1": "16:30",
  "solo1_Tractor_2": "20:30",
  "solo1_Tractor_3": "20:30",
  "solo1_Tractor_4": "17:30",
  "solo1_Tractor_5": "21:30",
  "solo1_Tractor_6": "01:30",
  "solo1_Tractor_7": "18:30",
  "solo1_Tractor_8": "00:30",
  "solo1_Tractor_9": "16:30",
  "solo1_Tractor_10": "20:30",
  "solo2_Tractor_1": "18:30",
  "solo2_Tractor_2": "23:30",
  "solo2_Tractor_3": "21:30",
  "solo2_Tractor_4": "08:30",
  "solo2_Tractor_5": "15:30",
  "solo2_Tractor_6": "11:30",
  "solo2_Tractor_7": "16:30",
};

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

interface DriverInfo {
  id: string;
  name: string;
  contractType: string;
  preferredDays: string[];
  preferredTime: string;
}

interface BlockInfo {
  id: string;
  day: string;
  time: string;
  contractType: string;
  serviceDate: string;
  tractorId: string;
}

interface SlotHistory {
  [slot: string]: {
    [driverId: string]: number;
  };
}

interface ScheduleSuggestion {
  blockId: string;
  driverId: string;
  driverName: string;
  confidence: number;
  matchType: string;
  reason: string;
}

/**
 * GeminiScheduler - AI-powered schedule optimization
 */
class GeminiScheduler {
  private client: GoogleGenerativeAI;
  private model: any;
  private initialized: boolean = false;

  constructor() {
    // Check both possible env var names
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || "";
    if (!apiKey) {
      console.warn("[GeminiScheduler] No GEMINI_API_KEY or GOOGLE_AI_API_KEY found");
    } else {
      console.log("[GeminiScheduler] API key found, length:", apiKey.length);
    }
    this.client = new GoogleGenerativeAI(apiKey);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Use gemini-1.5-flash - more stable quota than experimental models
      this.model = this.client.getGenerativeModel({
        model: "gemini-1.5-flash"
      });
      this.initialized = true;
      console.log("[GeminiScheduler] Initialized with gemini-1.5-flash");
    } catch (error) {
      console.error("[GeminiScheduler] Failed to initialize:", error);
      throw error;
    }
  }

  /**
   * Main optimization function - uses Gemini to match drivers to blocks
   */
  async optimizeSchedule(
    driversData: DriverInfo[],
    blocksData: BlockInfo[],
    slotHistory: SlotHistory,
    minDays: number = 3
  ): Promise<{
    suggestions: ScheduleSuggestion[];
    unassigned: string[];
    stats: {
      totalBlocks: number;
      totalDrivers: number;
      assigned: number;
      unassigned: number;
      solverStatus: string;
    };
  }> {
    if (!this.model) {
      throw new Error("Gemini model not initialized");
    }

    if (blocksData.length === 0) {
      return {
        suggestions: [],
        unassigned: [],
        stats: {
          totalBlocks: 0,
          totalDrivers: driversData.length,
          assigned: 0,
          unassigned: 0,
          solverStatus: "NO_BLOCKS"
        }
      };
    }

    console.log(`[GeminiScheduler] Processing ${driversData.length} drivers, ${blocksData.length} blocks`);

    // Group by contract type for cleaner processing
    const solo1Drivers = driversData.filter(d => d.contractType === "solo1");
    const solo2Drivers = driversData.filter(d => d.contractType === "solo2");
    const solo1Blocks = blocksData.filter(b => b.contractType.toLowerCase() === "solo1");
    const solo2Blocks = blocksData.filter(b => b.contractType.toLowerCase() === "solo2");

    console.log(`[GeminiScheduler] Solo1: ${solo1Drivers.length} drivers, ${solo1Blocks.length} blocks`);
    console.log(`[GeminiScheduler] Solo2: ${solo2Drivers.length} drivers, ${solo2Blocks.length} blocks`);

    const allSuggestions: ScheduleSuggestion[] = [];
    const allUnassigned: string[] = [];

    // Process solo1
    if (solo1Blocks.length > 0 && solo1Drivers.length > 0) {
      const result = await this.matchContractType(solo1Drivers, solo1Blocks, slotHistory, minDays, "solo1");
      allSuggestions.push(...result.suggestions);
      allUnassigned.push(...result.unassigned);
    } else if (solo1Blocks.length > 0) {
      allUnassigned.push(...solo1Blocks.map(b => b.id));
    }

    // Process solo2
    if (solo2Blocks.length > 0 && solo2Drivers.length > 0) {
      const result = await this.matchContractType(solo2Drivers, solo2Blocks, slotHistory, minDays, "solo2");
      allSuggestions.push(...result.suggestions);
      allUnassigned.push(...result.unassigned);
    } else if (solo2Blocks.length > 0) {
      allUnassigned.push(...solo2Blocks.map(b => b.id));
    }

    return {
      suggestions: allSuggestions,
      unassigned: allUnassigned,
      stats: {
        totalBlocks: blocksData.length,
        totalDrivers: driversData.length,
        assigned: allSuggestions.length,
        unassigned: allUnassigned.length,
        solverStatus: "GEMINI_OPTIMAL"
      }
    };
  }

  /**
   * Match drivers to blocks for one contract type using Gemini
   */
  private async matchContractType(
    ctDrivers: DriverInfo[],
    ctBlocks: BlockInfo[],
    slotHistory: SlotHistory,
    minDays: number,
    contractType: string
  ): Promise<{ suggestions: ScheduleSuggestion[]; unassigned: string[] }> {

    // Build history summary for each driver
    const driverHistorySummary = ctDrivers.map(driver => {
      const historySlots: string[] = [];
      for (const [slot, drivers] of Object.entries(slotHistory)) {
        const count = drivers[driver.id] || 0;
        if (count > 0) {
          historySlots.push(`${slot}:${count}x`);
        }
      }
      return {
        id: driver.id,
        name: driver.name,
        history: historySlots.slice(0, 10).join(", ") || "no history"
      };
    });

    // Group blocks by day for cleaner output
    const blocksByDay: Record<string, BlockInfo[]> = {};
    for (const block of ctBlocks) {
      if (!blocksByDay[block.day]) blocksByDay[block.day] = [];
      blocksByDay[block.day].push(block);
    }

    // Build unique dates
    const uniqueDates = [...new Set(ctBlocks.map(b => b.serviceDate))].sort();

    const prompt = `You are a schedule optimizer for Amazon delivery drivers. Match drivers to blocks fairly.

CONTRACT TYPE: ${contractType.toUpperCase()}

DRIVERS (${ctDrivers.length}):
${driverHistorySummary.map(d => `- ${d.name} (ID: ${d.id.slice(0,8)}): ${d.history}`).join("\n")}

BLOCKS TO ASSIGN (${ctBlocks.length} blocks across ${uniqueDates.length} days):
${Object.entries(blocksByDay).map(([day, blocks]) =>
  `${day.toUpperCase()}: ${blocks.length} blocks at times [${[...new Set(blocks.map(b => b.time))].join(", ")}]`
).join("\n")}

CONSTRAINTS:
1. Each driver can work AT MOST ONE block per day
2. Fair distribution: each driver should get ${minDays === 5 ? "equal blocks" : minDays === 4 ? "4-6 blocks" : "3-7 blocks"}
3. Prefer matching drivers to slots they've worked before (history shows "day_time:Nx" = N times worked)
4. ALL ${ctBlocks.length} blocks must be assigned

Respond with a JSON array of assignments. Format:
[
  {"blockId": "full-block-uuid", "driverId": "full-driver-uuid", "driverName": "Name", "reason": "brief reason"}
]

IMPORTANT:
- Use FULL UUIDs, not shortened versions
- Assign EVERY block exactly once
- Each driver works max 1 block per DATE (${uniqueDates.join(", ")})

BLOCKS (with full IDs):
${ctBlocks.map(b => `${b.id} - ${b.day} ${b.time} (${b.serviceDate})`).join("\n")}

DRIVERS (with full IDs):
${ctDrivers.map(d => `${d.id} - ${d.name}`).join("\n")}

Return ONLY the JSON array, no other text.`;

    try {
      const result = await this.model.generateContent(prompt);
      const responseText = result.response.text();

      // Parse JSON from response
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        console.error("[GeminiScheduler] No JSON array in response:", responseText.slice(0, 500));
        throw new Error("No JSON array found in Gemini response");
      }

      const assignments = JSON.parse(jsonMatch[0]) as Array<{
        blockId: string;
        driverId: string;
        driverName: string;
        reason: string;
      }>;

      console.log(`[GeminiScheduler] Gemini returned ${assignments.length} assignments for ${contractType}`);

      // Convert to suggestions format
      const suggestions: ScheduleSuggestion[] = [];
      const assignedBlockIds = new Set<string>();

      for (const assignment of assignments) {
        // Validate the assignment
        const block = ctBlocks.find(b => b.id === assignment.blockId);
        const driver = ctDrivers.find(d => d.id === assignment.driverId);

        if (!block || !driver) {
          console.warn(`[GeminiScheduler] Invalid assignment: block=${assignment.blockId}, driver=${assignment.driverId}`);
          continue;
        }

        if (assignedBlockIds.has(block.id)) {
          console.warn(`[GeminiScheduler] Block ${block.id} already assigned, skipping duplicate`);
          continue;
        }

        // Check history for confidence score
        const slot = `${block.day}_${block.time}`;
        const historyCount = slotHistory[slot]?.[driver.id] || 0;
        const confidence = historyCount > 0 ? Math.min(1.0, 0.7 + historyCount * 0.1) : 0.6;

        suggestions.push({
          blockId: block.id,
          driverId: driver.id,
          driverName: driver.name,
          confidence,
          matchType: historyCount > 0 ? "historical" : "optimal",
          reason: assignment.reason || "Gemini assignment"
        });

        assignedBlockIds.add(block.id);
      }

      // Find unassigned blocks
      const unassigned = ctBlocks
        .filter(b => !assignedBlockIds.has(b.id))
        .map(b => b.id);

      if (unassigned.length > 0) {
        console.warn(`[GeminiScheduler] ${unassigned.length} blocks could not be assigned for ${contractType}`);
      }

      return { suggestions, unassigned };

    } catch (error) {
      console.error("[GeminiScheduler] Gemini API error:", error);
      // Fallback to simple round-robin assignment
      return this.fallbackAssignment(ctDrivers, ctBlocks, slotHistory);
    }
  }

  /**
   * Fallback assignment when Gemini fails - simple round-robin
   */
  private fallbackAssignment(
    ctDrivers: DriverInfo[],
    ctBlocks: BlockInfo[],
    slotHistory: SlotHistory
  ): { suggestions: ScheduleSuggestion[]; unassigned: string[] } {
    console.log("[GeminiScheduler] Using fallback round-robin assignment");

    const suggestions: ScheduleSuggestion[] = [];
    const driverAssignmentsByDate: Record<string, Set<string>> = {}; // date -> Set of driverIds

    // Sort blocks by date
    const sortedBlocks = [...ctBlocks].sort((a, b) => a.serviceDate.localeCompare(b.serviceDate));

    let driverIndex = 0;
    for (const block of sortedBlocks) {
      // Find next available driver for this date
      let attempts = 0;
      while (attempts < ctDrivers.length) {
        const driver = ctDrivers[driverIndex % ctDrivers.length];

        // Check if driver already has a block on this date
        if (!driverAssignmentsByDate[block.serviceDate]) {
          driverAssignmentsByDate[block.serviceDate] = new Set();
        }

        if (!driverAssignmentsByDate[block.serviceDate].has(driver.id)) {
          // Assign this block to this driver
          const slot = `${block.day}_${block.time}`;
          const historyCount = slotHistory[slot]?.[driver.id] || 0;

          suggestions.push({
            blockId: block.id,
            driverId: driver.id,
            driverName: driver.name,
            confidence: historyCount > 0 ? 0.7 : 0.5,
            matchType: "fallback",
            reason: "Round-robin fallback assignment"
          });

          driverAssignmentsByDate[block.serviceDate].add(driver.id);
          driverIndex++;
          break;
        }

        driverIndex++;
        attempts++;
      }
    }

    const assignedBlockIds = new Set(suggestions.map(s => s.blockId));
    const unassigned = ctBlocks.filter(b => !assignedBlockIds.has(b.id)).map(b => b.id);

    return { suggestions, unassigned };
  }
}

// Singleton instance
let schedulerInstance: GeminiScheduler | null = null;

async function getGeminiScheduler(): Promise<GeminiScheduler> {
  if (!schedulerInstance) {
    schedulerInstance = new GeminiScheduler();
    await schedulerInstance.initialize();
  }
  return schedulerInstance;
}

/**
 * Main export - optimize a week's schedule using Gemini
 */
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
  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 0 });

  console.log(`[GeminiScheduler] Optimizing ${format(weekStart, "yyyy-MM-dd")} to ${format(weekEnd, "yyyy-MM-dd")}`);

  // Get drivers with DNA profiles
  const allDrivers = await db
    .select({
      id: drivers.id,
      firstName: drivers.firstName,
      lastName: drivers.lastName,
      contractType: driverDnaProfiles.preferredContractType,
      preferredDays: driverDnaProfiles.preferredDays,
      preferredTime: driverDnaProfiles.preferredStartTimes,
    })
    .from(drivers)
    .leftJoin(driverDnaProfiles, eq(drivers.id, driverDnaProfiles.driverId))
    .where(
      and(
        eq(drivers.tenantId, tenantId),
        eq(drivers.status, "active")
      )
    );

  const driverInputs: DriverInfo[] = allDrivers.map(d => ({
    id: d.id,
    name: `${d.firstName} ${d.lastName}`,
    contractType: (d.contractType || "solo1").toLowerCase(),
    preferredDays: (d.preferredDays as string[]) || [],
    preferredTime: ((d.preferredTime as string[]) || [])[0] || ""
  }));

  // Get unassigned blocks
  const weekEndPlusOne = new Date(weekEnd);
  weekEndPlusOne.setDate(weekEndPlusOne.getDate() + 1);

  const allBlocks = await db
    .select()
    .from(blocks)
    .where(
      and(
        eq(blocks.tenantId, tenantId),
        gte(blocks.serviceDate, weekStart),
        lte(blocks.serviceDate, weekEndPlusOne)
      )
    );

  const assignments = await db
    .select({ blockId: blockAssignments.blockId })
    .from(blockAssignments)
    .where(eq(blockAssignments.isActive, true));

  const assignedBlockIds = new Set(assignments.map(a => a.blockId));

  const blockInputs: BlockInfo[] = allBlocks
    .filter(b => !assignedBlockIds.has(b.id))
    .filter(b => {
      if (!contractTypeFilter) return true;
      return b.soloType?.toLowerCase() === contractTypeFilter.toLowerCase();
    })
    .map(b => {
      const serviceDate = new Date(b.serviceDate);
      const dayIndex = serviceDate.getDay();
      const dayName = DAY_NAMES[dayIndex];
      const soloType = (b.soloType || "solo1").toLowerCase();
      const tractorId = b.tractorId || "Tractor_1";
      const lookupKey = `${soloType}_${tractorId}`;
      const time = CANONICAL_START_TIMES[lookupKey] || "00:00";

      return {
        id: b.id,
        day: dayName,
        time,
        contractType: soloType,
        serviceDate: format(serviceDate, "yyyy-MM-dd"),
        tractorId
      };
    });

  // Get 8-week slot history
  const slotHistory = await get8WeekSlotHistory(tenantId, weekStart);

  console.log(`[GeminiScheduler] Found ${driverInputs.length} drivers, ${blockInputs.length} unassigned blocks`);

  if (driverInputs.length === 0 || blockInputs.length === 0) {
    return {
      suggestions: [],
      unassigned: blockInputs.map(b => b.id),
      stats: {
        totalBlocks: blockInputs.length,
        totalDrivers: driverInputs.length,
        assigned: 0,
        unassigned: blockInputs.length,
        solverStatus: "NO_DATA"
      }
    };
  }

  // Call Gemini scheduler
  const scheduler = await getGeminiScheduler();
  const result = await scheduler.optimizeSchedule(driverInputs, blockInputs, slotHistory, minDays);

  // Convert to expected format
  const suggestions = result.suggestions.map(s => {
    const block = blockInputs.find(b => b.id === s.blockId);
    return {
      blockId: s.blockId,
      driverId: s.driverId,
      driverName: s.driverName,
      confidence: s.confidence,
      matchType: s.matchType,
      preferredTime: block?.time || "",
      actualTime: block?.time || ""
    };
  });

  return {
    suggestions,
    unassigned: result.unassigned,
    stats: result.stats
  };
}

/**
 * Get 8-week slot history for historical pattern matching
 */
async function get8WeekSlotHistory(tenantId: string, currentWeekStart: Date): Promise<SlotHistory> {
  const eightWeeksAgo = new Date(currentWeekStart);
  eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 56);

  const historyEnd = new Date(currentWeekStart);
  historyEnd.setDate(historyEnd.getDate() - 1);

  const historyBlocks = await db
    .select({
      id: blocks.id,
      serviceDate: blocks.serviceDate,
      soloType: blocks.soloType,
      tractorId: blocks.tractorId
    })
    .from(blocks)
    .where(
      and(
        eq(blocks.tenantId, tenantId),
        gte(blocks.serviceDate, eightWeeksAgo),
        lte(blocks.serviceDate, historyEnd)
      )
    );

  const blockIdToSlot: Record<string, string> = {};
  for (const b of historyBlocks) {
    const serviceDate = new Date(b.serviceDate);
    const dayIndex = serviceDate.getDay();
    const dayName = DAY_NAMES[dayIndex];
    const soloType = (b.soloType || "solo1").toLowerCase();
    const tractorId = b.tractorId || "Tractor_1";
    const lookupKey = `${soloType}_${tractorId}`;
    const canonicalTime = CANONICAL_START_TIMES[lookupKey] || "00:00";
    const slot = `${dayName}_${canonicalTime}`;
    blockIdToSlot[b.id] = slot;
  }

  const assignmentsData = await db
    .select({
      blockId: blockAssignments.blockId,
      driverId: blockAssignments.driverId
    })
    .from(blockAssignments)
    .where(eq(blockAssignments.isActive, true));

  const slotHistory: SlotHistory = {};
  for (const a of assignmentsData) {
    if (!a.blockId) continue;
    const slot = blockIdToSlot[a.blockId];
    if (slot) {
      if (!slotHistory[slot]) slotHistory[slot] = {};
      slotHistory[slot][a.driverId] = (slotHistory[slot][a.driverId] || 0) + 1;
    }
  }

  console.log(`[GeminiScheduler] Built history: ${Object.keys(slotHistory).length} slots`);
  return slotHistory;
}

/**
 * Apply Gemini-optimized assignments to database
 */
export async function applyGeminiSchedule(
  tenantId: string,
  assignments: Array<{ blockId: string; driverId: string }>
): Promise<{ applied: number; errors: string[] }> {
  let applied = 0;
  const errors: string[] = [];

  for (const assignment of assignments) {
    try {
      const existing = await db
        .select()
        .from(blockAssignments)
        .where(
          and(
            eq(blockAssignments.blockId, assignment.blockId),
            eq(blockAssignments.isActive, true)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        errors.push(`Block ${assignment.blockId} already assigned`);
        continue;
      }

      await db.insert(blockAssignments).values({
        tenantId,
        blockId: assignment.blockId,
        driverId: assignment.driverId,
        isActive: true,
        assignedAt: new Date(),
        assignedBy: null
      });

      applied++;
    } catch (e: any) {
      errors.push(`Failed to assign ${assignment.blockId}: ${e.message}`);
    }
  }

  return { applied, errors };
}
