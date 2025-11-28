# Block Reconstruction Prompt

Analyze this trip-level CSV export and reconstruct the original blocks.

For each unique Block ID:

## 1. Parse the Operator ID to extract:
- Solo type (Solo1 or Solo2)
- Tractor number (Tractor_X)

## 2. Lookup canonical start time from contracts:

### Solo1 Contracts (14h duration)
| Tractor | Start Time |
|---------|------------|
| Tractor_1 | 16:30 |
| Tractor_2 | 20:30 |
| Tractor_3 | 20:30 |
| Tractor_4 | 17:30 |
| Tractor_5 | 21:30 |
| Tractor_6 | 01:30 |
| Tractor_7 | 18:30 |
| Tractor_8 | 00:30 |
| Tractor_9 | 16:30 |
| Tractor_10 | 20:30 |

### Solo2 Contracts (38h duration)
| Tractor | Start Time |
|---------|------------|
| Tractor_1 | 18:30 |
| Tractor_2 | 23:30 |
| Tractor_3 | 21:30 |
| Tractor_4 | 08:30 |
| Tractor_5 | 15:30 |
| Tractor_6 | 11:30 |
| Tractor_7 | 16:30 |

## 3. Determine block start date
Use the earliest load departure date in that block, combined with the canonical start time.

## 4. Calculate end time
- Solo1: start + 14 hours
- Solo2: start + 38 hours

## 5. Identify drivers
- **Primary driver** = driver with most loads in the block
- **Relay driver(s)** = remaining drivers on stem legs

## 6. Sum total cost
Add up cost from all loads in the block.

---

## Output Format

For each reconstructed block, output:

```
───────────────────────────────
Block: [BLOCK_ID]
Contract: [Solo1/Solo2] Tractor_[X]
Start: [Day], [Month] [Date], [Canonical Time] CST
End: [Day], [Month] [Date], [End Time] CST
Duration: [14h/38h]
Cost: $[XXX.XX]
Primary Driver: [FULL NAME]
Relay Driver(s): [FULL NAME] (if any)
Loads: [count]
Route: [First Origin] → [Last Destination]
───────────────────────────────
```

## Calendar Card Format

Also provide a compact calendar view:

```
┌──────────────────────────────────┐
│ [Start Day] [Month] [Date]       │
│ ┌──────────────────────────────┐ │
│ │ [Time]  [SOLO TYPE] T[X]     │ │
│ │ ──────────────────────────── │ │
│ │ [Primary Driver Name]        │ │
│ │ [Relay Driver] (relay)       │ │
│ │ $[Cost] • [Duration] • [N] loads │
│ └──────────────────────────────┘ │
└──────────────────────────────────┘
```
