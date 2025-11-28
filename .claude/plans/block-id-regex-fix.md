# Block ID Detection Fix Plan

## Problem Analysis

### What Broke
The trip-level CSV detection is currently not finding ANY Block IDs. The console output shows:
```
[CSV Detection] hasBlockIds: false hasOperatorIdPattern: true isTriplevel: false
[CSV Detection] Unique block IDs found: 0 []
```

### Root Cause
I incorrectly changed the Block ID regex pattern from the working version to a broken version:

| Version | Regex | Result |
|---------|-------|--------|
| **Original (working)** | `/B-[A-Z0-9]{8,}/gi` | Matches 8+ chars after `B-` |
| **My broken change** | `/\bB-[A-Z0-9]{8}\b/gi` | Matches exactly 8 chars only |

### The Actual Block ID Format
From analyzing `attached_assets/November 9 thru14 base block no drivers_1763059198812.csv`:

- Block IDs follow pattern: `B-` followed by **9 alphanumeric characters**
- Examples: `B-Q5B44Z199`, `B-60XPGDFLS`, `B-11LZSXLXJ`
- Trip IDs use `T-` prefix with same 9-char format

### Why {8} Matches Zero
My regex `/\bB-[A-Z0-9]{8}\b/gi` requires:
1. Word boundary before `B`
2. Exactly 8 characters after `B-`
3. Word boundary after the 8th character

Since Block IDs have **9 characters** (not 8), the regex matches zero results.

## Locations Needing Fix

Three places in `ImportWizard.tsx` use Block ID regex:

1. **Line 65** - `parseBlockData()` function:
   ```typescript
   const blockIdMatch = line.match(/^(B-[A-Z0-9]+)$/);
   ```
   Status: **OK** - Uses `+` (one or more), will match any length

2. **Line 147** - `detectTripLevelCSV()` function:
   ```typescript
   const blockIdMatches = (text.match(/\bB-[A-Z0-9]{8}\b/gi) || []).map(id => id.toUpperCase());
   ```
   Status: **BROKEN** - needs fix

3. **Line 293** - File upload handler:
   ```typescript
   const hasBlockIds = /\bB-[A-Z0-9]{8}\b/i.test(text);
   ```
   Status: **BROKEN** - needs fix

## Fix Options

### Option A: Return to Original (Recommended)
Restore the original regex: `/B-[A-Z0-9]{8,}/gi`

**Pros:**
- Known to work (was working before my changes)
- Handles 8+ character Block IDs
- Case-insensitive

**Cons:**
- Doesn't have word boundaries (could match embedded patterns, though unlikely in CSV context)

### Option B: Fix with Correct Length
Use: `/\bB-[A-Z0-9]{9}\b/gi`

**Pros:**
- Precise matching of 9-char Block IDs
- Word boundaries prevent false positives

**Cons:**
- Assumes all Block IDs are exactly 9 chars (may break if Amazon changes format)

### Option C: Flexible but Bounded
Use: `/\bB-[A-Z0-9]{8,10}\b/gi`

**Pros:**
- Handles 8-10 character variations
- Word boundaries for precision

**Cons:**
- Arbitrary bounds that may not match future formats

## Recommended Fix

**Use Option A** - Restore to original `/B-[A-Z0-9]{8,}/gi`

Rationale:
1. It was working before my changes
2. The `{8,}` (8 or more) is flexible enough for format variations
3. In CSV context, false positive risk is minimal
4. No word boundaries needed since Block IDs appear in their own column or clearly delimited

## Implementation Steps

1. Edit line 147 in `ImportWizard.tsx`:
   ```typescript
   // FROM:
   const blockIdMatches = (text.match(/\bB-[A-Z0-9]{8}\b/gi) || []).map(id => id.toUpperCase());
   // TO:
   const blockIdMatches = (text.match(/B-[A-Z0-9]{8,}/gi) || []).map(id => id.toUpperCase());
   ```

2. Edit line 293 in `ImportWizard.tsx`:
   ```typescript
   // FROM:
   const hasBlockIds = /\bB-[A-Z0-9]{8}\b/i.test(text);
   // TO:
   const hasBlockIds = /B-[A-Z0-9]{8,}/i.test(text);
   ```

## Addressing the Original Off-by-One Issue

The user originally reported seeing 63 blocks instead of 62. After fixing the detection, I should investigate:

1. Check if there are duplicate Block IDs being counted
2. Verify the Block ID column in the CSV only contains Block IDs (not other B- patterns)
3. Consider if the `toUpperCase()` normalization is causing duplicates

However, the priority is restoring working detection first, then investigating the count discrepancy if it persists.

## Test Verification

After fixing, the console should show:
```
[CSV Detection] hasBlockIds: true hasOperatorIdPattern: true isTriplevel: true
[CSV Detection] Unique block IDs found: 62 [first few IDs...] ...
```

And the UI should:
1. Show the purple "Trip-Level CSV Detected" banner
2. Display block count correctly
3. Proceed to reconstruction step (not "What are you importing?")
