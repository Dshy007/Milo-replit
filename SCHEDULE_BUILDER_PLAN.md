# MILO Schedule Builder - Implementation Plan

## Overview

Build the missing middle piece: **Schedule Analysis & Fine-Tuning UI**

```
Current Flow:
  CSV Import → Block Reconstruction → [MISSING] → Executive Report

Target Flow:
  CSV Import → Block Reconstruction → SCHEDULE BUILDER → Executive Report
                                           ↓
                                    - Auto-assign drivers
                                    - Validate DOT compliance
                                    - Fine-tune/swap drivers
                                    - Audit workloads
                                    - Generate final report
```

---

## Phase 1: Driver Roster Data Structure

### 1.1 EXISTING Schema - What We Already Have!

**`drivers` table (schema.ts:37-59):**
```typescript
- id, tenantId, firstName, lastName
- status: "active" | "inactive" | "on_leave"
- domicile, loadEligible
// MISSING: soloType, maxWeeklyRuns, canonicalTime
```

**`driverAvailabilityPreferences` table (schema.ts:975-995) - THIS IS KEY:**
```typescript
- driverId
- blockType: "solo1" | "solo2" | "team"  // ← This IS soloType!
- startTime: "16:30", "20:30"            // ← This IS canonical time!
- dayOfWeek: "monday", "tuesday"         // ← This IS preferred days!
- isAvailable: boolean
```

**`protectedDriverRules` table** - Driver restrictions (no Fridays, etc.)
**`driverContractStats` table** - Historical assignment data

### 1.2 Decision: NO Schema Changes Needed!

We can derive everything from existing tables:
- `soloType` → From `driverAvailabilityPreferences.blockType`
- `canonicalTime` → Most frequent `startTime` from preferences
- `preferredDays` → Days where `isAvailable=true`
- `maxWeeklyRuns` → Default: 3 for Solo2, 6 for Solo1

### 1.3 API Endpoint Needed

**File:** `server/routes.ts` - new endpoint

```typescript
GET /api/drivers/scheduling-roster

// Joins drivers + driverAvailabilityPreferences
// Aggregates preferences into driver profile
// Returns structured data for schedule builder
```

### 1.4 Types File (types only, no hardcoded data)

**File:** `client/src/lib/driver-roster.ts`

```typescript
export interface DriverProfile {
  id: string;
  name: string;
  soloType: "solo1" | "solo2" | "both";
  preferredDays: string[];       // ["Sun", "Tue", "Thu"]
  canonicalTime: string;         // "21:30"
  maxWeeklyRuns: number;         // 3 for Solo2, 6 for Solo1
  reliabilityRating: number;     // 1-5 (can use assignment history)
  status: "active" | "standby" | "inactive";
}

// DOT rules - hardcoded (federal regulations don't change)
export const DOT_RULES = { ... }
```

### 1.2 DOT Compliance Rules Engine

**File:** `client/src/lib/dot-compliance.ts`

```typescript
// Rules from your prompt
DOT_RULES = {
  solo1: {
    blockDuration: 14,
    minRestBetweenShifts: 10,  // hours
    maxConsecutiveDays: 6,
    weeklyReset: 34,           // hours
    bumpTolerance: 2,          // hours (±2h from canonical)
    maxPerWeek: 6
  },
  solo2: {
    blockDuration: 38,
    minStartToStartGap: 48,    // hours - THE KEY RULE
    maxConsecutiveDays: 6,
    weeklyReset: 34,
    bumpTolerance: 2,
    maxPerWeek: 3
  }
}
```

---

## Phase 2: Auto-Assignment Algorithm

### 2.1 Matching Logic (Priority Order)

From your prompt's Phase 3:

```
FOR each unassigned block:
  1. EXACT MATCH: Same day + same time (±15 min)
  2. CLOSE MATCH: Same day + time within ±2 hours
  3. PATTERN MATCH: Driver's pattern day + compatible time
  4. CROSS-TRAINED: Check flex drivers
  5. STANDBY: Activate standby list
  6. FLAG: Mark as "NEEDS COVERAGE"
```

### 2.2 Constraint Verification

After EVERY assignment, verify:
- [ ] Solo2: 48h gap from last block START time
- [ ] Solo1: 10h rest from last block END time
- [ ] Driver under weekly maximum
- [ ] No 7th consecutive day
- [ ] 34h reset available if needed

---

## Phase 3: Schedule Builder UI Component

### 3.1 Main Component Structure

**File:** `client/src/components/ScheduleBuilder.tsx`

```
┌─────────────────────────────────────────────────────────────────┐
│  MILO SCHEDULE BUILDER - Week of Nov 30 - Dec 6, 2025          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ 87 Blocks    │  │ 85 Assigned  │  │ 2 Gaps       │          │
│  │ Total        │  │ (98%)        │  │ Need Cover   │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│                                                                 │
│  [Auto-Assign All]  [Validate DOT]  [Show Gaps]  [Fine-Tune]   │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  TABS: [By Day] [By Driver] [Conflicts] [Workload]             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  DAY VIEW (default):                                           │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ SUNDAY - Nov 30 (12 blocks)                             │   │
│  ├─────────────────────────────────────────────────────────┤   │
│  │ Solo1 (8 blocks)                                        │   │
│  │ ┌────────────┬─────────┬──────────────────┬───────────┐ │   │
│  │ │ Block ID   │ Time    │ Driver           │ Actions   │ │   │
│  │ ├────────────┼─────────┼──────────────────┼───────────┤ │   │
│  │ │ B-MB1SF0F64│ 00:30   │ Brian Worts    ▼ │ [Swap]    │ │   │
│  │ │ B-56WTV5R6S│ 01:30   │ R. Niederhauser▼ │ [Swap]    │ │   │
│  │ └────────────┴─────────┴──────────────────┴───────────┘ │   │
│  │                                                         │   │
│  │ Solo2 (4 blocks)                                        │   │
│  │ ┌────────────┬─────────┬──────────────────┬───────────┐ │   │
│  │ │ B-3K7KJZ031│ 15:30   │ AUSTIN FALL    ▼ │ [Swap]    │ │   │
│  │ └────────────┴─────────┴──────────────────┴───────────┘ │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  MONDAY - Dec 1 (13 blocks)                                    │
│  ...                                                           │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  COMPLIANCE PANEL (collapsible)                                │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ ✓ 10-Hour Rest: 100%    ✓ 48-Hour Gaps: 100%           │   │
│  │ ✓ Max 6 Days: 100%      ✓ Weekly Max: 100%             │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  WATCH LIST                                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ ⚠ ABSHIR HIRED - 3 Solo2 = MAX                         │   │
│  │ ⚠ Kwana Barber - 5 days (6th = OT)                     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│              [Generate Executive Report]  [Export to Relay]    │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Fine-Tuning Features

**Swap Modal:**
```
┌─────────────────────────────────────────────┐
│  SWAP DRIVER                                │
├─────────────────────────────────────────────┤
│  Block: B-5JZLZFKWK                         │
│  Day: Thursday 12/04                        │
│  Time: 18:30                                │
│  Current: Kwana Barber (5 runs this week)   │
│                                             │
│  Available Drivers:                         │
│  ○ Shalamar D Smith (2 runs) ← RECOMMENDED │
│  ○ Henry Calhoun (2 runs)                   │
│  ○ Brian Worts (3 runs)                     │
│                                             │
│  [Cancel]              [Confirm Swap]       │
└─────────────────────────────────────────────┘
```

**Quick Commands (Chat Integration):**
- "swap Kwana and Shalamar on Thursday"
- "who can cover Tuesday 18:30?"
- "show me Solo2 gaps"
- "move Raymond's Friday block to Saturday"

---

## Phase 4: Integration Points

### 4.1 Flow from ImportWizard

```
ImportWizard (reconstruct step)
    ↓
[Build Schedule] button (NEW)
    ↓
ScheduleBuilder modal opens
    ↓
Auto-assigns drivers using roster
    ↓
User fine-tunes
    ↓
[Generate Report] → ExecutiveReport
    ↓
[Import to Calendar] → Database
```

### 4.2 Data Flow

```typescript
// Input to ScheduleBuilder
interface ScheduleBuilderProps {
  blocks: ReconstructedBlock[];  // From Gemini reconstruction
  weekStart: Date;
  onComplete: (schedule: FinalSchedule) => void;
}

// Output from ScheduleBuilder
interface FinalSchedule {
  blocks: AssignedBlock[];       // Blocks with driver assignments
  compliance: ComplianceReport;  // DOT validation results
  workloads: DriverWorkload[];   // Driver utilization
  watchList: WatchItem[];        // Warnings/alerts
  gaps: UnassignedBlock[];       // Needs coverage
}
```

---

## Phase 5: Implementation Order

### Step 1: API Endpoint (server)
- `server/routes.ts` - Add `/api/drivers/scheduling-roster`
  - Join drivers + driverAvailabilityPreferences
  - Return aggregated driver profiles
  - No schema changes needed!

### Step 2: Types & DOT Rules (client)
- `client/src/lib/schedule-types.ts`
  - DriverProfile interface
  - DOT compliance rules (hardcoded - federal regs)
  - Block assignment types

### Step 3: Algorithm Layer (client)
- `client/src/lib/schedule-engine.ts`
  - Auto-assignment logic (match drivers to blocks)
  - Constraint validation (48h gaps, 10h rest, max days)
  - Gap detection
  - Swap validation

### Step 4: UI Layer (client)
- `client/src/components/ScheduleBuilder.tsx`
  - Main builder modal
  - Day view / Driver view tabs
  - Swap modal for fine-tuning
  - DOT compliance panel
  - Watch list

### Step 5: Integration (modify existing)
- `client/src/components/ImportWizard.tsx`
  - Add "Build Schedule" button after reconstruction
  - Open ScheduleBuilder modal
  - Connect to ExecutiveReport

---

## Phase 6: Key Features Matching Your Prompt

From MILO_SCHEDULE_BUILDER_PROMPT_v2.md:

| Feature | Implementation |
|---------|---------------|
| Parse CSV | Already done (Gemini reconstruction) |
| Week Intelligence Report | ScheduleBuilder header stats |
| PEAK/LOW DAY identification | Highlight in day view |
| Driver Profiles | API endpoint → from DB |
| Auto-Assignment | schedule-engine.ts |
| Constraint Verification | DOT compliance panel |
| Workload Matrix | Driver view tab |
| Optimization Moves | Swap recommendations |
| Watch List | Watch list panel |
| Standby Priority | Available in swap modal |
| Quick Commands | Chat integration (future) |
| Executive Report | Already built |

---

## Files to Create/Modify

### NEW FILES:
1. `client/src/lib/schedule-types.ts` - Types & DOT rules (~100 lines)
2. `client/src/lib/schedule-engine.ts` - Assignment algorithm (~350 lines)
3. `client/src/components/ScheduleBuilder.tsx` - Main UI (~700 lines)

### MODIFY:
4. `server/routes.ts` - Add scheduling roster endpoint (~50 lines)
5. `client/src/components/ImportWizard.tsx` - Add Build Schedule button (~30 lines)

---

## Estimated Complexity

| Component | Lines | Complexity |
|-----------|-------|------------|
| schedule-types.ts | ~100 | Low (types) |
| schedule-engine.ts | ~350 | Medium (logic) |
| ScheduleBuilder.tsx | ~700 | High (UI) |
| routes.ts (new endpoint) | ~50 | Low |
| ImportWizard changes | ~30 | Low |

**Total: ~1,230 lines of new code**

---

## Success Criteria

After implementation, user can:

1. Upload CSV → Reconstruct blocks (existing)
2. Click "Build Schedule"
3. See auto-assigned drivers based on roster/patterns
4. View compliance status (all green)
5. See watch list for drivers at max
6. Click any block to swap drivers
7. Fine-tune until satisfied
8. Generate Executive Report (existing)
9. Export to Amazon Relay

This matches the workflow you did manually with me for 2+ hours - now automated!

---

## Ready to Build?

Approve this plan and I'll implement in order:
1. driver-roster.ts (data)
2. schedule-engine.ts (algorithm)
3. ScheduleBuilder.tsx (UI)
4. ImportWizard integration
