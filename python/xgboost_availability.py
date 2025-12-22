"""
XGBoost Slot Pattern Affinity Scorer

Scores how strongly a driver's historical pattern MATCHES a specific contract slot.
This is PATTERN MATCHING against history, not predicting future behavior.

The Question We Answer:
  "How well does Solo1_Tractor_1_Monday match Driver X's historical work pattern?"
  NOT: "Will Driver X work this slot?" (we don't predict the future)

Features (9 total - slot-aware pattern matching):
  0. solo_type (int 0-1): 0=solo1, 1=solo2
  1. tractor_id (int 0-9): Tractor number encoded
  2. canonical_time (int): Minutes since midnight (0-1439)
  3. day_of_week (int 0-6): Sunday=0, Saturday=6
  4. week_of_month (int 1-4): Which week in the month
  5. days_since_last_worked (int): Gap since last assignment
  6. slot_freq (float): Historical frequency of THIS SPECIFIC SLOT
  7. rolling_interval (float): Average days between shifts
  8. is_rolling_match (bool 0/1): Does date match rolling pattern?

Output:
  - Affinity score 0.0-1.0 representing PATTERN STRENGTH
  - 1.0 = Strong historical match (driver frequently worked this exact slot)
  - 0.0 = No historical match (driver never worked this slot)

This is the "Holy Grail" - using Operator ID (soloType + tractorId) to match
drivers to their historically worked slots.
"""

import json
import sys
import os
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
from collections import defaultdict

from xgboost import XGBClassifier
from sklearn.preprocessing import LabelEncoder
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score

# Model save paths
MODEL_PATH = os.path.join(os.path.dirname(__file__), 'models', 'availability_model.json')
ENCODERS_PATH = os.path.join(os.path.dirname(__file__), 'models', 'availability_encoders.json')

# Canonical start times from contracts (STATIC lookup - same as ownership model)
# These define the 17 unique contract slots
CANONICAL_START_TIMES: Dict[str, str] = {
    # Solo1 (10 tractors)
    "solo1_Tractor_1": "16:30",
    "solo1_Tractor_2": "20:30",
    "solo1_Tractor_3": "20:30",
    "solo1_Tractor_4": "17:30",
    "solo1_Tractor_5": "21:30",
    "solo1_Tractor_6": "01:30",
    "solo1_Tractor_7": "18:30",
    "solo1_Tractor_8": "00:30",
    "solo1_Tractor_9": "16:30",
    "solo1_Tractor_10": "20:30",
    # Solo2 (7 tractors)
    "solo2_Tractor_1": "18:30",
    "solo2_Tractor_2": "23:30",
    "solo2_Tractor_3": "21:30",
    "solo2_Tractor_4": "08:30",
    "solo2_Tractor_5": "15:30",
    "solo2_Tractor_6": "11:30",
    "solo2_Tractor_7": "16:30",
}

# Feature names for debugging
FEATURE_NAMES = [
    'solo_type',           # Contract type (solo1/solo2)
    'tractor_id',          # Tractor number encoded
    'canonical_time',      # Slot start time in minutes
    'day_of_week',         # Day of week (Sun=0)
    'week_of_month',       # Week within month
    'days_since_last',     # Gap since last assignment
    'slot_freq',           # Historical frequency of THIS SLOT
    'rolling_interval',    # Average days between shifts
    'is_pattern_match'     # Does date fit rolling pattern?
]


def time_to_minutes(time_str: str) -> int:
    """Convert HH:MM to minutes since midnight."""
    parts = time_str.split(':')
    return int(parts[0]) * 60 + int(parts[1] if len(parts) > 1 else 0)


def get_canonical_time(solo_type: str, tractor_id: str) -> str:
    """Get canonical start time for a contract slot."""
    key = f"{solo_type.lower()}_{tractor_id}"
    return CANONICAL_START_TIMES.get(key, "00:00")


def make_slot_key(solo_type: str, tractor_id: str, day_of_week: int) -> str:
    """Create unique key for a slot (soloType|tractorId|dayOfWeek)."""
    return f"{solo_type.lower()}|{tractor_id}|{day_of_week}"


class SlotPatternScorer:
    """
    Slot Pattern Affinity Scorer.

    Scores how strongly a driver's historical work pattern MATCHES a specific slot.
    This is pattern matching, not prediction.

    Example:
        - Driver "Firas" historically worked Solo1_Tractor_1 on Mon/Wed/Fri
        - Score for Solo1_Tractor_1_Monday = 0.95 (strong match)
        - Score for Solo2_Tractor_6_Monday = 0.05 (weak match - different slot)

    The XGBoost model learns these patterns from historical assignments.
    """

    def __init__(self):
        self.model = XGBClassifier(
            n_estimators=50,
            max_depth=4,
            learning_rate=0.1,
            min_child_weight=3,
            subsample=0.8,
            colsample_bytree=0.8,
            objective='binary:logistic',
            eval_metric='logloss',
            random_state=42,
            verbosity=0
        )
        self.is_fitted = False

        # Encoders for categorical features
        self.solo_type_encoder = LabelEncoder()
        self.tractor_encoder = LabelEncoder()

        # Cache: driver_id -> {slot_key -> count}
        self.driver_slot_counts: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))

        # Cache: driver_id -> general stats
        self.driver_stats: Dict[str, Dict] = {}

    def _get_week_of_month(self, date: datetime) -> int:
        """Get week of month (1-4)."""
        first_day = date.replace(day=1)
        dom = date.day
        adjusted_dom = dom + first_day.weekday()
        return min(4, (adjusted_dom - 1) // 7 + 1)

    def _compute_driver_history(self, driver_id: str, history: List[Dict]) -> Dict:
        """
        Analyze a driver's historical work pattern.

        Returns statistics about WHICH SLOTS they historically worked,
        not predictions about future behavior.
        """
        if not history:
            return {
                'work_dates': [],
                'total_days': 0,
                'rolling_interval': 3.0,
                'interval_std': 1.0,
                'slot_counts': defaultdict(int)
            }

        work_dates = []
        slot_counts = defaultdict(int)

        for assignment in history:
            date_str = assignment.get('serviceDate') or assignment.get('date')
            solo_type = assignment.get('soloType', 'solo1').lower()
            tractor_id = assignment.get('tractorId', 'Tractor_1')

            if date_str:
                try:
                    date = pd.to_datetime(date_str).to_pydatetime()
                    work_dates.append(date)

                    # Track which slots this driver historically worked
                    day_of_week = (date.weekday() + 1) % 7  # Sun=0
                    slot_key = make_slot_key(solo_type, tractor_id, day_of_week)
                    slot_counts[slot_key] += 1
                except:
                    continue

        work_dates = sorted(set(work_dates))

        # Compute rolling interval (historical pattern)
        if len(work_dates) >= 2:
            intervals = []
            for i in range(1, len(work_dates)):
                gap = (work_dates[i] - work_dates[i-1]).days
                if gap > 0 and gap < 30:
                    intervals.append(gap)

            if intervals:
                rolling_interval = np.mean(intervals)
                interval_std = np.std(intervals) if len(intervals) > 1 else 1.0
            else:
                rolling_interval = 3.0
                interval_std = 1.0
        else:
            rolling_interval = 3.0
            interval_std = 1.0

        return {
            'work_dates': work_dates,
            'total_days': len(work_dates),
            'rolling_interval': rolling_interval,
            'interval_std': interval_std,
            'slot_counts': dict(slot_counts)
        }

    def extract_features(
        self,
        driver_id: str,
        date: datetime,
        solo_type: str,
        tractor_id: str,
        driver_history: List[Dict]
    ) -> List[float]:
        """
        Extract 9 features for pattern matching a driver to a slot.

        These features capture:
        - The slot identity (soloType, tractorId, canonicalTime)
        - The day/time context (dayOfWeek, weekOfMonth)
        - The driver's historical pattern (slot_freq, rolling_interval, etc.)
        """
        # Ensure date is datetime
        if isinstance(date, str):
            date = pd.to_datetime(date).to_pydatetime()

        # Normalize inputs
        solo_type = solo_type.lower() if solo_type else 'solo1'
        tractor_id = tractor_id if tractor_id else 'Tractor_1'

        # Get or compute driver's historical pattern
        if driver_id in self.driver_stats:
            stats = self.driver_stats[driver_id]
        else:
            stats = self._compute_driver_history(driver_id, driver_history)
            self.driver_stats[driver_id] = stats

        # Feature 0: solo_type encoded
        try:
            solo_enc = self.solo_type_encoder.transform([solo_type])[0]
        except ValueError:
            solo_enc = 0  # Default to solo1

        # Feature 1: tractor_id encoded
        try:
            tractor_enc = self.tractor_encoder.transform([tractor_id])[0]
        except ValueError:
            tractor_enc = 0

        # Feature 2: canonical_time in minutes (identifies the slot)
        canonical_time = get_canonical_time(solo_type, tractor_id)
        time_minutes = time_to_minutes(canonical_time)

        # Feature 3: day_of_week (Sun=0, Sat=6)
        day_of_week = (date.weekday() + 1) % 7

        # Feature 4: week_of_month (1-4)
        week_of_month = self._get_week_of_month(date)

        # Feature 5: days_since_last_worked (historical context)
        work_dates = stats['work_dates']
        if work_dates:
            past_dates = [d for d in work_dates if d < date]
            if past_dates:
                days_since_last = (date - max(past_dates)).days
            else:
                days_since_last = 14
        else:
            days_since_last = 14
        days_since_last = min(days_since_last, 30)

        # Feature 6: slot_freq - HOW OFTEN did driver work THIS EXACT SLOT historically?
        # This is the KEY feature for pattern matching
        slot_key = make_slot_key(solo_type, tractor_id, day_of_week)
        slot_counts = stats.get('slot_counts', {})
        total_days = stats['total_days']

        if total_days > 0:
            slot_count = slot_counts.get(slot_key, 0)
            slot_freq = slot_count / total_days
        else:
            slot_freq = 0.0

        # Feature 7: rolling_interval (historical work frequency)
        rolling_interval = stats['rolling_interval']

        # Feature 8: is_pattern_match (does date fit historical pattern?)
        interval_std = stats['interval_std']
        if work_dates and rolling_interval > 0:
            deviation = abs(days_since_last - rolling_interval)
            tolerance = max(1.0, interval_std)
            is_pattern_match = 1.0 if deviation <= tolerance else 0.0
        else:
            is_pattern_match = 0.5

        return [
            float(solo_enc),
            float(tractor_enc),
            float(time_minutes),
            float(day_of_week),
            float(week_of_month),
            float(days_since_last),
            float(slot_freq),
            float(rolling_interval),
            float(is_pattern_match)
        ]

    def build_training_data(
        self,
        driver_histories: Dict[str, List[Dict]]
    ) -> Tuple[np.ndarray, np.ndarray]:
        """
        Build training data from historical assignments.

        For each historical assignment:
        - Positive sample: slot the driver DID work (label=1, strong match)
        - Negative samples: slots the driver did NOT work that day (label=0, weak match)

        The model learns to distinguish slots that match a driver's pattern
        from slots that don't.
        """
        X_samples = []
        y_labels = []

        print(f"[Pattern Scorer] Building training data from {len(driver_histories)} drivers...", file=sys.stderr)

        # First: fit encoders on all unique values
        all_solo_types = set()
        all_tractors = set()
        all_dates = []

        for driver_id, assignments in driver_histories.items():
            for a in assignments:
                solo_type = a.get('soloType', 'solo1').lower()
                tractor_id = a.get('tractorId', 'Tractor_1')
                all_solo_types.add(solo_type)
                all_tractors.add(tractor_id)

                date_str = a.get('serviceDate') or a.get('date')
                if date_str:
                    try:
                        all_dates.append(pd.to_datetime(date_str).to_pydatetime())
                    except:
                        pass

        if not all_dates:
            print(f"[Pattern Scorer] ERROR: No valid dates found", file=sys.stderr)
            return np.array([]), np.array([])

        # Fit encoders
        self.solo_type_encoder.fit(list(all_solo_types))
        self.tractor_encoder.fit(list(all_tractors))

        global_min_date = min(all_dates)
        global_max_date = max(all_dates)

        print(f"[Pattern Scorer] Solo types: {list(all_solo_types)}", file=sys.stderr)
        print(f"[Pattern Scorer] Tractors: {sorted(all_tractors)}", file=sys.stderr)
        print(f"[Pattern Scorer] Date range: {global_min_date.date()} to {global_max_date.date()}", file=sys.stderr)

        # Build list of all unique slots
        all_slots = []
        for solo_type in all_solo_types:
            for tractor_id in all_tractors:
                all_slots.append((solo_type, tractor_id))

        # Generate samples for each driver
        for driver_id, assignments in driver_histories.items():
            if len(assignments) < 1:
                continue

            # Analyze driver's historical pattern
            stats = self._compute_driver_history(driver_id, assignments)
            self.driver_stats[driver_id] = stats

            # Track which (date, slot) combinations this driver historically worked
            worked_combinations = set()

            for a in assignments:
                date_str = a.get('serviceDate') or a.get('date')
                solo_type = a.get('soloType', 'solo1').lower()
                tractor_id = a.get('tractorId', 'Tractor_1')

                if not date_str:
                    continue

                try:
                    date = pd.to_datetime(date_str).to_pydatetime()
                except:
                    continue

                # POSITIVE sample: slot the driver historically worked (strong match)
                features = self.extract_features(driver_id, date, solo_type, tractor_id, assignments)
                X_samples.append(features)
                y_labels.append(1)

                worked_combinations.add((date, solo_type, tractor_id))

            # NEGATIVE samples: slots the driver did NOT work (weak/no match)
            dates_worked = list(set(
                pd.to_datetime(a.get('serviceDate') or a.get('date')).to_pydatetime()
                for a in assignments
                if a.get('serviceDate') or a.get('date')
            ))

            for date in dates_worked:
                # Sample slots the driver didn't work on this date
                non_matching_slots = [
                    (s, t) for s, t in all_slots
                    if (date, s, t) not in worked_combinations
                ]

                if non_matching_slots:
                    np.random.seed(hash(f"{driver_id}_{date}") % (2**32))
                    num_negatives = min(3, len(non_matching_slots))
                    sampled_indices = np.random.choice(len(non_matching_slots), size=num_negatives, replace=False)

                    for idx in sampled_indices:
                        solo_type, tractor_id = non_matching_slots[idx]
                        features = self.extract_features(driver_id, date, solo_type, tractor_id, assignments)
                        X_samples.append(features)
                        y_labels.append(0)

        X = np.array(X_samples)
        y = np.array(y_labels)

        strong_matches = np.sum(y == 1)
        weak_matches = np.sum(y == 0)

        print(f"\n[Pattern Scorer] {'='*50}", file=sys.stderr)
        print(f"[Pattern Scorer] TRAINING DATA SUMMARY", file=sys.stderr)
        print(f"[Pattern Scorer] {'='*50}", file=sys.stderr)
        print(f"[Pattern Scorer] Total samples: {len(X)}", file=sys.stderr)
        print(f"[Pattern Scorer]   Strong matches (historically worked): {strong_matches}", file=sys.stderr)
        print(f"[Pattern Scorer]   Weak matches (historically didn't work): {weak_matches}", file=sys.stderr)
        print(f"[Pattern Scorer]   Balance ratio: {strong_matches / max(1, weak_matches):.2f}", file=sys.stderr)
        print(f"[Pattern Scorer] {'='*50}\n", file=sys.stderr)

        return X, y

    def fit(self, driver_histories: Dict[str, List[Dict]]) -> bool:
        """Train the pattern scorer on historical assignments."""
        print(f"\n{'='*60}", file=sys.stderr)
        print(f"Training Slot Pattern Affinity Scorer", file=sys.stderr)
        print(f"{'='*60}", file=sys.stderr)

        X, y = self.build_training_data(driver_histories)

        if len(X) < 10:
            print(f"[Pattern Scorer] ERROR: Not enough samples ({len(X)})", file=sys.stderr)
            return False

        # Train/test split
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=42, stratify=y
        )

        print(f"\n[Pattern Scorer] Split:", file=sys.stderr)
        print(f"  Train: {len(X_train)} samples", file=sys.stderr)
        print(f"  Test: {len(X_test)} samples", file=sys.stderr)

        # Train
        print(f"\n[Pattern Scorer] Fitting XGBClassifier...", file=sys.stderr)
        self.model.fit(X_train, y_train)
        self.is_fitted = True

        # Evaluate
        y_pred = self.model.predict(X_test)
        accuracy = accuracy_score(y_test, y_pred)
        precision = precision_score(y_test, y_pred, zero_division=0)
        recall = recall_score(y_test, y_pred, zero_division=0)
        f1 = f1_score(y_test, y_pred, zero_division=0)

        print(f"\n{'='*60}", file=sys.stderr)
        print(f"Pattern Scorer Training Results", file=sys.stderr)
        print(f"{'='*60}", file=sys.stderr)
        print(f"Metrics:", file=sys.stderr)
        print(f"  Accuracy:  {accuracy:.3f}", file=sys.stderr)
        print(f"  Precision: {precision:.3f}", file=sys.stderr)
        print(f"  Recall:    {recall:.3f}", file=sys.stderr)
        print(f"  F1 Score:  {f1:.3f}", file=sys.stderr)

        # Feature importance
        importance = self.model.feature_importances_
        print(f"\nFeature Importance:", file=sys.stderr)
        for name, imp in sorted(zip(FEATURE_NAMES, importance), key=lambda x: -x[1]):
            bar = '█' * int(imp * 20)
            print(f"  {name:25s} {imp:.3f} {bar}", file=sys.stderr)

        print(f"{'='*60}\n", file=sys.stderr)

        return True

    def score_slot_affinity(
        self,
        driver_id: str,
        date: str,
        solo_type: str,
        tractor_id: str,
        history: List[Dict]
    ) -> float:
        """
        Score how strongly a slot matches a driver's historical pattern.

        Returns affinity score 0.0-1.0:
        - 1.0 = Strong match (driver frequently worked this exact slot)
        - 0.0 = No match (driver never worked this slot)

        This is PATTERN MATCHING, not prediction.

        Example:
            Driver "Firas" works Solo1_Tractor_1 on Mon/Wed/Fri
            - score_slot_affinity(Firas, Monday, solo1, Tractor_1) → 0.95 (strong match)
            - score_slot_affinity(Firas, Monday, solo2, Tractor_6) → 0.05 (no match)
        """
        # Clear cached stats to use fresh history
        if driver_id in self.driver_stats:
            del self.driver_stats[driver_id]

        # Analyze driver's historical pattern
        stats = self._compute_driver_history(driver_id, history)
        self.driver_stats[driver_id] = stats

        # Parse date
        target_date = pd.to_datetime(date).to_pydatetime()
        day_of_week = (target_date.weekday() + 1) % 7

        # Get slot-specific historical frequency (primary signal)
        slot_key = make_slot_key(solo_type, tractor_id, day_of_week)
        slot_counts = stats.get('slot_counts', {})
        total_days = stats['total_days']

        if total_days > 0:
            slot_count = slot_counts.get(slot_key, 0)
            # Historical frequency is the primary pattern signal
            if slot_count == 0:
                # Driver NEVER worked this slot - very weak match
                slot_freq = 0.0
            elif slot_count == 1:
                # Worked once - moderate match
                slot_freq = 0.70
            else:
                # Worked multiple times - strong match
                slot_freq = min(0.80 + (slot_count - 2) * 0.05, 0.98)
        else:
            slot_freq = 0.0

        # If model is fitted, blend with XGBoost pattern score
        if self.is_fitted and total_days >= 3:
            try:
                features = self.extract_features(driver_id, date, solo_type, tractor_id, history)
                X = np.array([features])
                xgb_score = self.model.predict_proba(X)[0][1]

                # Blend: 50% historical frequency, 50% XGBoost pattern score
                blended = 0.5 * slot_freq + 0.5 * xgb_score
                return float(blended)
            except Exception as e:
                print(f"[Pattern Scorer] Scoring error: {e}", file=sys.stderr)

        return float(slot_freq)

    def save(self, model_path: str = MODEL_PATH, encoders_path: str = ENCODERS_PATH):
        """Save model and encoders to disk."""
        if self.is_fitted:
            self.model.save_model(model_path)
            print(f"[Pattern Scorer] Model saved to {model_path}", file=sys.stderr)

            # Save encoders
            encoders_data = {
                'solo_type_classes': self.solo_type_encoder.classes_.tolist(),
                'tractor_classes': self.tractor_encoder.classes_.tolist(),
            }

            os.makedirs(os.path.dirname(encoders_path), exist_ok=True)
            with open(encoders_path, 'w') as f:
                json.dump(encoders_data, f, indent=2)
            print(f"[Pattern Scorer] Encoders saved to {encoders_path}", file=sys.stderr)

    def load(self, model_path: str = MODEL_PATH, encoders_path: str = ENCODERS_PATH) -> bool:
        """Load model and encoders from disk."""
        try:
            self.model.load_model(model_path)
            self.is_fitted = True
            print(f"[Pattern Scorer] Model loaded from {model_path}", file=sys.stderr)

            # Load encoders
            with open(encoders_path, 'r') as f:
                encoders_data = json.load(f)

            self.solo_type_encoder.fit(encoders_data['solo_type_classes'])
            self.tractor_encoder.fit(encoders_data['tractor_classes'])
            print(f"[Pattern Scorer] Encoders loaded from {encoders_path}", file=sys.stderr)

            return True
        except Exception as e:
            print(f"[Pattern Scorer] Failed to load: {e}", file=sys.stderr)
            return False


# Backward compatibility aliases
SlotAwareAvailabilityClassifier = SlotPatternScorer
AvailabilityClassifier = SlotPatternScorer


def main():
    """CLI entry point."""
    if not sys.stdin.isatty():
        input_data = json.loads(sys.stdin.read())
        action = input_data.get('action', 'train')
    else:
        if len(sys.argv) < 2:
            print("Usage: python xgboost_availability.py <action>")
            sys.exit(1)
        action = sys.argv[1]
        input_data = {}

    if action == "train":
        driver_histories = input_data.get('driverHistories', {}) or input_data.get('histories', {})

        scorer = SlotPatternScorer()
        success = scorer.fit(driver_histories)

        if success:
            scorer.save()
            print(json.dumps({'success': True, 'message': 'Slot pattern scorer trained and saved'}))
        else:
            print(json.dumps({'success': False, 'error': 'Training failed'}))

    elif action == "predict":
        # Keep 'predict' action for backward compatibility, but it's really scoring affinity
        driver_id = input_data.get('driverId')
        date = input_data.get('date')
        solo_type = input_data.get('soloType', 'solo1')
        tractor_id = input_data.get('tractorId', 'Tractor_1')
        history = input_data.get('history', [])

        scorer = SlotPatternScorer()
        if scorer.load():
            affinity = scorer.score_slot_affinity(driver_id, date, solo_type, tractor_id, history)
            # Return as 'probability' for backward compatibility, but it's really affinity score
            print(json.dumps({'probability': affinity}))
        else:
            print(json.dumps({'error': 'Model not found'}))

    elif action == "batch_predict":
        """
        Batch pattern scoring for ALL drivers × ALL blocks.

        Input:
        {
            "action": "batch_predict",
            "drivers": [
                {"id": "driver1", "name": "Firas", "history": [{serviceDate, soloType, tractorId}, ...]},
                ...
            ],
            "blocks": [
                {"date": "2025-12-15", "soloType": "solo1", "tractorId": "Tractor_1"},
                {"date": "2025-12-15", "soloType": "solo2", "tractorId": "Tractor_6"},
                ...
            ]
        }

        Output:
        {
            "predictions": {
                "driver1": {
                    "solo1|Tractor_1|2025-12-15": 0.95,  // Strong pattern match
                    "solo2|Tractor_6|2025-12-15": 0.05,  // No pattern match
                    ...
                },
                ...
            }
        }

        Note: 'predictions' key kept for backward compatibility, but values are affinity scores.
        """
        drivers = input_data.get('drivers', [])
        blocks = input_data.get('blocks', [])

        scorer = SlotPatternScorer()
        scorer.load()

        # Output is affinity scores, not predictions
        affinity_scores = {}

        for driver in drivers:
            driver_id = driver.get('id')
            history = driver.get('history', [])

            # Analyze driver's historical pattern once
            stats = scorer._compute_driver_history(driver_id, history)
            scorer.driver_stats[driver_id] = stats

            driver_scores = {}
            for block in blocks:
                date = block.get('date')
                solo_type = block.get('soloType', 'solo1')
                tractor_id = block.get('tractorId', 'Tractor_1')

                key = f"{solo_type}|{tractor_id}|{date}"
                affinity = scorer.score_slot_affinity(driver_id, date, solo_type, tractor_id, history)
                driver_scores[key] = round(affinity, 3)

            affinity_scores[driver_id] = driver_scores

        # Return as 'predictions' for backward compatibility
        print(json.dumps({
            'predictions': affinity_scores,
            'driverCount': len(drivers),
            'blockCount': len(blocks),
            'totalPredictions': len(drivers) * len(blocks)
        }))

    else:
        print(json.dumps({'error': f'Unknown action: {action}'}))
        sys.exit(1)


if __name__ == '__main__':
    main()
