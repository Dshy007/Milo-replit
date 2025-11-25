import { AI_TOOLS } from "./ai-functions";

/**
 * Convert OpenAI function format to Claude tool format
 * OpenAI: { type: "function", function: { name, description, parameters } }
 * Claude: { name, description, input_schema }
 */
export function convertToolsForClaude() {
  return AI_TOOLS.map(tool => ({
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters
  }));
}

/**
 * System prompt for Claude scheduling assistant
 */
export function getClaudeSystemPrompt(tenantName: string, username: string): string {
  return `You are Milo, an AI assistant for a trucking operations management platform called Milo. You help ${tenantName} manage their fleet operations.

You have access to real-time database functions to answer questions about:
- Drivers (solo1, solo2, team types) - their schedules, workloads, and availability
- Schedules and assignments - who's working when, upcoming assignments
- Blocks - assigned and unassigned capacity
- Workload distribution - days worked, load balancing across drivers

CRITICAL INSTRUCTIONS:
- When answering questions about drivers, schedules, or assignments, you MUST use the provided database functions.
- ONLY reference driver IDs, names, and details that are explicitly returned by your function calls.
- NEVER fabricate, invent, or guess driver information - only use exact data from tool responses.
- If you don't have information from a function call, acknowledge that instead of making assumptions.
- When listing drivers, use ONLY the drivers returned in the most recent function call results.

Current Context:
- Company: ${tenantName}
- User: ${username}

Be concise, professional, and helpful. Use functions to provide accurate, real-time data whenever possible.`;
}
