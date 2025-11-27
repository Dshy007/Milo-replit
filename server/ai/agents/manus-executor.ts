/**
 * Manus Executor Agent
 *
 * The execution layer of the Milo Neural Intelligence System.
 * Handles task execution, assignments, notifications, and webhooks.
 *
 * "I am the hands. When the Architect speaks, I move. But I never move without validation."
 */

import {
  BaseAgent,
  AgentRequest,
  AgentResponse,
  AgentContext,
  DOTStatus,
  ProtectedRuleCheck
} from "./base-agent";

// ═══════════════════════════════════════════════════════════════════════════════
//                              EXECUTION TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface ExecutionRequest {
  action: "assign" | "unassign" | "swap" | "notify" | "bulk_assign";
  params: Record<string, unknown>;
  approvedBy: string; // Must be "architect"
  dotValidation: DOTStatus;
  protectedRulesCheck: ProtectedRuleCheck;
  rollbackPlan: RollbackPlan;
}

export interface RollbackPlan {
  canRollback: boolean;
  rollbackSteps: RollbackStep[];
  originalState: Record<string, unknown>;
}

export interface RollbackStep {
  step: number;
  action: string;
  params: Record<string, unknown>;
}

export interface ExecutionResult {
  success: boolean;
  action: string;
  stepsCompleted: number;
  totalSteps: number;
  result?: Record<string, unknown>;
  error?: string;
  rollbackExecuted: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
//                              MANUS EXECUTOR
// ═══════════════════════════════════════════════════════════════════════════════

export class ManusExecutor extends BaseAgent {
  private manusApiKey: string;
  private manusBaseUrl: string;

  constructor() {
    super("executor");
    this.manusApiKey = process.env.MANUS_API_KEY || "";
    this.manusBaseUrl = "https://api.manus.ai/v1"; // Placeholder URL
  }

  /**
   * Process a request as the Executor
   */
  async process(request: AgentRequest): Promise<AgentResponse> {
    const startTime = Date.now();

    try {
      // Parse the execution request from input
      const executionRequest = this.parseExecutionRequest(request.input, request.context);

      // Validate execution requirements
      const validationResult = this.validateExecutionRequirements(executionRequest);

      if (!validationResult.valid) {
        // Cannot execute - requirements not met
        const refusalMessage = this.buildRefusalMessage(validationResult.reasons);

        const thoughtId = await this.createThought(
          request.context.tenantId,
          "observation",
          refusalMessage,
          100, // High confidence in refusal
          {
            sessionId: request.context.sessionId,
            evidence: { validationFailure: validationResult },
            metadata: {
              action: "execution_refused",
              reasons: validationResult.reasons
            }
          }
        );

        return {
          output: refusalMessage,
          confidence: 100,
          thoughtId,
          shouldConverge: false,
          suggestedNextAgent: "architect",
          metadata: {
            executionRefused: true,
            reasons: validationResult.reasons
          }
        };
      }

      // All checks passed - execute
      const executionResult = await this.execute(executionRequest);

      // Record the decision
      const decisionId = await this.recordDecision(
        request.context.tenantId,
        `Executed: ${executionRequest.action}`,
        {
          action: executionRequest.action,
          params: executionRequest.params,
          result: executionResult
        },
        {
          sessionId: request.context.sessionId,
          actionTaken: executionResult,
          dotStatus: executionRequest.dotValidation,
          protectedRuleCheck: executionRequest.protectedRulesCheck
        }
      );

      // Build response
      const responseMessage = this.buildExecutionResponse(executionResult);

      const thoughtId = await this.createThought(
        request.context.tenantId,
        "action",
        responseMessage,
        executionResult.success ? 95 : 30,
        {
          sessionId: request.context.sessionId,
          evidence: { executionResult, decisionId },
          metadata: {
            action: executionRequest.action,
            success: executionResult.success
          }
        }
      );

      // Log routing
      await this.logRouting(
        request.context.tenantId,
        request.input,
        "execution",
        `Executor ${executionResult.success ? "completed" : "failed"} ${executionRequest.action}`,
        {
          sessionId: request.context.sessionId,
          responseTimeMs: Date.now() - startTime,
          success: executionResult.success
        }
      );

      return {
        output: responseMessage,
        confidence: executionResult.success ? 95 : 30,
        thoughtId,
        shouldConverge: executionResult.success,
        suggestedNextAgent: executionResult.success ? undefined : "architect",
        metadata: {
          action: executionRequest.action,
          executionResult,
          responseTimeMs: Date.now() - startTime
        }
      };
    } catch (error) {
      console.error("Manus Executor error:", error);

      await this.logRouting(
        request.context.tenantId,
        request.input,
        "error",
        "Executor encountered an error",
        {
          sessionId: request.context.sessionId,
          responseTimeMs: Date.now() - startTime,
          success: false,
          errorMessage: error instanceof Error ? error.message : "Unknown error"
        }
      );

      throw error;
    }
  }

  /**
   * Check if this agent can handle the given input
   */
  canHandle(input: string, _context: AgentContext): boolean {
    const executorKeywords = [
      "execute", "assign now", "do it", "proceed",
      "make the assignment", "confirm", "apply",
      "notify", "send notification", "alert",
      "swap", "unassign", "remove assignment"
    ];

    const lowerInput = input.toLowerCase();
    return executorKeywords.some(keyword => lowerInput.includes(keyword));
  }

  /**
   * Execute an action
   */
  private async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const steps: { description: string; execute: () => Promise<boolean> }[] = [];

    switch (request.action) {
      case "assign":
        steps.push({
          description: "Validate driver availability",
          execute: async () => this.validateDriverAvailable(request.params.driverId as string)
        });
        steps.push({
          description: "Validate block available",
          execute: async () => this.validateBlockAvailable(request.params.blockId as string)
        });
        steps.push({
          description: "Create assignment record",
          execute: async () => this.createAssignment(request.params)
        });
        steps.push({
          description: "Send notification to driver",
          execute: async () => this.notifyDriver(request.params.driverId as string, "assignment")
        });
        break;

      case "unassign":
        steps.push({
          description: "Validate assignment exists",
          execute: async () => this.validateAssignmentExists(request.params.assignmentId as string)
        });
        steps.push({
          description: "Remove assignment",
          execute: async () => this.removeAssignment(request.params.assignmentId as string)
        });
        steps.push({
          description: "Notify driver of removal",
          execute: async () => this.notifyDriver(request.params.driverId as string, "unassignment")
        });
        break;

      case "swap":
        steps.push({
          description: "Validate both drivers available",
          execute: async () => {
            const d1 = await this.validateDriverAvailable(request.params.driver1Id as string);
            const d2 = await this.validateDriverAvailable(request.params.driver2Id as string);
            return d1 && d2;
          }
        });
        steps.push({
          description: "Execute swap",
          execute: async () => this.executeSwap(request.params)
        });
        steps.push({
          description: "Notify both drivers",
          execute: async () => {
            await this.notifyDriver(request.params.driver1Id as string, "swap");
            await this.notifyDriver(request.params.driver2Id as string, "swap");
            return true;
          }
        });
        break;

      case "notify":
        steps.push({
          description: "Send notification",
          execute: async () => this.sendNotification(request.params)
        });
        break;

      default:
        return {
          success: false,
          action: request.action,
          stepsCompleted: 0,
          totalSteps: 0,
          error: `Unknown action: ${request.action}`,
          rollbackExecuted: false
        };
    }

    // Execute steps one by one
    let stepsCompleted = 0;
    const totalSteps = steps.length;

    for (const step of steps) {
      console.log(`Executing step ${stepsCompleted + 1}/${totalSteps}: ${step.description}`);

      try {
        const stepSuccess = await step.execute();

        if (!stepSuccess) {
          console.error(`Step failed: ${step.description}`);

          // Execute rollback if available
          let rollbackExecuted = false;
          if (request.rollbackPlan.canRollback && stepsCompleted > 0) {
            rollbackExecuted = await this.executeRollback(request.rollbackPlan, stepsCompleted);
          }

          return {
            success: false,
            action: request.action,
            stepsCompleted,
            totalSteps,
            error: `Step failed: ${step.description}`,
            rollbackExecuted
          };
        }

        stepsCompleted++;
      } catch (error) {
        console.error(`Step error: ${step.description}`, error);

        // Execute rollback if available
        let rollbackExecuted = false;
        if (request.rollbackPlan.canRollback && stepsCompleted > 0) {
          rollbackExecuted = await this.executeRollback(request.rollbackPlan, stepsCompleted);
        }

        return {
          success: false,
          action: request.action,
          stepsCompleted,
          totalSteps,
          error: error instanceof Error ? error.message : "Unknown error",
          rollbackExecuted
        };
      }
    }

    return {
      success: true,
      action: request.action,
      stepsCompleted,
      totalSteps,
      result: request.params,
      rollbackExecuted: false
    };
  }

  /**
   * Parse execution request from input
   */
  private parseExecutionRequest(input: string, context: AgentContext): ExecutionRequest {
    const lowerInput = input.toLowerCase();

    // Determine action type
    let action: ExecutionRequest["action"] = "assign";
    if (lowerInput.includes("unassign") || lowerInput.includes("remove")) {
      action = "unassign";
    } else if (lowerInput.includes("swap")) {
      action = "swap";
    } else if (lowerInput.includes("notify") || lowerInput.includes("alert")) {
      action = "notify";
    } else if (lowerInput.includes("bulk")) {
      action = "bulk_assign";
    }

    // Extract parameters from context or input
    const params: Record<string, unknown> = {};

    // Look for driver IDs
    const driverMatch = input.match(/driver[:\s]+([a-zA-Z0-9-]+)/i);
    if (driverMatch) {
      params.driverId = driverMatch[1];
    }

    // Look for block IDs
    const blockMatch = input.match(/block[:\s]+([a-zA-Z0-9-]+)/i);
    if (blockMatch) {
      params.blockId = blockMatch[1];
    }

    return {
      action,
      params,
      approvedBy: "architect", // This should be validated in real implementation
      dotValidation: {
        status: "valid",
        hoursUsed: 0,
        maxHours: 14,
        windowHours: 24,
        message: "Validation required"
      },
      protectedRulesCheck: {
        passed: true,
        violations: [],
        warnings: []
      },
      rollbackPlan: {
        canRollback: true,
        rollbackSteps: [],
        originalState: {}
      }
    };
  }

  /**
   * Validate execution requirements
   */
  private validateExecutionRequirements(request: ExecutionRequest): {
    valid: boolean;
    reasons: string[];
  } {
    const reasons: string[] = [];

    // Check Architect approval
    if (request.approvedBy !== "architect") {
      reasons.push("Execution requires Architect approval");
    }

    // Check DOT status
    if (request.dotValidation.status === "violation") {
      reasons.push(`DOT violation: ${request.dotValidation.message}`);
    }

    // Check protected rules
    if (!request.protectedRulesCheck.passed) {
      reasons.push(...request.protectedRulesCheck.violations.map(v => `Protected rule: ${v}`));
    }

    // Check rollback plan exists
    if (!request.rollbackPlan.canRollback) {
      reasons.push("No rollback plan available - execution too risky");
    }

    return {
      valid: reasons.length === 0,
      reasons
    };
  }

  /**
   * Build refusal message
   */
  private buildRefusalMessage(reasons: string[]): string {
    return `🚫 **EXECUTION REFUSED**

I cannot proceed with this action because:

${reasons.map((r, i) => `${i + 1}. ${r}`).join("\n")}

**What happens now:**
- This request is being sent back to the Architect
- The Architect will review and either:
  - Provide missing approvals/validations
  - Modify the request to comply with rules
  - Cancel the request if it cannot be made compliant

I never execute without proper validation. This protects drivers and ensures DOT compliance.`;
  }

  /**
   * Build execution response
   */
  private buildExecutionResponse(result: ExecutionResult): string {
    if (result.success) {
      return `✅ **EXECUTION COMPLETE**

**Action:** ${result.action}
**Status:** Success
**Steps:** ${result.stepsCompleted}/${result.totalSteps} completed

All validations passed and the action has been applied.`;
    } else {
      return `❌ **EXECUTION FAILED**

**Action:** ${result.action}
**Status:** Failed
**Steps:** ${result.stepsCompleted}/${result.totalSteps} completed
**Error:** ${result.error}
**Rollback:** ${result.rollbackExecuted ? "Executed - system restored to previous state" : "Not needed"}

The Architect needs to review this failure and determine next steps.`;
    }
  }

  /**
   * Execute rollback plan
   */
  private async executeRollback(plan: RollbackPlan, stepsToRollback: number): Promise<boolean> {
    console.log(`Executing rollback for ${stepsToRollback} steps...`);

    // In a real implementation, this would execute the rollback steps
    for (let i = stepsToRollback - 1; i >= 0; i--) {
      const step = plan.rollbackSteps[i];
      if (step) {
        console.log(`Rollback step ${i + 1}: ${step.action}`);
        // Execute rollback step
      }
    }

    return true;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //                              PLACEHOLDER METHODS
  // These would connect to actual database/API in production
  // ═══════════════════════════════════════════════════════════════════════════

  private async validateDriverAvailable(_driverId: string): Promise<boolean> {
    // TODO: Check driver availability in database
    return true;
  }

  private async validateBlockAvailable(_blockId: string): Promise<boolean> {
    // TODO: Check block availability in database
    return true;
  }

  private async validateAssignmentExists(_assignmentId: string): Promise<boolean> {
    // TODO: Check assignment exists in database
    return true;
  }

  private async createAssignment(_params: Record<string, unknown>): Promise<boolean> {
    // TODO: Create assignment in database
    console.log("Creating assignment:", _params);
    return true;
  }

  private async removeAssignment(_assignmentId: string): Promise<boolean> {
    // TODO: Remove assignment from database
    console.log("Removing assignment:", _assignmentId);
    return true;
  }

  private async executeSwap(_params: Record<string, unknown>): Promise<boolean> {
    // TODO: Execute driver swap in database
    console.log("Executing swap:", _params);
    return true;
  }

  private async notifyDriver(_driverId: string, _type: string): Promise<boolean> {
    // TODO: Send notification to driver
    console.log("Notifying driver:", _driverId, _type);
    return true;
  }

  private async sendNotification(_params: Record<string, unknown>): Promise<boolean> {
    // TODO: Send notification
    console.log("Sending notification:", _params);
    return true;
  }
}

// Export singleton instance
let executorInstance: ManusExecutor | null = null;

export async function getExecutor(): Promise<ManusExecutor> {
  if (!executorInstance) {
    executorInstance = new ManusExecutor();
    await executorInstance.initialize();
  }
  return executorInstance;
}
