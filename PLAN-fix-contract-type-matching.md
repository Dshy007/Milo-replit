# Plan: Fix Contract Type Matching Bug

## Problem Statement

**"It assigned Adan to solo1 but he only ever works solo2"**

This is NOT an XGBoost problem. This is a **data flow bug**.

## Root Cause Analysis

### How Contract Type is Determined

1. **TypeScript** (`ortools-matcher.ts:323-340`):
   - Counts historical solo1/solo2/team assignments per driver
   - Uses 60% threshold, then majority rule
   - Stores in `profiles[driverId].contractType`

2. **Python** (`pattern_analyzer.py:436-441`):
   - Also calculates `contractType` from history
   - Uses mode (most common) from assignments

3. **The Bug**: There are TWO places calculating contract type:
   - TypeScript builds profiles → passes to Python
   - Python recalculates independently
   - **They may not agree**

### The Scoring Flow

```
TypeScript (ortools-matcher.ts)
  ↓
  builds profiles with contractType from history
  ↓
Python (schedule_optimizer.py)
  ↓
  receives drivers with contractType from TypeScript
  ↓
Python (pattern_analyzer.py)
  ↓
  IGNORES the passed contractType
  recalculates from driverHistories
  ↓
  Mismatch possible!
```

### Specific Bug Location

In `pattern_analyzer.py` line 522:
```python
driver_ct = driver.get('contractType', 'solo1').lower()
```

This gets the contract type from the `drivers` list passed in, which comes from TypeScript. BUT the TypeScript profile might have a different contract type than what Python calculates.

And critically, in `_calculate_preferences()` line 437-441:
```python
contract_col = df['soloType'] if 'soloType' in df.columns else df.get('contractType')
if contract_col is not None and len(contract_col.dropna()) > 0:
    contract_type = contract_col.str.lower().mode().iloc[0]
else:
    contract_type = 'solo1'  # DEFAULT TO SOLO1 IF MISSING
```

**If the history doesn't have `soloType` column, it defaults to solo1!**

## Why XGBoost Won't Help

XGBoost would:
1. Learn patterns from features
2. Predict a score

But if we're feeding it **wrong contract type labels**, XGBoost will learn the wrong thing. The issue is:
- The historical data shows Adan worked solo2
- But somewhere the system is labeling him as solo1
- XGBoost would just learn from that wrong label

**Fix the data first, then consider XGBoost.**

## Diagnosis Steps (Before Fixing)

1. Query Adan's actual block history:
   ```sql
   SELECT b.solo_type, COUNT(*)
   FROM block_assignments ba
   JOIN blocks b ON ba.block_id = b.id
   WHERE ba.driver_id = '<adan_id>'
   GROUP BY b.solo_type
   ```

2. Check what contract type TypeScript assigns him

3. Check what contract type Python assigns him

4. Find the discrepancy

## The Fix

### Option A: Single Source of Truth (Recommended)

Remove contract type calculation from Python. Use TypeScript's calculation only.

In `pattern_analyzer.py`, the `_calculate_preferences()` function should NOT return `contractType`. It should only return:
- `days`
- `times`
- `consistency`

The contract type should come from the TypeScript profile, which already does the 60% threshold calculation correctly.

### Option B: Debug the History Data

The `driverHistories` passed to Python might be missing the `soloType` field. Check:

In `ortools-matcher.ts` line 316:
```typescript
driverHistoryEntries[driverId].push({ day: dayName, time, serviceDate: serviceDateStr });
```

**Missing!** The `soloType` is NOT being passed to Python. So Python can't calculate contract type correctly and defaults to solo1.

**Fix**: Add soloType to the history entries:
```typescript
driverHistoryEntries[driverId].push({
  day: dayName,
  time,
  serviceDate: serviceDateStr,
  soloType  // ADD THIS
});
```

## Answer to Your Question

**Would XGBoost help?**

NO - not for this problem. The issue is a data bug, not a model problem.

**What would help?**
1. Fix the contract type data flow (Option A or B above)
2. Add logging to see what contract type is being used at each step
3. Verify Adan's history is being read correctly

**After fixing the bug**, XGBoost could potentially improve fit scoring by:
- Learning non-linear feature interactions
- Weighting features automatically based on historical patterns
- Handling edge cases the heuristics miss

But that's a "nice to have" optimization, not the solution to "assigned to wrong contract type."

## Next Steps

1. [ ] Run diagnostic queries on Adan's data
2. [ ] Add soloType to driverHistoryEntries in TypeScript
3. [ ] Log contract type at each step to find discrepancy
4. [ ] Verify fix with test run
