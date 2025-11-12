import { dbStorage } from "./db-storage";
import { parseNaturalDate, parseDateRange, formatDateForAPI } from "./date-parser";
import type { Driver, Schedule, Block, BlockAssignment, Contract } from "@shared/schema";
import { startOfDay, endOfDay, addDays, format } from "date-fns";

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
  const uniqueBlockIds = new Set(allAssignments.map(a => a.blockId));
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
    const block = blockMap.get(assignment.blockId);
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
        const firstBlock = await dbStorage.getBlock(assignments[0].blockId);
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
      const firstBlock = await dbStorage.getBlock(assignments[0].blockId);
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
  allAssignments.forEach(a => assignmentMap.set(a.blockId, a));
  
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
    allAssignments.forEach(a => assignmentMap.set(a.blockId, a));
    
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
  allAssignments.forEach(a => assignmentMap.set(a.blockId, a));
  
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
  const uniqueBlockIds = new Set(allAssignments.map(a => a.blockId));
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
    const block = blockMap.get(assignment.blockId);
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
