import { dbStorage } from "./db-storage";
import { parseNaturalDate, parseDateRange, formatDateForAPI } from "./date-parser";
import type { Driver, Schedule, Block, BlockAssignment, Contract } from "@shared/schema";
import { startOfDay, endOfDay, addDays, format } from "date-fns";

/**
 * Helper function to assert non-null values
 */
function requireNonNull<T>(value: T | null | undefined, fieldName: string): T {
  if (value === null || value === undefined) {
    throw new Error(`Expected ${fieldName} to be non-null`);
  }
  return value;
}

/**
 * OpenAI Function Calling Tool Definitions
 * Using JSON Schema format for OpenAI API
 */

export const AI_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "getDriversByType",
      description: "Get all drivers filtered by their contract type (solo1, solo2, or team). Returns driver details with their current workload and upcoming assignments.",
      parameters: {
        type: "object",
        properties: {
          driverType: {
            type: "string",
            enum: ["solo1", "solo2", "team"],
            description: "The type of drivers to retrieve: solo1, solo2, or team"
          },
          includeUpcoming: {
            type: "boolean",
            description: "Whether to include upcoming assignments for each driver (default: true)"
          }
        },
        required: ["driverType"]
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "getDriverByNameOrId",
      description: "Find a specific driver by their name (first name, last name, or full name) or driver ID. Useful for disambiguation when multiple drivers match.",
      parameters: {
        type: "object",
        properties: {
          search: {
            type: "string",
            description: "Driver name (first, last, or full name) or driver ID to search for"
          }
        },
        required: ["search"]
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "getDriverSchedule",
      description: "Get a specific driver's schedule for a date range. Returns all block assignments with block details.",
      parameters: {
        type: "object",
        properties: {
          driverId: {
            type: "string",
            description: "The unique identifier of the driver"
          },
          startDate: {
            type: "string",
            description: "Start date in ISO 8601 format (e.g., '2025-11-10T00:00:00.000Z') or natural language (e.g., 'last Sunday', 'today')"
          },
          endDate: {
            type: "string",
            description: "End date in ISO 8601 format (e.g., '2025-11-17T23:59:59.999Z') or natural language (e.g., 'next Friday', 'tomorrow')"
          }
        },
        required: ["driverId", "startDate", "endDate"]
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "getAssignmentsByDate",
      description: "Get all driver assignments for a specific date or date range. Useful for answering 'who is working on Monday' or 'show me this week's schedule'.",
      parameters: {
        type: "object",
        properties: {
          date: {
            type: "string",
            description: "Date in ISO 8601 format or natural language (e.g., 'Monday', 'last Sunday', 'today', 'this week'). For ranges, returns all assignments in that period."
          }
        },
        required: ["date"]
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "getBlocksByDateRange",
      description: "Get all blocks (assigned or unassigned) within a date range. Useful for finding unassigned blocks or available capacity.",
      parameters: {
        type: "object",
        properties: {
          startDate: {
            type: "string",
            description: "Start date in ISO 8601 format or natural language"
          },
          endDate: {
            type: "string",
            description: "End date in ISO 8601 format or natural language"
          },
          includeAssignments: {
            type: "boolean",
            description: "Whether to include assignment information for each block (default: true)"
          }
        },
        required: ["startDate", "endDate"]
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "getUpcomingAssignments",
      description: "Get all assignments starting within the next N days. Useful for questions like 'what's coming up' or 'show me next week'.",
      parameters: {
        type: "object",
        properties: {
          daysAhead: {
            type: "number",
            description: "Number of days to look ahead (1-30)",
            minimum: 1,
            maximum: 30
          }
        },
        required: ["daysAhead"]
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "getDriverWorkloadSummary",
      description: "Get a comprehensive workload summary for all drivers, showing how many days each driver is working in a date range. Useful for load balancing and capacity planning.",
      parameters: {
        type: "object",
        properties: {
          startDate: {
            type: "string",
            description: "Start date for workload analysis (ISO 8601 or natural language)"
          },
          endDate: {
            type: "string",
            description: "End date for workload analysis (ISO 8601 or natural language)"
          }
        },
        required: ["startDate", "endDate"]
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "recallPastConversation",
      description: "Search through past conversations with this user to recall what was discussed before. Use this when the user references something from a previous chat, asks 'what did we discuss about X', 'who worked last weekend', or when context from past conversations would be helpful. This searches the last 6 weeks of chat history.",
      parameters: {
        type: "object",
        properties: {
          searchQuery: {
            type: "string",
            description: "Keywords or phrases to search for in past conversations (e.g., 'last weekend', 'Solo1 workload', 'John Smith schedule', 'replacement driver')"
          },
          limit: {
            type: "number",
            description: "Maximum number of results to return (default: 5, max: 10)"
          }
        },
        required: ["searchQuery"]
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "getWeather",
      description: "Get current weather and forecast for a location. CRITICAL FOR DRIVER SAFETY - use this when users ask about weather conditions, road safety, or planning routes. Weather affects driving conditions, visibility, and safety decisions.",
      parameters: {
        type: "object",
        properties: {
          location: {
            type: "string",
            description: "City name, state, or zip code (e.g., 'Kansas City, MO', 'Los Angeles', '90210')"
          },
          includeForecast: {
            type: "boolean",
            description: "Whether to include multi-day forecast (default: true)"
          }
        },
        required: ["location"]
      }
    }
  }
];

/**
 * Type-safe function call handlers
 */

interface FunctionContext {
  tenantId: string;
  userId: string;
}

/**
 * Helper to parse dates with fallback - throws error on invalid input
 */
function parseDateWithFallback(dateStr: string): Date {
  // Try natural language first
  const natural = parseNaturalDate(dateStr);
  if (natural) return natural;
  
  // Try ISO parse
  try {
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) return parsed;
  } catch (e) {
    // Fall through
  }
  
  // Throw error instead of silently defaulting
  throw new Error(`Could not parse date: "${dateStr}". Use formats like "Monday", "last Sunday", "2025-11-10", or "this week".`);
}

/**
 * Centralized function execution with tenant scoping
 */
export async function executeTool(
  functionName: string,
  args: any,
  context: FunctionContext
): Promise<string> {
  try {
    switch (functionName) {
      case "getDriversByType":
        return await handleGetDriversByType(args, context);
      
      case "getDriverByNameOrId":
        return await handleGetDriverByNameOrId(args, context);
      
      case "getDriverSchedule":
        return await handleGetDriverSchedule(args, context);
      
      case "getAssignmentsByDate":
        return await handleGetAssignmentsByDate(args, context);
      
      case "getBlocksByDateRange":
        return await handleGetBlocksByDateRange(args, context);
      
      case "getUpcomingAssignments":
        return await handleGetUpcomingAssignments(args, context);
      
      case "getDriverWorkloadSummary":
        return await handleGetDriverWorkloadSummary(args, context);

      case "recallPastConversation":
        return await handleRecallPastConversation(args, context);

      case "getWeather":
        return await handleGetWeather(args, context);

      default:
        return JSON.stringify({ error: `Unknown function: ${functionName}` });
    }
  } catch (error: any) {
    console.error(`Error executing ${functionName}:`, error);
    return JSON.stringify({ 
      error: `Failed to execute ${functionName}: ${error.message}` 
    });
  }
}

// ==================== PRIMITIVE FUNCTIONS ====================

async function handleGetDriversByType(
  args: { driverType: string; includeUpcoming?: boolean },
  context: FunctionContext
): Promise<string> {
  const { driverType, includeUpcoming = true } = args;
  const { tenantId } = context;
  
  // Get all drivers for tenant
  const allDrivers = await dbStorage.getDriversByTenant(tenantId);
  
  // Get all block assignments for tenant to determine driver types
  const allAssignments = await dbStorage.getBlockAssignmentsByTenant(tenantId);
  
  // Get blocks to determine solo types
  const uniqueBlockIds = new Set(allAssignments.map(a => a.blockId).filter((id): id is string => id !== null));
  const blockMap = new Map<string, Block>();
  for (const blockId of Array.from(uniqueBlockIds)) {
    const block = await dbStorage.getBlock(blockId);
    if (block) {
      blockMap.set(blockId, block);
    }
  }

  // Create a map of driverId -> soloType (from their most recent assignment)
  // Normalize soloType to lowercase for case-insensitive matching
  const driverTypeMap = new Map<string, string>();
  allAssignments.forEach(assignment => {
    const block = assignment.blockId ? blockMap.get(assignment.blockId) : null;
    if (block && !driverTypeMap.has(assignment.driverId)) {
      driverTypeMap.set(assignment.driverId, block.soloType.toLowerCase());
    }
  });
  
  // Filter drivers by type (case-insensitive)
  // Note: Drivers with no assignment history are excluded from results
  const normalizedDriverType = driverType.toLowerCase();
  const filteredDrivers = allDrivers.filter(driver => {
    const assignedType = driverTypeMap.get(driver.id);
    return assignedType === normalizedDriverType;
  });
  
  // If includeUpcoming, get assignments for next 7 days
  const results = [];
  for (const driver of filteredDrivers) {
    const driverInfo: any = {
      id: driver.id,
      name: `${driver.firstName} ${driver.lastName}`,
      status: driver.status,
      domicile: driver.domicile,
      type: driverType
    };
    
    if (includeUpcoming) {
      const now = new Date();
      const weekFromNow = addDays(now, 7);
      
      const assignments = await dbStorage.getBlockAssignmentsWithBlocksByDriverAndDateRange(
        driver.id,
        tenantId,
        now,
        weekFromNow
      );
      
      driverInfo.upcomingAssignments = assignments.map(a => ({
        blockId: a.block.blockId,
        startTime: a.block.startTimestamp,
        endTime: a.block.endTimestamp,
        dayOfWeek: format(a.block.startTimestamp, 'EEEE')
      }));
      driverInfo.daysScheduled = assignments.length;
    }
    
    results.push(driverInfo);
  }
  
  return JSON.stringify({
    driverType,
    count: results.length,
    drivers: results
  });
}

async function handleGetDriverByNameOrId(
  args: { search: string },
  context: FunctionContext
): Promise<string> {
  const { search } = args;
  const { tenantId } = context;
  
  // First try exact ID match
  try {
    const driver = await dbStorage.getDriver(search);
    if (driver && driver.tenantId === tenantId) {
      // Get driver's type from their block assignments
      const assignments = await dbStorage.getBlockAssignmentsByDriver(driver.id);
      let driverType = "unknown";
      if (assignments.length > 0) {
        const firstBlock = await dbStorage.getBlock(requireNonNull(assignments[0].blockId, "blockId"));
        if (firstBlock) {
          driverType = firstBlock.soloType;
        }
      }
      
      return JSON.stringify({
        found: true,
        driver: {
          id: driver.id,
          name: `${driver.firstName} ${driver.lastName}`,
          firstName: driver.firstName,
          lastName: driver.lastName,
          status: driver.status,
          domicile: driver.domicile,
          phone: driver.phoneNumber,
          email: driver.email,
          type: driverType
        }
      });
    }
  } catch (e) {
    // Not a valid ID, continue to name search
  }
  
  // Search by name
  const allDrivers = await dbStorage.getDriversByTenant(tenantId);
  const searchLower = search.toLowerCase();
  
  const matches = allDrivers.filter(driver => {
    const fullName = `${driver.firstName} ${driver.lastName}`.toLowerCase();
    const firstName = driver.firstName.toLowerCase();
    const lastName = driver.lastName.toLowerCase();
    
    return fullName.includes(searchLower) || 
           firstName.includes(searchLower) || 
           lastName.includes(searchLower);
  });
  
  if (matches.length === 0) {
    return JSON.stringify({ found: false, message: `No drivers found matching "${search}"` });
  }
  
  // Get types for matched drivers
  const results = [];
  for (const driver of matches) {
    const assignments = await dbStorage.getBlockAssignmentsByDriver(driver.id);
    let driverType = "unknown";
    if (assignments.length > 0) {
      const firstBlock = await dbStorage.getBlock(requireNonNull(assignments[0].blockId, "blockId"));
      if (firstBlock) {
        driverType = firstBlock.soloType;
      }
    }
    results.push({
      id: driver.id,
      name: `${driver.firstName} ${driver.lastName}`,
      firstName: driver.firstName,
      lastName: driver.lastName,
      status: driver.status,
      domicile: driver.domicile,
      type: driverType
    });
  }
  
  return JSON.stringify({
    found: true,
    count: results.length,
    drivers: results
  });
}

async function handleGetDriverSchedule(
  args: { driverId: string; startDate: string; endDate: string },
  context: FunctionContext
): Promise<string> {
  const { driverId, startDate, endDate } = args;
  const { tenantId } = context;
  
  // Verify driver belongs to tenant
  const driver = await dbStorage.getDriver(driverId);
  if (!driver || driver.tenantId !== tenantId) {
    return JSON.stringify({ error: "Driver not found or access denied" });
  }
  
  // Parse dates
  const start = parseDateWithFallback(startDate);
  const end = parseDateWithFallback(endDate);
  
  // Get assignments with block details
  const assignments = await dbStorage.getBlockAssignmentsWithBlocksByDriverAndDateRange(
    driverId,
    tenantId,
    start,
    end
  );
  
  return JSON.stringify({
    driver: {
      id: driver.id,
      name: `${driver.firstName} ${driver.lastName}`
    },
    dateRange: {
      start: formatDateForAPI(start),
      end: formatDateForAPI(end)
    },
    totalAssignments: assignments.length,
    assignments: assignments.map(a => ({
      blockId: a.block.blockId,
      startTime: a.block.startTimestamp,
      endTime: a.block.endTimestamp,
      dayOfWeek: format(a.block.startTimestamp, 'EEEE'),
      contractId: a.block.contractId,
      assignedAt: a.assignedAt
    }))
  });
}

async function handleGetAssignmentsByDate(
  args: { date: string },
  context: FunctionContext
): Promise<string> {
  const { date } = args;
  const { tenantId } = context;
  
  // Parse as date range (handles both single dates and ranges like "this week")
  const range = parseDateRange(date);
  if (!range) {
    throw new Error(`Could not parse date: "${date}". Use formats like "Monday", "this week", "last Sunday", or "2025-11-10".`);
  }
  
  // Use endOfDay for inclusive range end
  const rangeStart = range.startDate;
  const rangeEnd = endOfDay(range.endDate);
  
  // Get blocks that OVERLAP the range using efficient DB query
  const blocks = await dbStorage.getBlocksByDateRangeOverlapping(tenantId, rangeStart, rangeEnd);
  
  // Get all assignments for tenant
  const allAssignments = await dbStorage.getBlockAssignmentsByTenant(tenantId);
  
  // Create assignment map
  const assignmentMap = new Map<string, BlockAssignment>();
  allAssignments.forEach(a => {
    if (a.blockId) {
      assignmentMap.set(a.blockId, a);
    }
  });
  
  // Get driver info for assigned blocks
  const driverMap = new Map<string, Driver>();
  const uniqueDriverIds = new Set(allAssignments.map(a => a.driverId));
  for (const driverId of Array.from(uniqueDriverIds)) {
    const driver = await dbStorage.getDriver(driverId);
    if (driver) {
      driverMap.set(driverId, driver);
    }
  }
  
  const results = blocks.map(block => {
    const assignment = assignmentMap.get(block.id);
    const driver = assignment ? driverMap.get(assignment.driverId) : null;
    
    return {
      blockId: block.blockId,
      startTime: block.startTimestamp,
      endTime: block.endTimestamp,
      dayOfWeek: format(block.startTimestamp, 'EEEE'),
      assigned: !!assignment,
      driver: driver ? {
        id: driver.id,
        name: `${driver.firstName} ${driver.lastName}`
      } : null
    };
  });
  
  return JSON.stringify({
    dateRange: {
      start: formatDateForAPI(range.startDate),
      end: formatDateForAPI(range.endDate)
    },
    totalBlocks: results.length,
    assignedBlocks: results.filter(r => r.assigned).length,
    unassignedBlocks: results.filter(r => !r.assigned).length,
    blocks: results
  });
}

async function handleGetBlocksByDateRange(
  args: { startDate: string; endDate: string; includeAssignments?: boolean },
  context: FunctionContext
): Promise<string> {
  const { startDate, endDate, includeAssignments = true } = args;
  const { tenantId } = context;
  
  const start = parseDateWithFallback(startDate);
  const end = parseDateWithFallback(endDate);
  
  const blocks = await dbStorage.getBlocksByDateRange(tenantId, start, end);
  
  let results = blocks.map(block => ({
    id: block.id,
    blockId: block.blockId,
    startTime: block.startTimestamp,
    endTime: block.endTimestamp,
    dayOfWeek: format(block.startTimestamp, 'EEEE'),
    contractId: block.contractId
  }));
  
  if (includeAssignments) {
    const allAssignments = await dbStorage.getBlockAssignmentsByTenant(tenantId);
    const assignmentMap = new Map<string, BlockAssignment>();
    allAssignments.forEach(a => {
      if (a.blockId) {
        assignmentMap.set(a.blockId, a);
      }
    });
    
    const driverMap = new Map<string, Driver>();
    const uniqueDriverIds = new Set(allAssignments.map(a => a.driverId));
    for (const driverId of Array.from(uniqueDriverIds)) {
      const driver = await dbStorage.getDriver(driverId);
      if (driver) driverMap.set(driverId, driver);
    }
    
    results = results.map((block: any) => {
      const assignment = assignmentMap.get(block.id);
      const driver = assignment ? driverMap.get(assignment.driverId) : null;
      
      return {
        ...block,
        assigned: !!assignment,
        driver: driver ? {
          id: driver.id,
          name: `${driver.firstName} ${driver.lastName}`
        } : null
      };
    });
  }
  
  return JSON.stringify({
    dateRange: {
      start: formatDateForAPI(start),
      end: formatDateForAPI(end)
    },
    totalBlocks: results.length,
    blocks: results
  });
}

async function handleGetUpcomingAssignments(
  args: { daysAhead: number },
  context: FunctionContext
): Promise<string> {
  const { daysAhead } = args;
  const { tenantId } = context;
  
  const now = new Date();
  const futureDate = addDays(now, Math.min(daysAhead, 30));
  
  const blocks = await dbStorage.getBlocksByDateRange(tenantId, now, futureDate);
  const allAssignments = await dbStorage.getBlockAssignmentsByTenant(tenantId);
  
  const assignmentMap = new Map<string, BlockAssignment>();
  allAssignments.forEach(a => {
    if (a.blockId) {
      assignmentMap.set(a.blockId, a);
    }
  });
  
  const driverMap = new Map<string, Driver>();
  const uniqueDriverIds = new Set(allAssignments.map(a => a.driverId));
  for (const driverId of Array.from(uniqueDriverIds)) {
    const driver = await dbStorage.getDriver(driverId);
    if (driver) driverMap.set(driverId, driver);
  }
  
  const assignedBlocks = blocks
    .filter(block => assignmentMap.has(block.id))
    .map(block => {
      const assignment = assignmentMap.get(block.id)!;
      const driver = driverMap.get(assignment.driverId);
      
      return {
        blockId: block.blockId,
        startTime: block.startTimestamp,
        endTime: block.endTimestamp,
        dayOfWeek: format(block.startTimestamp, 'EEEE'),
        driver: driver ? {
          id: driver.id,
          name: `${driver.firstName} ${driver.lastName}`
        } : null
      };
    });
  
  return JSON.stringify({
    daysAhead,
    dateRange: {
      start: formatDateForAPI(now),
      end: formatDateForAPI(futureDate)
    },
    totalAssignments: assignedBlocks.length,
    assignments: assignedBlocks
  });
}

// ==================== COMPOSITE FUNCTIONS ====================

async function handleGetDriverWorkloadSummary(
  args: { startDate: string; endDate: string },
  context: FunctionContext
): Promise<string> {
  const { startDate, endDate } = args;
  const { tenantId } = context;
  
  const start = parseDateWithFallback(startDate);
  const end = parseDateWithFallback(endDate);
  
  // Get all drivers and their block assignments to determine types
  const allDrivers = await dbStorage.getDriversByTenant(tenantId);
  const allAssignments = await dbStorage.getBlockAssignmentsByTenant(tenantId);
  
  // Get blocks to determine solo types
  const uniqueBlockIds = new Set(allAssignments.map(a => a.blockId).filter((id): id is string => id !== null));
  const blockMap = new Map<string, Block>();
  for (const blockId of Array.from(uniqueBlockIds)) {
    const block = await dbStorage.getBlock(blockId);
    if (block) {
      blockMap.set(blockId, block);
    }
  }

  // Create driver type map from their block assignments
  const driverTypeMap = new Map<string, string>();
  allAssignments.forEach(assignment => {
    const block = assignment.blockId ? blockMap.get(assignment.blockId) : null;
    if (block && !driverTypeMap.has(assignment.driverId)) {
      driverTypeMap.set(assignment.driverId, block.soloType);
    }
  });
  
  // Get workload for each driver
  const workloads = [];
  for (const driver of allDrivers) {
    const assignments = await dbStorage.getBlockAssignmentsWithBlocksByDriverAndDateRange(
      driver.id,
      tenantId,
      start,
      end
    );
    
    // Count unique days worked
    const uniqueDays = new Set<string>(
      assignments.map(a => startOfDay(a.block.startTimestamp).toISOString())
    );
    
    workloads.push({
      driverId: driver.id,
      name: `${driver.firstName} ${driver.lastName}`,
      type: driverTypeMap.get(driver.id) || "unknown",
      status: driver.status,
      domicile: driver.domicile,
      totalAssignments: assignments.length,
      daysWorked: uniqueDays.size,
      assignments: assignments.map(a => ({
        blockId: a.block.blockId,
        startTime: a.block.startTimestamp,
        endTime: a.block.endTimestamp,
        dayOfWeek: format(a.block.startTimestamp, 'EEEE')
      }))
    });
  }
  
  // Sort by days worked descending
  workloads.sort((a, b) => b.daysWorked - a.daysWorked);
  
  // Group by type
  const byType = {
    solo1: workloads.filter(w => w.type === "solo1"),
    solo2: workloads.filter(w => w.type === "solo2"),
    team: workloads.filter(w => w.type === "team"),
    unknown: workloads.filter(w => w.type === "unknown")
  };
  
  return JSON.stringify({
    dateRange: {
      start: formatDateForAPI(start),
      end: formatDateForAPI(end)
    },
    summary: {
      totalDrivers: workloads.length,
      solo1Count: byType.solo1.length,
      solo2Count: byType.solo2.length,
      teamCount: byType.team.length,
      averageDaysWorked: workloads.length > 0
        ? (workloads.reduce((sum, w) => sum + w.daysWorked, 0) / workloads.length).toFixed(1)
        : 0
    },
    byType,
    drivers: workloads
  });
}

// ==================== MEMORY/CONVERSATION FUNCTIONS ====================

async function handleRecallPastConversation(
  args: { searchQuery: string; limit?: number },
  context: FunctionContext
): Promise<string> {
  const { searchQuery, limit = 5 } = args;
  const { tenantId, userId } = context;

  // Limit to max 10 results
  const actualLimit = Math.min(Math.max(limit, 1), 10);

  const results = await dbStorage.searchPastConversations(
    tenantId,
    userId,
    searchQuery,
    6, // 6 weeks of history
    actualLimit
  );

  if (results.totalMatches === 0) {
    return JSON.stringify({
      found: false,
      message: `No past conversations found matching "${searchQuery}" in the last 6 weeks.`,
      suggestion: "This might be a new topic we haven't discussed before. Would you like me to look up this information now?"
    });
  }

  // Format results for the AI to understand
  const formattedMatches = results.matches.map(match => ({
    date: format(match.messageDate, 'EEEE, MMM d, yyyy h:mm a'),
    conversationTitle: match.sessionTitle || "Untitled conversation",
    whoSaid: match.role === "user" ? "You asked" : "I responded",
    content: match.contentSnippet
  }));

  return JSON.stringify({
    found: true,
    searchQuery,
    totalMatches: results.totalMatches,
    message: `Found ${results.totalMatches} relevant message${results.totalMatches > 1 ? 's' : ''} from past conversations.`,
    matches: formattedMatches
  });
}

// ==================== WEATHER FUNCTIONS ====================

interface GeocodingResult {
  results?: Array<{
    name: string;
    admin1?: string;
    country: string;
    latitude: number;
    longitude: number;
  }>;
}

interface WeatherResponse {
  current?: {
    temperature_2m: number;
    apparent_temperature: number;
    relative_humidity_2m: number;
    precipitation: number;
    weather_code: number;
    wind_speed_10m: number;
    wind_gusts_10m: number;
    visibility: number;
  };
  daily?: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_sum: number[];
    precipitation_probability_max: number[];
    wind_speed_10m_max: number[];
  };
}

// Weather code descriptions for driver safety
function getWeatherDescription(code: number): { condition: string; drivingAlert?: string } {
  const weatherCodes: Record<number, { condition: string; drivingAlert?: string }> = {
    0: { condition: "Clear sky" },
    1: { condition: "Mainly clear" },
    2: { condition: "Partly cloudy" },
    3: { condition: "Overcast" },
    45: { condition: "Fog", drivingAlert: "⚠️ REDUCED VISIBILITY - Use fog lights, reduce speed" },
    48: { condition: "Depositing rime fog", drivingAlert: "⚠️ ICY CONDITIONS POSSIBLE - Roads may be slippery" },
    51: { condition: "Light drizzle", drivingAlert: "Wet roads - increase following distance" },
    53: { condition: "Moderate drizzle", drivingAlert: "Wet roads - reduce speed" },
    55: { condition: "Dense drizzle", drivingAlert: "⚠️ Poor visibility - reduce speed significantly" },
    56: { condition: "Light freezing drizzle", drivingAlert: "🚨 ICE ALERT - Roads extremely slippery" },
    57: { condition: "Dense freezing drizzle", drivingAlert: "🚨 SEVERE ICE - Consider delaying travel" },
    61: { condition: "Slight rain", drivingAlert: "Wet roads - drive cautiously" },
    63: { condition: "Moderate rain", drivingAlert: "⚠️ Reduced visibility - slow down" },
    65: { condition: "Heavy rain", drivingAlert: "🚨 HEAVY RAIN - Poor visibility, hydroplaning risk" },
    66: { condition: "Light freezing rain", drivingAlert: "🚨 ICE STORM - Roads extremely dangerous" },
    67: { condition: "Heavy freezing rain", drivingAlert: "🚨 SEVERE ICE STORM - Avoid travel if possible" },
    71: { condition: "Slight snow", drivingAlert: "⚠️ Snow on roads - reduce speed, chains may be needed" },
    73: { condition: "Moderate snow", drivingAlert: "🚨 SNOW - Slippery roads, reduced visibility" },
    75: { condition: "Heavy snow", drivingAlert: "🚨 HEAVY SNOW - Consider delaying travel" },
    77: { condition: "Snow grains", drivingAlert: "⚠️ Icy conditions possible" },
    80: { condition: "Slight rain showers" },
    81: { condition: "Moderate rain showers", drivingAlert: "⚠️ Variable conditions - stay alert" },
    82: { condition: "Violent rain showers", drivingAlert: "🚨 SEVERE RAIN - Pull over if visibility poor" },
    85: { condition: "Slight snow showers", drivingAlert: "⚠️ Snow squalls - sudden visibility drops" },
    86: { condition: "Heavy snow showers", drivingAlert: "🚨 HEAVY SNOW - Whiteout conditions possible" },
    95: { condition: "Thunderstorm", drivingAlert: "🚨 THUNDERSTORM - Lightning risk, potential hail" },
    96: { condition: "Thunderstorm with slight hail", drivingAlert: "🚨 HAIL - Pull over under shelter" },
    99: { condition: "Thunderstorm with heavy hail", drivingAlert: "🚨 SEVERE HAIL - Seek shelter immediately" }
  };
  return weatherCodes[code] || { condition: "Unknown" };
}

async function handleGetWeather(
  args: { location: string; includeForecast?: boolean },
  _context: FunctionContext
): Promise<string> {
  const { location, includeForecast = true } = args;

  try {
    // Step 1: Geocode the location
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`;
    const geoResponse = await fetch(geoUrl);

    if (!geoResponse.ok) {
      return JSON.stringify({
        error: true,
        message: `Could not find location: ${location}. Try a city name like "Kansas City, MO" or "Los Angeles".`
      });
    }

    const geoData: GeocodingResult = await geoResponse.json();

    if (!geoData.results || geoData.results.length === 0) {
      return JSON.stringify({
        error: true,
        message: `Location "${location}" not found. Try a specific city name like "Kansas City, MO".`
      });
    }

    const place = geoData.results[0];
    const { latitude, longitude, name, admin1, country } = place;
    const locationName = admin1 ? `${name}, ${admin1}, ${country}` : `${name}, ${country}`;

    // Step 2: Get weather data
    const weatherParams = [
      `latitude=${latitude}`,
      `longitude=${longitude}`,
      'current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,visibility',
      'daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max',
      'temperature_unit=fahrenheit',
      'wind_speed_unit=mph',
      'precipitation_unit=inch',
      'timezone=auto',
      'forecast_days=5'
    ].join('&');

    const weatherUrl = `https://api.open-meteo.com/v1/forecast?${weatherParams}`;
    const weatherResponse = await fetch(weatherUrl);

    if (!weatherResponse.ok) {
      return JSON.stringify({
        error: true,
        message: "Weather service temporarily unavailable. Please try again."
      });
    }

    const weather: WeatherResponse = await weatherResponse.json();

    if (!weather.current) {
      return JSON.stringify({
        error: true,
        message: "No weather data available for this location."
      });
    }

    const current = weather.current;
    const currentCondition = getWeatherDescription(current.weather_code);
    const visibilityMiles = (current.visibility / 1609.34).toFixed(1); // Convert meters to miles

    // Build current conditions
    const result: any = {
      location: locationName,
      coordinates: { latitude, longitude },
      current: {
        temperature: `${Math.round(current.temperature_2m)}°F`,
        feelsLike: `${Math.round(current.apparent_temperature)}°F`,
        condition: currentCondition.condition,
        humidity: `${current.relative_humidity_2m}%`,
        wind: `${Math.round(current.wind_speed_10m)} mph`,
        windGusts: `${Math.round(current.wind_gusts_10m)} mph`,
        visibility: `${visibilityMiles} miles`,
        precipitation: `${current.precipitation} in`
      },
      drivingSafety: {
        alert: currentCondition.drivingAlert || "✅ Normal driving conditions",
        conditions: []
      }
    };

    // Add safety conditions
    const safetyConditions: string[] = [];
    if (current.wind_gusts_10m > 40) {
      safetyConditions.push("⚠️ High winds - Watch for crosswinds on open roads");
    }
    if (parseFloat(visibilityMiles) < 1) {
      safetyConditions.push("🚨 Very poor visibility - Use extreme caution");
    } else if (parseFloat(visibilityMiles) < 3) {
      safetyConditions.push("⚠️ Reduced visibility - Turn on headlights");
    }
    if (current.precipitation > 0.1) {
      safetyConditions.push("Precipitation active - Roads may be wet/slippery");
    }
    result.drivingSafety.conditions = safetyConditions;

    // Add forecast if requested
    if (includeForecast && weather.daily) {
      const forecast = weather.daily.time.map((date, i) => {
        const dayCondition = getWeatherDescription(weather.daily!.weather_code[i]);
        return {
          date: format(new Date(date), 'EEE, MMM d'),
          high: `${Math.round(weather.daily!.temperature_2m_max[i])}°F`,
          low: `${Math.round(weather.daily!.temperature_2m_min[i])}°F`,
          condition: dayCondition.condition,
          precipChance: `${weather.daily!.precipitation_probability_max[i]}%`,
          precipAmount: `${weather.daily!.precipitation_sum[i]} in`,
          maxWind: `${Math.round(weather.daily!.wind_speed_10m_max[i])} mph`,
          drivingAlert: dayCondition.drivingAlert
        };
      });
      result.forecast = forecast;

      // Check for upcoming hazardous conditions
      const upcomingAlerts = forecast
        .filter(day => day.drivingAlert)
        .map(day => `${day.date}: ${day.drivingAlert}`);

      if (upcomingAlerts.length > 0) {
        result.upcomingHazards = upcomingAlerts;
      }
    }

    return JSON.stringify(result);

  } catch (error: any) {
    console.error("Weather API error:", error);
    return JSON.stringify({
      error: true,
      message: `Failed to get weather: ${error.message}. Try again in a moment.`
    });
  }
}
