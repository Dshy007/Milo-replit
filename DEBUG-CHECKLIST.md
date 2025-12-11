# AI Scheduler - Bug Report Guide

**You know the drivers and business rules. I know the code. This guide helps us communicate.**

---

## How to Report a Problem

### Template 1: Wrong Driver Showing Up
```
[Driver name] is showing up in the AI Scheduler results.

THIS IS WRONG BECAUSE: (pick one or more)
- They barely work / haven't worked in weeks
- They only work Sun-Wed but got assigned Thu-Sat
- They only work Wed-Sat but got assigned Sun-Tue
- They're a Solo1 driver but got a Solo2 block
- They're a Solo2 driver but got a Solo1 block
- They're inactive / no longer with us
- Other: _______________
```

### Template 2: Driver Missing Who Should Be There
```
[Driver name] is NOT showing up but should be.

THIS IS WRONG BECAUSE:
- They work regularly (about ___ days per week)
- They've been working for ___ weeks/months
- They're active and available
```

### Template 3: Right Driver, Wrong Assignment
```
[Driver name] got assigned to [day] at [time].

THIS IS WRONG BECAUSE:
- They usually work [list their actual days]
- They usually start at [their actual time]
- I know this because [you've seen their schedule / they told you / etc.]
```

---

## Examples

### Good Reports (I can fix these quickly):

> "Daniel Shirey is showing at 17:30 on Wednesday. He shouldn't appear - he's barely been on the schedule, maybe 1-2 times total in the last 2 months."

> "Austin got a Saturday block but he only works Sun-Wed. He's worked Sun-Wed every week for at least 6 weeks."

> "Maria is a Solo2 driver but got assigned to Tractor 9 which is Solo1."

> "Dillon T. has ZERO history - brand new - but he's showing up in results."

### Reports I Need More Info On:

> "Daniel J. 17:30"
↳ Is this right or wrong? Should he be there? What time does he usually work?

> "The results look off"
↳ Which driver? What's wrong about it?

---

## What I Need to Know

When something looks wrong, tell me:

1. **WHO** - Driver's name
2. **WHAT HAPPENED** - What the AI showed
3. **WHAT SHOULD HAPPEN** - What you expected
4. **WHY YOU KNOW** - How you know it's wrong (their usual schedule, their contract type, etc.)

---

## Current Business Rules

These are the rules the AI follows. If these are wrong, tell me:

| Rule | Current Setting |
|------|-----------------|
| Must have worked recently to appear | At least 1 assignment in past 8 weeks |
| How far back AI looks at history | 8 weeks (56 days) |
| Contract types must match | Solo1 → Solo1, Solo2 → Solo2 |
| Need enough history for pattern badge | 8+ assignments to show Sun-Wed or Wed-Sat label |
| Only considers active drivers | Inactive drivers are excluded |

---

## Types of Problems

### "Shouldn't be there at all"
Driver appears in results but has no business being scheduled.
- **Tell me**: Their name and why they shouldn't be there (inactive? brand new? wrong contract type?)

### "Right driver, wrong day/time"
Driver is valid but got assigned to a slot that doesn't match their pattern.
- **Tell me**: What day/time they got, what day/time they actually work

### "Missing driver"
Someone who should appear isn't in the results.
- **Tell me**: Their name, how often they work, how long they've been working

### "Wrong contract type"
Solo1 driver got Solo2 block or vice versa.
- **Tell me**: Driver name, what type they are, what type of block they got

---

## Quick Reference: What Each Setting Controls

| If you say... | I'll check... |
|---------------|---------------|
| "They have no history" | Minimum history filter (currently: 1+ assignments) |
| "Wrong contract type" | Solo1/Solo2 matching |
| "Wrong days" | Pattern detection (Sun-Wed vs Wed-Sat) |
| "They're inactive" | Active status filter |
| "Badge shows 'unknown'" | Need 8+ assignments for pattern badge |
