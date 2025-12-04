/**
 * Milo Agent - AI-powered assistant that can execute actions
 * Uses Gemini (free tier) to understand natural language commands and execute them
 */

import { GoogleGenerativeAI, GenerativeModel } from "@google/generative-ai";
import { db } from "../../db";
import { drivers, specialRequests, driverDnaProfiles, blocks, autoBuildRuns } from "@shared/schema";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { generateAutoBuildPreview, commitAutoBuildRun, saveAutoBuildRun } from "../../auto-build-engine";
import { startOfWeek, addWeeks, format } from "date-fns";

// All days of the week for recurring availability calculations
const ALL_DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

// Action types Milo can execute
type MiloAction =
  | { type: "create_time_off"; driverId: string; startDate: string; endDate?: string; reason?: string }
  | { type: "query_schedule"; driverId?: string; date?: string }
  | { type: "query_drivers"; filter?: string }
  | { type: "query_workload"; driverId?: string; weekStart?: string }
  | { type: "find_coverage"; date: string; blockType?: string }
  | { type: "set_recurring_availability"; driverId: string; workDays: string[]; preferredStartTimes?: string[]; reason?: string }
  | { type: "update_driver_dna"; driverId: string; preferredDays?: string[]; preferredStartTimes?: string[]; preferredTractors?: string[] }
  | { type: "auto_build_preview"; weekStart?: string; weeksAhead?: number }
  | { type: "auto_build_commit"; runId?: string; confidenceThreshold?: number }
  | { type: "unknown"; message: string };

interface MiloResponse {
  message: string;
  action?: MiloAction;
  actionResult?: unknown;
  success: boolean;
}

interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

export class MiloAgent {
  private client: GoogleGenerativeAI;
  private model: GenerativeModel;
  private initialized = false;

  constructor() {
    // Try both possible env var names for Gemini API key
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || "";
    if (!apiKey) {
      console.warn("[MiloAgent] No Gemini API key found (GEMINI_API_KEY or GOOGLE_AI_API_KEY)");
    }
    this.client = new GoogleGenerativeAI(apiKey);
    // Use gemini-2.5-flash which is the latest stable model (Dec 2025)
    this.model = this.client.getGenerativeModel({ model: "gemini-2.5-flash" });
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
  }

  /**
   * Process a user message and execute any actions
   */
  async processMessage(
    tenantId: string,
    userMessage: string,
    history: ConversationMessage[] = []
  ): Promise<MiloResponse> {
    await this.initialize();

    // Get context about the tenant's data
    const context = await this.buildContext(tenantId);

    // Build the prompt for Gemini
    const systemPrompt = `You are Milo, an AI assistant for Freedom Transportation's scheduling system. You help dispatchers manage driver schedules, time off requests, and workload analysis.

AVAILABLE ACTIONS:
You can execute these actions by responding with a special JSON block:

1. CREATE_TIME_OFF - Add time off for a driver
   {"action": "create_time_off", "driverId": "driver-name-or-id", "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD", "reason": "optional reason"}

2. QUERY_SCHEDULE - Look up schedule information
   {"action": "query_schedule", "driverId": "optional-driver-name", "date": "YYYY-MM-DD"}

3. QUERY_DRIVERS - Get driver information
   {"action": "query_drivers", "filter": "optional filter like name or status"}

4. QUERY_WORKLOAD - Check driver workload
   {"action": "query_workload", "driverId": "driver-name", "weekStart": "YYYY-MM-DD"}

5. FIND_COVERAGE - Find available drivers for a date
   {"action": "find_coverage", "date": "YYYY-MM-DD", "blockType": "solo1 or solo2 or team"}

6. SET_RECURRING_AVAILABILITY - Set which days a driver works AND update their Driver DNA profile
   {"action": "set_recurring_availability", "driverId": "driver-name", "workDays": ["friday", "saturday"], "preferredStartTimes": ["1630", "1730"], "reason": "optional reason"}
   Use this when user says things like:
   - "John only works on Friday" -> workDays: ["friday"]
   - "Maria only works Monday through Wednesday" -> workDays: ["monday", "tuesday", "wednesday"]
   - "Isaac works Fri, Sat, Sun at 1630 and 1730" -> workDays: ["friday", "saturday", "sunday"], preferredStartTimes: ["1630", "1730"]
   Days must be lowercase: sunday, monday, tuesday, wednesday, thursday, friday, saturday
   Start times should be in 24-hour format like "1630", "1730", "0600"

7. UPDATE_DRIVER_DNA - Update a driver's DNA profile preferences directly
   {"action": "update_driver_dna", "driverId": "driver-name", "preferredDays": ["sunday", "monday"], "preferredStartTimes": ["1630", "1730"], "preferredTractors": ["T001"]}
   Use when user wants to update specific preferences without changing recurring availability

8. AUTO_BUILD_PREVIEW - Preview the auto-generated schedule for next week
   {"action": "auto_build_preview", "weeksAhead": 1}
   Use when user says "show me next week's schedule", "preview auto-build", or "what would the schedule look like"
   weeksAhead: 1 = next week, 2 = two weeks from now, etc.

9. AUTO_BUILD_COMMIT - Apply/commit the auto-built schedule
   {"action": "auto_build_commit", "confidenceThreshold": 0.7}
   Use when user says "apply the schedule", "commit auto-build", or "looks good, apply it"
   confidenceThreshold: Only assign blocks with this confidence or higher (default 0.7 = 70%)

CURRENT CONTEXT:
${context}

INSTRUCTIONS:
- When the user asks you to DO something (add time off, make a change, etc.), include an ACTION block in your response
- Format actions as: [ACTION]{"action": "action_type", ...params}[/ACTION]
- Be conversational and helpful
- If you need more information to complete an action, ask for it
- After executing an action, confirm what was done
- Today's date is ${new Date().toISOString().split('T')[0]}
- Use the driver's full name from the context when creating actions

CONVERSATION HISTORY:
${history.map(m => `${m.role}: ${m.content}`).join('\n')}

USER MESSAGE: ${userMessage}

Respond naturally and include an [ACTION] block if you need to execute something.`;

    try {
      // Retry logic with exponential backoff for rate limits
      let result;
      let lastError;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          result = await this.model.generateContent(systemPrompt);
          break; // Success, exit retry loop
        } catch (e: unknown) {
          lastError = e;
          const error = e as { status?: number; message?: string };
          if (error.status === 429 || error.message?.includes('429') || error.message?.includes('quota')) {
            // Rate limited, wait and retry
            const waitTime = Math.pow(2, attempt) * 2000; // 2s, 4s, 8s
            console.log(`[MiloAgent] Rate limited, waiting ${waitTime}ms before retry ${attempt + 1}/3`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
          } else {
            throw e; // Not a rate limit error, don't retry
          }
        }
      }

      if (!result) {
        throw lastError || new Error("Failed to get response after retries");
      }

      const responseText = result.response.text();

      // Parse for actions (using non-greedy match)
      const actionMatch = responseText.match(/\[ACTION\]([\s\S]*?)\[\/ACTION\]/);
      let action: MiloAction | undefined;
      let actionResult: unknown;
      let cleanMessage = responseText;

      if (actionMatch) {
        try {
          const actionData = JSON.parse(actionMatch[1].trim());
          action = this.parseAction(actionData);

          // Execute the action
          if (action && action.type !== "unknown") {
            actionResult = await this.executeAction(tenantId, action);
          }

          // Remove the action block from the message
          cleanMessage = responseText.replace(/\[ACTION\][\s\S]*?\[\/ACTION\]/, '').trim();

          // Add action result to message if successful
          const result = actionResult as { success?: boolean; message?: string } | undefined;
          if (result?.success) {
            cleanMessage += `\n\n${result.message}`;
          }
        } catch (e) {
          console.error("Failed to parse action:", e);
        }
      }

      return {
        message: cleanMessage,
        action,
        actionResult,
        success: true
      };
    } catch (error: unknown) {
      console.error("Milo agent error:", error);
      const err = error as { status?: number; message?: string };

      // Check if it's a rate limit error
      if (err.status === 429 || err.message?.includes('429') || err.message?.includes('quota')) {
        return {
          message: "I'm currently at my rate limit. Please wait a minute and try again, or use the Edit Days button on the DNA flip cards to update driver preferences directly.",
          success: false
        };
      }

      return {
        message: "I'm sorry, I encountered an error processing your request. Please try again.",
        success: false
      };
    }
  }

  /**
   * Build context about the tenant's data for the AI
   */
  private async buildContext(tenantId: string): Promise<string> {
    try {
      // Get drivers
      const driverList = await db
        .select({
          id: drivers.id,
          firstName: drivers.firstName,
          lastName: drivers.lastName,
          status: drivers.status,
        })
        .from(drivers)
        .where(eq(drivers.tenantId, tenantId))
        .limit(30);

      const driverLines = driverList.map(d =>
        `- ${d.firstName} ${d.lastName} (ID: ${d.id}, Status: ${d.status})`
      ).join('\n');

      // Get DNA profiles with driver names (join with drivers table)
      const dnaList = await db
        .select({
          driverId: driverDnaProfiles.driverId,
          patternGroup: driverDnaProfiles.patternGroup,
          preferredDays: driverDnaProfiles.preferredDays,
          firstName: drivers.firstName,
          lastName: drivers.lastName,
        })
        .from(driverDnaProfiles)
        .innerJoin(drivers, eq(driverDnaProfiles.driverId, drivers.id))
        .where(eq(driverDnaProfiles.tenantId, tenantId))
        .limit(15);

      const dnaLines = dnaList.map(p =>
        `- ${p.firstName} ${p.lastName}: ${p.patternGroup || 'mixed'} pattern, ${p.preferredDays?.join(', ') || 'flexible days'}`
      ).join('\n');

      return `
DRIVERS (${driverList.length} shown):
${driverLines || 'No drivers found'}

DRIVER DNA PROFILES:
${dnaLines || 'No DNA profiles analyzed yet'}
`;
    } catch (e) {
      console.error("Error building context:", e);
      return "Unable to load context data.";
    }
  }

  /**
   * Parse action data from AI response
   */
  private parseAction(data: Record<string, unknown>): MiloAction {
    switch (data.action) {
      case "create_time_off":
        return {
          type: "create_time_off",
          driverId: data.driverId as string,
          startDate: data.startDate as string,
          endDate: data.endDate as string | undefined,
          reason: data.reason as string | undefined
        };
      case "query_schedule":
        return {
          type: "query_schedule",
          driverId: data.driverId as string | undefined,
          date: data.date as string | undefined
        };
      case "query_drivers":
        return {
          type: "query_drivers",
          filter: data.filter as string | undefined
        };
      case "query_workload":
        return {
          type: "query_workload",
          driverId: data.driverId as string | undefined,
          weekStart: data.weekStart as string | undefined
        };
      case "find_coverage":
        return {
          type: "find_coverage",
          date: data.date as string,
          blockType: data.blockType as string | undefined
        };
      case "set_recurring_availability":
        return {
          type: "set_recurring_availability",
          driverId: data.driverId as string,
          workDays: (data.workDays as string[]) || [],
          preferredStartTimes: data.preferredStartTimes as string[] | undefined,
          reason: data.reason as string | undefined
        };
      case "update_driver_dna":
        return {
          type: "update_driver_dna",
          driverId: data.driverId as string,
          preferredDays: data.preferredDays as string[] | undefined,
          preferredStartTimes: data.preferredStartTimes as string[] | undefined,
          preferredTractors: data.preferredTractors as string[] | undefined
        };
      case "auto_build_preview":
        return {
          type: "auto_build_preview",
          weekStart: data.weekStart as string | undefined,
          weeksAhead: data.weeksAhead as number | undefined
        };
      case "auto_build_commit":
        return {
          type: "auto_build_commit",
          runId: data.runId as string | undefined,
          confidenceThreshold: data.confidenceThreshold as number | undefined
        };
      default:
        return { type: "unknown", message: "Unknown action type" };
    }
  }

  /**
   * Execute an action
   */
  private async executeAction(tenantId: string, action: MiloAction): Promise<unknown> {
    switch (action.type) {
      case "create_time_off":
        return this.createTimeOff(tenantId, action);
      case "query_schedule":
        return this.querySchedule(tenantId, action);
      case "query_drivers":
        return this.queryDrivers(tenantId, action);
      case "query_workload":
        return this.queryWorkload(tenantId, action);
      case "find_coverage":
        return this.findCoverage(tenantId, action);
      case "set_recurring_availability":
        return this.setRecurringAvailability(tenantId, action);
      case "update_driver_dna":
        return this.updateDriverDNA(tenantId, action);
      case "auto_build_preview":
        return this.autoBuildPreview(tenantId, action);
      case "auto_build_commit":
        return this.autoBuildCommit(tenantId, action);
      default:
        return { success: false, message: "Unknown action" };
    }
  }

  /**
   * Find a driver by name or ID
   */
  private async findDriver(tenantId: string, nameOrId: string) {
    // First try exact ID match
    const byId = await db
      .select()
      .from(drivers)
      .where(and(eq(drivers.tenantId, tenantId), eq(drivers.id, nameOrId)))
      .limit(1);

    if (byId.length > 0) return byId[0];

    // Try name match
    const searchLower = nameOrId.toLowerCase();
    const allDrivers = await db
      .select()
      .from(drivers)
      .where(eq(drivers.tenantId, tenantId));

    return allDrivers.find(d => {
      const fullName = `${d.firstName} ${d.lastName}`.toLowerCase();
      return fullName.includes(searchLower) ||
             d.firstName.toLowerCase().includes(searchLower) ||
             d.lastName.toLowerCase().includes(searchLower);
    });
  }

  /**
   * Create a time off request for a driver
   */
  private async createTimeOff(
    tenantId: string,
    action: { driverId: string; startDate: string; endDate?: string; reason?: string }
  ): Promise<unknown> {
    try {
      const driver = await this.findDriver(tenantId, action.driverId);

      if (!driver) {
        return {
          success: false,
          message: `Could not find driver: ${action.driverId}. Please provide the correct driver name.`
        };
      }

      // Create the special request (time off)
      const [request] = await db.insert(specialRequests).values({
        tenantId,
        driverId: driver.id,
        availabilityType: "unavailable",
        startDate: new Date(action.startDate),
        endDate: action.endDate ? new Date(action.endDate) : null,
        reason: action.reason || "Time off request via Milo",
        status: "approved", // Auto-approve via Milo
        isRecurring: false,
      }).returning();

      const driverName = `${driver.firstName} ${driver.lastName}`;
      const dateRange = action.endDate
        ? `${action.startDate} to ${action.endDate}`
        : action.startDate;

      return {
        success: true,
        message: `✓ Time off created for ${driverName} on ${dateRange}.`,
        data: request
      };
    } catch (error: unknown) {
      console.error("Create time off error:", error);
      return { success: false, message: `Failed to create time off: ${(error as Error).message}` };
    }
  }

  /**
   * Query schedule information
   */
  private async querySchedule(
    tenantId: string,
    action: { driverId?: string; date?: string }
  ): Promise<unknown> {
    try {
      const date = action.date ? new Date(action.date) : new Date();
      const weekStart = new Date(date);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);

      // Query blocks for the week
      const weekBlocks = await db
        .select()
        .from(blocks)
        .where(
          and(
            eq(blocks.tenantId, tenantId),
            gte(blocks.serviceDate, weekStart),
            lte(blocks.serviceDate, weekEnd)
          )
        );

      return {
        success: true,
        message: `Found ${weekBlocks.length} blocks for the week of ${weekStart.toISOString().split('T')[0]}.`,
        data: weekBlocks.slice(0, 20)
      };
    } catch (error: unknown) {
      return { success: false, message: `Failed to query schedule: ${(error as Error).message}` };
    }
  }

  /**
   * Query driver information
   */
  private async queryDrivers(
    tenantId: string,
    action: { filter?: string }
  ): Promise<unknown> {
    try {
      const allDrivers = await db
        .select({
          id: drivers.id,
          firstName: drivers.firstName,
          lastName: drivers.lastName,
          status: drivers.status,
        })
        .from(drivers)
        .where(eq(drivers.tenantId, tenantId));

      let filtered = allDrivers;
      if (action.filter) {
        const f = action.filter.toLowerCase();
        filtered = allDrivers.filter(d =>
          d.firstName.toLowerCase().includes(f) ||
          d.lastName.toLowerCase().includes(f) ||
          d.status?.toLowerCase().includes(f)
        );
      }

      return {
        success: true,
        message: `Found ${filtered.length} drivers${action.filter ? ` matching "${action.filter}"` : ''}.`,
        data: filtered.slice(0, 20).map(d => ({
          id: d.id,
          name: `${d.firstName} ${d.lastName}`,
          status: d.status
        }))
      };
    } catch (error: unknown) {
      return { success: false, message: `Failed to query drivers: ${(error as Error).message}` };
    }
  }

  /**
   * Query driver workload
   */
  private async queryWorkload(
    tenantId: string,
    action: { driverId?: string; weekStart?: string }
  ): Promise<unknown> {
    try {
      const weekStart = action.weekStart ? new Date(action.weekStart) : new Date();
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);

      // Get blocks for the week with assignments
      const weekBlocks = await db
        .select({
          blockId: blocks.blockId,
          serviceDate: blocks.serviceDate,
        })
        .from(blocks)
        .where(
          and(
            eq(blocks.tenantId, tenantId),
            gte(blocks.serviceDate, weekStart),
            lte(blocks.serviceDate, weekEnd)
          )
        );

      return {
        success: true,
        message: `Found ${weekBlocks.length} blocks for the week of ${weekStart.toISOString().split('T')[0]}.`,
        data: { totalBlocks: weekBlocks.length }
      };
    } catch (error: unknown) {
      return { success: false, message: `Failed to query workload: ${(error as Error).message}` };
    }
  }

  /**
   * Find available drivers for coverage
   */
  private async findCoverage(
    tenantId: string,
    action: { date: string; blockType?: string }
  ): Promise<unknown> {
    try {
      // Get all active drivers
      const activeDrivers = await db
        .select({
          id: drivers.id,
          firstName: drivers.firstName,
          lastName: drivers.lastName,
          status: drivers.status,
        })
        .from(drivers)
        .where(
          and(
            eq(drivers.tenantId, tenantId),
            eq(drivers.status, "active")
          )
        );

      // Get DNA profiles for context
      const dnaList = await db
        .select()
        .from(driverDnaProfiles)
        .where(eq(driverDnaProfiles.tenantId, tenantId));

      const dnaMap = new Map(dnaList.map(d => [d.driverId, d]));

      const withDna = activeDrivers.slice(0, 10).map(d => {
        const dna = dnaMap.get(d.id);
        return {
          id: d.id,
          name: `${d.firstName} ${d.lastName}`,
          pattern: dna?.patternGroup || 'unknown',
          consistency: dna?.consistencyScore || null
        };
      });

      return {
        success: true,
        message: `Found ${activeDrivers.length} active drivers for potential coverage on ${action.date}${action.blockType ? ` (${action.blockType})` : ''}.`,
        data: withDna
      };
    } catch (error: unknown) {
      return { success: false, message: `Failed to find coverage: ${(error as Error).message}` };
    }
  }

  /**
   * Set recurring work days for a driver (creates unavailability for non-work days AND updates DNA profile)
   */
  private async setRecurringAvailability(
    tenantId: string,
    action: { driverId: string; workDays: string[]; preferredStartTimes?: string[]; reason?: string }
  ): Promise<unknown> {
    try {
      const driver = await this.findDriver(tenantId, action.driverId);

      if (!driver) {
        return {
          success: false,
          message: `Could not find driver: ${action.driverId}. Please provide the correct driver name.`
        };
      }

      // Normalize work days to lowercase
      const workDays = action.workDays.map(d => d.toLowerCase());

      // Validate days
      const invalidDays = workDays.filter(d => !ALL_DAYS.includes(d));
      if (invalidDays.length > 0) {
        return {
          success: false,
          message: `Invalid days: ${invalidDays.join(', ')}. Use: sunday, monday, tuesday, wednesday, thursday, friday, saturday`
        };
      }

      // Calculate unavailable days (all days minus work days)
      const unavailableDays = ALL_DAYS.filter(d => !workDays.includes(d));

      if (unavailableDays.length === 0) {
        return {
          success: false,
          message: `${driver.firstName} would be available every day. No changes needed.`
        };
      }

      // Delete any existing recurring availability requests for this driver
      await db.delete(specialRequests).where(
        and(
          eq(specialRequests.tenantId, tenantId),
          eq(specialRequests.driverId, driver.id),
          eq(specialRequests.isRecurring, true)
        )
      );

      // Create the recurring special request for unavailable days
      const [request] = await db.insert(specialRequests).values({
        tenantId,
        driverId: driver.id,
        availabilityType: "unavailable",
        startDate: new Date(), // Starts today
        endDate: null, // Indefinite
        reason: action.reason || `Only works ${workDays.join(', ')} - set via Milo`,
        status: "approved", // Auto-approve via Milo
        isRecurring: true,
        recurringPattern: "custom",
        recurringDays: unavailableDays,
      }).returning();

      // Also update Driver DNA profile with preferred days and times
      const existingDna = await db
        .select()
        .from(driverDnaProfiles)
        .where(
          and(
            eq(driverDnaProfiles.tenantId, tenantId),
            eq(driverDnaProfiles.driverId, driver.id)
          )
        )
        .limit(1);

      const dnaUpdate: Record<string, unknown> = {
        preferredDays: workDays,
        updatedAt: new Date(),
      };

      // Add preferred start times if provided
      if (action.preferredStartTimes && action.preferredStartTimes.length > 0) {
        // Convert to HH:MM format if needed
        dnaUpdate.preferredStartTimes = action.preferredStartTimes.map(t => {
          if (t.length === 4 && !t.includes(':')) {
            return `${t.slice(0, 2)}:${t.slice(2)}`;
          }
          return t;
        });
      }

      if (existingDna.length > 0) {
        // Update existing DNA profile
        await db.update(driverDnaProfiles)
          .set(dnaUpdate)
          .where(eq(driverDnaProfiles.id, existingDna[0].id));
      } else {
        // Create new DNA profile
        await db.insert(driverDnaProfiles).values({
          tenantId,
          driverId: driver.id,
          preferredDays: workDays,
          preferredStartTimes: dnaUpdate.preferredStartTimes as string[] | undefined,
          consistencyScore: "0.5", // Default medium consistency
        });
      }

      const driverName = `${driver.firstName} ${driver.lastName}`;
      const workDaysFormatted = workDays.map(d => d.charAt(0).toUpperCase() + d.slice(1)).join(', ');
      const unavailableDaysFormatted = unavailableDays.map(d => d.charAt(0).toUpperCase() + d.slice(1)).join(', ');

      let message = `✓ ${driverName} now only works on ${workDaysFormatted}. Unavailable on ${unavailableDaysFormatted}. DNA profile updated.`;
      if (action.preferredStartTimes && action.preferredStartTimes.length > 0) {
        message += ` Preferred start times: ${action.preferredStartTimes.join(', ')}.`;
      }

      return {
        success: true,
        message,
        data: request
      };
    } catch (error: unknown) {
      console.error("Set recurring availability error:", error);
      return { success: false, message: `Failed to set recurring availability: ${(error as Error).message}` };
    }
  }

  /**
   * Update a driver's DNA profile directly
   */
  private async updateDriverDNA(
    tenantId: string,
    action: { driverId: string; preferredDays?: string[]; preferredStartTimes?: string[]; preferredTractors?: string[] }
  ): Promise<unknown> {
    try {
      const driver = await this.findDriver(tenantId, action.driverId);

      if (!driver) {
        return {
          success: false,
          message: `Could not find driver: ${action.driverId}. Please provide the correct driver name.`
        };
      }

      // Build update object
      const dnaUpdate: Record<string, unknown> = {
        updatedAt: new Date(),
      };

      if (action.preferredDays) {
        dnaUpdate.preferredDays = action.preferredDays.map(d => d.toLowerCase());
      }

      if (action.preferredStartTimes) {
        // Convert to HH:MM format if needed
        dnaUpdate.preferredStartTimes = action.preferredStartTimes.map(t => {
          if (t.length === 4 && !t.includes(':')) {
            return `${t.slice(0, 2)}:${t.slice(2)}`;
          }
          return t;
        });
      }

      if (action.preferredTractors) {
        dnaUpdate.preferredTractors = action.preferredTractors;
      }

      // Check if DNA profile exists
      const existingDna = await db
        .select()
        .from(driverDnaProfiles)
        .where(
          and(
            eq(driverDnaProfiles.tenantId, tenantId),
            eq(driverDnaProfiles.driverId, driver.id)
          )
        )
        .limit(1);

      if (existingDna.length > 0) {
        // Update existing
        await db.update(driverDnaProfiles)
          .set(dnaUpdate)
          .where(eq(driverDnaProfiles.id, existingDna[0].id));
      } else {
        // Create new
        await db.insert(driverDnaProfiles).values({
          tenantId,
          driverId: driver.id,
          preferredDays: dnaUpdate.preferredDays as string[] | undefined,
          preferredStartTimes: dnaUpdate.preferredStartTimes as string[] | undefined,
          preferredTractors: dnaUpdate.preferredTractors as string[] | undefined,
          consistencyScore: "0.5",
        });
      }

      const driverName = `${driver.firstName} ${driver.lastName}`;
      const updates: string[] = [];
      if (action.preferredDays) updates.push(`days: ${action.preferredDays.join(', ')}`);
      if (action.preferredStartTimes) updates.push(`times: ${action.preferredStartTimes.join(', ')}`);
      if (action.preferredTractors) updates.push(`tractors: ${action.preferredTractors.join(', ')}`);

      return {
        success: true,
        message: `✓ Updated ${driverName}'s DNA profile: ${updates.join('; ')}.`
      };
    } catch (error: unknown) {
      console.error("Update driver DNA error:", error);
      return { success: false, message: `Failed to update DNA profile: ${(error as Error).message}` };
    }
  }

  /**
   * Preview auto-built schedule for next week
   */
  private async autoBuildPreview(
    tenantId: string,
    action: { weekStart?: string; weeksAhead?: number }
  ): Promise<unknown> {
    try {
      // Calculate target week
      const today = new Date();
      const weeksAhead = action.weeksAhead || 1;
      let targetDate: Date;

      if (action.weekStart) {
        targetDate = new Date(action.weekStart);
      } else {
        // Default to next week (or specified weeks ahead)
        targetDate = startOfWeek(addWeeks(today, weeksAhead), { weekStartsOn: 0 });
      }

      // Generate preview using the auto-build engine
      const preview = await generateAutoBuildPreview(tenantId, targetDate);

      // Format for display
      const weekStartStr = format(preview.targetWeekStart, 'MMM d');
      const weekEndStr = format(preview.targetWeekEnd, 'MMM d, yyyy');

      const avgConfidence = preview.suggestions.length > 0
        ? Math.round(preview.suggestions.reduce((sum, s) => sum + s.confidence, 0) / preview.suggestions.length * 100)
        : 0;

      // Get top 5 high-confidence assignments for summary
      const topAssignments = preview.suggestions
        .filter(s => s.confidence >= 0.7)
        .slice(0, 5)
        .map(s => `${s.blockDisplayId} → ${s.driverName} (${Math.round(s.confidence * 100)}%)`);

      // Save the run for potential commit later
      const savedRun = await saveAutoBuildRun(tenantId, preview);

      return {
        success: true,
        message: `📊 Auto-Build Preview for ${weekStartStr} - ${weekEndStr}:
• ${preview.totalBlocks} total blocks
• ${preview.highConfidence} high confidence (>80%)
• ${preview.mediumConfidence} medium confidence (60-80%)
• ${preview.lowConfidence} low confidence (<60%)
• ${preview.unassignable.length} unassignable
• Average confidence: ${avgConfidence}%

Top assignments:
${topAssignments.length > 0 ? topAssignments.join('\n') : 'None above 70% confidence'}

${preview.warnings.length > 0 ? `⚠️ Warnings: ${preview.warnings.slice(0, 3).join('; ')}` : ''}

Say "apply the schedule" or "commit auto-build" to apply these assignments.`,
        data: {
          runId: savedRun.id,
          preview: {
            totalBlocks: preview.totalBlocks,
            highConfidence: preview.highConfidence,
            mediumConfidence: preview.mediumConfidence,
            lowConfidence: preview.lowConfidence,
            unassignable: preview.unassignable.length,
            avgConfidence
          }
        }
      };
    } catch (error: unknown) {
      console.error("Auto-build preview error:", error);
      return { success: false, message: `Failed to generate preview: ${(error as Error).message}` };
    }
  }

  // Store the last preview run ID for commit
  private lastPreviewRunId: string | null = null;

  /**
   * Commit/apply the auto-built schedule
   */
  private async autoBuildCommit(
    tenantId: string,
    action: { runId?: string; confidenceThreshold?: number }
  ): Promise<unknown> {
    try {
      // Get the run to commit (use provided runId or last preview)
      const runId = action.runId || this.lastPreviewRunId;
      const threshold = action.confidenceThreshold || 0.7;

      if (!runId) {
        return {
          success: false,
          message: "No auto-build preview found. Please run 'auto build preview' first."
        };
      }

      // Fetch the run
      const [run] = await db
        .select()
        .from(autoBuildRuns)
        .where(eq(autoBuildRuns.id, runId));

      if (!run) {
        return {
          success: false,
          message: "Auto-build run not found. Please generate a new preview."
        };
      }

      // Parse suggestions and filter by confidence threshold
      const suggestions = JSON.parse(run.suggestions as string) as Array<{
        blockId: string;
        blockDisplayId: string;
        driverId: string;
        driverName: string;
        confidence: number;
      }>;

      const approvedBlockIds = suggestions
        .filter(s => s.confidence >= threshold && s.driverId)
        .map(s => s.blockId);

      if (approvedBlockIds.length === 0) {
        return {
          success: false,
          message: `No blocks meet the ${Math.round(threshold * 100)}% confidence threshold. Try lowering the threshold.`
        };
      }

      // Commit the approved blocks
      const result = await commitAutoBuildRun(runId, approvedBlockIds);

      return {
        success: true,
        message: `✓ Auto-build committed successfully!
• ${result.created} blocks assigned
• ${result.failed} failed
${result.errors.length > 0 ? `\n⚠️ Errors: ${result.errors.slice(0, 3).join('; ')}` : ''}

Schedule for the week has been updated.`
      };
    } catch (error: unknown) {
      console.error("Auto-build commit error:", error);
      return { success: false, message: `Failed to commit auto-build: ${(error as Error).message}` };
    }
  }
}

// Singleton instance
let miloInstance: MiloAgent | null = null;

export async function getMiloAgent(): Promise<MiloAgent> {
  if (!miloInstance) {
    miloInstance = new MiloAgent();
    await miloInstance.initialize();
  }
  return miloInstance;
}
