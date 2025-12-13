# XGBoost Integration Plan for AI Scheduler

## Current State

### Data Available
| Source | Fields | Use Case |
|--------|--------|----------|
| `blocks` | serviceDate, status, isRejectedLoad, soloType, tractorId | Outcome labels |
| `blockAssignments` | driverId, blockId, isActive, assignedAt | Assignment history |
| `drivers` | schedulingMinDays, maxDays, allowedDays | Constraints |
| `neuralDecisions` | outcome, userFeedback | AI decision quality |

### Current ML Stack
- **K-Means** → Pattern groups (sunWed, wedSat, mixed)
- **Heuristic scoring** → Fit scores (day match, time match, history bonus)
- **Rolling pattern detection** → Interval-based prediction
- **OR-Tools CP-SAT** → Constraint optimization

### What's Missing
1. **Learned fit scoring** - current scoring is rule-based, not learned
2. **Outcome prediction** - we don't predict if an assignment will succeed
3. **Feature interactions** - non-linear relationships between driver/block

## XGBoost Integration Options

### Option 1: Replace Heuristic Fit Scoring (Recommended First Step)
**Goal**: Train XGBoost to predict "fit score" using historical successful assignments

```python
# Features per (driver, block) pair:
features = {
    # Driver features
    'driver_total_shifts_8wk': int,           # Experience level
    'driver_primary_time_match': bool,        # Does block time match driver's preferred?
    'driver_day_frequency': float,            # How often driver works this day of week
    'driver_has_rolling_pattern': bool,       # Rolling vs fixed pattern
    'driver_interval_days': float,            # For rolling patterns
    'driver_days_since_last': int,            # Days since last assignment

    # Block features
    'block_day_of_week': int,                 # 0-6
    'block_time_bucket': int,                 # Morning/afternoon/evening/night
    'block_solo_type': str,                   # solo1/solo2

    # Match features
    'slot_history_count': int,                # Times driver worked this exact slot
    'time_diff_minutes': int,                 # Diff from driver's primary time
    'day_match': bool,                        # Does day match driver preference?
    'rolling_pattern_distance': float,        # Days from predicted work date
}

# Target: Binary (was this assignment made and kept?)
# Or: Score based on outcome (completed=1.0, cancelled=0.5, rejected=0.0)
```

**Training Data**:
- Positive: All active blockAssignments with completed blocks
- Negative: Rejected loads (isRejectedLoad=true) + cancelled assignments

### Option 2: Predict Assignment Outcome (Second Step)
**Goal**: Predict probability an assignment will be "successful"

```python
# Same features as Option 1, plus:
additional_features = {
    'assignment_lead_time_days': int,     # How far in advance was it assigned?
    'driver_cancel_rate_30d': float,      # Historical cancel rate
    'day_fill_rate': float,               # How full is this day for driver?
    'contract_type_match': bool,          # Does driver's dominant type match?
}

# Target: outcome from neuralDecisions or block.status
```

### Option 3: Predict Driver Availability (Advanced)
**Goal**: Predict which drivers will be available on future dates

```python
# Time series features
features = {
    'driver_worked_same_dow_last_4wk': List[bool],
    'driver_avg_interval_last_8wk': float,
    'driver_variance_in_schedule': float,
    'is_holiday_week': bool,
    'days_until_date': int,
}

# Target: Binary (did driver work on this date?)
```

## Implementation Plan

### Phase 1: Data Pipeline (Week 1)
1. Create training data extraction script
2. Build feature engineering module
3. Validate we have enough outcome data

```python
# python/xgboost_trainer.py
class SchedulerXGBoostTrainer:
    def extract_training_data(self, tenant_id: str, weeks_back: int = 12):
        """Extract (driver, block, outcome) tuples from history"""
        pass

    def engineer_features(self, driver_id: str, block: dict, history: dict):
        """Compute feature vector for a driver-block pair"""
        pass

    def train(self, X: np.ndarray, y: np.ndarray):
        """Train XGBoost model"""
        pass

    def save_model(self, path: str):
        """Persist trained model"""
        pass
```

### Phase 2: XGBoost Model (Week 2)
1. Train initial model on 12-week history
2. Validate with cross-validation
3. Compare to current heuristic scoring

```python
import xgboost as xgb

params = {
    'objective': 'binary:logistic',  # or 'reg:squarederror' for continuous
    'max_depth': 6,
    'eta': 0.1,
    'subsample': 0.8,
    'colsample_bytree': 0.8,
    'eval_metric': 'auc',
}

model = xgb.train(
    params,
    dtrain,
    num_boost_round=100,
    evals=[(dtest, 'test')],
    early_stopping_rounds=10,
)
```

### Phase 3: Integration (Week 3)
1. Replace `predict_fit_scores()` in pattern_analyzer.py
2. Fall back to heuristics if model unavailable
3. Add model retraining endpoint

```python
# In pattern_analyzer.py
def predict_fit_scores_xgboost(
    self,
    drivers,
    blocks,
    driver_profiles,
    slot_history
) -> Dict[Tuple[str, str], float]:
    """Use XGBoost model if available, else fall back to heuristics"""
    if self.xgb_model is not None:
        features = self._engineer_features_batch(drivers, blocks, driver_profiles)
        scores = self.xgb_model.predict(features)
        return dict(zip(feature_keys, scores))
    else:
        return self.predict_fit_scores(drivers, blocks, driver_profiles, slot_history)
```

### Phase 4: Feedback Loop (Week 4)
1. Track which assignments are kept/rejected
2. Retrain model weekly with new data
3. A/B test XGBoost vs heuristic

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Assignment rejection rate | Unknown | Track baseline |
| Scheduling time | ~30s | Maintain |
| User overrides after AI schedule | Unknown | Reduce by 20% |
| Driver time slot consistency | ~70% | Improve to 85% |

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Not enough outcome data | Start with "assignment made" as positive label |
| Cold start for new drivers | Fall back to heuristics until 8+ assignments |
| Model drift over time | Weekly retraining cron job |
| XGBoost adds latency | Pre-compute features, cache predictions |

## Dependencies

```python
# requirements.txt additions
xgboost>=2.0.0
scikit-learn>=1.3.0  # Already have
joblib>=1.3.0        # For model persistence
```

## Questions Before Starting

1. **Outcome data quality**: How many blocks have `isRejectedLoad=true`? Need at least 100 for meaningful training.
2. **Cancel tracking**: Are cancelled assignments tracked in `blockAssignments.isActive=false`?
3. **User feedback**: Is `neuralDecisions.userFeedback` being populated?
4. **Retraining schedule**: Daily? Weekly? On-demand?

## Next Steps

1. [ ] Query current data to validate we have enough outcomes
2. [ ] Build feature engineering module
3. [ ] Train initial model and compare to heuristics
4. [ ] Integrate into scheduler pipeline
