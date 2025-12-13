# Plan: Bolt-On Scheduler - Replace Custom Analyzers with Proven Libraries

## Problem Statement

The current Milo codebase has **6 different analyzer/scheduler files** that keep breaking at various points:

| File | Purpose | Issues |
|------|---------|--------|
| `dna-analyzer.ts` (913 lines) | Analyze driver patterns from history | Complex custom logic, threshold tuning, canonical time lookups |
| `cascade-analyzer.ts` (534 lines) | Compliance checking for schedule changes | Manual workload calculations, DOT rules hardcoded |
| `statistical-analyzer.ts` (455 lines) | Regression, forecasting, correlations | Reinventing scipy/sklearn capabilities |
| `claude-scheduler.ts` (712 lines) | AI-powered matching via Claude API | LLM variability, JSON parsing, expensive API calls |
| `gemini-scheduler.ts` | Original AI scheduler | Rate limited, deprecated |
| `schedule_optimizer.py` (311 lines) | OR-Tools constraint solver | Works well but disconnected from pattern analysis |

**Root Problem**: We're building custom ML/pattern recognition from scratch instead of using battle-tested libraries.

---

## Research Findings

### 1. scikit-learn (Best for Pattern Recognition)

**What it does well:**
- **Clustering** (K-Means, DBSCAN) - Group drivers by behavior patterns
- **Classification** - Predict which driver fits a block best
- **Feature extraction** - Turn raw history into meaningful features

**Key algorithms for our use case:**
| Algorithm | Use Case |
|-----------|----------|
| K-Means | Cluster drivers into "Sun-Wed" vs "Wed-Sat" groups automatically |
| DBSCAN | Find outlier drivers with unusual patterns |
| RandomForest | Predict driver-block fit score from features |
| linear_sum_assignment (scipy) | Optimal assignment matching |

**Verdict**: **USE THIS** for replacing `dna-analyzer.ts` pattern detection

---

### 2. KNIME Analytics Platform

**What it is:** Visual workflow tool for data science, drag-and-drop interface

**Features:**
- 300+ connectors for data sources
- Built-in ML algorithms
- Workflow automation
- Free/open source (GNU GPL)

**Downsides:**
- Desktop application (not embeddable in Node.js)
- Visual tool - not API-friendly
- Overkill for our specific problem
- Would require complete architecture change

**Verdict**: **NOT SUITABLE** - designed for data analysts, not embedding in web apps

---

### 3. Timefold Solver (Constraint Optimization)

**What it is:** AI constraint solver for scheduling optimization

**Features:**
- Employee rostering with skill matching
- Shift constraints and rest periods
- Workload fairness distribution
- Open source (Apache License)

**Critical Issue (2025):**
> The official Timefold Python solver has been DISCONTINUED. The Timefold team is focusing on Java/Kotlin solvers.

**Alternative: SolverForge** - Community fork continuing Python support

**Verdict**: **RISKY** - Python version abandoned, Java version requires JVM

---

### 4. pyworkforce

**What it is:** Python library for workforce scheduling using OR-Tools

**Features:**
- `MinAbsDifference` - minimize gaps in coverage
- `MinRequiredResources` - ensure coverage while minimizing cost
- Rostering with shift bans and rest requirements
- MIT licensed

**Downsides:**
- Last release: August 2023 (potentially stale)
- We already have OR-Tools integration that works
- Not much added value over raw OR-Tools

**Verdict**: **NOT NEEDED** - our `schedule_optimizer.py` already does this better

---

### 5. Google OR-Tools (Already Using)

**What we have:** `schedule_optimizer.py` using CP-SAT solver

**Current capabilities:**
- Constraint satisfaction (one driver per day, contract matching)
- Fair distribution (min/max days per driver)
- Historical preference scoring

**What's missing:**
- Pattern LEARNING (it uses history but doesn't learn patterns)
- Automatic preference detection (relies on dna-analyzer.ts)

**Verdict**: **KEEP AND ENHANCE** - just needs better input from ML

---

## Recommended Architecture: Hybrid Approach

```
┌────────────────────────────────────────────────────────────────┐
│                    NEW ARCHITECTURE                             │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  LAYER 1: Pattern Learning (scikit-learn)                      │
│  ─────────────────────────────────────────                     │
│  Replace dna-analyzer.ts with sklearn pipeline:                │
│                                                                 │
│  ┌─────────────────┐    ┌──────────────────┐                   │
│  │ Feature         │    │ Clustering       │                   │
│  │ Extraction      │───►│ (K-Means/DBSCAN) │                   │
│  │ - Day patterns  │    │ - Pattern groups │                   │
│  │ - Time prefs    │    │ - Outliers       │                   │
│  │ - Consistency   │    └────────┬─────────┘                   │
│  └─────────────────┘             │                             │
│                                  ▼                             │
│  ┌───────────────────────────────────────────┐                 │
│  │ Classification (RandomForest/XGBoost)     │                 │
│  │ - Predict driver-block fit score (0-1)    │                 │
│  │ - Trained on historical successful matches│                 │
│  └───────────────────────────────┬───────────┘                 │
│                                  │                             │
├──────────────────────────────────┼─────────────────────────────┤
│                                  │                             │
│  LAYER 2: Optimization (OR-Tools CP-SAT)                       │
│  ───────────────────────────────────────                       │
│  Keep schedule_optimizer.py, feed it ML scores:                │
│                                                                 │
│  ┌─────────────────────────────────────────────┐               │
│  │ Inputs from Layer 1:                        │               │
│  │ - preference_score[driver,block] = ML fit   │               │
│  │ - pattern_group[driver] = cluster label     │               │
│  │ - compatibility[driver,block] = binary      │               │
│  └─────────────────────────────────────────────┘               │
│                         │                                      │
│                         ▼                                      │
│  ┌─────────────────────────────────────────────┐               │
│  │ CP-SAT Solver (existing)                    │               │
│  │ - Hard constraints: 1 block/day, contract   │               │
│  │ - Soft constraints: maximize ML scores      │               │
│  │ - Fair distribution: min/max days           │               │
│  └─────────────────────────────────────────────┘               │
│                                                                 │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  LAYER 3: API (Optional Claude Enhancement)                    │
│  ──────────────────────────────────────────                    │
│  Keep claude-scheduler.ts as FALLBACK only:                    │
│  - Use when ML model confidence is low                         │
│  - Use for edge cases or special requests                      │
│  - NOT primary scheduler (too expensive/slow)                  │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

---

## Implementation Plan

### Phase 1: Create sklearn Pattern Analyzer (Replace dna-analyzer.ts)

**New file:** `python/pattern_analyzer.py`

```python
from sklearn.cluster import KMeans, DBSCAN
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import StandardScaler
import numpy as np
import json

class PatternAnalyzer:
    """
    scikit-learn based pattern analyzer
    Replaces 900 lines of custom dna-analyzer.ts
    """

    def __init__(self):
        self.scaler = StandardScaler()
        self.clusterer = KMeans(n_clusters=3)  # sunWed, wedSat, mixed
        self.classifier = RandomForestClassifier(n_estimators=100)

    def extract_features(self, driver_history: list) -> np.ndarray:
        """
        Convert raw assignment history to feature vector
        Features:
        - day_frequency[0-6]: normalized count per day
        - time_buckets[0-3]: morning/afternoon/evening/night
        - consistency_score: how regular their pattern is
        - weeks_active: tenure indicator
        """
        features = np.zeros(12)  # 7 days + 4 time buckets + 1 consistency

        day_counts = np.zeros(7)
        time_counts = np.zeros(4)

        for assignment in driver_history:
            day_counts[assignment['dayOfWeek']] += 1
            hour = int(assignment['startTime'].split(':')[0])
            time_counts[hour // 6] += 1  # 0-5=night, 6-11=morning, etc.

        # Normalize
        total = len(driver_history) or 1
        features[0:7] = day_counts / total
        features[7:11] = time_counts / total

        # Consistency: how "peaky" is the distribution
        features[11] = np.std(day_counts) / (np.mean(day_counts) + 0.1)

        return features

    def cluster_drivers(self, all_histories: dict) -> dict:
        """
        Cluster drivers into pattern groups using K-Means
        Returns {driver_id: pattern_group}
        """
        driver_ids = list(all_histories.keys())
        X = np.array([
            self.extract_features(all_histories[d])
            for d in driver_ids
        ])

        X_scaled = self.scaler.fit_transform(X)
        labels = self.clusterer.fit_predict(X_scaled)

        # Map cluster labels to meaningful names
        cluster_names = self._interpret_clusters(X, labels)

        return {
            driver_ids[i]: cluster_names[labels[i]]
            for i in range(len(driver_ids))
        }

    def predict_fit_scores(self, drivers: list, blocks: list,
                           histories: dict) -> dict:
        """
        Predict how well each driver fits each block (0-1 score)
        Uses trained RandomForest model
        """
        scores = {}

        for driver in drivers:
            driver_features = self.extract_features(
                histories.get(driver['id'], [])
            )

            for block in blocks:
                block_features = self._block_features(block)
                combined = np.concatenate([driver_features, block_features])

                # Predict probability of good match
                score = self.classifier.predict_proba([combined])[0][1]
                scores[(driver['id'], block['id'])] = score

        return scores
```

### Phase 2: Integrate with Existing OR-Tools Solver

**Modify:** `python/schedule_optimizer.py`

```python
from pattern_analyzer import PatternAnalyzer

def optimize_schedule(drivers, blocks, slot_history, min_days=3):
    # NEW: Use ML for preference scores instead of raw history counts
    analyzer = PatternAnalyzer()

    # Cluster drivers into pattern groups
    pattern_groups = analyzer.cluster_drivers(slot_history)

    # Get ML-predicted fit scores
    fit_scores = analyzer.predict_fit_scores(drivers, blocks, slot_history)

    # Feed to CP-SAT solver (existing code)
    # Replace: preference_score[(d,b)] = history_count
    # With:    preference_score[(d,b)] = fit_scores[(driver_id, block_id)]
    ...
```

### Phase 3: Simplify TypeScript Layer

**Delete or minimize:**
- `dna-analyzer.ts` - Replace with Python sklearn
- `statistical-analyzer.ts` - Use sklearn directly
- `gemini-scheduler.ts` - Deprecated, remove

**Keep but simplify:**
- `claude-scheduler.ts` - Fallback only, not primary
- `cascade-analyzer.ts` - Compliance checking (still needed)

---

## Files to Create/Modify

| Action | File | Purpose |
|--------|------|---------|
| CREATE | `python/pattern_analyzer.py` | sklearn-based pattern analysis |
| CREATE | `python/requirements.txt` | Add scikit-learn, numpy |
| MODIFY | `python/schedule_optimizer.py` | Integrate ML scores |
| SIMPLIFY | `server/dna-analyzer.ts` | Thin wrapper calling Python |
| DELETE | `server/gemini-scheduler.ts` | Deprecated |
| MODIFY | `server/claude-scheduler.ts` | Make fallback-only |

---

## Benefits

1. **Proven Algorithms**: scikit-learn is battle-tested on millions of projects
2. **Less Code**: Replace 900+ lines of custom JS with ~200 lines of sklearn
3. **Better Patterns**: K-Means/DBSCAN find patterns humans miss
4. **Trainable**: RandomForest learns from successful assignments
5. **Maintainable**: Standard ML pipeline vs custom spaghetti
6. **Cost Savings**: No Claude API calls for primary scheduling

---

## Dependencies to Add

```bash
pip install scikit-learn numpy pandas
```

No new npm packages needed - just call Python from Node.js (already doing this).

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| sklearn learning curve | Well-documented, many tutorials |
| Python integration complexity | Already have Python integration working |
| ML model accuracy | Train on historical data, validate before deploy |
| Cold start (new drivers) | Fallback to simple heuristics or Claude |

---

## Decision Needed

**Option A**: Full sklearn integration (recommended)
- Replace DNA analyzer with ML pipeline
- ~1-2 days implementation

**Option B**: Minimal sklearn (pattern clustering only)
- Just add K-Means for driver grouping
- Keep rest of existing code
- ~4-6 hours implementation

**Option C**: Stay with current approach
- Keep fixing individual analyzers
- Risk: continues breaking in different places

---

## Next Steps (Awaiting Approval)

1. Create `python/pattern_analyzer.py` with sklearn
2. Add sklearn to requirements
3. Integrate with `schedule_optimizer.py`
4. Test on historical data
5. Deprecate redundant TypeScript analyzers

---

## PHASE 0: Isolate and Disable All Analyzers (IMMEDIATE)

Before building the new sklearn solution, we need to disable the broken analyzers to stop the bleeding.

### Files to Disable

| File | Lines | Import Locations | Disable Strategy |
|------|-------|------------------|------------------|
| `server/dna-analyzer.ts` | 913 | routes.ts, 4 scripts | Stub all exports |
| `server/cascade-analyzer.ts` | 534 | routes.ts | Stub exports |
| `server/statistical-analyzer.ts` | 455 | excel-import.ts | Stub exports |
| `server/claude-scheduler.ts` | 712 | routes.ts | Stub exports |
| `server/gemini-scheduler.ts` | ~500 | routes.ts | Stub exports |
| `server/milo-scheduler.ts` | ~400 | routes.ts | Stub exports |

### Dependency Map

```
routes.ts imports:
  ├── dna-analyzer.ts (analyzeDriverDNA, getAllDNAProfiles, etc.)
  ├── cascade-analyzer.ts (analyzeCascadeEffect, executeCascadeChange)
  ├── gemini-scheduler.ts (optimizeWithGemini, applyGeminiSchedule)
  ├── claude-scheduler.ts (optimizeWithClaude, applyClaudeSchedule)
  └── milo-scheduler.ts (optimizeWithMilo, applyMiloSchedule)

excel-import.ts imports:
  └── statistical-analyzer.ts (calculateLinearRegression, etc.)

scripts/ imports:
  └── dna-analyzer.ts (various test scripts)
```

### Disable Strategy: Create Stub Files

For each analyzer, replace the implementation with stubs that:
1. Log a warning that the feature is disabled
2. Return safe default values
3. Don't break the app

**Example stub for dna-analyzer.ts:**
```typescript
// DISABLED: Analyzer isolated pending sklearn replacement
// See PLAN-bolt-on-scheduler.md

export async function analyzeDriverDNA(options: any): Promise<any> {
  console.warn("[DNA Analyzer] DISABLED - pending sklearn replacement");
  return { totalDrivers: 0, profilesCreated: 0, profilesUpdated: 0, errors: 0, profiles: [] };
}

export async function getAllDNAProfiles(tenantId: string): Promise<any[]> {
  console.warn("[DNA Analyzer] DISABLED - pending sklearn replacement");
  return [];
}

// ... stub all other exports
```

### Execution Plan

| Step | Action | Risk |
|------|--------|------|
| 1 | Create `server/disabled/` folder | None |
| 2 | Move original files to `server/disabled/` | None (git tracked) |
| 3 | Create stub files in `server/` | Low - stubs return safe defaults |
| 4 | Test app still starts | Verify |
| 5 | Test routes return graceful errors | Verify |

### What Will Break (Expected)

- DNA Analysis page: Will show empty profiles
- Auto-Match buttons: Will return "feature disabled" message
- Cascade analyzer: Swap/reassign will be disabled
- Excel import stats: Will skip statistical analysis

### What Will Still Work

- Manual driver assignment (drag-drop)
- Block import from CSV
- All other app functionality
- OR-Tools optimizer (schedule_optimizer.py) - KEEP THIS

---

## Confirmation Needed

**Ready to execute Phase 0: Isolate and Disable?**

This will:
- Move 6 analyzer files to `server/disabled/`
- Replace with stub files that return safe defaults
- App will still run, but analyzer features will be disabled
- Unblocks sklearn replacement work

**YES / NO?**
