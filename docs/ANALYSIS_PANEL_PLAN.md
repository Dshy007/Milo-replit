# Milo Analysis Panel Integration Plan

## Overview

Replace the standalone ScheduleBuilder modal with an integrated Analysis Panel on the Schedules page. This panel will unify all 3 Python agents and provide a streamlined workflow.

---

## Current State (What We Have)

### Working Components:
- **CSV Import** → ImportWizard.tsx → Blocks appear on calendar
- **Calendar Display** → Schedules.tsx → RED/YELLOW/GREEN blocks
- **Python ML** → assignment_predictor.py → Working via python-bridge.ts
- **ScheduleBuilder** → Standalone modal (opens after import)
- **"Analyze Now" button** → Only does compliance checking

### Problems:
1. ScheduleBuilder is disconnected from main workflow
2. "Analyze Now" doesn't use Python ML agents
3. No coverage analysis in UI
4. User has to click extra button after import to open ScheduleBuilder

---

## Target State (3-Phase Architecture)

### Phase 1: Import & Display (COMPLETE)
```
CSV Upload → Reconstruct → Import → Calendar Display
                                         ↓
                              RED = Rejected
                              YELLOW = Unassigned
                              GREEN = Assigned
```

### Phase 2: Analysis Panel (THIS PHASE)
```
Schedules Page
├── Calendar Grid (existing)
├── [Analyze] Button → Opens Analysis Panel (slide-out or collapsible)
│   ├── Tab 1: Coverage Analysis (Python)
│   │   - % coverage for week
│   │   - Gap list (unfilled blocks)
│   │   - Recommendations
│   │
│   ├── Tab 2: Assignment Suggestions (Python ML)
│   │   - List YELLOW blocks
│   │   - Top 3 driver recommendations per block
│   │   - One-click assign button
│   │   - Confidence scores
│   │
│   └── Tab 3: Compliance (TypeScript)
│       - DOT violations
│       - Bump warnings
│       - Hours-of-service issues
```

### Phase 3: AI Assistant (FUTURE)
```
Chat interface for natural language queries:
- "Show me Solo2 coverage for next week"
- "Which drivers are available Friday?"
- "Auto-assign all unassigned blocks"
```

---

## Implementation Steps

### Step 1: Remove ScheduleBuilder from ImportWizard
**File:** `client/src/components/ImportWizard.tsx`

**Changes:**
- Remove "Schedule Builder" button from import success screen
- Keep only "Done" and "View Calendar" buttons
- Remove ScheduleBuilder Dialog component

**Why:** Users should analyze from the Schedules page, not from import modal

---

### Step 2: Create Analysis Panel Component
**New File:** `client/src/components/AnalysisPanel.tsx`

**Structure:**
```tsx
interface AnalysisPanelProps {
  weekStart: Date;
  weekEnd: Date;
  blocks: ShiftOccurrence[];
  onAssignDriver: (blockId: string, driverId: string) => void;
  onClose: () => void;
}

function AnalysisPanel({ weekStart, weekEnd, blocks, onAssignDriver, onClose }) {
  const [activeTab, setActiveTab] = useState<'coverage' | 'assignments' | 'compliance'>('coverage');

  return (
    <div className="analysis-panel slide-out-right">
      <Tabs value={activeTab}>
        <TabsList>
          <TabsTrigger value="coverage">Coverage</TabsTrigger>
          <TabsTrigger value="assignments">Assignments</TabsTrigger>
          <TabsTrigger value="compliance">Compliance</TabsTrigger>
        </TabsList>

        <TabsContent value="coverage">
          <CoverageAnalysis weekStart={weekStart} weekEnd={weekEnd} />
        </TabsContent>

        <TabsContent value="assignments">
          <AssignmentSuggestions
            blocks={blocks.filter(b => !b.driverId)}
            onAssign={onAssignDriver}
          />
        </TabsContent>

        <TabsContent value="compliance">
          <ComplianceReport blocks={blocks} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

---

### Step 3: Add Coverage Analysis Tab
**New File:** `client/src/components/analysis/CoverageAnalysis.tsx`

**API Call:**
```tsx
POST /api/analysis/coverage
Body: {
  weekStart: "2025-11-30",
  weekEnd: "2025-12-06"
}

Response: {
  coverage_percentage: 85.5,
  total_slots: 73,
  filled_slots: 62,
  gaps: [
    { block_id: "B-XXX", date: "2025-12-01", contract_type: "solo2", priority: "high" }
  ],
  recommendations: ["11 unfilled blocks - review driver availability"]
}
```

**UI:**
- Large percentage display (85% coverage)
- Progress bar visual
- Gap list with clickable items
- Quick-assign buttons

---

### Step 4: Add Assignment Suggestions Tab
**New File:** `client/src/components/analysis/AssignmentSuggestions.tsx`

**API Call:**
```tsx
POST /api/analysis/predict-assignments
Body: {
  blocks: [{ blockId, contractType, shiftStart, shiftEnd }],
  drivers: [{ id, name, type }]
}

Response: {
  recommendations: [{
    block_id: "B-XXX",
    recommendations: [
      { driver_id: "123", driver_name: "John", score: 0.85, reasons: ["Contract match", "Available"] },
      { driver_id: "456", driver_name: "Jane", score: 0.72, reasons: ["Available"] }
    ]
  }]
}
```

**UI:**
- List of YELLOW blocks needing assignment
- Each block shows top 3 driver recommendations
- Confidence score badges (85% = green, 60% = yellow)
- "Assign" button per recommendation
- "Auto-Assign All" bulk button

---

### Step 5: Migrate Compliance Tab
**Reuse from existing:** `Schedules.tsx` handleAnalyzeCompliance

**Move to:** `client/src/components/analysis/ComplianceReport.tsx`

**Features:**
- DOT violations list
- Bump warnings (time drift from canonical)
- Driver-specific issues
- Severity badges

---

### Step 6: Integrate Panel into Schedules.tsx
**File:** `client/src/pages/Schedules.tsx`

**Changes:**
```tsx
// Add state
const [showAnalysisPanel, setShowAnalysisPanel] = useState(false);

// Replace "Analyze Now" button
<Button onClick={() => setShowAnalysisPanel(true)}>
  <BarChart className="w-4 h-4 mr-2" />
  Analyze
</Button>

// Add panel (slide-out from right)
{showAnalysisPanel && (
  <AnalysisPanel
    weekStart={weekStart}
    weekEnd={weekEnd}
    blocks={calendarData.occurrences}
    onAssignDriver={handleAssignDriver}
    onClose={() => setShowAnalysisPanel(false)}
  />
)}
```

---

### Step 7: Wire Up Driver Assignment
**Function in Schedules.tsx:**
```tsx
const handleAssignDriver = async (blockId: string, driverId: string) => {
  await fetch(`/api/shift-occurrences/${blockId}/assignment`, {
    method: 'PATCH',
    body: JSON.stringify({ driverId })
  });
  refetchCalendar(); // Refresh to show GREEN
};
```

---

## File Changes Summary

| File | Action | Changes |
|------|--------|---------|
| `ImportWizard.tsx` | MODIFY | Remove ScheduleBuilder button & dialog |
| `AnalysisPanel.tsx` | CREATE | Main panel container with tabs |
| `analysis/CoverageAnalysis.tsx` | CREATE | Coverage tab UI |
| `analysis/AssignmentSuggestions.tsx` | CREATE | ML suggestions UI |
| `analysis/ComplianceReport.tsx` | CREATE | Compliance tab (migrated) |
| `Schedules.tsx` | MODIFY | Add panel toggle, integrate |
| `ScheduleBuilder.tsx` | DEPRECATE | Keep for reference, may remove later |

---

## API Endpoints Used

| Endpoint | Python Agent | Purpose |
|----------|--------------|---------|
| `POST /api/analysis/coverage` | assignment_predictor.py | Get coverage % and gaps |
| `POST /api/analysis/predict-assignments` | assignment_predictor.py | Get driver suggestions |
| `POST /api/schedules/analyze-compliance` | TypeScript | DOT compliance check |
| `PATCH /api/shift-occurrences/:id/assignment` | N/A | Assign driver to block |

---

## UI/UX Design

### Analysis Panel Layout:
```
┌─────────────────────────────────────────────┐
│ Analysis Panel                         [X]  │
├─────────────────────────────────────────────┤
│ [Coverage] [Assignments] [Compliance]       │
├─────────────────────────────────────────────┤
│                                             │
│  Coverage: 85%  ████████████░░░░            │
│                                             │
│  11 gaps found:                             │
│  ┌─────────────────────────────────────┐   │
│  │ B-FF9H61N85 | Sun Dec 1 | Solo2     │   │
│  │ Suggested: John (85%) [Assign]      │   │
│  └─────────────────────────────────────┘   │
│  ┌─────────────────────────────────────┐   │
│  │ B-RQGJMKTGS | Mon Dec 2 | Solo2     │   │
│  │ Suggested: Jane (72%) [Assign]      │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  [Auto-Assign All Gaps]                     │
│                                             │
└─────────────────────────────────────────────┘
```

---

## Testing Checklist

- [ ] Import CSV → blocks appear on calendar
- [ ] Click "Analyze" → panel opens
- [ ] Coverage tab shows % and gaps
- [ ] Assignments tab shows YELLOW blocks with suggestions
- [ ] Click "Assign" → block turns GREEN
- [ ] "Auto-Assign All" works
- [ ] Compliance tab shows violations
- [ ] Panel closes properly
- [ ] Calendar refreshes after assignment

---

## Future Enhancements (Phase 3)

1. **AI Chat Widget**
   - Natural language queries
   - "Show me all Solo2 gaps"
   - "Who can cover Friday night?"

2. **Historical Learning**
   - Track which suggestions were accepted
   - Improve ML model over time

3. **Batch Operations**
   - Select multiple blocks
   - Assign same driver to all

4. **Notifications**
   - Alert when coverage drops below threshold
   - Warn about upcoming compliance issues

---

## Timeline Estimate

| Step | Description | Complexity |
|------|-------------|------------|
| 1 | Remove ScheduleBuilder from ImportWizard | Simple |
| 2 | Create AnalysisPanel shell | Medium |
| 3 | Coverage Analysis tab | Medium |
| 4 | Assignment Suggestions tab | Medium |
| 5 | Compliance tab (migrate) | Simple |
| 6 | Integrate into Schedules.tsx | Medium |
| 7 | Wire up assignment | Simple |

---

**Ready to implement?** Start with Step 1: Remove ScheduleBuilder from ImportWizard.
