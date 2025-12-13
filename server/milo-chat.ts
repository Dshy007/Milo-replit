/**
 * MILO Chat - Conversational Schedule Intelligence
 *
 * Enables natural language conversations about drivers, schedules, and matching.
 * Maintains conversation history for context-aware follow-up questions.
 */

import Anthropic from "@anthropic-ai/sdk";
import { db } from "./db";
import { drivers, blocks, blockAssignments, driverDnaProfiles } from "@shared/schema";
import { eq, and, gte, lte, sql, isNull } from "drizzle-orm";
import { format, subWeeks, startOfWeek, endOfWeek, addDays } from "date-fns";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Conversation history storage (in-memory for now, could be persisted to DB)
const conversationHistory: Map<string, Array<{ role: "user" | "assistant"; content: string }>> = new Map();

const MILO_CHAT_SYSTEM_PROMPT = `You are MILO (Match Intelligence & Logistics Optimizer), a conversational assistant for trucking schedule operations.

## YOUR CAPABILITIES

You can answer questions about:
- Driver schedules and history (what days/times they worked)
- Driver preferences from their DNA profiles
- Driver scheduling preferences (min/max days, allowed days restrictions)
- Block assignments and coverage
- DOT compliance patterns
- Matching recommendations
- How many blocks/days a driver was assigned this week
- AI Scheduler constraints for part-time drivers
- Rolling interval patterns (drivers who work every N days)

## DRIVER PATTERN TYPES

There are TWO fundamentally different pattern types:

### 1. Fixed Weekday Pattern (e.g., Firas)
- Works specific days of the week: Saturday, Sunday, Monday
- Calendar-driven schedule
- Use allowedDays scheduling preference to restrict

### 2. Rolling Interval Pattern (e.g., Adan)
- Works every ~N days regardless of which weekday
- Cycle-driven schedule (e.g., works every 3 days)
- Identified by consistent interval between blocks
- Example: blocks on Nov 1, Nov 4, Nov 7, Nov 10 = ~3 day cycle

When a driver has a rolling pattern, the data will show:
- **intervalDays**: Average days between blocks
- **intervalStdDev**: How consistent the pattern is (lower = more consistent)
- **lastWorkDate**: Most recent work date (for predicting next work)

## DRIVER SCHEDULING PREFERENCES

Drivers can have per-driver scheduling preferences that control how the AI Scheduler assigns them:
- **minDays**: Minimum days per week (e.g., 1 for part-time)
- **maxDays**: Maximum days per week (e.g., 3 for part-time)
- **allowedDays**: Specific days only (e.g., ["saturday", "sunday"] for weekend-only)
- **notes**: Free-form notes like "Part-time student" or "Only weekends"

Examples:
- A driver with minDays=3, maxDays=3, allowedDays=["saturday", "sunday", "monday"] will ONLY get blocks on those 3 days
- A driver with no preferences uses the global defaults (typically 3-5 days)

## ASSIGNMENT COMMANDS (handled automatically)

Users can say things like "give Adan 3 solo2's at 23:30" - these commands are executed directly. You don't need to process them.

## RESPONSE STYLE

- Be concise and direct
- Use tables when showing multiple data points
- Reference specific dates and times
- If you don't have data, say so clearly
- When asked about a driver, always mention their contract type (solo1/solo2)
- When asked "how many days did X get", count their assignments in the provided data
- When asked about scheduling preferences, mention any restrictions like min/max days or allowed days

## DATA CONTEXT

You will receive relevant data from the database injected into each message. Use this data to answer questions accurately.

## EXAMPLES

User: "Show me Firas's last 4 weeks"
Assistant: Here's Firas's schedule history for the last 4 weeks:

| Date | Day | Start Time | Tractor |
|------|-----|------------|---------|
| 2024-12-01 | Sunday | 16:30 | Tractor_1 |
| 2024-12-02 | Monday | 16:30 | Tractor_9 |
...

Firas worked 18 shifts total, primarily Sunday-Thursday with a preferred 16:30 start time.

User: "Did he work on Monday?"
Assistant: Yes, Firas worked on Mondays in the last 4 weeks:
- Dec 2: 16:30 start (Tractor_9)
- Dec 9: 16:30 start (Tractor_1)
- Dec 16: 16:30 start (Tractor_9)

He consistently works Mondays at 16:30.

User: "What are Firas's scheduling preferences?"
Assistant: Firas has the following scheduling preferences:
- **Min Days**: 3
- **Max Days**: 3
- **Allowed Days**: Saturday, Sunday, Monday
- **Notes**: None

This means the AI Scheduler will only assign Firas blocks on Saturday, Sunday, and Monday, exactly 3 days per week.
`;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// Canonical start times derived from tractor assignments
const CANONICAL_START_TIMES: Record<string, string> = {
  // Solo1 (10 tractors)
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
  // Solo2 (7 tractors)
  "solo2_Tractor_1": "18:30",
  "solo2_Tractor_2": "23:30",
  "solo2_Tractor_3": "21:30",
  "solo2_Tractor_4": "08:30",
  "solo2_Tractor_5": "15:30",
  "solo2_Tractor_6": "11:30",
  "solo2_Tractor_7": "16:30",
};

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

interface RollingPattern {
  hasRollingPattern: boolean;
  intervalDays: number | null;
  intervalMedian: number | null;
  intervalStdDev: number | null;
  confidence: number;
  lastWorkDate: string | null;
}

interface PatternAnalysisResult {
  profiles: Record<string, {
    patternGroup: string | null;
    preferredDays: string[];
    preferredTimes: string[];
    rollingPattern: RollingPattern;
  }>;
}

/**
 * Call Python pattern analyzer to detect rolling interval patterns
 */
async function analyzeDriverPatterns(
  driverHistories: Record<string, Array<{ day: string; time: string; serviceDate: string }>>
): Promise<PatternAnalysisResult | null> {
  return new Promise((resolve) => {
    const pythonPath = process.env.PYTHON_PATH || "python";
    const scriptPath = path.join(__dirname, "../python/pattern_analyzer.py");

    const input = JSON.stringify({
      action: "cluster",
      driverHistories
    });

    const python = spawn(pythonPath, [scriptPath]);

    let stdout = "";
    let stderr = "";

    python.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    python.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    python.on("close", (code) => {
      if (code !== 0) {
        console.error("[MiloChat] Pattern analyzer error:", stderr);
        resolve(null);
        return;
      }

      try {
        const result = JSON.parse(stdout);
        if (result.success) {
          resolve(result as PatternAnalysisResult);
        } else {
          console.error("[MiloChat] Pattern analyzer failed:", result.error);
          resolve(null);
        }
      } catch (e) {
        console.error("[MiloChat] Failed to parse pattern analyzer output:", stdout);
        resolve(null);
      }
    });

    python.on("error", (err) => {
      console.error("[MiloChat] Failed to start pattern analyzer:", err);
      resolve(null);
    });

    python.stdin.write(input);
    python.stdin.end();
  });
}

/**
 * Compute driver patterns from 8-week historical assignment data
 * This is the SOURCE OF TRUTH - not the DNA profile table
 */
async function computeDriverPatternsFromHistory(
  tenantId: string,
  weeksBack: number = 8
): Promise<Map<string, {
  id: string;
  name: string;
  contractType: string;
  preferredDays: string[];
  preferredTimes: string[];
  primaryTime: string;
  dayCounts: Record<string, number>;
  timeCounts: Record<string, number>;
  totalShifts: number;
  rollingPattern?: RollingPattern;
}>> {
  const cutoffDate = format(subWeeks(new Date(), weeksBack), "yyyy-MM-dd");

  // Step 1: Get assignment counts by contract type for each driver
  const driverContractCounts = await db.execute(sql`
    SELECT
      ba.driver_id,
      d.first_name,
      d.last_name,
      LOWER(b.solo_type) as solo_type,
      COUNT(*) as assignment_count
    FROM block_assignments ba
    JOIN blocks b ON ba.block_id = b.id
    JOIN drivers d ON ba.driver_id = d.id
    WHERE ba.is_active = true
    AND b.service_date >= ${cutoffDate}::date
    AND d.tenant_id = ${tenantId}
    GROUP BY ba.driver_id, d.first_name, d.last_name, LOWER(b.solo_type)
    ORDER BY d.last_name, d.first_name
  `);

  // Calculate predominant contract type per driver
  const driverPredominantType = new Map<string, { name: string; contractType: string; solo1Count: number; solo2Count: number }>();

  for (const row of driverContractCounts.rows as any[]) {
    const driverId = row.driver_id;
    const name = `${row.first_name} ${row.last_name}`;
    const soloType = row.solo_type || "";
    const count = parseInt(row.assignment_count);

    if (!driverPredominantType.has(driverId)) {
      driverPredominantType.set(driverId, { name, contractType: "solo1", solo1Count: 0, solo2Count: 0 });
    }

    const data = driverPredominantType.get(driverId)!;
    if (soloType === "solo1") {
      data.solo1Count += count;
    } else if (soloType === "solo2") {
      data.solo2Count += count;
    }
  }

  // Determine predominant type
  for (const [_, data] of driverPredominantType) {
    data.contractType = data.solo1Count >= data.solo2Count ? "solo1" : "solo2";
  }

  // Step 2: Get all assignments from last 8 weeks
  const assignments = await db.execute(sql`
    SELECT
      d.id as driver_id,
      d.first_name,
      d.last_name,
      b.service_date,
      LOWER(b.solo_type) as solo_type,
      b.tractor_id
    FROM block_assignments ba
    JOIN blocks b ON ba.block_id = b.id
    JOIN drivers d ON ba.driver_id = d.id
    WHERE ba.is_active = true
    AND b.service_date >= ${cutoffDate}::date
    AND d.tenant_id = ${tenantId}
    ORDER BY d.last_name, d.first_name, b.service_date
  `);

  // Group by driver and compute patterns
  const driverPatterns = new Map<string, {
    id: string;
    name: string;
    contractType: string;
    preferredDays: string[];
    preferredTimes: string[];
    primaryTime: string;
    dayCounts: Record<string, number>;
    timeCounts: Record<string, number>;
    totalShifts: number;
    rollingPattern?: RollingPattern;
  }>();

  // Also build history entries for Python pattern analyzer
  const driverHistories: Record<string, Array<{ day: string; time: string; serviceDate: string }>> = {};

  for (const row of assignments.rows as any[]) {
    const driverId = row.driver_id;
    const driverName = `${row.first_name} ${row.last_name}`;
    const soloType = row.solo_type || "solo1";
    const tractorId = row.tractor_id || "Unknown";

    // Lookup canonical time based on contract type + tractor
    const lookupKey = `${soloType}_${tractorId}`;
    const time = CANONICAL_START_TIMES[lookupKey] || "??:??";

    const serviceDate = new Date(row.service_date);
    const dayIndex = serviceDate.getDay();
    const dayName = DAY_NAMES[dayIndex];
    const serviceDateStr = format(serviceDate, "yyyy-MM-dd");

    if (!driverPatterns.has(driverId)) {
      const predType = driverPredominantType.get(driverId);
      driverPatterns.set(driverId, {
        id: driverId,
        name: driverName,
        contractType: predType?.contractType || "solo1",
        preferredDays: [],
        preferredTimes: [],
        primaryTime: "",
        dayCounts: {},
        timeCounts: {},
        totalShifts: 0,
      });
    }

    // Build history entries for Python pattern analyzer
    if (!driverHistories[driverId]) {
      driverHistories[driverId] = [];
    }
    driverHistories[driverId].push({ day: dayName, time, serviceDate: serviceDateStr });

    const pattern = driverPatterns.get(driverId)!;
    pattern.dayCounts[dayName] = (pattern.dayCounts[dayName] || 0) + 1;
    pattern.timeCounts[time] = (pattern.timeCounts[time] || 0) + 1;
    pattern.totalShifts++;
  }

  // Calculate preferred days/times from counts
  for (const [_, pattern] of driverPatterns) {
    // Preferred days = all days they've worked, sorted by frequency
    pattern.preferredDays = Object.entries(pattern.dayCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([day]) => day);

    // Preferred times = all times they've worked, sorted by frequency
    const sortedTimes = Object.entries(pattern.timeCounts)
      .sort((a, b) => b[1] - a[1]);

    pattern.preferredTimes = sortedTimes.map(([time]) => time);
    pattern.primaryTime = sortedTimes[0]?.[0] || "??:??";
  }

  // Analyze rolling patterns using Python ML analyzer
  if (Object.keys(driverHistories).length > 0) {
    try {
      const patternAnalysis = await analyzeDriverPatterns(driverHistories);
      if (patternAnalysis && patternAnalysis.profiles) {
        for (const [driverId, profile] of Object.entries(patternAnalysis.profiles)) {
          const driverPattern = driverPatterns.get(driverId);
          if (driverPattern && profile.rollingPattern) {
            driverPattern.rollingPattern = profile.rollingPattern;
          }
        }
      }
    } catch (err) {
      console.error("[MiloChat] Failed to analyze rolling patterns:", err);
    }
  }

  return driverPatterns;
}

/**
 * Fetch driver data for context injection
 * Uses ACTUAL historical assignment data, not stale DNA profile table
 * Also includes scheduling preferences (minDays, maxDays, allowedDays)
 */
async function getDriverContext(tenantId: string, driverName?: string, contractTypeFilter?: string, weeksBack: number = 8): Promise<string> {
  // Compute patterns from history (source of truth)
  const driverPatterns = await computeDriverPatternsFromHistory(tenantId, weeksBack);

  // Fetch scheduling preferences for all drivers
  const schedulingPrefs = await db
    .select({
      id: drivers.id,
      schedulingMinDays: drivers.schedulingMinDays,
      schedulingMaxDays: drivers.schedulingMaxDays,
      schedulingAllowedDays: drivers.schedulingAllowedDays,
      schedulingNotes: drivers.schedulingNotes,
    })
    .from(drivers)
    .where(eq(drivers.tenantId, tenantId));

  const prefsMap = new Map<string, {
    minDays: number | null;
    maxDays: number | null;
    allowedDays: string[] | null;
    notes: string | null;
  }>();
  for (const pref of schedulingPrefs) {
    prefsMap.set(pref.id, {
      minDays: pref.schedulingMinDays,
      maxDays: pref.schedulingMaxDays,
      allowedDays: pref.schedulingAllowedDays,
      notes: pref.schedulingNotes,
    });
  }

  // Convert to array and optionally filter
  let filteredDrivers = Array.from(driverPatterns.values());

  // Filter by contract type if specified
  if (contractTypeFilter) {
    filteredDrivers = filteredDrivers.filter(d => d.contractType === contractTypeFilter.toLowerCase());
  }

  // Filter by name if provided (fuzzy match)
  if (driverName) {
    const searchName = driverName.toLowerCase();
    filteredDrivers = filteredDrivers.filter(d =>
      d.name.toLowerCase().includes(searchName)
    );
  }

  if (filteredDrivers.length === 0) {
    const allDrivers = Array.from(driverPatterns.values());
    return driverName
      ? `No driver found matching "${driverName}". Available drivers: ${allDrivers.map(d => d.name).join(", ")}`
      : `No drivers found with assignments in the last ${weeksBack} weeks.`;
  }

  // Sort by name
  filteredDrivers.sort((a, b) => a.name.localeCompare(b.name));

  // Format driver info with ACTUAL historical patterns AND scheduling preferences
  const driverInfo = filteredDrivers.map(d => {
    const dayList = d.preferredDays
      .map(day => {
        const count = d.dayCounts[day];
        return `${day.charAt(0).toUpperCase() + day.slice(1)} (${count}x)`;
      })
      .join(", ");

    const timeList = d.preferredTimes
      .map(time => {
        const count = d.timeCounts[time];
        return `${time} (${count}x)`;
      })
      .join(", ");

    // Include scheduling preferences
    const prefs = prefsMap.get(d.id);
    let schedulingInfo = "";
    if (prefs && (prefs.minDays || prefs.maxDays || prefs.allowedDays?.length || prefs.notes)) {
      const parts: string[] = [];
      if (prefs.minDays !== null) parts.push(`Min Days: ${prefs.minDays}`);
      if (prefs.maxDays !== null) parts.push(`Max Days: ${prefs.maxDays}`);
      if (prefs.allowedDays && prefs.allowedDays.length > 0) {
        parts.push(`Allowed Days: ${prefs.allowedDays.map(dayStr => dayStr.charAt(0).toUpperCase() + dayStr.slice(1)).join(", ")}`);
      }
      if (prefs.notes) parts.push(`Notes: ${prefs.notes}`);
      schedulingInfo = `\n  - **Scheduling Preferences**: ${parts.join(" | ")}`;
    }

    // Include rolling pattern info if detected
    let rollingPatternInfo = "";
    if (d.rollingPattern && d.rollingPattern.hasRollingPattern) {
      const rp = d.rollingPattern;
      rollingPatternInfo = `\n  - **Rolling Pattern**: Works every ~${rp.intervalDays} days (std: ${rp.intervalStdDev}, conf: ${(rp.confidence * 100).toFixed(0)}%, last: ${rp.lastWorkDate})`;
    }

    return `**${d.name}** (${d.contractType}, ${d.totalShifts} shifts in last ${weeksBack} weeks)
  - Primary Time: ${d.primaryTime}
  - Days Worked: ${dayList || "none"}
  - Times Worked: ${timeList || "none"}
  - ID: ${d.id}${schedulingInfo}${rollingPatternInfo}`;
  }).join("\n\n");

  return driverInfo;
}

/**
 * Get driver schedule for a specific date range
 * Used when user asks "what did X work Dec 7-13"
 */
async function getDriverScheduleForDateRange(
  tenantId: string,
  driverName: string,
  dateRange: { start: Date; end: Date }
): Promise<string> {
  // Find matching driver
  const matchingDrivers = await db
    .select({ id: drivers.id, firstName: drivers.firstName, lastName: drivers.lastName })
    .from(drivers)
    .where(eq(drivers.tenantId, tenantId));

  const searchName = driverName.toLowerCase();
  const matchedDrivers = matchingDrivers.filter(d =>
    d.firstName?.toLowerCase().includes(searchName) ||
    d.lastName?.toLowerCase().includes(searchName) ||
    `${d.firstName} ${d.lastName}`.toLowerCase().includes(searchName)
  );

  if (matchedDrivers.length === 0) {
    return `No driver found matching "${driverName}".`;
  }

  const driverIds = matchedDrivers.map(d => d.id);
  const driverMap = new Map<string, string>();
  for (const d of matchedDrivers) {
    driverMap.set(d.id, `${d.firstName} ${d.lastName}`);
  }

  // Get blocks in the date range for these drivers
  const assignments = await db
    .select({
      serviceDate: blocks.serviceDate,
      soloType: blocks.soloType,
      tractorId: blocks.tractorId,
      driverId: blockAssignments.driverId,
    })
    .from(blockAssignments)
    .innerJoin(blocks, eq(blockAssignments.blockId, blocks.id))
    .where(
      and(
        eq(blocks.tenantId, tenantId),
        eq(blockAssignments.isActive, true),
        gte(blocks.serviceDate, dateRange.start),
        lte(blocks.serviceDate, dateRange.end)
      )
    );

  // Filter to our drivers
  const driverAssignments = assignments.filter(a => a.driverId && driverIds.includes(a.driverId));

  if (driverAssignments.length === 0) {
    return `No assignments found for "${driverName}" between ${format(dateRange.start, "MMM d")} and ${format(dateRange.end, "MMM d")}.`;
  }

  // Format the results
  const DAY_NAMES_UPPER = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  const rows = driverAssignments
    .sort((a, b) => new Date(a.serviceDate).getTime() - new Date(b.serviceDate).getTime())
    .map(a => {
      const date = new Date(a.serviceDate);
      const dayName = DAY_NAMES_UPPER[date.getDay()];
      const soloType = (a.soloType || "solo1").toLowerCase();
      const tractorId = a.tractorId || "Tractor_1";
      const lookupKey = `${soloType}_${tractorId}`;
      const time = CANONICAL_START_TIMES[lookupKey] || "??:??";
      const driverFullName = driverMap.get(a.driverId!) || "Unknown";

      return `| ${format(date, "yyyy-MM-dd")} | ${dayName} | ${time} | ${a.soloType} | ${tractorId} | ${driverFullName} |`;
    });

  const driverNameDisplay = matchedDrivers.length === 1
    ? driverMap.get(matchedDrivers[0].id) || driverName
    : driverName;

  return `## ${driverNameDisplay}'s Schedule for ${format(dateRange.start, "MMM d")} - ${format(dateRange.end, "MMM d")}

| Date | Day | Start Time | Type | Tractor | Driver |
|------|-----|------------|------|---------|--------|
${rows.join("\n")}

**Total:** ${driverAssignments.length} assignment(s)`;
}

/**
 * Fetch schedule history for context injection
 */
async function getScheduleHistory(
  tenantId: string,
  driverName?: string,
  weeksBack: number = 4
): Promise<string> {
  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn: 0 });
  const historyStart = subWeeks(weekStart, weeksBack);

  // Get driver IDs if filtering by name
  let driverIds: string[] = [];
  if (driverName) {
    const searchName = driverName.toLowerCase();
    const matchingDrivers = await db
      .select({ id: drivers.id, firstName: drivers.firstName, lastName: drivers.lastName })
      .from(drivers)
      .where(eq(drivers.tenantId, tenantId));

    driverIds = matchingDrivers
      .filter(d =>
        d.firstName?.toLowerCase().includes(searchName) ||
        d.lastName?.toLowerCase().includes(searchName) ||
        `${d.firstName} ${d.lastName}`.toLowerCase().includes(searchName)
      )
      .map(d => d.id);

    if (driverIds.length === 0) {
      return `No driver found matching "${driverName}".`;
    }
  }

  // Get blocks with assignments
  const historyBlocks = await db
    .select({
      blockId: blocks.id,
      serviceDate: blocks.serviceDate,
      soloType: blocks.soloType,
      tractorId: blocks.tractorId,
      startTimestamp: blocks.startTimestamp,
      driverId: blockAssignments.driverId,
    })
    .from(blocks)
    .leftJoin(blockAssignments, and(
      eq(blocks.id, blockAssignments.blockId),
      eq(blockAssignments.isActive, true)
    ))
    .where(
      and(
        eq(blocks.tenantId, tenantId),
        gte(blocks.serviceDate, historyStart),
        lte(blocks.serviceDate, now)
      )
    );

  // Filter by driver if specified
  let relevantBlocks = historyBlocks;
  if (driverIds.length > 0) {
    relevantBlocks = historyBlocks.filter(b => b.driverId && driverIds.includes(b.driverId));
  }

  if (relevantBlocks.length === 0) {
    return driverName
      ? `No schedule history found for "${driverName}" in the last ${weeksBack} weeks.`
      : `No schedule history found in the last ${weeksBack} weeks.`;
  }

  // Get driver names for display
  const driverMap = new Map<string, string>();
  const driverData = await db
    .select({ id: drivers.id, firstName: drivers.firstName, lastName: drivers.lastName })
    .from(drivers)
    .where(eq(drivers.tenantId, tenantId));

  for (const d of driverData) {
    driverMap.set(d.id, `${d.firstName} ${d.lastName}`);
  }

  // Format history
  const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  const rows = relevantBlocks
    .filter(b => b.driverId)
    .sort((a, b) => new Date(b.serviceDate).getTime() - new Date(a.serviceDate).getTime())
    .map(b => {
      const date = new Date(b.serviceDate);
      const dayName = DAY_NAMES[date.getDay()];
      const driverNameDisplay = driverMap.get(b.driverId!) || "Unknown";
      const startTime = b.startTimestamp ? format(new Date(b.startTimestamp), "HH:mm") : "N/A";
      return `| ${format(date, "yyyy-MM-dd")} | ${dayName} | ${startTime} | ${b.tractorId || "N/A"} | ${driverNameDisplay} |`;
    });

  // Calculate stats
  const dayCounts: Record<string, number> = {};
  const timeCounts: Record<string, number> = {};

  for (const b of relevantBlocks) {
    if (!b.driverId) continue;
    const date = new Date(b.serviceDate);
    const dayName = DAY_NAMES[date.getDay()];
    dayCounts[dayName] = (dayCounts[dayName] || 0) + 1;
    if (b.startTimestamp) {
      const timeStr = format(new Date(b.startTimestamp), "HH:mm");
      timeCounts[timeStr] = (timeCounts[timeStr] || 0) + 1;
    }
  }

  const topDays = Object.entries(dayCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([day, count]) => `${day} (${count}x)`)
    .join(", ");

  const topTimes = Object.entries(timeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([time, count]) => `${time} (${count}x)`)
    .join(", ");

  // For driver-specific queries, show ALL rows (they typically have 20-50 shifts)
  // For general queries, limit to 50 rows to avoid overwhelming context
  const isDriverSpecific = driverIds.length > 0;
  const maxRows = isDriverSpecific ? rows.length : 50;
  const displayRows = rows.slice(0, maxRows);

  return `## Schedule History (Last ${weeksBack} weeks)${isDriverSpecific ? ` for ${driverName}` : ""}

| Date | Day | Start Time | Tractor | Driver |
|------|-----|------------|---------|--------|
${displayRows.join("\n")}
${rows.length > maxRows ? `\n... and ${rows.length - maxRows} more rows` : ""}

### Summary
- Total shifts: ${relevantBlocks.filter(b => b.driverId).length}
- Most common days: ${topDays || "N/A"}
- Most common times: ${topTimes || "N/A"}`;
}

/**
 * Extract driver name from user query
 * Handles both single names ("Courtney") and full names ("Courtney Smith")
 */
function extractDriverName(query: string): string | undefined {
  // Common patterns for multi-word names (capture 1-3 words as name)
  const multiWordPatterns = [
    /show\s+me\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/,
    /what\s+about\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/,
    /(?:what|which)\s+days?\s+(?:can|does|did|will|could)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\s+work/i,
    /([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})'s?\s+(?:schedule|history|shifts|runs|blocks|availability|pattern)/i,
    /for\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/,
    /driver\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/i,
    /analyze\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/,
  ];

  // Try multi-word patterns first (case-sensitive for proper names)
  for (const pattern of multiWordPatterns) {
    const match = query.match(pattern);
    if (match && match[1]) {
      const name = match[1].trim();
      // Skip common words
      const skipWords = ["the", "a", "an", "all", "my", "our", "this", "that", "last", "next", "schedule", "history"];
      if (!skipWords.includes(name.toLowerCase())) {
        return name;
      }
    }
  }

  // Fallback: single word patterns (case-insensitive)
  const singleWordPatterns = [
    /show\s+me\s+(\w+)/i,
    /what\s+about\s+(\w+)/i,
    /(\w+)'s?\s+(schedule|history|shifts|runs|blocks)/i,
    /for\s+(\w+)/i,
    /driver\s+(\w+)/i,
  ];

  for (const pattern of singleWordPatterns) {
    const match = query.match(pattern);
    if (match && match[1]) {
      const name = match[1];
      // Skip common words that aren't names
      if (!["the", "a", "an", "all", "my", "our", "this", "that", "last", "next", "week", "days", "work"].includes(name.toLowerCase())) {
        return name;
      }
    }
  }

  return undefined;
}

/**
 * Extract weeks from query
 * Uses 12 weeks for pattern/availability questions, 4 weeks for general history
 */
function extractWeeks(query: string): number {
  const match = query.match(/(\d+)\s*weeks?/i);
  if (match) {
    const weeks = parseInt(match[1], 10);
    return Math.min(weeks, 12); // Cap at 12 weeks
  }

  // For pattern/availability questions, use 12 weeks by default
  const lowerQuery = query.toLowerCase();
  if (lowerQuery.includes("can") && lowerQuery.includes("work") ||
      lowerQuery.includes("availability") ||
      lowerQuery.includes("pattern") ||
      lowerQuery.includes("prefer") ||
      lowerQuery.includes("usually") ||
      lowerQuery.includes("typically") ||
      lowerQuery.includes("analyze")) {
    return 12;
  }

  return 4; // Default to 4 weeks for simple history queries
}

/**
 * Parse date range from query like "Dec 7-13" or "December 7-13"
 * Returns { start: Date, end: Date } or null
 */
function extractDateRange(query: string): { start: Date; end: Date } | null {
  const lowerQuery = query.toLowerCase();

  // Pattern: "Dec 7-13" or "December 7-13" or "dec 7 - 13"
  const monthRangeMatch = query.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s*(\d{1,2})\s*[-–to]+\s*(\d{1,2})\b/i);

  if (monthRangeMatch) {
    const monthName = monthRangeMatch[1].toLowerCase();
    const startDay = parseInt(monthRangeMatch[2]);
    const endDay = parseInt(monthRangeMatch[3]);

    // Map month name to number
    const monthMap: Record<string, number> = {
      jan: 0, january: 0,
      feb: 1, february: 1,
      mar: 2, march: 2,
      apr: 3, april: 3,
      may: 4,
      jun: 5, june: 5,
      jul: 6, july: 6,
      aug: 7, august: 7,
      sep: 8, september: 8,
      oct: 9, october: 9,
      nov: 10, november: 10,
      dec: 11, december: 11,
    };

    const month = monthMap[monthName];
    if (month !== undefined && startDay >= 1 && endDay >= 1 && endDay <= 31) {
      const currentYear = new Date().getFullYear();
      // If the date is in the future, assume current year; otherwise last year
      const testDate = new Date(currentYear, month, startDay);
      const year = testDate > new Date() ? currentYear - 1 : currentYear;

      const start = new Date(year, month, startDay);
      const end = new Date(year, month, endDay, 23, 59, 59);
      return { start, end };
    }
  }

  return null;
}

/**
 * Extract contract type filter from query
 */
function extractContractType(query: string): string | undefined {
  const lowerQuery = query.toLowerCase();
  if (lowerQuery.includes("solo1") || lowerQuery.includes("solo 1")) {
    return "solo1";
  }
  if (lowerQuery.includes("solo2") || lowerQuery.includes("solo 2")) {
    return "solo2";
  }
  return undefined;
}

/**
 * Check if the query is a strategy analysis request
 */
function isStrategyAnalysisQuery(query: string): boolean {
  const lowerQuery = query.toLowerCase();
  return lowerQuery.includes("[cover schedule analysis]") ||
         lowerQuery.includes("[minimize overtime analysis]") ||
         lowerQuery.includes("[premium match analysis]") ||
         lowerQuery.includes("[balanced analysis]") ||
         (lowerQuery.includes("analyze") && lowerQuery.includes("this week"));
}

/**
 * Convert time string "HH:MM" to minutes for comparison
 */
function timeToMinutesServer(time: string | null | undefined): number {
  if (!time || typeof time !== 'string') return 0;
  const parts = time.split(':');
  if (parts.length < 2) return 0;
  const [hours, minutes] = parts.map(Number);
  if (isNaN(hours) || isNaN(minutes)) return 0;
  return hours * 60 + minutes;
}

/**
 * Calculate match score between a block and a driver's DNA profile
 * Same logic as frontend calculateBlockMatch()
 */
function calculateBlockMatchServer(
  block: { serviceDate: Date; startTime: string; contractType: string },
  driver: {
    preferredDays: string[] | null;
    preferredTimes: string[] | null;
    contractType: string | null;
    name: string;
  }
): { score: number; name: string } | null {
  // Hard constraint: contract type must match
  const blockContract = block.contractType?.toLowerCase();
  const driverContract = driver.contractType?.toLowerCase();
  if (driverContract && blockContract && driverContract !== blockContract) {
    return null;
  }

  // Hard constraint: must have preferences (non-empty days AND time)
  const preferredDays = driver.preferredDays || [];
  const preferredTimes = driver.preferredTimes || [];
  const primaryTime = preferredTimes[0];

  if (preferredDays.length === 0 || !primaryTime) {
    return null;
  }

  // Hard constraint: day must match
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayOfWeek = dayNames[block.serviceDate.getDay()];
  const dayMatches = preferredDays.some(d => d.toLowerCase() === dayOfWeek);

  if (!dayMatches) {
    return null;
  }

  // Soft constraint: time proximity scoring
  const blockMinutes = timeToMinutesServer(block.startTime);
  const driverMinutes = timeToMinutesServer(primaryTime);
  const diff = Math.abs(blockMinutes - driverMinutes);
  const timeDiff = Math.min(diff, 1440 - diff); // Handle overnight wraparound

  let score = 0.7; // Base score for day match only
  if (timeDiff === 0) score = 1.0;       // Perfect time match
  else if (timeDiff <= 60) score = 0.9;  // Within 1 hour
  else if (timeDiff <= 120) score = 0.8; // Within 2 hours

  return { score, name: driver.name };
}

/**
 * Get current week's schedule with all blocks (assigned AND unassigned)
 * This provides the context MILO needs for strategy analysis
 */
async function getCurrentWeekSchedule(tenantId: string): Promise<string> {
  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn: 0 }); // Sunday
  const weekEnd = endOfWeek(now, { weekStartsOn: 0 }); // Saturday

  // Get all blocks for current week
  const currentWeekBlocks = await db
    .select({
      blockId: blocks.id,
      serviceDate: blocks.serviceDate,
      soloType: blocks.soloType,
      tractorId: blocks.tractorId,
      startTimestamp: blocks.startTimestamp,
      driverId: blockAssignments.driverId,
    })
    .from(blocks)
    .leftJoin(blockAssignments, and(
      eq(blocks.id, blockAssignments.blockId),
      eq(blockAssignments.isActive, true)
    ))
    .where(
      and(
        eq(blocks.tenantId, tenantId),
        gte(blocks.serviceDate, weekStart),
        lte(blocks.serviceDate, weekEnd)
      )
    );

  if (currentWeekBlocks.length === 0) {
    return `No blocks found for current week (${format(weekStart, "MMM d")} - ${format(weekEnd, "MMM d")}).`;
  }

  // Get driver names for display
  const driverMap = new Map<string, string>();
  const driverData = await db
    .select({ id: drivers.id, firstName: drivers.firstName, lastName: drivers.lastName })
    .from(drivers)
    .where(eq(drivers.tenantId, tenantId));

  for (const d of driverData) {
    driverMap.set(d.id, `${d.firstName} ${d.lastName}`);
  }

  // Fetch DNA profiles for matching
  const dnaProfiles = await db
    .select({
      driverId: driverDnaProfiles.driverId,
      preferredDays: driverDnaProfiles.preferredDays,
      preferredStartTimes: driverDnaProfiles.preferredStartTimes,
      preferredContractType: driverDnaProfiles.preferredContractType,
    })
    .from(driverDnaProfiles)
    .where(eq(driverDnaProfiles.tenantId, tenantId));

  // Build driver DNA map with names
  const driverDnaMap = new Map<string, {
    preferredDays: string[] | null;
    preferredTimes: string[] | null;
    contractType: string | null;
    name: string;
  }>();
  for (const dna of dnaProfiles) {
    const name = driverMap.get(dna.driverId) || "Unknown";
    driverDnaMap.set(dna.driverId, {
      preferredDays: dna.preferredDays,
      preferredTimes: dna.preferredStartTimes,
      contractType: dna.preferredContractType,
      name,
    });
  }

  // Separate assigned and unassigned blocks
  const assignedBlocks = currentWeekBlocks.filter(b => b.driverId);
  const unassignedBlocks = currentWeekBlocks.filter(b => !b.driverId);

  // Group unassigned by day and time
  const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  // Format unassigned blocks table with driver matches
  let unassignedTable = "";
  let perfectMatches = 0;
  let goodMatches = 0;
  let weakMatches = 0;
  let noMatches = 0;

  if (unassignedBlocks.length > 0) {
    const unassignedRows = unassignedBlocks
      .sort((a, b) => new Date(a.serviceDate).getTime() - new Date(b.serviceDate).getTime())
      .map(b => {
        const date = new Date(b.serviceDate);
        const dayName = DAY_NAMES[date.getDay()];
        const soloType = b.soloType || "unknown";
        const tractorId = b.tractorId || "N/A";

        // Get canonical time from tractor lookup
        const lookupKey = `${soloType.toLowerCase()}_${tractorId}`;
        const startTime = CANONICAL_START_TIMES[lookupKey] || "??:??";

        // Find top 3 matching drivers for this block
        const blockForMatch = {
          serviceDate: date,
          startTime,
          contractType: soloType,
        };

        const matches: Array<{ score: number; name: string }> = [];
        for (const [, driver] of driverDnaMap) {
          const match = calculateBlockMatchServer(blockForMatch, driver);
          if (match) {
            matches.push(match);
          }
        }

        // Sort by score descending and take top 3
        matches.sort((a, b) => b.score - a.score);
        const top3 = matches.slice(0, 3);

        // Track match quality for summary
        if (top3.length === 0) {
          noMatches++;
        } else if (top3[0].score >= 1.0) {
          perfectMatches++;
        } else if (top3[0].score >= 0.8) {
          goodMatches++;
        } else {
          weakMatches++;
        }

        // Format matches column
        const matchesStr = top3.length > 0
          ? top3.map(m => `${m.name.split(' ')[0]} (${Math.round(m.score * 100)}%)`).join(', ')
          : '*No matches*';

        return `| ${format(date, "MMM d")} | ${dayName} | ${startTime} | ${soloType} | ${matchesStr} |`;
      });

    unassignedTable = `### Unassigned Blocks (${unassignedBlocks.length}) - With Best Matches

| Date | Day | Time | Type | Best Matches |
|------|-----|------|------|--------------|
${unassignedRows.join("\n")}

### Match Quality Summary
- **Perfect (100%):** ${perfectMatches} blocks
- **Good (80-99%):** ${goodMatches} blocks
- **Weak (<80%):** ${weakMatches} blocks
- **No Matches:** ${noMatches} blocks`;
  } else {
    unassignedTable = "### Unassigned Blocks: **0** (Full coverage! 🎉)";
  }

  // Format assigned blocks table
  const assignedRows = assignedBlocks
    .sort((a, b) => new Date(a.serviceDate).getTime() - new Date(b.serviceDate).getTime())
    .slice(0, 50) // Limit to 50 for readability
    .map(b => {
      const date = new Date(b.serviceDate);
      const dayName = DAY_NAMES[date.getDay()];
      const driverNameDisplay = driverMap.get(b.driverId!) || "Unknown";
      const soloType = b.soloType || "unknown";
      const tractorId = b.tractorId || "N/A";

      // Get canonical time from tractor lookup
      const lookupKey = `${soloType.toLowerCase()}_${tractorId}`;
      const startTime = CANONICAL_START_TIMES[lookupKey] || "??:??";

      return `| ${format(date, "MMM d")} | ${dayName} | ${startTime} | ${soloType} | ${tractorId} | ${driverNameDisplay} |`;
    });

  const assignedTable = `### Assigned Blocks (${assignedBlocks.length})

| Date | Day | Time | Type | Tractor | Driver |
|------|-----|------|------|---------|--------|
${assignedRows.join("\n")}${assignedBlocks.length > 50 ? `\n... and ${assignedBlocks.length - 50} more` : ""}`;

  // Calculate coverage stats
  const totalBlocks = currentWeekBlocks.length;
  const coveragePercent = Math.round((assignedBlocks.length / totalBlocks) * 100);

  // Group unassigned by day for summary
  const unassignedByDay: Record<string, number> = {};
  for (const b of unassignedBlocks) {
    const date = new Date(b.serviceDate);
    const dayName = DAY_NAMES[date.getDay()];
    unassignedByDay[dayName] = (unassignedByDay[dayName] || 0) + 1;
  }

  const gapsByDay = Object.entries(unassignedByDay)
    .sort((a, b) => b[1] - a[1])
    .map(([day, count]) => `${day}: ${count}`)
    .join(", ");

  // Group by solo type
  const solo1Unassigned = unassignedBlocks.filter(b => b.soloType?.toLowerCase() === "solo1").length;
  const solo2Unassigned = unassignedBlocks.filter(b => b.soloType?.toLowerCase() === "solo2").length;

  return `## Current Week Schedule (${format(weekStart, "MMM d")} - ${format(weekEnd, "MMM d")})

### Summary
- **Total Blocks:** ${totalBlocks}
- **Assigned:** ${assignedBlocks.length}
- **Unassigned:** ${unassignedBlocks.length}
- **Coverage:** ${coveragePercent}%
- **Solo1 Gaps:** ${solo1Unassigned}
- **Solo2 Gaps:** ${solo2Unassigned}
${gapsByDay ? `- **Gaps by Day:** ${gapsByDay}` : ""}

${unassignedTable}

${assignedTable}`;
}

/**
 * Generate drivers grouped by time slot for structured display
 */
async function getDriversByTimeSlot(tenantId: string, contractType: string): Promise<string> {
  const driverPatterns = await computeDriverPatternsFromHistory(tenantId, 8);

  // Filter to specified contract type
  const filteredDrivers = Array.from(driverPatterns.values())
    .filter(d => d.contractType === contractType);

  if (filteredDrivers.length === 0) {
    return `No ${contractType} drivers found with assignments in the last 8 weeks.`;
  }

  // Group by time slot
  const SOLO1_TIMES = ["00:30", "01:30", "16:30", "17:30", "18:30", "20:30", "21:30"];
  const SOLO2_TIMES = ["08:30", "11:30", "15:30", "16:30", "18:30", "21:30", "23:30"];
  const times = contractType === "solo1" ? SOLO1_TIMES : SOLO2_TIMES;

  let result = `## ${contractType.toUpperCase()} Drivers by Time Slot\n\n`;

  for (const time of times) {
    const driversAtTime = filteredDrivers.filter(d => d.preferredTimes.includes(time));

    if (driversAtTime.length === 0) continue;

    result += `### ${time}\n`;
    result += "| Driver | Days Worked at This Time | Shift Count |\n";
    result += "|--------|--------------------------|-------------|\n";

    for (const driver of driversAtTime.sort((a, b) => (b.timeCounts[time] || 0) - (a.timeCounts[time] || 0))) {
      // Get days this driver worked at THIS specific time
      const shiftsAtTime = driver.timeCounts[time] || 0;
      const daysWorked = driver.preferredDays.join(", ");
      result += `| ${driver.name} | ${daysWorked} | ${shiftsAtTime} |\n`;
    }
    result += "\n";
  }

  return result;
}

// ===== ASSIGNMENT COMMAND HANDLING =====

interface AssignmentCommand {
  driverName: string;
  count: number;
  contractType: "solo1" | "solo2";
  preferredTime?: string;
}

/**
 * Parse assignment commands from user messages
 * Examples:
 * - "give Adan 3 solo2's at 23:30"
 * - "assign Abshir 3 solo2 blocks at 21:30"
 * - "schedule Maria for 4 solo1 shifts"
 */
function parseAssignmentCommand(message: string): AssignmentCommand | null {
  const lowerMessage = message.toLowerCase();

  // Check for assignment intent
  const hasAssignIntent = /\b(give|assign|schedule|book)\b/i.test(message);
  if (!hasAssignIntent) return null;

  // Extract driver name (capitalized word after give/assign/schedule)
  const nameMatch = message.match(/(?:give|assign|schedule|book)\s+([A-Z][a-z]+)/i);
  if (!nameMatch) return null;
  const driverName = nameMatch[1];

  // Extract count (number before solo1/solo2 or blocks/shifts)
  const countMatch = message.match(/(\d+)\s*(?:solo[12]|blocks?|shifts?)/i);
  const count = countMatch ? parseInt(countMatch[1]) : 1;

  // Extract contract type
  let contractType: "solo1" | "solo2" = "solo1";
  if (/solo\s*2/i.test(message)) {
    contractType = "solo2";
  } else if (/solo\s*1/i.test(message)) {
    contractType = "solo1";
  }

  // Extract preferred time (HH:MM format)
  const timeMatch = message.match(/(?:at\s+)?(\d{1,2}:\d{2})/);
  const preferredTime = timeMatch ? timeMatch[1].padStart(5, '0') : undefined;

  return {
    driverName,
    count,
    contractType,
    preferredTime,
  };
}

/**
 * Execute an assignment command - find matching blocks and assign driver
 */
async function executeAssignmentCommand(
  tenantId: string,
  command: AssignmentCommand
): Promise<string> {
  console.log(`[MiloChat] Executing assignment command:`, command);

  // 1. Find the driver by name
  const matchingDrivers = await db
    .select({ id: drivers.id, firstName: drivers.firstName, lastName: drivers.lastName })
    .from(drivers)
    .where(eq(drivers.tenantId, tenantId));

  const searchName = command.driverName.toLowerCase();
  const driver = matchingDrivers.find(d =>
    d.firstName?.toLowerCase() === searchName ||
    d.lastName?.toLowerCase() === searchName ||
    `${d.firstName} ${d.lastName}`.toLowerCase().includes(searchName)
  );

  if (!driver) {
    const availableDrivers = matchingDrivers.slice(0, 10).map(d => `${d.firstName} ${d.lastName}`).join(", ");
    return `❌ No driver found matching "${command.driverName}". Available drivers: ${availableDrivers}...`;
  }

  const driverFullName = `${driver.firstName} ${driver.lastName}`;

  // 2. Get current week's unassigned blocks
  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn: 0 });
  const weekEnd = addDays(weekStart, 7);

  // Find unassigned blocks for this week matching contract type
  const allBlocks = await db
    .select({
      id: blocks.id,
      serviceDate: blocks.serviceDate,
      soloType: blocks.soloType,
      tractorId: blocks.tractorId,
    })
    .from(blocks)
    .where(
      and(
        eq(blocks.tenantId, tenantId),
        gte(blocks.serviceDate, weekStart),
        lte(blocks.serviceDate, weekEnd)
      )
    );

  // Get existing assignments
  const existingAssignments = await db
    .select({ blockId: blockAssignments.blockId })
    .from(blockAssignments)
    .where(eq(blockAssignments.isActive, true));

  const assignedBlockIds = new Set(existingAssignments.map(a => a.blockId));

  // Get blocks driver is already assigned to this week
  const driverAssignments = await db
    .select({ blockId: blockAssignments.blockId })
    .from(blockAssignments)
    .where(
      and(
        eq(blockAssignments.driverId, driver.id),
        eq(blockAssignments.isActive, true)
      )
    );
  const driverBlockIds = new Set(driverAssignments.map(a => a.blockId));

  // Get dates driver already has blocks
  const driverDates = new Set<string>();
  for (const block of allBlocks) {
    if (driverBlockIds.has(block.id)) {
      driverDates.add(format(new Date(block.serviceDate), "yyyy-MM-dd"));
    }
  }

  // Filter to unassigned blocks matching contract type
  const unassignedBlocks = allBlocks.filter(b => {
    if (assignedBlockIds.has(b.id)) return false;
    if (b.soloType?.toLowerCase() !== command.contractType.toLowerCase()) return false;

    // Don't assign multiple blocks on same day
    const blockDate = format(new Date(b.serviceDate), "yyyy-MM-dd");
    if (driverDates.has(blockDate)) return false;

    return true;
  });

  if (unassignedBlocks.length === 0) {
    return `❌ No unassigned ${command.contractType} blocks available for this week.`;
  }

  // 3. Score and rank blocks by time preference
  const scoredBlocks = unassignedBlocks.map(block => {
    const soloType = (block.soloType || "solo1").toLowerCase();
    const tractorId = block.tractorId || "Tractor_1";
    const lookupKey = `${soloType}_${tractorId}`;
    const blockTime = CANONICAL_START_TIMES[lookupKey] || "00:00";

    let score = 0;

    // Time match scoring
    if (command.preferredTime) {
      const [prefH, prefM] = command.preferredTime.split(':').map(Number);
      const [blockH, blockM] = blockTime.split(':').map(Number);
      const prefMinutes = prefH * 60 + prefM;
      const blockMinutes = blockH * 60 + blockM;
      const diff = Math.abs(prefMinutes - blockMinutes);
      const wrappedDiff = Math.min(diff, 1440 - diff);

      if (wrappedDiff === 0) score = 100;
      else if (wrappedDiff <= 60) score = 80;
      else if (wrappedDiff <= 120) score = 60;
      else score = 40;
    } else {
      score = 50; // No time preference, neutral score
    }

    return { block, blockTime, score };
  });

  // Sort by score descending, then by date
  scoredBlocks.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return new Date(a.block.serviceDate).getTime() - new Date(b.block.serviceDate).getTime();
  });

  // 4. Assign up to requested count, avoiding same-day conflicts
  const assignedDates = new Set<string>(driverDates);
  const assignments: Array<{ blockId: string; date: string; time: string }> = [];

  for (const { block, blockTime } of scoredBlocks) {
    if (assignments.length >= command.count) break;

    const blockDate = format(new Date(block.serviceDate), "yyyy-MM-dd");
    if (assignedDates.has(blockDate)) continue;

    // Create the assignment
    try {
      await db.insert(blockAssignments).values({
        tenantId,
        blockId: block.id,
        driverId: driver.id,
        isActive: true,
        assignedAt: new Date(),
      });

      assignments.push({
        blockId: block.id,
        date: format(new Date(block.serviceDate), "EEE MMM d"),
        time: blockTime,
      });
      assignedDates.add(blockDate);
    } catch (error: any) {
      console.error(`[MiloChat] Failed to assign block ${block.id}:`, error.message);
    }
  }

  // 5. Return result summary
  if (assignments.length === 0) {
    return `❌ Could not assign any ${command.contractType} blocks to ${driverFullName}. ` +
           `All available blocks may conflict with their existing schedule.`;
  }

  const assignmentList = assignments
    .map(a => `  • ${a.date} @ ${a.time}`)
    .join("\n");

  const timeNote = command.preferredTime
    ? ` (preferred time: ${command.preferredTime})`
    : "";

  return `✅ Assigned ${assignments.length} ${command.contractType} block${assignments.length > 1 ? 's' : ''} to **${driverFullName}**${timeNote}:\n\n${assignmentList}`;
}

/**
 * Check if message is an assignment command and execute it
 */
async function handleAssignmentCommand(
  tenantId: string,
  message: string
): Promise<string | null> {
  const command = parseAssignmentCommand(message);
  if (!command) return null;

  return executeAssignmentCommand(tenantId, command);
}

/**
 * Main chat function
 */
export async function chatWithMilo(
  tenantId: string,
  sessionId: string,
  userMessage: string
): Promise<{ response: string; sessionId: string }> {

  const apiKey = process.env.ANTHROPIC_API_KEY || "";
  if (!apiKey) {
    return {
      response: "MILO Chat is not configured. Please add ANTHROPIC_API_KEY to your environment.",
      sessionId
    };
  }

  const client = new Anthropic({ apiKey });

  // Get or create conversation history
  if (!conversationHistory.has(sessionId)) {
    conversationHistory.set(sessionId, []);
  }
  const history = conversationHistory.get(sessionId)!;

  // Check for assignment commands first (these are executed directly, not sent to Claude)
  const assignmentResult = await handleAssignmentCommand(tenantId, userMessage);
  if (assignmentResult) {
    // Add to history for context
    history.push({ role: "user", content: userMessage });
    history.push({ role: "assistant", content: assignmentResult });
    return {
      response: assignmentResult,
      sessionId
    };
  }

  // Extract context from user query
  const driverName = extractDriverName(userMessage);
  const weeks = extractWeeks(userMessage);
  const contractType = extractContractType(userMessage);
  const isStrategyQuery = isStrategyAnalysisQuery(userMessage);
  const dateRange = extractDateRange(userMessage);

  // Fetch relevant data based on query
  let contextData = "";

  // If specific date range requested with a driver name, use date range lookup
  if (dateRange && driverName) {
    contextData += await getDriverScheduleForDateRange(tenantId, driverName, dateRange);
    contextData += "\n\n";
    // Also include general driver pattern info for context
    contextData += await getDriverContext(tenantId, driverName, undefined, 8);
  }
  // Strategy analysis queries need CURRENT WEEK schedule with unassigned blocks
  else if (isStrategyQuery) {
    // Get current week schedule (assigned + unassigned blocks)
    contextData += await getCurrentWeekSchedule(tenantId);
    contextData += "\n\n";
    // Also include driver patterns for recommendations
    contextData += await getDriverContext(tenantId, undefined, undefined, 8);
  }
  // Check if this is a contract-type specific query
  else if (contractType && !driverName) {
    // Solo1 or Solo2 specific query - provide time-slot grouping
    contextData += await getDriversByTimeSlot(tenantId, contractType);
    contextData += "\n\n";
    contextData += await getDriverContext(tenantId, undefined, contractType, weeks);
  } else if (driverName) {
    // Always fetch driver context if a name is mentioned
    // Use the computed weeks (12 for pattern questions, 4 for simple history)
    contextData += await getDriverContext(tenantId, driverName, undefined, weeks);
    contextData += "\n\n";
    contextData += await getScheduleHistory(tenantId, driverName, weeks);
  } else if (userMessage.toLowerCase().includes("schedule") ||
             userMessage.toLowerCase().includes("history") ||
             userMessage.toLowerCase().includes("week")) {
    // General schedule query
    contextData += await getScheduleHistory(tenantId, undefined, weeks);
  } else {
    // Default: show all drivers
    contextData += await getDriverContext(tenantId);
  }

  // Build the message with context
  const contextualMessage = `## DATABASE CONTEXT
${contextData}

## USER QUESTION
${userMessage}`;

  // Add to history
  history.push({ role: "user", content: contextualMessage });

  // Keep history manageable (last 10 exchanges)
  while (history.length > 20) {
    history.shift();
  }

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      system: MILO_CHAT_SYSTEM_PROMPT,
      messages: history.map(m => ({
        role: m.role,
        content: m.content
      }))
    });

    const textBlock = response.content.find(block => block.type === "text");
    const assistantMessage = textBlock?.type === "text" ? textBlock.text : "I couldn't process that request.";

    // Add assistant response to history
    history.push({ role: "assistant", content: assistantMessage });

    return {
      response: assistantMessage,
      sessionId
    };

  } catch (error: any) {
    console.error("[MiloChat] API error:", error.message || error);
    return {
      response: `Error communicating with MILO: ${error.message || "Unknown error"}`,
      sessionId
    };
  }
}

/**
 * Clear conversation history for a session
 */
export function clearMiloChatHistory(sessionId: string): void {
  conversationHistory.delete(sessionId);
}

/**
 * Get available sessions (for debugging)
 */
export function getMiloChatSessions(): string[] {
  return Array.from(conversationHistory.keys());
}
