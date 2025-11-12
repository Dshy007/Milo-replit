# Competitor Scheduling Systems Research Guide
**Date**: November 12, 2025  
**Purpose**: Analyze top shift-based scheduling systems to inform Milo's truck-based rolling scheduling UX/algorithm design

---

## Executive Summary

This research examines 8+ commercial scheduling platforms (Connecteam, When I Work, Sling, Deputy, 7shifts, ShiftBoard, Humanity) and open-source constraint solvers to identify best practices for:
- DOT/compliance constraint handling
- Calendar UI patterns
- Shift overlap prevention
- Bulk import workflows
- Mobile vs. desktop experiences

**Key Finding**: Industry leaders use **hybrid constraint solving** (CP-SAT + heuristics) with **grid-based calendar UIs** optimized for drag-drop interaction, compliance warnings, and mobile-first accessibility.

---

## 1. Algorithm Approaches

### **A. Rule Engine Approach**
**Systems**: Connecteam, When I Work, Sling  
**Method**: Validation-based system with predefined scheduling policies

**How It Works**:
- **Define policies**: Max hours/day, min rest between shifts, overtime limits
- **Real-time validation**: Check constraints as manager creates/edits shifts
- **Visual alerts**: Red exclamation marks, conflict tabs, blocking modals
- **Manager override**: Allow emergency exceptions with explicit confirmation

**Pros**:
- Fast setup with pre-built rule templates
- Easy for non-technical managers to configure
- Predictable behavior

**Cons**:
- No optimization (doesn't suggest *best* schedule, just validates)
- Requires manual scheduling decisions
- Limited to hard constraints (can't balance soft preferences)

**Example (Connecteam)**:
```yaml
Scheduling Policy: "DOT Drivers"
  - Max 11 hours/day
  - Max 60 hours/7 consecutive days
  - Min 10 hours rest between shifts
  - Block employees from claiming shifts that violate rules
```

---

### **B. Constraint Solver Approach**
**Systems**: ShiftBoard, Deputy (AI auto-scheduler), Timefold, OptaPlanner  
**Method**: Mathematical optimization with constraint programming (CP) or mixed-integer programming (MIP)

**How It Works**:
- **Model as CSP**: Variables = shift assignments, Domain = eligible employees, Constraints = labor laws + preferences
- **Solve optimization**: Use CP-SAT, genetic algorithms, or simulated annealing to find feasible schedule
- **Objective functions**: Minimize cost, maximize coverage, balance workload, optimize fairness
- **Continuous refinement**: Re-optimize when changes occur

**Pros**:
- Generates optimized schedules automatically
- Handles 100+ constraints simultaneously
- Scales to thousands of employees
- Balances hard + soft constraints

**Cons**:
- Complex setup (requires constraint modeling)
- Longer computation time for large datasets
- "Black box" feeling for managers (less transparent)

**Algorithm Types**:
| Type | Use Case | Libraries |
|------|----------|-----------|
| **CP-SAT** (Constraint Programming) | Employee rostering, nurse scheduling | Google OR-Tools |
| **MIP** (Mixed-Integer Programming) | Cost optimization, labor budgets | SCIP, GLPK, Gurobi |
| **Metaheuristics** (Genetic, Tabu Search) | Large-scale scheduling (10k+ workers) | Timefold, OptaPlanner |
| **Linear Programming** | Simple shift assignment with linear objectives | PuLP, Google GLOP |

**Example (Google OR-Tools CP-SAT)**:
```python
from ortools.sat.python import cp_model

model = cp_model.CpModel()

# Decision variables: shifts[(driver, day, block)]
shifts = {}
for driver in drivers:
    for day in days:
        for block in blocks:
            shifts[(driver, day, block)] = model.NewBoolVar(f'shift_{driver}_{day}_{block}')

# Constraint: Each block assigned to exactly one driver
for day in days:
    for block in blocks:
        model.Add(sum(shifts[(driver, day, block)] for driver in drivers) == 1)

# Constraint: Driver works at most 6 days per week
for driver in drivers:
    model.Add(sum(shifts[(driver, day, block)] for day in days for block in blocks) <= 6)

# Constraint: Rolling 6-hour DOT compliance
# (complex logic for consecutive hours tracking)

# Objective: Minimize workload variance across drivers
model.Minimize(sum(...variance calculation...))

solver = cp_model.CpSolver()
solver.Solve(model)
```

---

### **C. Hybrid Approach** ⭐ **RECOMMENDED FOR MILO**
**Systems**: Deputy, Humanity, modern ShiftBoard  
**Method**: Constraint solver for auto-generation + rule engine for manual editing validation

**How It Works**:
1. **Auto-Schedule Phase**: Use CP-SAT or metaheuristic solver to generate initial schedule optimizing for:
   - Pattern learning (historical preferences)
   - Workload balance (4-day sweet spot)
   - DOT compliance (rolling 6-hour rule)
   - Protected assignments (Isaac/Firas/Tareef)
2. **Manual Adjustment Phase**: Manager can override any assignment
3. **Real-Time Validation**: Rule engine checks constraints as manager edits
4. **Re-Optimization**: Optional "re-optimize remaining blocks" after manual changes

**Pros**:
- Best of both worlds: AI efficiency + human flexibility
- Transparent (managers see suggestions, not black-box schedules)
- Incremental adoption (start with manual, add auto-schedule later)

---

## 2. Rolling Compliance Constraints (DOT-Style)

### Industry Approaches

**Connecteam**:
- ❌ No built-in DOT templates
- ✅ Custom policies: Max hours/day, max hours/week, min rest periods
- ⚠️ Manual configuration required (not pre-built)

**Deputy**:
- ✅ Fatigue management standards (API RP 755 for oil/gas)
- ✅ Automated compliance warnings before violations
- ✅ Fair Workweek laws, break tracking, predictive scheduling
- ⚠️ DOT-specific rules require custom setup

**ShiftBoard**:
- ✅ **Compliance guarantee** (93% violation reduction)
- ✅ Pre-built templates for union contracts, industry regulations
- ✅ Auto-blocking prevents violations before they occur
- ✅ Audit trails for legal reporting

**Humanity (TCP)**:
- ✅ Fair Workweek compliance automation
- ✅ Break management (paid/unpaid)
- ✅ Predictive scheduling law adherence

### **Rolling 6-Hour DOT Implementation Pattern**

**Challenge**: Track cumulative hours worked across **any consecutive 6-hour window**, not just daily totals.

**Solution Pattern (Milo-specific)**:
```javascript
function checkDOTCompliance(driverId, newBlockStart, existingAssignments) {
  const windowSize = 6 * 3600 * 1000; // 6 hours in milliseconds
  
  // Get all assignments in rolling 6-hour window before newBlockStart
  const relevantAssignments = existingAssignments.filter(a => 
    a.driverId === driverId &&
    a.endTime >= (newBlockStart - windowSize) &&
    a.startTime < newBlockStart
  );
  
  // Calculate total hours worked in window
  const totalHours = relevantAssignments.reduce((sum, a) => {
    const overlapStart = Math.max(a.startTime, newBlockStart - windowSize);
    const overlapEnd = Math.min(a.endTime, newBlockStart);
    return sum + (overlapEnd - overlapStart) / 3600000;
  }, 0);
  
  // DOT limit: Max 5.5 hours worked in any 6-hour window
  const DOT_LIMIT = 5.5;
  
  if (totalHours > DOT_LIMIT) {
    return {
      compliant: false,
      violation: `Driver worked ${totalHours.toFixed(2)}h in 6-hour window (limit: ${DOT_LIMIT}h)`,
      severity: 'critical'
    };
  }
  
  return { compliant: true };
}
```

**Visual Indicator Pattern**:
- 🟢 **Green badge**: <4h in rolling window (safe)
- 🟡 **Yellow badge**: 4-5h in rolling window (approaching limit)
- 🔴 **Red badge**: >5h in rolling window (violation)

---

## 3. Shift Overlap Prevention & Swap Logic

### **A. Overlap Detection**

**When I Work**:
- ✅ Automatic warnings when double-booking
- ✅ Conflict detection compares shift times against availability
- ✅ Trimmed shift display (show only non-conflicting portions of available shifts)
- ✅ Manager override with explicit confirmation

**Sling**:
- ✅ Highlights overlapping shifts automatically
- ✅ Availability tracking prevents double-booking
- ✅ Alerts for "clopenings" (closing + opening shifts with short rest)
- ✅ Overtime warnings if swap causes OT

**Algorithm (Simple Overlap Check)**:
```javascript
function hasOverlap(shift1, shift2) {
  return shift1.start < shift2.end && shift2.start < shift1.end;
}

// For Milo: Check if new assignment conflicts with existing
function canAssignBlock(driverId, newBlock, existingAssignments) {
  const driverAssignments = existingAssignments.filter(a => a.driverId === driverId);
  
  for (const existing of driverAssignments) {
    if (hasOverlap(newBlock, existing)) {
      return {
        allowed: false,
        reason: `Conflicts with ${existing.blockDisplayId} (${existing.contractName})`
      };
    }
  }
  
  return { allowed: true };
}
```

---

### **B. Shift Swap Workflow**

**7shifts**:
- Employee offers shift → Qualified coworkers notified → Manager approves/denies
- Automatic conflict checking (availability, skills, overtime)
- Mobile-first experience (bottom sheet UI for swap requests)

**Sling**:
- **Option 1**: Auto-approve swaps (no manager intervention)
- **Option 2**: Manager approval required (default for liability)
- Real-time swap requests visible to coworkers
- Constraint checking before swap confirmation

**Recommended Swap Flow for Milo**:
```
1. Driver A requests to swap Block X with Driver B
2. System checks:
   - Is Driver B qualified for Block X's contract type?
   - Does swap create overlap for Driver B?
   - Does swap violate DOT compliance for Driver B?
   - Does swap exceed 6-day workweek for Driver B?
3. If all checks pass:
   - Notify Driver B (push notification)
   - Driver B accepts/declines
   - If accepted, notify manager for approval
4. Manager reviews:
   - See impact on workload balance
   - See DOT compliance status
   - Approve/Deny with reason
5. Update database, notify both drivers
```

---

## 4. Calendar Layout Patterns

### **A. Grid/Calendar View** ⭐ **Most Common**

**Used by**: Connecteam, Deputy, 7shifts, When I Work, Sling

**Layout Structure**:
```
┌─────────────────────────────────────────────────────────────┐
│  Week View: Nov 11-17    [Filter: All Drivers ▼] [$2,450]  │
├────────┬────────┬────────┬────────┬────────┬────────┬───────┤
│  SUN   │  MON   │  TUE   │  WED   │  THU   │  FRI   │  SAT  │
├────────┼────────┼────────┼────────┼────────┼────────┼───────┤
│ John   │ [8-4]  │ [8-4]  │ [OFF]  │ [8-4]  │ [8-4]  │ [OFF] │ 32h
│        │ Solo1  │ Solo1  │        │ Solo1  │ Solo1  │       │
├────────┼────────┼────────┼────────┼────────┼────────┼───────┤
│ Sarah  │ [OFF]  │ [2-10] │ [2-10] │ [2-10] │ [OFF]  │ [2-10]│ 32h
│        │        │ Solo2  │ Solo2  │ Solo2  │        │ Solo2 │
└────────┴────────┴────────┴────────┴────────┴────────┴───────┘
```

**Key Features**:
- **Drag-and-drop**: Reassign shifts between drivers
- **Color coding**: By contract type, solo type, or status
- **Day/Week/Month toggles**: Switch time granularity
- **Filters**: Department, role, location, driver name
- **Inline editing**: Click cell to create/edit shift
- **Visual status**: Draft (yellow), published (green), conflict (red)

**7shifts Specific**:
- **Shift flags**: Top-right corner badges (⚠️ overtime, 🔄 swap requested)
- **Multi-select**: Hold Shift key + drag to copy shifts
- **Template library**: Save recurring patterns, one-click apply

**Deputy Specific**:
- **AI auto-scheduler**: Click "Generate Schedule" → algorithm fills week
- **Real-time labor cost**: Running total updates as you add shifts
- **Geofencing**: GPS validation for mobile clock-in

---

### **B. Timeline/Gantt View**

**Used by**: ShiftBoard, Humanity, Bryntum-based systems

**Layout**:
```
08:00   10:00   12:00   14:00   16:00   18:00   20:00
│       │       │       │       │       │       │
John    ████████████████████████████                    [Solo1 - Freedom #1]
Sarah                   ████████████████████████        [Solo2 - Freedom #3]
Mike    ████████        ████████████████                [Solo1 - Freedom #2]
```

**Pros**:
- Excellent for visualizing shift overlaps
- Shows exact time spans (hour-by-hour)
- Good for multi-location scheduling

**Cons**:
- Less intuitive for weekly overview
- Harder to implement drag-drop across days
- Requires horizontal scrolling for long weeks

**Best Use Case**: Intraday scheduling (e.g., hospital shifts with exact handoff times)

---

### **C. Heatmap View**

**Used by**: Deputy (compliance dashboard), Humanity (labor cost tracking)

**Layout**:
```
Driver Dashboard - Week of Nov 11
─────────────────────────────────────────────────
       SUN  MON  TUE  WED  THU  FRI  SAT  Total
John   🟢   🟢   🟢   🟢   🟢   ⚪   ⚪   40h
Sarah  ⚪   🟢   🟢   🟢   🟢   🟢   ⚪   40h
Mike   🟢   🟢   🟡   🟡   🔴   🔴   ⚪   48h ⚠️
```

**Color Legend**:
- 🟢 Green: 0-8 hours (compliant)
- 🟡 Yellow: 8-10 hours (approaching OT)
- 🔴 Red: 10+ hours (overtime)
- ⚪ Gray: Not scheduled

**Pros**:
- At-a-glance compliance status
- Identifies workload imbalance quickly
- Good for executive dashboards

**Cons**:
- Not actionable (can't edit from heatmap)
- Requires separate edit view

---

### **D. Kanban/Board View**

**Used by**: Sling (open shift marketplace), When I Work (shift trade requests)

**Layout**:
```
┌──────────────┬──────────────┬──────────────┬──────────────┐
│ Unassigned   │ Pending      │ Scheduled    │ Completed    │
│ Shifts       │ Approval     │              │              │
├──────────────┼──────────────┼──────────────┼──────────────┤
│ [Solo1 #1]   │ [Solo2 #3]   │ [Solo1 #2]   │ [Solo1 #5]   │
│ Sun 8-4pm    │ Swap Request │ Mon 8-4pm    │ Nov 4        │
│ No driver    │ John → Sarah │ Assigned:    │ Completed    │
│ [Assign]     │ [Approve]    │ John         │              │
│              │              │              │              │
│ [Solo2 #4]   │              │ [Solo2 #6]   │              │
│ Tue 2-10pm   │              │ Tue 2-10pm   │              │
│ [Assign]     │              │ Sarah        │              │
└──────────────┴──────────────┴──────────────┴──────────────┘
```

**Pros**:
- Great for workflow management (unassigned → assigned)
- Visual progress tracking
- Intuitive drag-drop for assignment

**Cons**:
- Poor for calendar overview (lose time context)
- Not suitable for weekly planning
- Better as supplementary view, not primary

**Best Use Case**: Shift marketplace (employees claim open shifts), swap approval workflow

---

## 5. Assignment Visualization

### **A. Who's On / Who's Off Indicators**

**7shifts**:
- **Dashboard widget**: "Currently Clocked In" (5 employees)
- **Schedule view**: Color-coded presence (green = on shift, gray = off)
- **Mobile app**: "Today" tab shows who's working now

**Deputy**:
- **Live Dashboard**: Real-time clock-in status, GPS location on map
- **Calendar badges**: Blue dot = checked-in, green dot = completed shift

**When I Work**:
- **Employee can see coworkers**: "Who else is working?" on shift details
- **Manager view**: Filter "On Shift Now" to see active employees

**Recommended for Milo**:
```javascript
// Dashboard widget: "Active Drivers"
SELECT 
  d.firstName, 
  d.lastName, 
  ba.startTime, 
  ba.endTime,
  b.displayId,
  c.name as contractName
FROM block_assignments ba
JOIN drivers d ON ba.driverId = d.id
JOIN blocks b ON ba.blockId = b.id
JOIN bench_contracts c ON b.contractId = c.id
WHERE 
  ba.startTime <= NOW() 
  AND ba.endTime >= NOW()
ORDER BY ba.startTime;
```

**UI Display**:
```
🚛 Active Now (3 drivers)
┌─────────────────────────────────────┐
│ John Smith                          │
│ Solo1 - Freedom #1                  │
│ 8:00am - 4:00pm (2h remaining)      │
├─────────────────────────────────────┤
│ Sarah Jones                         │
│ Solo2 - Freedom #3                  │
│ 2:00pm - 10:00pm (6h remaining)     │
└─────────────────────────────────────┘
```

---

### **B. Unassigned Slot Highlighting**

**Sling**:
- Red border around empty shift cells
- "Unassigned Shifts" count in header (e.g., "⚠️ 5 shifts need coverage")
- Filter: "Show only unassigned"

**Deputy**:
- Gray placeholder blocks with "+ Assign" button
- Drag employee card onto placeholder to assign

**Connecteam**:
- "Open Shifts" feature: Employees can claim unassigned shifts
- Manager approval workflow

**Recommended for Milo**:
- **Week view**: Red dashed borders around unassigned blocks
- **Notification badge**: "12 unassigned blocks this week"
- **Quick assign dropdown**: Click empty cell → dropdown of eligible drivers → assign

---

## 6. Bulk Upload (CSV/Excel Import)

### **Industry Patterns**

**Connecteam**:
- ✅ **Employee import**: CSV with columns (Name, Position, Pay Rate, Availability)
- ✅ **Schedule export**: Download shifts as CSV/XLS with notes, end times
- ❌ **Schedule import**: Not supported (must use templates instead)

**Sling**:
- ✅ **Employee import**: XLS/CSV bulk add
- ❌ **Schedule import**: Only via Toast POS integration, not direct CSV
- ✅ **Workaround**: Recurring shift templates for faster scheduling

**Deputy**:
- ✅ **Employee import**: CSV with custom field mapping
- ✅ **Schedule export**: For payroll integration
- ⚠️ **Schedule import**: Limited (via API, not direct UI upload)

**ShiftBoard**:
- ✅ **Bulk assign via CSV**: Upload role assignments for teams
- ✅ **API-based import**: REST endpoints for programmatic schedule creation

---

### **CSV Import Flow (Best Practice)**

**Step 1: Template Download**
```csv
Driver Name,Contract Name,Solo Type,Day of Week,Start Time,End Time
John Smith,Freedom Transportation #1,Solo1,Monday,08:00,16:00
Sarah Jones,Freedom Transportation #3,Solo2,Monday,14:00,22:00
```

**Step 2: Validation**
- Check driver exists in database
- Verify contract exists and is active
- Validate solo type matches contract
- Check time format (HH:MM or ISO 8601)
- Detect overlaps within CSV
- Detect DOT violations

**Step 3: Preview**
```
┌──────────────────────────────────────────────────────────┐
│ CSV Import Preview                                       │
│                                                          │
│ ✅ 15 valid rows                                         │
│ ⚠️  2 warnings (approaching workload limit)              │
│ ❌ 1 error (driver not found: "Jon Smith" - typo?)      │
│                                                          │
│ [Fix Errors] [Import Valid Rows Only] [Cancel]          │
└──────────────────────────────────────────────────────────┘
```

**Step 4: Commit**
- Insert block_assignments in transaction
- Log import activity (audit trail)
- Send notifications to affected drivers

---

### **Excel Import Libraries (Implementation)**

**Frontend (React)**:
```bash
npm install xlsx papaparse
```

```javascript
import * as XLSX from 'xlsx';

function handleFileUpload(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const data = new Uint8Array(e.target.result);
    const workbook = XLSX.read(data, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const json = XLSX.utils.sheet_to_json(worksheet);
    
    // Send to backend for validation
    validateImport(json);
  };
  reader.readAsArrayBuffer(file);
}
```

**Backend (Node.js)**:
```javascript
import { parse } from 'csv-parse/sync';

app.post('/api/schedules/import', async (req, res) => {
  const { csvData } = req.body;
  const records = parse(csvData, { columns: true, skip_empty_lines: true });
  
  const validationResults = [];
  
  for (const record of records) {
    // Validate each row
    const driver = await db.query.drivers.findFirst({
      where: eq(drivers.firstName, record['Driver Name'].split(' ')[0])
    });
    
    if (!driver) {
      validationResults.push({
        row: record,
        error: `Driver not found: ${record['Driver Name']}`
      });
      continue;
    }
    
    // More validation...
  }
  
  res.json({ validationResults });
});
```

---

## 7. Mobile vs. Desktop Differences

### **Key Insights**

**Desktop (Manager View)**:
- **Wide screen real estate**: Multi-column calendar, filters, labor cost sidebar
- **Drag-and-drop**: Primary interaction (mouse-based)
- **Keyboard shortcuts**: Copy/paste shifts, bulk select
- **Advanced filters**: Multiple criteria (location + role + availability)
- **Reporting dashboards**: Charts, graphs, heatmaps

**Mobile (Employee + Manager)**:
- **Vertical layout**: List-based schedules (not grids)
- **Bottom navigation**: 5-tab design (Schedule, Messages, Notifications, More, Home)
- **Swipe gestures**: Navigate between days/weeks
- **Large tap targets**: Minimum 44x44px for buttons
- **Push notifications**: Critical for shift changes, swap requests
- **GPS features**: Geofencing for clock-in/out, location tracking

---

### **Mobile-First Design Patterns**

**7shifts Mobile**:
- **Bottom tabs**: Schedule | Messages | Notifications | More | Home
- **Day selector**: Horizontal swipe carousel at top
- **Shift cards**: Tappable cards with employee name, role, time
- **Floating action button (FAB)**: "+" to add shift

**When I Work Mobile**:
- **Today view**: Shows current shift + who's working
- **Calendar sync**: One-way sync to personal calendar apps
- **Shift trade flow**: Bottom sheet modal for trade requests
- **Availability management**: Repeating unavailability patterns

**Deputy Mobile**:
- **ScheduleFlex app**: Separate branded mobile app
- **Check-in/Complete**: Status updates without full time clock
- **GPS pinning**: Location tracking on accept/reject/check-in
- **Modern UI**: More polished than web (recent redesign)

---

### **Responsive Design Considerations for Milo**

**Breakpoints**:
- **Mobile**: <768px (stack columns, list view, bottom nav)
- **Tablet**: 768-1024px (compact calendar, 3-day view)
- **Desktop**: >1024px (full week calendar, multi-panel layout)

**Mobile-Specific Features**:
```javascript
// Detect swipe for day navigation
let touchStartX = 0;
let touchEndX = 0;

calendar.addEventListener('touchstart', e => {
  touchStartX = e.changedTouches[0].screenX;
});

calendar.addEventListener('touchend', e => {
  touchEndX = e.changedTouches[0].screenX;
  handleSwipe();
});

function handleSwipe() {
  if (touchEndX < touchStartX - 50) {
    // Swipe left: next day
    navigateToNextDay();
  }
  if (touchEndX > touchStartX + 50) {
    // Swipe right: previous day
    navigateToPreviousDay();
  }
}
```

**Desktop-Specific Features**:
- Keyboard shortcuts (Ctrl+C to copy shift)
- Multi-select with Shift+Click
- Sidebar filters with advanced criteria
- Export buttons (CSV, PDF)

---

## 8. Open-Source Scheduling Libraries

### **A. Constraint Solvers**

| Library | Language | Stars | Best For | License |
|---------|----------|-------|----------|---------|
| **Timefold Solver** | Java, Kotlin, Python | 2k+ | Employee rostering, vehicle routing | Apache 2.0 |
| **Google OR-Tools** | Python, Java, C++ | 10k+ | Constraint programming, nurse scheduling | Apache 2.0 |
| **OptaPlanner** | Java | Mature | Original constraint solver (now Apache KIE) | Apache 2.0 |
| **PuLP** | Python | 2k+ | Linear programming, simple scheduling | BSD |

**Recommended**: **Timefold Solver (Python)** for Milo
- Active development (forked from OptaPlanner in 2023)
- Excellent employee scheduling examples
- Handles hard + soft constraints elegantly
- Metaheuristic algorithms (tabu search, simulated annealing)

**Installation**:
```bash
pip install timefold
```

**Quick Start**:
```bash
git clone https://github.com/TimefoldAI/timefold-quickstarts.git
cd timefold-quickstarts/python/employee-scheduling
python app.py
```

---

### **B. Calendar UI Libraries**

| Library | Language | Best For | License | Demo |
|---------|----------|----------|---------|------|
| **FullCalendar** | JavaScript | Resource timeline, drag-drop | MIT (GPL for Resource) | fullcalendar.io |
| **Bryntum Scheduler** | JavaScript | Advanced resource scheduling | Commercial | bryntum.com |
| **DHTMLX Scheduler** | JavaScript | Gantt-style calendar | Commercial | dhtmlx.com |
| **react-big-calendar** | React | Simple event calendar | MIT | github.com/jquense/react-big-calendar |
| **vis-timeline** | JavaScript | Lightweight timeline | Apache/MIT | visjs.org |

**Recommended for Milo**: **FullCalendar (Resource Timeline)**
- Drag-drop resource scheduling
- Multi-day view
- Background events (for availability blocking)
- Event constraints (prevent overlaps)

**Installation**:
```bash
npm install @fullcalendar/react @fullcalendar/resource-timeline
```

**Example**:
```jsx
import FullCalendar from '@fullcalendar/react';
import resourceTimelinePlugin from '@fullcalendar/resource-timeline';

<FullCalendar
  plugins={[resourceTimelinePlugin]}
  initialView="resourceTimelineWeek"
  resources={[
    { id: 'john', title: 'John Smith' },
    { id: 'sarah', title: 'Sarah Jones' }
  ]}
  events={[
    { 
      resourceId: 'john', 
      start: '2025-11-13T08:00', 
      end: '2025-11-13T16:00', 
      title: 'Solo1 - Freedom #1',
      backgroundColor: '#06b6d4'
    }
  ]}
  editable={true}
  eventDrop={(info) => handleShiftDrop(info)}
/>
```

---

### **C. GitHub Projects (Reference Implementations)**

1. **lbiedma/shift-scheduling**
   - https://github.com/lbiedma/shift-scheduling
   - Python scripts using MIP (Mixed-Integer Programming)
   - Solves shift scheduling with OR-Tools

2. **weiran-aitech/shift_schedule**
   - https://github.com/weiran-aitech/shift_schedule
   - Nurse rostering with constraint programming
   - Production-ready patterns for healthcare

3. **Google OR-Tools Employee Scheduling**
   - https://developers.google.com/optimization/scheduling/employee_scheduling
   - Official tutorial: nurse scheduling with shifts, requests, fairness

---

## 9. Recommendations for Milo

### **Architecture: Hybrid Constraint Solver + Rule Engine**

**Phase 1: Rule Engine (Current)**
- ✅ Manual scheduling with real-time validation
- ✅ DOT compliance checks (rolling 6-hour rule)
- ✅ Workload balance warnings (6-day cap)
- ✅ Protected driver enforcement

**Phase 2: Pattern Learning (Current)**
- ✅ Analyze historical assignments (12-week window)
- ✅ Exponential decay scoring (recency weighting)
- ✅ Build pattern database for auto-suggestions

**Phase 3: Constraint Solver (Future Enhancement)**
- 🔄 Integrate Timefold Solver or Google OR-Tools
- 🔄 Define constraints as code:
  ```python
  @constraint_provider
  def milo_constraints(factory):
      return [
          # Hard constraints
          factory.for_each(BlockAssignment)
                .filter(lambda a: not is_qualified(a.driver, a.block))
                .penalize("Unqualified driver", HardScore(100)),
          
          factory.for_each(BlockAssignment)
                .filter(lambda a: violates_dot_compliance(a))
                .penalize("DOT violation", HardScore(100)),
          
          factory.for_each(BlockAssignment)
                .filter(lambda a: exceeds_6_day_week(a.driver))
                .penalize("6-day limit", HardScore(50)),
          
          # Soft constraints (preferences)
          factory.for_each(BlockAssignment)
                .reward("Pattern match", SoftScore(pattern_confidence)),
          
          factory.for_each_unique_pair(BlockAssignment, 
                                      same_driver,
                                      equals(lambda a: a.week))
                .reward("Workload balance", SoftScore(balance_score)),
      ]
  ```

- 🔄 Objective: Maximize pattern confidence + workload balance + DOT compliance
- 🔄 Generate optimized schedule, present to manager for review

---

### **UI: Grid Calendar with Heatmap Dashboard**

**Primary View: Resource Timeline (FullCalendar)**
```
┌─────────────────────────────────────────────────────────────┐
│  Week: Nov 11-17, 2025       [Generate Next Week] [Export]  │
├────────┬────────┬────────┬────────┬────────┬────────┬───────┤
│  SUN   │  MON   │  TUE   │  WED   │  THU   │  FRI   │  SAT  │
├────────┼────────┼────────┼────────┼────────┼────────┼───────┤
│ John   │[Solo1] │[Solo1] │[Solo1] │[Solo1] │ [OFF]  │ [OFF] │ 32h 🟢
│        │ #1 8-4 │ #1 8-4 │ #1 8-4 │ #1 8-4 │        │       │
├────────┼────────┼────────┼────────┼────────┼────────┼───────┤
│ Sarah  │ [OFF]  │[Solo2] │[Solo2] │[Solo2] │[Solo2] │ [OFF] │ 32h 🟢
│        │        │ #3 2-10│ #3 2-10│ #3 2-10│ #3 2-10│       │
├────────┼────────┼────────┼────────┼────────┼────────┼───────┤
│ Mike   │[Solo1] │[Solo1] │[Solo1] │[Solo1] │[Solo1] │[Solo1]│ 48h 🔴
│        │ #2 8-4 │ #2 8-4 │ #2 8-4 │ #2 8-4 │ #2 8-4 │ #2 8-4│ ⚠️ OT
└────────┴────────┴────────┴────────┴────────┴────────┴───────┘
```

**Features**:
- **Drag-drop**: Reassign blocks between drivers
- **Color coding**: By solo type (Solo1 = cyan, Solo2 = violet)
- **Badges**: 🟢 compliant, 🟡 warning, 🔴 violation
- **Click empty cell**: Dropdown of eligible drivers → assign
- **Right-click block**: Edit, delete, swap, view details
- **Protected assignments**: Lock icon, grayed-out (cannot reassign)

**Compliance Heatmap (Dashboard Widget)**
```
Workload Heatmap - Week of Nov 11
─────────────────────────────────────────
       SUN  MON  TUE  WED  THU  FRI  SAT  Total  DOT
John   🟢   🟢   🟢   🟢   ⚪   ⚪   ⚪    32h   🟢
Sarah  ⚪   🟢   🟢   🟢   🟢   ⚪   ⚪    32h   🟢
Mike   🟢   🟢   🟢   🟢   🟢   🟢   ⚪    48h   🔴 ⚠️
Isaac  ⚪   ⚪   ⚪   ⚪   ⚪   🔵   ⚪     8h   🟢 (Protected)
```

**Legend**:
- 🟢 Green: 0-8h/day (safe)
- 🟡 Yellow: 8-10h/day (approaching limit)
- 🔴 Red: 10+h/day (overtime)
- 🔵 Blue: Protected assignment
- ⚪ Gray: Not scheduled

---

### **Bulk Import: CSV with Smart Validation**

**Template**:
```csv
Driver Name,Contract Name,Solo Type,Day of Week,Start Time,End Time
John Smith,Freedom Transportation #1,Solo1,Monday,08:00,16:00
Sarah Jones,Freedom Transportation #3,Solo2,Monday,14:00,22:00
```

**Flow**:
1. **Upload**: Drag-drop CSV or click "Browse"
2. **Parse**: Extract rows, detect column headers
3. **Validate**:
   - Driver exists? (fuzzy match names)
   - Contract exists and active?
   - Solo type matches contract?
   - Time format valid?
   - Overlaps within CSV?
   - DOT compliance violations?
4. **Preview**: Show validation results (✅ valid, ⚠️ warnings, ❌ errors)
5. **Fix**: Inline editing in preview table
6. **Commit**: Insert valid rows, send notifications

---

### **Mobile: Bottom Navigation + Day List View**

**Bottom Tabs**:
- **Schedule**: View assigned blocks
- **Swap**: Request/approve swaps
- **Availability**: Set unavailable dates
- **Notifications**: Shift changes
- **More**: Profile, settings

**Day View (Mobile)**:
```
┌─────────────────────────────────────┐
│  < Monday, Nov 11 >                 │
│                                     │
│  Your Shifts (1)                    │
│  ┌──────────────────────────────┐  │
│  │ Solo1 - Freedom #1           │  │
│  │ 8:00am - 4:00pm              │  │
│  │ 📍 Warehouse A               │  │
│  └──────────────────────────────┘  │
│                                     │
│  Who Else is Working                │
│  • Sarah Jones (Solo2 #3, 2-10pm)  │
│  • Mike Davis (Solo1 #2, 8-4pm)    │
│                                     │
│  [Request Swap]  [Mark Unavailable] │
└─────────────────────────────────────┘
```

**Swipe Gestures**:
- Swipe left: Next day
- Swipe right: Previous day
- Pull down: Refresh schedule

---

## 10. Summary & Action Items

### **Algorithm Choice**: Hybrid (Pattern Learning + Manual Validation)
- ✅ **Current**: Rule engine with pattern learning is production-ready
- 🔄 **Future**: Add Timefold Solver for full auto-schedule generation (Phase 4)

### **UI Pattern**: Grid Calendar (Desktop) + List View (Mobile)
- ✅ **Current**: Schedules.tsx has calendar grid
- 🔄 **Enhance**: Add FullCalendar Resource Timeline for drag-drop
- 🔄 **Add**: Compliance heatmap dashboard widget

### **Compliance**: DOT Rolling 6-Hour Tracking
- ✅ **Current**: `rolling6-calculator.ts` implemented
- ✅ **Validated**: Pattern engine respects DOT limits
- ✅ **Tested**: Workload balance prevents 6+ day weeks

### **Bulk Import**: CSV Upload with Validation
- 🔄 **Add**: CSV parser (papaparse)
- 🔄 **Add**: Validation endpoint `/api/schedules/import-preview`
- 🔄 **Add**: UI with upload → validate → preview → commit flow

### **Mobile**: Responsive Design
- 🔄 **Add**: Bottom navigation for mobile
- 🔄 **Add**: Swipe gestures for day navigation
- 🔄 **Add**: Push notifications (shift changes, swap requests)

---

## 11. Visual Wireframe Concepts

### **Concept 1: Grid Calendar with Compliance Badges**
```
┌───────────────────────────────────────────────────────────────┐
│ Milo Scheduling - Week of Nov 11                              │
│ [Auto-Build] [Import CSV] [Export] [Filter: All Drivers ▼]   │
├─────────┬─────────┬─────────┬─────────┬─────────┬─────────────┤
│ Driver  │ SUN     │ MON     │ TUE     │ WED     │ THU ... SAT │
├─────────┼─────────┼─────────┼─────────┼─────────┼─────────────┤
│ John S. │ [Solo1] │ [Solo1] │ [Solo1] │ [Solo1] │ [OFF]   ... │ 🟢
│ 32h     │ #1 8-4  │ #1 8-4  │ #1 8-4  │ #1 8-4  │             │
├─────────┼─────────┼─────────┼─────────┼─────────┼─────────────┤
│ Sarah J.│ [OFF]   │ [Solo2] │ [Solo2] │ [Solo2] │ [Solo2] ... │ 🟢
│ 32h     │         │ #3 2-10 │ #3 2-10 │ #3 2-10 │ #3 2-10     │
├─────────┼─────────┼─────────┼─────────┼─────────┼─────────────┤
│ Isaac K.│ [OFF]   │ [OFF]   │ [OFF]   │ [OFF]   │ [Solo1] ... │ 🔵
│ 8h      │         │         │         │         │ #5 16:30 🔒 │ Protected
└─────────┴─────────┴─────────┴─────────┴─────────┴─────────────┘

Compliance Summary:
  ✅ 15 drivers compliant
  ⚠️  2 drivers approaching limits
  ❌ 1 driver violation (Mike D. - 48h/week)
```

### **Concept 2: Heatmap Dashboard**
```
┌───────────────────────────────────────────────────────────────┐
│ Workload Compliance Dashboard                                 │
├───────────────────────────────────────────────────────────────┤
│ Week of Nov 11-17, 2025                                       │
│                                                               │
│        SUN  MON  TUE  WED  THU  FRI  SAT  │ Total  DOT       │
│ ────────────────────────────────────────────────────────────│
│ John   🟢   🟢   🟢   🟢   ⚪   ⚪   ⚪    │  32h   🟢       │
│ Sarah  ⚪   🟢   🟢   🟢   🟢   ⚪   ⚪    │  32h   🟢       │
│ Mike   🟢   🟢   🟢   🟢   🟢   🟢   ⚪    │  48h   🔴 ⚠️   │
│ Isaac  ⚪   ⚪   ⚪   ⚪   ⚪   🔵   ⚪    │   8h   🟢 🔒    │
│                                                               │
│ Legend: 🟢 Compliant | 🟡 Warning | 🔴 Violation | 🔵 Protected│
└───────────────────────────────────────────────────────────────┘
```

### **Concept 3: Auto-Build Review UI** (Already Implemented!)
```
┌───────────────────────────────────────────────────────────────┐
│ Auto-Build Suggestions - Week of Nov 18-24                    │
├───────────────────────────────────────────────────────────────┤
│ ☑️ Select All  ☐ Deselect All    [Approve 12 Selected]       │
├────┬──────────┬────────────┬──────────┬──────────────────────┤
│ ☑️ │ Block    │ AI Driver  │ Manual   │ Confidence │ Rationale│
├────┼──────────┼────────────┼──────────┼──────────────────────┤
│ ☑️ │ Solo1 #1 │ John Smith │ [Select▼]│ 🟢 85%     │ Pattern  │
│    │ Mon 8-4  │            │          │            │ match    │
├────┼──────────┼────────────┼──────────┼──────────────────────┤
│ ☑️ │ Solo2 #3 │ Sarah Jones│ [Select▼]│ 🟢 78%     │ Workload │
│    │ Mon 2-10 │            │          │            │ balance  │
├────┼──────────┼────────────┼──────────┼──────────────────────┤
│ ☐  │ Solo1 #5 │ Isaac K.   │ DISABLED │ 🔵 Protected│ Friday  │
│    │ Fri 16:30│            │   🔒     │            │ rule     │
└────┴──────────┴────────────┴──────────┴──────────────────────┘
```

### **Concept 4: Mobile Day View**
```
┌─────────────────────────────┐
│  < Monday, Nov 11 >         │
├─────────────────────────────┤
│  Your Shifts (1)            │
│  ┌────────────────────────┐ │
│  │ Solo1 - Freedom #1     │ │
│  │ 🕐 8:00am - 4:00pm     │ │
│  │ 📍 Warehouse A         │ │
│  │ [Swap] [Details]       │ │
│  └────────────────────────┘ │
│                             │
│  Who Else:                  │
│  • Sarah (Solo2 #3, 2-10)  │
│  • Mike (Solo1 #2, 8-4)    │
│                             │
│ [Request Time Off]          │
└─────────────────────────────┘
│Schedule│Swap│Avail│Notify│Me│
```

### **Concept 5: CSV Import Flow**
```
Step 1: Upload
┌─────────────────────────────────────┐
│ Import Schedule from CSV            │
│                                     │
│  ┌───────────────────────────────┐ │
│  │  Drag & drop CSV here         │ │
│  │  or click to browse           │ │
│  └───────────────────────────────┘ │
│                                     │
│  [Download Template]                │
└─────────────────────────────────────┘

Step 2: Validate
┌─────────────────────────────────────┐
│ Validation Results                  │
│ ✅ 15 valid rows                    │
│ ⚠️  2 warnings (workload high)     │
│ ❌ 1 error (driver not found)      │
│                                     │
│ Row 16: "Jon Smith" not found      │
│ Did you mean "John Smith"?          │
│ [Fix] [Skip Row]                    │
│                                     │
│ [Import Valid Rows] [Cancel]        │
└─────────────────────────────────────┘
```

---

## Conclusion

**Best Approach for Milo**: **Hybrid Constraint Solver + Grid Calendar UI**

1. **Algorithm**: Pattern learning (current) → add Timefold Solver (future) for full auto-schedule
2. **UI**: FullCalendar Resource Timeline with drag-drop + compliance heatmap dashboard
3. **Compliance**: Continue using rolling 6-hour DOT calculator (already implemented)
4. **Mobile**: Bottom nav + day list view with swipe gestures
5. **Bulk Import**: CSV upload with validation preview (add in Phase 3/4)

**Key Differentiators from Competitors**:
- ✅ DOT rolling 6-hour compliance (unique to trucking)
- ✅ Protected driver assignments (Isaac/Firas/Tareef)
- ✅ Pattern learning with exponential decay (recency weighting)
- ✅ Block signature normalization (contract+solo+time+day+tractor)
- ✅ Manual override with AI suggestions (hybrid approach)

**Next Steps**:
1. Enhance calendar UI with FullCalendar Resource Timeline (drag-drop)
2. Add compliance heatmap dashboard widget
3. Implement CSV import with validation preview
4. Build mobile-responsive views with bottom navigation
5. (Future) Integrate Timefold Solver for full auto-schedule generation

---

*End of Research Document*
