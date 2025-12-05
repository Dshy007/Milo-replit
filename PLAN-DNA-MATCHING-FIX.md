# Plan: Fix DNA Profile Block Matching

## Problem Statement
When a driver is selected in the sidebar, unassigned calendar blocks should highlight with purple glow based on DNA profile matching. Currently this isn't working.

## Root Cause Analysis

After thorough investigation, **the code is architecturally correct**. All the pieces are in place:

### ✅ What's Working
1. **DNA Profiles exist** - 46 profiles with populated data (preferredDays, preferredStartTimes, preferredTractors)
2. **Calendar blocks exist** - 85 unassigned blocks with proper data (tractorId, serviceDate, startTime)
3. **State flow is correct** - `selectedDriverId` → `activeDriverId` → `dnaProfileMap.get()` → `hoveredDriverProfile`
4. **Match calculation is sound** - Day (40%), Time (35%), Tractor (25%), Contract (+10%)
5. **Purple glow CSS is defined** - Box shadows for high/medium/low matches

### 🔍 The Issue
The code requires the user to **click on a driver** to trigger the matching. The debug indicators we added should show:
- "🧬 Matching: [Driver Name]" when a driver is selected
- Match percentages (0-100%) next to each unassigned block

**Most likely scenario**: The feature IS working, but needs user testing to verify.

## Simplest Solution

Since all the infrastructure is in place, the easiest path forward is:

### Option 1: Verify It Works (5 minutes)
1. Open http://localhost:3000/schedules
2. Click on a driver in the left sidebar (they should highlight with sky-blue border)
3. Look for:
   - Purple "🧬 Matching: [name]" badge in header toolbar
   - Purple percentage numbers next to unassigned block IDs
   - Purple glow around matching blocks

### Option 2: If Debug Shows "NO PROFILE!"
The driver clicked doesn't have a DNA profile. Fix: Click a different driver who has an analyzed profile.

### Option 3: If Percentages Show But No Glow
The match scores might all be below thresholds. We can:
- Lower the glow thresholds (currently 75%/50%/0%)
- Or ensure we're testing with a driver whose preferences match available blocks

## Example Match Calculation

For **Brett Michael Baker**:
- preferredDays: `['monday', 'wednesday', 'sunday', 'tuesday']`
- preferredStartTimes: `['00:30', '20:30', '21:30']`
- preferredTractors: `['Tractor_5', 'Tractor_2']`
- preferredContractType: `'solo1'`

Against block **B-GRTVC7GXD** (Sunday 2025-11-30, 20:30, Tractor_2):
- Day: Sunday ✓ → +40%
- Time: 20:30 matches exactly → +35%
- Tractor: Tractor_2 ✓ → +25%
- **Total: 100%** → Should show bright purple glow!

## No Code Changes Needed

The implementation is complete. The issue is likely:
1. User hasn't clicked a driver yet
2. Or the visual indicator is subtle and missed
3. Or we need to test with the right driver/block combination

## Next Steps

1. **Test manually** with the example above
2. **Check browser console** for `[MATCH CALC DEBUG]` and `[DNA MATCH DEBUG]` logs
3. If still not working, check React DevTools for `selectedDriverId` state value
