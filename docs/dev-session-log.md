# Development Session Log

## Quick Prompts

**Sign On (start of session):**
> I'm back. Read docs/dev-session-log.md and give me: 1) Where we left off 2) What's next 3) Any gotchas

**Sign Off (end of session):**
> Update the dev session log with today's progress and push to GitHub.

**Data Debug (when CSV parsing fails):**
> The CSV has column "[NAME]" with value "[VALUE]". Check if findColumn() in local-reconstruct.ts is looking for it.

---

## [2025-12-01 – EST] Session Summary

**Branch:** main

**What we did:**
- **Driver DNA Feature Enhancements** - Major work on the Schedule Intelligence page
- Created database table for `driver_dna_profiles` (script in `scripts/create-dna-table.ts`)
- Added 3D flip cards to driver profiles - click to flip and see AI summary + insights
- Made "How It Works" arrow functional - scrolls to cards with instruction text
- Added hover movement effect on cards (`hover:-translate-y-1`)
- Changed all match % to green (removed conditional coloring)
- Slowed analysis progress animation from 1.5s to 6s
- **Fixed canonical start times lookup** - Added `CANONICAL_START_TIMES` lookup table to use contract times instead of raw UTC timestamps
- Created plan file at `.claude/plan.md` documenting the implementation approach

**Key files touched:**
- `server/dna-analyzer.ts` – Added CANONICAL_START_TIMES lookup table, getCanonicalStartTime() helper function, updated fetchHistoricalAssignments() to use canonical times based on soloType + tractorId
- `server/ai/agents/gemini-profiler.ts` – Changed calculateConsistencyScore() to be pattern match % (Sun-Wed or Wed-Sat alignment instead of entropy-based)
- `client/src/pages/ScheduleIntelligence.tsx` – Added 3D flip card animation, insights display on back, functional arrow with scroll behavior, hover effects
- `scripts/create-dna-table.ts` – NEW FILE: Database migration script for driver_dna_profiles table
- `.claude/plan.md` – NEW FILE: Implementation plan for Driver DNA improvements

**Current status - NEEDS CONTINUATION:**
The Driver DNA feature is partially working but has issues:
1. **Start times still showing incorrectly** (e.g., "1:30 AM, 1:46 AM") - The canonical lookup was added but may not be getting the right data. Need to re-run analysis and verify tractorId/soloType are being passed correctly.
2. **Match % is low** (16% for Richard who clearly works Sun-Wed) - This suggests pattern detection is returning 'mixed' when it should be 'sunWed'. May be a data quality issue from the source.
3. **Need to verify data source** - Should be pulling from cleaned schedule data, not raw CSV imports

**Canonical Start Times Reference:**
```
Solo1: Tractor_1=16:30, Tractor_2=20:30, Tractor_6=01:30, Tractor_8=00:30
Solo2: Tractor_4=08:30, Tractor_5=15:30, Tractor_6=11:30
```

**Next session START HERE:**
1. Debug why canonical times aren't showing correctly after re-analysis
2. Check if tractorId and soloType are populated in blockAssignments query results
3. Verify pattern detection logic - Richard on Tractor_6 (01:30) works Sun-Wed consistently
4. Consider adding debug logging to DNA analysis to trace data flow
5. Test with re-running "Re-analyze" button after the code changes

---

## [2025-11-29 – EST] Session Summary

**Branch:** main

**What we did:**
- Fixed Trip Stage detection for rejected loads (RED vs YELLOW on calendar)
- Added `hasRejectedTrip` field to ReconstructedBlock interface (client & server)
- Added comprehensive debug logging to trace Trip Stage values through CSV parsing
- Updated ImportWizard to display rejected loads (red) vs unassigned blocks (yellow) separately
- Added Quick Prompts section to dev-session-log.md for faster session handoff
- Pushed to GitHub: commits `3828f06`, `a81bb66`, `13165e6`

**Key files touched:**
- `server/local-reconstruct.ts` – Added tripStage parsing with `findColumn()`, hasRejectedTrip detection, debug logging
- `server/routes.ts` – Added calendar API debug logging for isRejectedLoad
- `client/src/components/ImportWizard.tsx` – Added hasRejectedTrip to interface, rejectedLoads/unassignedBlocks in import result
- `docs/dev-session-log.md` – Added Quick Prompts section at top for session handoff

**Current status:**
- CSV import with Trip Stage detection is WORKING
- RED = Trip Stage "Rejected" (isRejectedLoad=true)
- YELLOW = No driver, not rejected (unassigned)
- GREEN = Has driver assigned

**Lessons learned (for future sessions):**
- When debugging CSV parsing, trace data flow from parsing → API → database
- Use specific test files: Nov 23-29.csv has "Rejected" blocks, Nov 30-Dec6.csv has "Upcoming"
- Add debug logging that shows actual column values, not just counts

**Next session START HERE:**
1. ScheduleBuilder integration - component exists, may need UI work
2. DOT compliance validation - hours-of-service rules
3. Driver assignment UI - click YELLOW block to assign driver
4. Consider updating ScheduleBuilder.tsx to use the calendar data

---

## [2025-11-28 – EST] Session Summary

**Branch:** main

**What we did:**
- Fixed Block ID regex that was breaking trip-level CSV detection (changed from `{8}` to `{8,}`)
- Started implementing enterprise-style import success UI (replacing confetti/gradient flashy UI)
- Added local-reconstruct.ts for improved CSV column parsing with better date column detection
- Updated Gemini token limits for large block sets (90+ blocks)
- Updated .gitignore to exclude temp files, .env, and debug artifacts

**Key files touched:**
- `client/src/components/ImportWizard.tsx` – Block ID regex fix (lines 147, 293) + enterprise import result UI (lines ~1285-1258)
- `server/local-reconstruct.ts` – NEW FILE: Local block reconstruction with improved column parsing
- `server/gemini-reconstruct.ts` – Increased maxOutputTokens to 32768
- `.gitignore` – Added .env, temp files, debug files exclusions

**Current status:**
- Block ID regex is FIXED and working (detects 9-char Block IDs like B-Q5B44Z199)
- Trip-level CSV import flow is working
- Enterprise import success UI is PARTIALLY DONE - basic structure in place but needs design refinement
- TypeScript has pre-existing errors (not from this session) - app still runs

**Next session START HERE:**
1. **FINISH THE ENTERPRISE UI** - The import success dialog needs design work:
   - File: `client/src/components/ImportWizard.tsx` lines ~1285-1310
   - Reference the "Replace Driver?" dialog pattern for styling
   - See plan file: `.claude/plans/twinkly-wondering-forest.md` (may be in user's home dir)
   - Goal: Clean card, bold numbers inline, simple Done/View Calendar buttons
2. Test the complete import flow end-to-end with a real CSV
3. Consider whether the buttons positioning matches the target design

**Warnings / gotchas for future me:**
- Block IDs are 9 characters (e.g., `B-Q5B44Z199`), not 8 - that's why the regex was broken
- The regex `/B-[A-Z0-9]{8,}/gi` means "8 or more" - don't change to exact match!
- There are many orphaned background dev server processes running - kill them before starting a new one
- TypeScript errors exist but are pre-existing (AI memory system, routes.ts) - not blocking
- The plan file `twinkly-wondering-forest.md` was in `C:\Users\shire\.claude\plans\` not in the repo
