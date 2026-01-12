# Build Weekly Schedule

Build the weekly driver schedule using the Simple Schedule system (profile-based matching).

## Workflow

### 1. Get Week Start Date

Ask the user for the week start date (Sunday). Default to the upcoming Sunday if not provided.

### 2. Fetch Driver Profiles

Query the database to get all active drivers with slot ownership configured:

```sql
SELECT id, firstName, lastName, ownedSlotType, ownedTractorId, ownedStartTime, workPattern, daysOff
FROM drivers
WHERE isActive = true AND ownedSlotType IS NOT NULL
```

Display a summary:
```
DRIVER SLOT OWNERSHIP
────────────────────────────────────────
Driver          | Slot                  | Work Days
────────────────────────────────────────
John Doe        | Solo1 T1 @ 16:30     | Sun-Wed
Jane Smith      | Solo2 T3 @ 21:30     | Wed-Sat
Richard Ewing   | Solo1 T6 @ 01:30     | Sun-Wed
...
────────────────────────────────────────
Total: X drivers with slots configured
```

### 3. Build Schedule

Call the API to generate matches:

```bash
curl -X POST http://localhost:5000/api/schedule/build-from-profiles \
  -H "Content-Type: application/json" \
  -d '{"weekStart": "YYYY-MM-DD"}'
```

### 4. Display Results

Show the schedule in a clear format:

```
SCHEDULE - Week of Jan 12, 2025
════════════════════════════════════════════════════════════════

SUNDAY (Jan 12)
┌──────────────────────┬───────────────┬──────────┐
│ Slot                 │ Driver        │ Status   │
├──────────────────────┼───────────────┼──────────┤
│ Solo1 T1 @ 16:30     │ John Doe      │ ✓ Match  │
│ Solo1 T6 @ 01:30     │ Richard Ewing │ ✓ Match  │
│ Solo2 T3 @ 21:30     │ -             │ ⚠ No Own │
└──────────────────────┴───────────────┴──────────┘

MONDAY (Jan 13)
...

SUMMARY
────────────────────────────────────────
✓ Matched:    42 blocks
⚠ No Owner:   3 blocks
📅 Day Off:   2 blocks
────────────────────────────────────────
```

### 5. Handle Adjustments

Accept natural language requests to modify the schedule:

**Example requests:**
- "John is sick Monday, who can cover?"
- "Swap John and Jane on Tuesday"
- "Give the extra Friday block to whoever needs hours"
- "Richard needs Thursday off"

**For coverage requests:**
1. Find drivers who:
   - Have the right contract type (solo1/solo2)
   - Don't already have a block that day
   - Aren't on their day off
2. Suggest the best replacement
3. Update the assignment if user confirms

### 6. Apply Schedule

When user is ready, apply the matched assignments:

```bash
curl -X POST http://localhost:5000/api/block-assignments \
  -H "Content-Type: application/json" \
  -d '{"blockId": "...", "driverId": "..."}'
```

For each matched block, create an assignment.

---

## Quick Reference

### Driver Profile Fields
- `ownedSlotType`: "solo1" or "solo2"
- `ownedTractorId`: "Tractor_1", "Tractor_2", etc.
- `ownedStartTime`: "16:30", "20:30", etc.
- `workPattern`: ["sunday", "monday", "tuesday", "wednesday"]
- `daysOff`: ["thursday", "friday", "saturday"]

### Match Logic
```
Block (Solo1, Tractor_1, 16:30, Monday)
→ Find driver where:
    ownedSlotType = "solo1"
    ownedTractorId = "Tractor_1"
    workPattern includes "monday"
    daysOff does NOT include "monday"
→ Assign
```

### API Endpoints
- `POST /api/schedule/build-from-profiles` - Generate matches
- `POST /api/block-assignments` - Create assignment
- `PATCH /api/drivers/:id` - Update driver profile
