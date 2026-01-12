# Make Weekly Schedule

Create the weekly driver schedule by running the deterministic matching algorithm and applying assignments.

## Prerequisites Check

Before starting, verify:
1. Server is running (`npm run dev`)
2. Blocks exist for the target week (import first if needed)
3. XGBoost models are trained (will auto-train if needed)

## Input Required

Ask the user for:
- **Week start date** (Sunday): Format YYYY-MM-DD (e.g., 2025-01-12)
- **Tenant ID**: Default is the primary tenant in the database

## Step 1: Check Current State

Query the database to show:
```
Week of [DATE]:
- Total blocks: [X]
- Already assigned: [X]
- Unassigned: [X]
- Drivers available: [X]
```

Use this SQL via the API or direct query:
```sql
SELECT
  COUNT(*) as total,
  SUM(CASE WHEN status = 'assigned' THEN 1 ELSE 0 END) as assigned
FROM blocks
WHERE service_date >= '[weekStart]'
  AND service_date < '[weekStart + 7 days]'
```

## Step 2: Run Pattern Analysis (if needed)

Check if XGBoost models exist and are recent:
- `python/models/ownership_model.json`
- `python/models/availability_model.json`

If models are older than 7 days or don't exist, trigger training:
```bash
curl -X POST http://localhost:5000/api/analysis/drivers-xgboost \
  -H "Content-Type: application/json" \
  -d '{"tenantId": "[TENANT_ID]"}'
```

## Step 3: Preview Matches

Run the deterministic matcher in preview mode:
```bash
curl -X POST http://localhost:5000/api/matching/deterministic \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "[TENANT_ID]",
    "weekStart": "[YYYY-MM-DD]"
  }'
```

Parse the response and display:

```
MATCH PREVIEW - Week of [DATE]
════════════════════════════════════════════════════════════════

✓ SUGGESTED ASSIGNMENTS ([X] blocks)
┌─────────────┬──────────────┬────────────┬──────────┬──────────┐
│ Date        │ Block        │ Driver     │ Type     │ Score    │
├─────────────┼──────────────┼────────────┼──────────┼──────────┤
│ Sun 01/12   │ S1-T1-001    │ John Doe   │ ★ Owner  │ 0.95     │
│ Sun 01/12   │ S2-T3-001    │ Jane Smith │ ○ Pattern│ 0.82     │
│ ...         │ ...          │ ...        │ ...      │ ...      │
└─────────────┴──────────────┴────────────┴──────────┴──────────┘

✗ UNASSIGNED ([X] blocks)
┌─────────────┬──────────────┬────────────────────────────────────┐
│ Date        │ Block        │ Reason                             │
├─────────────┼──────────────┼────────────────────────────────────┤
│ Mon 01/13   │ S1-T6-002    │ No eligible drivers (all have DOT) │
└─────────────┴──────────────┴────────────────────────────────────┘

STATISTICS
────────────────────────────────────────
Match Rate:     [X]% ([assigned]/[total])
Owner Matches:  [X] (★ high confidence)
Pattern Matches:[X] (○ good fit)
Fallbacks:      [X] (△ weak match)
────────────────────────────────────────
```

## Step 4: User Confirmation

Ask the user:
> **Ready to apply [X] assignments?**
> - Yes, apply all
> - No, I want to review/modify first
> - Cancel

## Step 5: Apply Assignments

If confirmed, apply the matches:
```bash
curl -X POST http://localhost:5000/api/matching/deterministic/apply \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "[TENANT_ID]",
    "weekStart": "[YYYY-MM-DD]"
  }'
```

## Step 6: Final Summary

Query final state and display:

```
SCHEDULE COMPLETE - Week of [DATE]
════════════════════════════════════════════════════════════════

DAILY BREAKDOWN
┌─────────┬────────┬──────────┬──────────────────────────────────┐
│ Day     │ Blocks │ Assigned │ Drivers Working                  │
├─────────┼────────┼──────────┼──────────────────────────────────┤
│ Sunday  │ 8      │ 8 ✓      │ John, Jane, Mike, Sarah...       │
│ Monday  │ 10     │ 9        │ John, Jane, Mike, Tom...         │
│ Tuesday │ 10     │ 10 ✓     │ Jane, Mike, Sarah, Tom...        │
│ ...     │ ...    │ ...      │ ...                              │
└─────────┴────────┴──────────┴──────────────────────────────────┘

DRIVER WORKLOAD
┌──────────────┬──────┬───────────────────────────────────────────┐
│ Driver       │ Days │ Schedule                                  │
├──────────────┼──────┼───────────────────────────────────────────┤
│ John Doe     │ 5    │ Sun Mon Tue Wed Thu                       │
│ Jane Smith   │ 4    │ Sun Tue Thu Sat                           │
│ Mike Johnson │ 6    │ Sun Mon Tue Wed Thu Fri                   │
│ ...          │ ...  │ ...                                       │
└──────────────┴──────┴───────────────────────────────────────────┘

⚠️  ATTENTION NEEDED
- 1 block unassigned on Monday (S1-T6-002) - needs manual assignment
- Mike Johnson has 6 days - verify DOT compliance

✓ Schedule saved to database
```

## Rollback Option

If the user needs to undo:
```bash
# Delete assignments for the week
curl -X DELETE "http://localhost:5000/api/block-assignments?weekStart=[DATE]&tenantId=[ID]"
```

## Alternative: Weekly Sync Flow

If the user prefers the sync approach (compare to last week):
1. Navigate to Weekly Sync page in UI
2. Or use API: `GET /api/sync/week/[weekStart]`
3. Apply last week's pattern: `POST /api/sync/apply-last-week`
4. Auto-match remaining: `POST /api/sync/auto-match`

---

## Quick Commands

For experienced users, here are the quick curl commands:

```bash
# Preview matches
curl -X POST http://localhost:5000/api/matching/deterministic \
  -H "Content-Type: application/json" \
  -d '{"tenantId":"[ID]","weekStart":"[DATE]"}'

# Apply matches
curl -X POST http://localhost:5000/api/matching/deterministic/apply \
  -H "Content-Type: application/json" \
  -d '{"tenantId":"[ID]","weekStart":"[DATE]"}'

# Check single block options
curl http://localhost:5000/api/matching/block/[blockId]
```
