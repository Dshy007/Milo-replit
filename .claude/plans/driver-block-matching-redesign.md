# Driver Block Matching Redesign Plan

## Goal
When a user clicks on a driver in the sidebar, the system should:
1. Expand the flip card showing matching blocks
2. Auto-scroll the calendar to the first matching block
3. Highlight all matching blocks on the calendar
4. Remove the redundant right-side panel

## Current State
- Two separate displays: sidebar flip card + right-side panel
- "39 matches" counts ALL blocks, not driver-specific matches
- No auto-scroll when selecting a driver
- No calendar highlighting based on driver DNA

## Implementation Plan

### Phase 1: Fix the Matching Logic in Flip Card

**File:** `client/src/components/DriverPoolSidebar.tsx`

1. Update flip card to show ONLY blocks matching driver's DNA:
   - Day must match (from `preferredDays`)
   - Time must be within 2 hours (from `preferredStartTimes`)

2. Show top 4-6 matching blocks with color-coded scores:
   - 🟢 Green (100%) = Day matches + Time within 1 hour
   - 🟡 Yellow (75%) = Day matches + Time within 2 hours
   - 🟠 Orange (50%) = Day matches + Time further off

3. Each block entry shows:
   - Block ID
   - Date (e.g., "Sun 11/30")
   - Time (e.g., "@ 16:30")
   - Match score with color

### Phase 2: Auto-Scroll Calendar to Matching Blocks

**File:** `client/src/pages/Schedules.tsx`

1. When driver is clicked/selected:
   - Calculate the first matching block's position
   - Scroll calendar view to that row/time slot
   - Use `scrollIntoView()` with smooth scrolling

2. Store matching block IDs in state for highlighting

### Phase 3: Highlight Matching Blocks on Calendar

**File:** `client/src/pages/Schedules.tsx`

1. Pass `highlightedBlockIds` to calendar cells
2. Matching blocks get visual treatment:
   - Purple/blue glow border
   - Slightly elevated shadow
   - Optional pulse animation

3. Non-matching blocks:
   - Normal appearance (no dimming needed)

### Phase 4: Remove Right-Side Panel

**File:** `client/src/pages/Schedules.tsx`

1. Remove the `miloActiveDriver` panel that appears on hover/select
2. All driver info now lives in the sidebar flip card
3. Clean up related state variables

## Files to Modify

1. **`client/src/components/DriverPoolSidebar.tsx`**
   - Update flip card back face to show matching blocks
   - Pass calendar data to calculate matches
   - Add click handler to trigger scroll + highlight

2. **`client/src/pages/Schedules.tsx`**
   - Add `highlightedBlockIds` state
   - Add `scrollToBlock()` function
   - Pass highlight state to calendar cells
   - Remove right-side panel component
   - Pass `onDriverClick` callback to sidebar

## Data Flow

```
User clicks driver name
       ↓
DriverPoolSidebar.onDriverClick(driverId)
       ↓
Schedules.tsx receives callback
       ↓
1. Calculate matching blocks using DNA profile
2. Set highlightedBlockIds state
3. Find first matching block's DOM element
4. scrollIntoView({ behavior: 'smooth', block: 'center' })
       ↓
Calendar re-renders with highlighted blocks
Flip card expands showing top matches
```

## Matching Algorithm (Simplified for Day + Time)

```typescript
function getMatchingBlocks(
  occurrences: ShiftOccurrence[],
  dnaProfile: DriverDnaProfile
): { occurrence: ShiftOccurrence; matchScore: number }[] {

  const preferredDays = dnaProfile.preferredDays || [];
  const preferredTimes = dnaProfile.preferredStartTimes || [];

  return occurrences
    .map(occ => {
      const dayOfWeek = getDayOfWeek(occ.serviceDate); // 'sunday', 'monday', etc.
      const dayMatches = preferredDays.includes(dayOfWeek);

      if (!dayMatches) return null; // Skip non-matching days

      // Calculate time proximity
      const blockMinutes = timeToMinutes(occ.startTime);
      let bestTimeDiff = Infinity;

      for (const prefTime of preferredTimes) {
        const prefMinutes = timeToMinutes(prefTime);
        const diff = Math.abs(blockMinutes - prefMinutes);
        const wrapDiff = Math.min(diff, 1440 - diff);
        bestTimeDiff = Math.min(bestTimeDiff, wrapDiff);
      }

      // Score based on time proximity (day already matched)
      let matchScore = 1.0;
      if (bestTimeDiff > 60) matchScore = 0.75;  // >1 hour off
      if (bestTimeDiff > 120) matchScore = 0.50; // >2 hours off
      if (bestTimeDiff > 180) return null;       // >3 hours = no match

      return { occurrence: occ, matchScore };
    })
    .filter(Boolean)
    .sort((a, b) => b!.matchScore - a!.matchScore);
}
```

## Visual Design

### Flip Card Back Face (Expanded)
```
┌─────────────────────────────────────┐
│ Firas IMAD Tahseen          ✨ 4    │  <- Name + match count
│ [S-W] [S1]                          │  <- Pattern + Contract badges
│                                     │
│ 📅 Sun, Mon, Sat  ⏰ 16:30  🚚 T1   │  <- DNA summary row
│                                     │
│ ─────── Matching Blocks ───────     │
│ B-4ZQV7MKMR  Sun 11/30 @ 16:30 🟢   │
│ B-7Z4X2G54P  Mon 12/1 @ 18:30  🟢   │
│ B-QVGWRVPF4  Sun 11/30 @ 16:30 🟢   │
│ B-TGT4GJ7NR  Mon 12/1 @ 16:30  🟢   │
│                          +2 more    │
└─────────────────────────────────────┘
```

### Calendar Block Highlighting
```css
/* Matching block style */
.block-highlighted {
  box-shadow: 0 0 12px rgba(147, 51, 234, 0.5);
  border: 2px solid rgb(147, 51, 234);
  transform: scale(1.02);
}
```

## Testing Checklist

- [ ] Click driver → flip card shows correct matching blocks
- [ ] Click driver → calendar scrolls to first match
- [ ] Click driver → matching blocks glow on calendar
- [ ] Match count reflects actual DNA-matched blocks (not all blocks)
- [ ] Right-side panel is removed
- [ ] Clicking different driver updates highlights + scroll position
- [ ] Clicking same driver again or clicking away clears highlights
