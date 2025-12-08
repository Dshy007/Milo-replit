# Plan: Integrate Claude Intelligence into Schedule Matching

## Problem Statement

The Gemini-based scheduler has two issues:
1. **API quota exhausted** - Both `gemini-2.0-flash-exp` and `gemini-1.5-flash` hit rate limits
2. **Not using DNA data** - The scheduler fetches `preferredDays`, `preferredStartTimes` from database but doesn't include them in the Gemini prompt

You want Claude's pattern recognition intelligence integrated into the website for schedule matching.

---

## Research Findings

### GitHub Libraries Found

| Library | LLM | Relevant? | Notes |
|---------|-----|-----------|-------|
| [claude-flow](https://github.com/ruvnet/claude-flow) | Claude | ✅ Yes | Multi-agent swarms with semantic vector search, pattern memory |
| [anthropic-cookbook](https://github.com/anthropics/anthropic-cookbook) | Claude | ✅ Yes | Orchestrator-Workers pattern for multi-perspective analysis |
| [data-analysis-llm-agent](https://github.com/crazycloud/data-analysis-llm-agent) | GPT-3.5 | ❌ No | Database querying but no historical pattern matching |
| [Time-LLM](https://github.com/KimMeen/Time-LLM) | Various | ⚠️ Partial | Time series forecasting, but research-focused, not production-ready |

### Best Option: Direct Claude API with Tool Use

None of the pre-built libraries do exactly what you need. However, using the **Anthropic SDK with Tool Use** gives us:
- Claude's pattern recognition ability
- Database query tools
- Structured output (JSON)
- No quota issues with paid API key

---

## Proposed Architecture

### Option A: Replace Gemini with Claude (Recommended)

Replace `gemini-scheduler.ts` with `claude-scheduler.ts`:

```
┌─────────────────────────────────────────────────────────────┐
│                    Claude Scheduler                          │
├─────────────────────────────────────────────────────────────┤
│  1. Fetch Data                                               │
│     - Drivers + DNA profiles (preferredDays, preferredTimes)│
│     - Unassigned blocks for the week                        │
│     - 8-week slot history                                    │
├─────────────────────────────────────────────────────────────┤
│  2. Build Context Prompt                                     │
│     - Driver preferences from DNA profiles                  │
│     - Historical patterns per driver                        │
│     - Blocks needing assignment                             │
├─────────────────────────────────────────────────────────────┤
│  3. Claude API Call with Structured Output                   │
│     - Returns JSON array of {blockId, driverId, reason}     │
│     - Uses claude-3-5-sonnet or claude-3-haiku              │
├─────────────────────────────────────────────────────────────┤
│  4. Apply Assignments                                        │
│     - Same as existing apply endpoint                       │
└─────────────────────────────────────────────────────────────┘
```

### Option B: Hybrid (Claude Analysis + OR-Tools Optimization)

Use Claude to analyze patterns and generate preferences, then OR-Tools solves:

```
Claude analyzes → OR-Tools optimizes
      ↓                  ↓
  "Driver X prefers    Uses scores to
   Mon 16:30 (8x)"     maximize fit
```

---

## Implementation Steps

### Step 1: Add Anthropic SDK
```bash
npm install @anthropic-ai/sdk
```

### Step 2: Create `server/claude-scheduler.ts`

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { db } from "./db";
import { drivers, blocks, driverDnaProfiles, blockAssignments } from "@shared/schema";

class ClaudeScheduler {
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    });
  }

  async optimizeWeek(weekStart: Date, contractTypeFilter?: string) {
    // 1. Fetch drivers with DNA profiles (INCLUDING preferences)
    const driversWithDna = await this.getDriversWithPreferences();

    // 2. Fetch unassigned blocks
    const unassignedBlocks = await this.getUnassignedBlocks(weekStart);

    // 3. Fetch 8-week slot history
    const slotHistory = await this.get8WeekHistory(weekStart);

    // 4. Build prompt with ALL the data
    const prompt = this.buildPrompt(driversWithDna, unassignedBlocks, slotHistory);

    // 5. Call Claude with structured output
    const response = await this.client.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }]
    });

    // 6. Parse and return assignments
    return this.parseAssignments(response);
  }

  private buildPrompt(drivers, blocks, history) {
    return `You are a scheduling optimizer for trucking operations.

## DRIVERS (with DNA preferences):
${drivers.map(d => `
- ${d.name} (${d.contractType})
  Preferred Days: ${d.preferredDays.join(", ") || "none"}
  Preferred Start Time: ${d.preferredStartTime || "none"}
  Historical slots: ${history[d.id] || "new driver"}
`).join("\n")}

## BLOCKS TO ASSIGN:
${blocks.map(b => `- ${b.id}: ${b.day} ${b.time} (${b.contractType})`).join("\n")}

## RULES:
1. Match contract types: solo1 drivers → solo1 blocks only
2. Prioritize drivers' preferred days and times from DNA profiles
3. Secondary: assign to slots they've historically worked
4. Each driver can only work ONE block per day
5. Fair distribution: try to give each driver similar number of days

Return JSON array:
[{"blockId": "...", "driverId": "...", "reason": "preferred day + historical"}]`;
  }
}
```

### Step 3: Add Route `/api/matching/claude`

Wire up the new scheduler to the existing button.

### Step 4: Update UI (Optional)

Change button text from "Auto-Match with Gemini" to "Auto-Match with Claude" or make it configurable.

---

## Cost Comparison

| Model | Cost per 1K tokens | Estimate per week match |
|-------|-------------------|------------------------|
| Claude 3.5 Sonnet | $3/$15 (in/out) | ~$0.10-0.20 |
| Claude 3 Haiku | $0.25/$1.25 | ~$0.01-0.02 |
| Gemini 1.5 Flash | Free tier exhausted | N/A |

---

## Environment Setup Required

Add to `.env`:
```
ANTHROPIC_API_KEY=sk-ant-api03-...
```

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `server/claude-scheduler.ts` | CREATE - New Claude-based scheduler |
| `server/routes.ts` | MODIFY - Add `/api/matching/claude` route |
| `client/src/components/DriverPoolSidebar.tsx` | MODIFY - Update endpoint from `/gemini` to `/claude` |
| `.env` | MODIFY - Add `ANTHROPIC_API_KEY` |

---

## Decision Needed

Do you have an **Anthropic API key**?

- **If YES**: Proceed with Claude integration
- **If NO**:
  - Option 1: Get an API key from [console.anthropic.com](https://console.anthropic.com)
  - Option 2: Use the existing OR-Tools solver (already built, no API needed, deterministic)
