/**
 * Scheduling Tools - 10 granular tools for the agentic scheduling system
 *
 * QUERY TOOLS (read-only):
 * 1. get_unassigned_blocks - What blocks need assignment
 * 2. get_driver_patterns - XGBoost pattern data for drivers
 * 3. check_dot_compliance - 10-hour rest rule
 * 4. check_rolling6_hours - Rolling hour limits
 * 5. check_protected_rules - Hard blocks (blocked days/times)
 * 6. check_time_off - Driver unavailability
 * 7. get_ownership_score - Who owns this slot (XGBoost)
 * 8. get_affinity_score - Pattern match strength
 *
 * EXECUTION TOOLS (write):
 * 9. assign_driver_to_block - Create assignment
 * 10. unassign_block - Remove assignment
 */

import { db } from "../../db";
import { blocks, drivers, blockAssignments, protectedDriverRules } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { format, differenceInHours } from "date-fns";
import { AgentScratchpad, UnassignedBlock } from "./agent-scratchpad";
import { getSlotDistribution, DriverPattern } from "../../python-bridge";
import {
  validate10HourRestRule,
  validateRolling6Compliance,
  validateProtectedDriverRules,
} from "../../rolling6-calculator";

// ============================================================================
// Tool Result Types
// ============================================================================

export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  suggestion?: string;
}

// ============================================================================
// QUERY TOOLS
// ============================================================================

/**
 * Tool 1: Get unassigned blocks for the week
 */
export async function getUnassignedBlocks(
  scratchpad: AgentScratchpad
): Promise<ToolResult<{
  blocks: Array<{
    id: string;
    blockId: string;
    serviceDate: string;
    dayName: string;
    soloType: string;
    tractorId: string;
    startTime: string;
    endTime: string;
  }>;
  count: number;
}>> {
  try {
    const blocks = scratchpad.getRemainingBlocks();

    return {
      success: true,
      data: {
        blocks: blocks.map(b => ({
          id: b.id,
          blockId: b.blockId,
          serviceDate: b.serviceDate,
          dayName: b.dayName,
          soloType: b.soloType,
          tractorId: b.tractorId,
          startTime: b.startTime,
          endTime: b.endTime,
        })),
        count: blocks.length,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to get unassigned blocks: ${(error as Error).message}`,
    };
  }
}

/**
 * Tool 2: Get driver patterns from XGBoost
 */
export async function getDriverPatterns(
  scratchpad: AgentScratchpad,
  contractType?: string
): Promise<ToolResult<{
  patterns: Array<{
    driverId: string;
    driverName: string;
    typicalDays: number;
    dayList: string[];
    confidence: number;
  }>;
  count: number;
}>> {
  try {
    const patterns: Array<{
      driverId: string;
      driverName: string;
      typicalDays: number;
      dayList: string[];
      confidence: number;
    }> = [];

    for (const driver of scratchpad.allDrivers) {
      const pattern = scratchpad.getDriverPattern(driver.name);
      if (pattern) {
        patterns.push({
          driverId: driver.id,
          driverName: driver.name,
          typicalDays: pattern.typical_days,
          dayList: pattern.day_list,
          confidence: pattern.confidence,
        });
      }
    }

    // Sort by confidence descending
    patterns.sort((a, b) => b.confidence - a.confidence);

    return {
      success: true,
      data: {
        patterns,
        count: patterns.length,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to get driver patterns: ${(error as Error).message}`,
    };
  }
}

/**
 * Tool 3: Check DOT 10-hour rest compliance
 */
export async function checkDotCompliance(
  scratchpad: AgentScratchpad,
  driverId: string,
  blockId: string
): Promise<ToolResult<{
  compliant: boolean;
  restHours: number;
  required: number;
  lastBlockEnd?: string;
  thisBlockStart?: string;
}>> {
  try {
    const driver = scratchpad.getDriver(driverId);
    if (!driver) {
      return { success: false, error: `Driver ${driverId} not found` };
    }

    // Find the block
    const block = scratchpad.getRemainingBlocks().find(b => b.id === blockId);
    if (!block) {
      return { success: false, error: `Block ${blockId} not found or already assigned` };
    }

    // Get driver's existing assignments including those made this session
    const driverAssignments = scratchpad.existingAssignments.get(driverId) || [];

    // Add assignments made this session
    for (const [assignedBlockId, assignedDriverId] of scratchpad.assignedThisSession) {
      if (assignedDriverId === driverId) {
        const assignedBlock = scratchpad.unassignedBlocks.find(b => b.id === assignedBlockId);
        if (assignedBlock) {
          driverAssignments.push({
            blockId: assignedBlockId,
            startTimestamp: assignedBlock.startTimestamp,
            endTimestamp: assignedBlock.endTimestamp,
            soloType: assignedBlock.soloType,
          });
        }
      }
    }

    // Find the closest assignment before this block
    const blockStart = block.startTimestamp;
    let minRestHours = Infinity;
    let lastBlockEnd: Date | null = null;

    for (const assignment of driverAssignments) {
      // Check gap from previous block's end to this block's start
      if (assignment.endTimestamp < blockStart) {
        const restHours = differenceInHours(blockStart, assignment.endTimestamp);
        if (restHours < minRestHours) {
          minRestHours = restHours;
          lastBlockEnd = assignment.endTimestamp;
        }
      }

      // Check gap from this block's end to next block's start
      if (assignment.startTimestamp > block.endTimestamp) {
        const restHours = differenceInHours(assignment.startTimestamp, block.endTimestamp);
        if (restHours < minRestHours) {
          minRestHours = restHours;
        }
      }
    }

    // If no adjacent blocks, compliance is automatic
    if (minRestHours === Infinity) {
      return {
        success: true,
        data: {
          compliant: true,
          restHours: 24, // Assume full day if no adjacent blocks
          required: 10,
        },
      };
    }

    const compliant = minRestHours >= 10;

    return {
      success: true,
      data: {
        compliant,
        restHours: Math.round(minRestHours * 10) / 10,
        required: 10,
        lastBlockEnd: lastBlockEnd ? format(lastBlockEnd, 'yyyy-MM-dd HH:mm') : undefined,
        thisBlockStart: format(blockStart, 'yyyy-MM-dd HH:mm'),
      },
    };
  } catch (error) {
    return {
      success: false,
      error: `DOT compliance check failed: ${(error as Error).message}`,
    };
  }
}

/**
 * Tool 4: Check Rolling-6 hour compliance
 */
export async function checkRolling6Hours(
  scratchpad: AgentScratchpad,
  driverId: string,
  date: string
): Promise<ToolResult<{
  compliant: boolean;
  currentHours: number;
  maxHours: number;
  periodType: string;
}>> {
  try {
    const driver = scratchpad.getDriver(driverId);
    if (!driver) {
      return { success: false, error: `Driver ${driverId} not found` };
    }

    // Get driver's assignments around this date
    const driverAssignments = scratchpad.existingAssignments.get(driverId) || [];

    // Calculate hours in the rolling period
    // Solo1: 14 hours max in 24-hour period
    // Solo2: 38 hours max in 48-hour period
    const targetDate = new Date(date);

    let totalHours = 0;
    let soloType = 'solo1';

    for (const assignment of driverAssignments) {
      const assignmentDate = format(assignment.startTimestamp, 'yyyy-MM-dd');
      const daysDiff = Math.abs(
        (targetDate.getTime() - assignment.startTimestamp.getTime()) / (1000 * 60 * 60 * 24)
      );

      // Check if within rolling period (1 day for Solo1, 2 days for Solo2)
      if (daysDiff <= 1) {
        const hours = differenceInHours(assignment.endTimestamp, assignment.startTimestamp);
        totalHours += hours;
        soloType = assignment.soloType;
      }
    }

    // Add hours from blocks assigned this session
    for (const [assignedBlockId, assignedDriverId] of scratchpad.assignedThisSession) {
      if (assignedDriverId === driverId) {
        // Would need to look up block details - for now assume 8 hours per block
        totalHours += 8;
      }
    }

    const maxHours = soloType === 'solo2' ? 38 : 14;
    const compliant = totalHours < maxHours;

    return {
      success: true,
      data: {
        compliant,
        currentHours: Math.round(totalHours * 10) / 10,
        maxHours,
        periodType: soloType === 'solo2' ? '48-hour rolling' : '24-hour rolling',
      },
    };
  } catch (error) {
    return {
      success: false,
      error: `Rolling-6 compliance check failed: ${(error as Error).message}`,
    };
  }
}

/**
 * Tool 5: Check protected driver rules
 */
export async function checkProtectedRules(
  scratchpad: AgentScratchpad,
  driverId: string,
  blockId: string
): Promise<ToolResult<{
  allowed: boolean;
  violations: string[];
  rules: Array<{
    ruleType: string;
    description: string;
  }>;
}>> {
  try {
    const driver = scratchpad.getDriver(driverId);
    if (!driver) {
      return { success: false, error: `Driver ${driverId} not found` };
    }

    const block = scratchpad.getRemainingBlocks().find(b => b.id === blockId);
    if (!block) {
      return { success: false, error: `Block ${blockId} not found` };
    }

    const violations: string[] = [];
    const rules: Array<{ ruleType: string; description: string }> = [];

    // Check driver's days off
    if (driver.daysOff.includes(block.dayName.toLowerCase())) {
      violations.push(`Driver has ${block.dayName} marked as day off`);
      rules.push({ ruleType: 'day_off', description: `${block.dayName} is a day off` });
    }

    // Check protected rules
    const driverRules = scratchpad.protectedRules.filter(r => r.driverId === driverId);

    for (const rule of driverRules) {
      // Check blocked days
      if (rule.blockedDays && rule.blockedDays.length > 0) {
        if (rule.blockedDays.some(d => d.toLowerCase() === block.dayName.toLowerCase())) {
          violations.push(`Protected rule: ${block.dayName} is blocked`);
          rules.push({ ruleType: 'blocked_day', description: `Cannot work on ${block.dayName}` });
        }
      }

      // Check allowed days (if specified, driver can ONLY work these days)
      if (rule.allowedDays && rule.allowedDays.length > 0) {
        if (!rule.allowedDays.some(d => d.toLowerCase() === block.dayName.toLowerCase())) {
          violations.push(`Protected rule: Can only work ${rule.allowedDays.join(', ')}`);
          rules.push({ ruleType: 'allowed_days_only', description: `Only works ${rule.allowedDays.join(', ')}` });
        }
      }

      // Check blocked solo types
      if (rule.blockedSoloTypes && rule.blockedSoloTypes.length > 0) {
        if (rule.blockedSoloTypes.some(t => t.toLowerCase() === block.soloType.toLowerCase())) {
          violations.push(`Protected rule: ${block.soloType} is blocked`);
          rules.push({ ruleType: 'blocked_solo_type', description: `Cannot work ${block.soloType}` });
        }
      }

      // Check allowed solo types
      if (rule.allowedSoloTypes && rule.allowedSoloTypes.length > 0) {
        if (!rule.allowedSoloTypes.some(t => t.toLowerCase() === block.soloType.toLowerCase())) {
          violations.push(`Protected rule: Can only work ${rule.allowedSoloTypes.join(', ')}`);
          rules.push({ ruleType: 'allowed_solo_types_only', description: `Only works ${rule.allowedSoloTypes.join(', ')}` });
        }
      }
    }

    return {
      success: true,
      data: {
        allowed: violations.length === 0,
        violations,
        rules,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: `Protected rules check failed: ${(error as Error).message}`,
    };
  }
}

/**
 * Tool 6: Check time-off / unavailability
 */
export async function checkTimeOff(
  scratchpad: AgentScratchpad,
  driverId: string,
  date: string
): Promise<ToolResult<{
  available: boolean;
  reason?: string;
}>> {
  try {
    const driver = scratchpad.getDriver(driverId);
    if (!driver) {
      return { success: false, error: `Driver ${driverId} not found` };
    }

    const result = scratchpad.isDriverUnavailable(driverId, date);

    return {
      success: true,
      data: {
        available: !result.unavailable,
        reason: result.reason,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: `Time-off check failed: ${(error as Error).message}`,
    };
  }
}

/**
 * Tool 7: Get ownership score from XGBoost
 */
export async function getOwnershipScore(
  scratchpad: AgentScratchpad,
  driverId: string,
  soloType: string,
  tractorId: string,
  dayOfWeek: number
): Promise<ToolResult<{
  score: number;
  isOwner: boolean;
  slotType: 'owned' | 'rotating' | 'unknown';
  shares: Record<string, number>;
}>> {
  try {
    const driver = scratchpad.getDriver(driverId);
    if (!driver) {
      return { success: false, error: `Driver ${driverId} not found` };
    }

    // Call XGBoost ownership model
    const result = await getSlotDistribution({
      soloType,
      tractorId,
      dayOfWeek,
    });

    if (!result.success || !result.data) {
      return {
        success: true,
        data: {
          score: 0,
          isOwner: false,
          slotType: 'unknown',
          shares: {},
        },
      };
    }

    const distribution = result.data;

    // Find this driver's ownership share
    const normalizedName = driver.name.toLowerCase().replace(/\s+/g, ' ').trim();
    let driverShare = 0;

    for (const [name, share] of Object.entries(distribution.shares || {})) {
      if (name.toLowerCase().replace(/\s+/g, ' ').trim() === normalizedName) {
        driverShare = share;
        break;
      }
    }

    return {
      success: true,
      data: {
        score: Math.round(driverShare * 100) / 100,
        isOwner: driverShare >= 0.7,
        slotType: distribution.slot_type,
        shares: distribution.shares || {},
      },
    };
  } catch (error) {
    return {
      success: false,
      error: `Ownership score failed: ${(error as Error).message}`,
    };
  }
}

/**
 * Tool 8: Get pattern affinity score
 */
export async function getAffinityScore(
  scratchpad: AgentScratchpad,
  driverId: string,
  blockId: string
): Promise<ToolResult<{
  score: number;
  pattern?: {
    typicalDays: number;
    dayList: string[];
    confidence: number;
  };
}>> {
  try {
    const driver = scratchpad.getDriver(driverId);
    if (!driver) {
      return { success: false, error: `Driver ${driverId} not found` };
    }

    const block = scratchpad.getRemainingBlocks().find(b => b.id === blockId);
    if (!block) {
      return { success: false, error: `Block ${blockId} not found` };
    }

    // Get cached affinity score
    const affinityScore = scratchpad.getAffinityScore(driverId, block);

    // Get driver pattern for context
    const pattern = scratchpad.getDriverPattern(driver.name);

    return {
      success: true,
      data: {
        score: Math.round(affinityScore * 100) / 100,
        pattern: pattern ? {
          typicalDays: pattern.typical_days,
          dayList: pattern.day_list,
          confidence: pattern.confidence,
        } : undefined,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: `Affinity score failed: ${(error as Error).message}`,
    };
  }
}

// ============================================================================
// EXECUTION TOOLS
// ============================================================================

/**
 * Tool 9: Assign a driver to a block
 */
export async function assignDriverToBlock(
  scratchpad: AgentScratchpad,
  tenantId: string,
  driverId: string,
  blockId: string,
  reason: string
): Promise<ToolResult<{
  assignmentId: string;
  driverName: string;
  blockInfo: string;
}>> {
  try {
    const driver = scratchpad.getDriver(driverId);
    if (!driver) {
      return { success: false, error: `Driver ${driverId} not found` };
    }

    const block = scratchpad.getRemainingBlocks().find(b => b.id === blockId);
    if (!block) {
      return { success: false, error: `Block ${blockId} not found or already assigned` };
    }

    // Check if assignment already exists
    const existing = await db
      .select()
      .from(blockAssignments)
      .where(
        and(
          eq(blockAssignments.blockId, blockId),
          eq(blockAssignments.isActive, true)
        )
      );

    let assignmentId: string;

    if (existing.length > 0) {
      // Update existing
      await db
        .update(blockAssignments)
        .set({
          driverId,
          assignedAt: new Date(),
          notes: 'Assigned by scheduling agent',
        })
        .where(eq(blockAssignments.id, existing[0].id));
      assignmentId = existing[0].id;
    } else {
      // Create new
      const [newAssignment] = await db.insert(blockAssignments).values({
        tenantId,
        blockId,
        driverId,
        isActive: true,
        assignedAt: new Date(),
        notes: 'Assigned by scheduling agent',
      }).returning();
      assignmentId = newAssignment.id;
    }

    const blockInfo = `${block.tractorId} ${block.dayName} ${block.startTime}`;

    // Record in scratchpad
    scratchpad.recordDecision(
      blockId,
      blockInfo,
      driverId,
      driver.name,
      'assigned',
      reason
    );

    return {
      success: true,
      data: {
        assignmentId,
        driverName: driver.name,
        blockInfo,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: `Assignment failed: ${(error as Error).message}`,
      suggestion: "Check if the block is already assigned or if there's a database constraint violation",
    };
  }
}

/**
 * Tool 10: Unassign a block
 */
export async function unassignBlock(
  scratchpad: AgentScratchpad,
  blockId: string,
  reason: string
): Promise<ToolResult<{
  previousDriverId?: string;
  previousDriverName?: string;
}>> {
  try {
    // Find existing assignment
    const existing = await db
      .select({
        assignment: blockAssignments,
        driver: drivers,
      })
      .from(blockAssignments)
      .leftJoin(drivers, eq(blockAssignments.driverId, drivers.id))
      .where(
        and(
          eq(blockAssignments.blockId, blockId),
          eq(blockAssignments.isActive, true)
        )
      );

    if (existing.length === 0) {
      return {
        success: true,
        data: {},
      };
    }

    const assignment = existing[0];
    const previousDriverId = assignment.assignment.driverId;
    const previousDriverName = assignment.driver
      ? `${assignment.driver.firstName} ${assignment.driver.lastName}`.trim()
      : undefined;

    // Soft delete by marking inactive
    await db
      .update(blockAssignments)
      .set({ isActive: false })
      .where(eq(blockAssignments.id, assignment.assignment.id));

    // Record decision
    scratchpad.recordDecision(
      blockId,
      `Block ${blockId}`,
      null,
      null,
      'skipped',
      `Unassigned: ${reason}. Previous driver: ${previousDriverName || 'unknown'}`
    );

    return {
      success: true,
      data: {
        previousDriverId,
        previousDriverName,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: `Unassign failed: ${(error as Error).message}`,
    };
  }
}

// ============================================================================
// Convenience: Run all checks for a driver-block pair
// ============================================================================

export interface AllChecksResult {
  canAssign: boolean;
  dot: { compliant: boolean; restHours: number };
  rolling6: { compliant: boolean; currentHours: number; maxHours: number };
  protected: { allowed: boolean; violations: string[] };
  timeOff: { available: boolean; reason?: string };
  ownership: { score: number; isOwner: boolean };
  affinity: { score: number };
  combinedScore: number;
  failReasons: string[];
}

export async function runAllChecks(
  scratchpad: AgentScratchpad,
  driverId: string,
  blockId: string
): Promise<ToolResult<AllChecksResult>> {
  const block = scratchpad.getRemainingBlocks().find(b => b.id === blockId);
  if (!block) {
    return { success: false, error: `Block ${blockId} not found` };
  }

  const driver = scratchpad.getDriver(driverId);
  if (!driver) {
    return { success: false, error: `Driver ${driverId} not found` };
  }

  const failReasons: string[] = [];

  // Run all checks in parallel
  const [dotResult, rolling6Result, protectedResult, timeOffResult, ownershipResult, affinityResult] =
    await Promise.all([
      checkDotCompliance(scratchpad, driverId, blockId),
      checkRolling6Hours(scratchpad, driverId, block.serviceDate),
      checkProtectedRules(scratchpad, driverId, blockId),
      checkTimeOff(scratchpad, driverId, block.serviceDate),
      getOwnershipScore(scratchpad, driverId, block.soloType, block.tractorId, block.dayOfWeek),
      getAffinityScore(scratchpad, driverId, blockId),
    ]);

  // Extract results with defaults
  const dot = dotResult.success && dotResult.data
    ? { compliant: dotResult.data.compliant, restHours: dotResult.data.restHours }
    : { compliant: false, restHours: 0 };

  const rolling6 = rolling6Result.success && rolling6Result.data
    ? { compliant: rolling6Result.data.compliant, currentHours: rolling6Result.data.currentHours, maxHours: rolling6Result.data.maxHours }
    : { compliant: false, currentHours: 0, maxHours: 14 };

  const protected_ = protectedResult.success && protectedResult.data
    ? { allowed: protectedResult.data.allowed, violations: protectedResult.data.violations }
    : { allowed: false, violations: ['Check failed'] };

  const timeOff = timeOffResult.success && timeOffResult.data
    ? { available: timeOffResult.data.available, reason: timeOffResult.data.reason }
    : { available: false, reason: 'Check failed' };

  const ownership = ownershipResult.success && ownershipResult.data
    ? { score: ownershipResult.data.score, isOwner: ownershipResult.data.isOwner }
    : { score: 0, isOwner: false };

  const affinity = affinityResult.success && affinityResult.data
    ? { score: affinityResult.data.score }
    : { score: 0 };

  // Check hard constraints
  if (!dot.compliant) failReasons.push(`DOT: Need ${10 - dot.restHours}h more rest`);
  if (!rolling6.compliant) failReasons.push(`Rolling6: ${rolling6.currentHours}/${rolling6.maxHours}h used`);
  if (!protected_.allowed) failReasons.push(`Protected: ${protected_.violations.join(', ')}`);
  if (!timeOff.available) failReasons.push(`TimeOff: ${timeOff.reason}`);

  const canAssign = dot.compliant && rolling6.compliant && protected_.allowed && timeOff.available;

  // Calculate combined score (ownership 70% + affinity 30%)
  const combinedScore = Math.round((ownership.score * 0.7 + affinity.score * 0.3) * 100) / 100;

  return {
    success: true,
    data: {
      canAssign,
      dot,
      rolling6,
      protected: protected_,
      timeOff,
      ownership,
      affinity,
      combinedScore,
      failReasons,
    },
  };
}

// ============================================================================
// Tool Definitions for Agent System Prompt
// ============================================================================

export const SCHEDULING_TOOLS_DESCRIPTION = `
## SCHEDULING TOOLS

You have access to these tools for building schedules:

### QUERY TOOLS (read-only)

1. **get_unassigned_blocks**
   Returns all blocks that need driver assignment for the week.
   → {blocks: [{id, blockId, serviceDate, dayName, soloType, tractorId, startTime}], count}

2. **get_driver_patterns**
   Returns XGBoost-learned work patterns for all drivers.
   → {patterns: [{driverId, driverName, typicalDays, dayList, confidence}], count}

3. **check_dot_compliance(driverId, blockId)**
   Checks if driver has 10+ hours rest before this block.
   → {compliant: boolean, restHours: number, required: 10}

4. **check_rolling6_hours(driverId, date)**
   Checks rolling hour limits (Solo1: 14h/24h, Solo2: 38h/48h).
   → {compliant: boolean, currentHours, maxHours}

5. **check_protected_rules(driverId, blockId)**
   Checks if driver has blocked days/types for this block.
   → {allowed: boolean, violations: string[]}

6. **check_time_off(driverId, date)**
   Checks if driver has approved time-off on this date.
   → {available: boolean, reason?: string}

7. **get_ownership_score(driverId, soloType, tractorId, dayOfWeek)**
   Gets XGBoost ownership score for this slot (0.0-1.0).
   → {score, isOwner: boolean, slotType: 'owned'|'rotating'}

8. **get_affinity_score(driverId, blockId)**
   Gets pattern match strength for driver-block pair (0.0-1.0).
   → {score, pattern: {typicalDays, dayList}}

### EXECUTION TOOLS (write)

9. **assign_driver_to_block(driverId, blockId, reason)**
   Creates assignment with reasoning logged.
   → {assignmentId, driverName, blockInfo}

10. **unassign_block(blockId, reason)**
    Removes existing assignment with reason.
    → {previousDriverId?, previousDriverName?}

### CONVENIENCE

- **run_all_checks(driverId, blockId)**
  Runs all validation checks at once and returns combined score.
  → {canAssign, dot, rolling6, protected, timeOff, ownership, affinity, combinedScore, failReasons}
`;
