# Driver DNA: AI-Powered Schedule Intelligence

## Overview

Transform the "Special Requests" area into a premium **"Driver DNA"** (or "Schedule Intelligence") feature that uses AI to automatically build driver preference profiles from historical data.

### Key Insight
~80% of drivers run the same routes consistently. Instead of manually entering preferences, AI analyzes weeks of historical assignments to infer each driver's "schedule DNA."

---

## Architecture

### Phase 1: Historical Pattern Extraction

**Data Sources (already available):**
- `shiftOccurrences` table - All historical driver-block assignments
- `blockAssignments` table - Assignment records with timestamps
- `assignmentPatterns` table - Already has weighted pattern data (12-week window)

**New Component: `GeminiProfileSynthesizer`**

```
server/ai/agents/gemini-profiler.ts
```

Uses Gemini (free tier, `gemini-1.5-flash`) to:
1. Analyze week-by-week assignment data starting from late October
2. Synthesize natural language "driver profiles"
3. Extract structured preferences from patterns

**Example Output:**
```json
{
  "driverId": "D123",
  "driverName": "Maria Santos",
  "dnaProfile": {
    "typicalSchedule": "Sun-Wed pattern, primarily morning Solo1 blocks",
    "preferredDays": ["sunday", "monday", "tuesday", "wednesday"],
    "preferredTimes": ["04:00", "04:30", "05:00"],
    "preferredTractors": ["Tractor_3", "Tractor_5"],
    "contractType": "solo1",
    "consistency": 0.87,
    "homeBlocks": ["B-00000012", "B-00000015"]
  },
  "insights": [
    "Has worked Tractor_3 on Sundays for 8 consecutive weeks",
    "Never scheduled after 07:00 start time",
    "Prefers MKC domicile routes"
  ],
  "aiSummary": "Maria is a highly consistent Solo1 driver who prefers early morning shifts (4-5 AM) on the Sun-Wed pattern. She has a strong affinity for Tractor_3 and rarely deviates from her established routine.",
  "lastAnalyzed": "2024-12-01T00:00:00Z",
  "confidence": 0.92
}
```

---

### Phase 2: Database Schema

**New Table: `driver_dna_profiles`**

```sql
CREATE TABLE driver_dna_profiles (
  id VARCHAR PRIMARY KEY,
  tenant_id VARCHAR NOT NULL REFERENCES tenants(id),
  driver_id VARCHAR NOT NULL REFERENCES drivers(id),

  -- Structured preferences (inferred from AI)
  preferred_days TEXT[], -- ['sunday', 'monday', 'tuesday', 'wednesday']
  preferred_start_times TEXT[], -- ['04:00', '04:30']
  preferred_tractors TEXT[], -- ['Tractor_3', 'Tractor_5']
  preferred_contract_type TEXT, -- 'solo1', 'solo2', 'team'
  home_blocks TEXT[], -- Block IDs driver consistently runs

  -- Pattern metrics
  consistency_score DECIMAL(5,4), -- 0.0 to 1.0
  pattern_group TEXT, -- 'sunWed', 'wedSat', 'mixed'
  weeks_analyzed INTEGER,
  assignments_analyzed INTEGER,

  -- AI-generated content
  ai_summary TEXT, -- Natural language summary from Gemini
  insights JSONB, -- Array of insight strings

  -- Metadata
  analysis_start_date DATE,
  analysis_end_date DATE,
  last_analyzed_at TIMESTAMP,
  analysis_version INTEGER DEFAULT 1,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(tenant_id, driver_id)
);
```

---

### Phase 3: API Endpoints

```typescript
// POST /api/driver-dna/analyze
// Trigger AI analysis for all drivers (or specific driver)
{
  "driverId": "optional-specific-driver",
  "startDate": "2024-10-27", // Late October
  "endDate": "2024-12-01"
}

// GET /api/driver-dna/:driverId
// Get DNA profile for a specific driver

// GET /api/driver-dna
// Get all DNA profiles with summary stats

// POST /api/driver-dna/refresh
// Re-run analysis with latest data

// GET /api/driver-dna/insights
// Get aggregated insights across all drivers
```

---

### Phase 4: UI/UX Design

**Rename: "Special Requests" → "Schedule Intelligence"**

#### Main Dashboard View

```
┌─────────────────────────────────────────────────────────────┐
│  SCHEDULE INTELLIGENCE                          [Analyze]   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  📊 FLEET OVERVIEW                                   │   │
│  │  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   │   │
│  │  45 Drivers Analyzed  |  87% Avg Consistency        │   │
│  │  12 Weeks of Data     |  1,247 Assignments          │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐        │
│  │ 🧬 Sun-Wed   │ │ 🧬 Wed-Sat   │ │ 🔄 Flexible  │        │
│  │ Pattern      │ │ Pattern      │ │ Drivers      │        │
│  │ 23 drivers   │ │ 18 drivers   │ │ 4 drivers    │        │
│  └──────────────┘ └──────────────┘ └──────────────┘        │
│                                                             │
│  DRIVER DNA CARDS                               [View All]  │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  🧬 Maria Santos                    92% Consistent  │   │
│  │  ─────────────────────────────────────────────────  │   │
│  │  📅 Sun-Wed Pattern  |  🕐 4-5 AM  |  🚛 Tractor_3  │   │
│  │                                                      │   │
│  │  "Highly reliable Solo1 driver. Prefers early       │   │
│  │   morning shifts and has worked Tractor_3 for       │   │
│  │   8 consecutive weeks."                             │   │
│  │                                                      │   │
│  │  [View Full Profile] [Override] [Time Off]          │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  🧬 John Davis                      78% Consistent  │   │
│  │  ─────────────────────────────────────────────────  │   │
│  │  📅 Wed-Sat Pattern  |  🕐 5-6 PM  |  🚛 Mixed      │   │
│  │                                                      │   │
│  │  "Flexible Solo2 driver who alternates between      │   │
│  │   Tractors 1 and 4. Good for covering gaps."        │   │
│  │                                                      │   │
│  │  [View Full Profile] [Override] [Time Off]          │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### Driver Detail View

```
┌─────────────────────────────────────────────────────────────┐
│  ← Back                                                     │
│                                                             │
│  🧬 MARIA SANTOS                                            │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  AI SUMMARY                                         │   │
│  │  ───────────────────────────────────────────────    │   │
│  │  Maria is a highly consistent Solo1 driver who      │   │
│  │  prefers early morning shifts (4-5 AM) on the       │   │
│  │  Sun-Wed pattern. She has a strong affinity for     │   │
│  │  Tractor_3 and rarely deviates from her routine.    │   │
│  │                                                      │   │
│  │  Confidence: ████████████░░░░ 92%                   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  SCHEDULE DNA                                               │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│                                                             │
│  ┌─────────┬─────────┬─────────┬─────────┬─────────┐       │
│  │   Sun   │   Mon   │   Tue   │   Wed   │   Thu   │ ...   │
│  ├─────────┼─────────┼─────────┼─────────┼─────────┤       │
│  │ ████    │ ████    │ ████    │ ████    │ ░░░░    │       │
│  │ 04:00   │ 04:30   │ 04:00   │ 04:30   │  off    │       │
│  └─────────┴─────────┴─────────┴─────────┴─────────┘       │
│                                                             │
│  KEY INSIGHTS                                               │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│  • Has worked Tractor_3 on Sundays for 8 consecutive weeks │
│  • Never scheduled after 07:00 start time                  │
│  • Prefers MKC domicile routes                             │
│  • 95% on-time rate over last 12 weeks                     │
│                                                             │
│  PREFERENCES (Editable)                    [Edit] [Reset]   │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│  Preferred Days:     ☑ Sun ☑ Mon ☑ Tue ☑ Wed ☐ Thu ☐ Fri  │
│  Start Time Window:  [04:00 ▼] to [06:00 ▼]                │
│  Preferred Tractors: [Tractor_3 ▼] [Add...]                │
│  Contract Type:      ● Solo1  ○ Solo2  ○ Team              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

### Phase 5: Integration with Auto-Build

**Feed DNA into assignment predictions:**

```typescript
// In auto-build-engine.ts, before scoring drivers:
const dnaProfile = await getDriverDNAProfile(tenantId, driverId);

if (dnaProfile) {
  // Boost score if block matches driver's DNA
  if (dnaProfile.preferredDays.includes(blockDayOfWeek)) {
    score += 0.15; // 15% boost for preferred day
  }
  if (dnaProfile.preferredTractors.includes(block.tractorId)) {
    score += 0.20; // 20% boost for preferred tractor
  }
  if (dnaProfile.preferredStartTimes.some(t => isWithinWindow(blockStart, t))) {
    score += 0.10; // 10% boost for preferred time
  }
}
```

---

### Phase 6: Gemini Integration Details

**File: `server/ai/agents/gemini-profiler.ts`**

```typescript
import { GoogleGenerativeAI } from "@google/generative-ai";

export class GeminiProfiler {
  private client: GoogleGenerativeAI;
  private model: any;

  constructor() {
    this.client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
    this.model = this.client.getGenerativeModel({
      model: "gemini-1.5-flash" // Free tier
    });
  }

  async analyzeDriverHistory(driverId: string, assignments: Assignment[]): Promise<DNAProfile> {
    const prompt = `
      Analyze this driver's assignment history and generate a preference profile.

      Driver ID: ${driverId}
      Assignment History (last 12 weeks):
      ${formatAssignmentsForAI(assignments)}

      Generate:
      1. A natural language summary (2-3 sentences)
      2. Pattern identification (Sun-Wed, Wed-Sat, or mixed)
      3. Key insights (3-5 bullet points)
      4. Preferred schedule windows
      5. Consistency score (0-100%)

      Return as JSON.
    `;

    const result = await this.model.generateContent(prompt);
    return parseGeminiResponse(result.response.text());
  }
}
```

---

## Implementation Steps

1. **Database Migration**
   - Add `driver_dna_profiles` table
   - Add indexes for efficient querying

2. **Backend Services**
   - Create `GeminiProfiler` agent
   - Add DNA profile API endpoints
   - Integrate with existing pattern engine

3. **Analysis Pipeline**
   - Build week-by-week data aggregator
   - Connect to `shiftOccurrences` table
   - Implement batch processing for all drivers

4. **Frontend Components**
   - Rename SpecialRequests → ScheduleIntelligence
   - Build DNA dashboard UI
   - Create driver profile cards
   - Add edit/override functionality

5. **Auto-Build Integration**
   - Modify scoring algorithm to use DNA
   - Add DNA-based recommendations

---

## Timeline

| Phase | Description | Files |
|-------|-------------|-------|
| 1 | Database schema + migration | `shared/schema.ts`, `migrations/` |
| 2 | Gemini Profiler agent | `server/ai/agents/gemini-profiler.ts` |
| 3 | API endpoints | `server/routes.ts` |
| 4 | Analysis pipeline | `server/dna-analyzer.ts` |
| 5 | Frontend dashboard | `client/src/pages/ScheduleIntelligence.tsx` |
| 6 | Auto-Build integration | `server/auto-build-engine.ts` |

---

## Premium Features

- **DNA Insights Dashboard** - Fleet-wide pattern visualization
- **Consistency Alerts** - Notify when driver deviates from pattern
- **Predictive Scheduling** - "This driver will likely want Sunday off"
- **Conflict Detection** - "This assignment breaks Maria's typical pattern"
- **Natural Language Queries** - "Who usually runs early Sunday Solo1?"
