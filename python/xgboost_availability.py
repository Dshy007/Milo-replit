"""
XGBoost Availability Classifier (Stage 1)

Binary classification model that predicts whether a driver will work on a given date.
XGBoost LEARNS patterns directly from data - no pre-clustering constraints.

Features (6 total - all learned by XGBoost):
  0. day_of_week (int 0-6): Sunday=0, Saturday=6
  1. week_of_month (int 1-4): Which week in the month
  2. days_since_last_worked (int): Gap since last assignment
  3. historical_freq_this_day (float): % times worked this weekday
  4. rolling_interval (float): Average days between shifts
  5. is_rolling_match (bool 0/1): Does date match rolling pattern?

NO CLUSTERING - Any driver can work any shift. XGBoost learns the patterns.

Output:
  - predict_proba() returns probability 0.0-1.0 of working
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
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score

# Model save path
MODEL_PATH = os.path.join(os.path.dirname(__file__), 'models', 'availability_model.json')

# Feature names for debugging
FEATURE_NAMES = [
    'day_of_week',
    'week_of_month',
    'days_since_last_worked',
    'historical_freq_this_day',
    'rolling_interval',
    'is_rolling_match'
]


class AvailabilityClassifier:
    """
    Stage 1: XGBClassifier for driver availability prediction.

    Predicts probability (0-1) that a driver will work on a specific date.
    NO CONSTRAINTS - XGBoost learns all patterns from data.
    """

    def __init__(self):
        self.model = XGBClassifier(
            n_estimators=300,
            max_depth=8,
            learning_rate=0.05,
            min_child_weight=3,
            subsample=0.8,
            colsample_bytree=0.8,
            objective='binary:logistic',
            eval_metric='logloss',
            random_state=42,
            verbosity=0
        )
        self.is_fitted = False
        self.driver_stats = {}  # Cache for driver statistics

    def _get_week_of_month(self, date: datetime) -> int:
        """Get week of month (1-4)."""
        first_day = date.replace(day=1)
        dom = date.day
        adjusted_dom = dom + first_day.weekday()
        return min(4, (adjusted_dom - 1) // 7 + 1)

    def _compute_driver_stats(self, driver_id: str, history: List[Dict]) -> Dict:
        """
        Compute statistics for a driver from their history.

        Returns dict with:
        - work_dates: sorted list of dates worked
        - weekday_counts: {0-6: count} how many times worked each weekday
        - total_days: total assignments
        - rolling_interval: average days between shifts
        - interval_std: standard deviation of intervals
        """
        if not history:
            return {
                'work_dates': [],
                'weekday_counts': defaultdict(int),
                'total_days': 0,
                'rolling_interval': 3.0,  # Default
                'interval_std': 1.0
            }

        # Parse work dates
        work_dates = []
        weekday_counts = defaultdict(int)

        for assignment in history:
            date_str = assignment.get('serviceDate') or assignment.get('date')
            if date_str:
                try:
                    if isinstance(date_str, str):
                        date = pd.to_datetime(date_str).to_pydatetime()
                    else:
                        date = pd.to_datetime(date_str).to_pydatetime()

                    work_dates.append(date)
                    # Python weekday: Mon=0, Sun=6. We want Sun=0, Sat=6
                    weekday = (date.weekday() + 1) % 7
                    weekday_counts[weekday] += 1
                except:
                    continue

        work_dates = sorted(set(work_dates))

        # Compute rolling interval (average gap between shifts)
        if len(work_dates) >= 2:
            intervals = []
            for i in range(1, len(work_dates)):
                gap = (work_dates[i] - work_dates[i-1]).days
                if gap > 0 and gap < 30:  # Ignore huge gaps
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
            'weekday_counts': dict(weekday_counts),
            'total_days': len(work_dates),
            'rolling_interval': rolling_interval,
            'interval_std': interval_std
        }

    def extract_features(
        self,
        driver_id: str,
        date: datetime,
        driver_history: List[Dict]
    ) -> List[float]:
        """
        Extract 6 features for a driver-date pair.

        Features (XGBoost learns patterns from these):
        0. day_of_week (int 0-6): Sunday=0, Saturday=6
        1. week_of_month (int 1-4): Which week in the month
        2. days_since_last_worked (int): Gap since last assignment
        3. historical_freq_this_day (float): % times worked this weekday
        4. rolling_interval (float): Average days between shifts
        5. is_rolling_match (bool 0/1): Does date match rolling pattern?

        Returns: [day_of_week, week_of_month, days_since_last, freq, interval, is_match]
        """
        # Ensure date is datetime
        if isinstance(date, str):
            date = pd.to_datetime(date).to_pydatetime()

        # Get or compute driver stats
        if driver_id in self.driver_stats:
            stats = self.driver_stats[driver_id]
        else:
            stats = self._compute_driver_stats(driver_id, driver_history)
            self.driver_stats[driver_id] = stats

        # Feature 0: day_of_week (Sun=0, Sat=6)
        day_of_week = (date.weekday() + 1) % 7

        # Feature 1: week_of_month (1-4)
        week_of_month = self._get_week_of_month(date)

        # Feature 2: days_since_last_worked
        work_dates = stats['work_dates']
        if work_dates:
            # Find most recent work date before target date
            past_dates = [d for d in work_dates if d < date]
            if past_dates:
                days_since_last = (date - max(past_dates)).days
            else:
                days_since_last = 14  # Default if no prior history
        else:
            days_since_last = 14

        # Cap at 30 days
        days_since_last = min(days_since_last, 30)

        # Feature 3: historical_freq_this_day (0.0-1.0)
        weekday_counts = stats['weekday_counts']
        total_days = stats['total_days']
        if total_days > 0:
            freq_this_day = weekday_counts.get(day_of_week, 0) / total_days
        else:
            freq_this_day = 0.0

        # Feature 4: rolling_interval
        rolling_interval = stats['rolling_interval']

        # Feature 5: is_rolling_match (does this date fit the pattern?)
        # Check if days_since_last is close to rolling_interval
        interval_std = stats['interval_std']
        if work_dates and rolling_interval > 0:
            # How far off is this date from expected next work date?
            deviation = abs(days_since_last - rolling_interval)
            # Match if within 1 std deviation (or 1 day minimum)
            tolerance = max(1.0, interval_std)
            is_rolling_match = 1.0 if deviation <= tolerance else 0.0
        else:
            is_rolling_match = 0.5  # Unknown

        return [
            float(day_of_week),
            float(week_of_month),
            float(days_since_last),
            float(freq_this_day),
            float(rolling_interval),
            float(is_rolling_match)
        ]

    def build_training_data(
        self,
        driver_histories: Dict[str, List[Dict]]
    ) -> Tuple[np.ndarray, np.ndarray]:
        """
        Generate balanced training data from driver histories.

        For each driver, for each day in their date range:
        - If they worked that day → positive sample (label=1)
        - If they didn't work → negative sample (label=0)

        Balance: Equal positive and negative samples PER DRIVER.
        Minimum: Each driver contributes at least 10 samples.

        Returns: (X, y) where X is features and y is labels
        """
        X_samples = []
        y_labels = []
        driver_ids = []  # Track which driver each sample belongs to

        # Stats tracking
        driver_sample_counts = {}

        print(f"[Training] Building training data from {len(driver_histories)} drivers...", file=sys.stderr)

        # First pass: find global date range across ALL drivers
        all_work_dates = []
        for driver_id, assignments in driver_histories.items():
            for assignment in assignments:
                date_str = assignment.get('serviceDate') or assignment.get('date')
                if date_str:
                    try:
                        date = pd.to_datetime(date_str).to_pydatetime()
                        all_work_dates.append(date)
                    except:
                        continue

        if not all_work_dates:
            print(f"[Training] ERROR: No valid dates found in histories", file=sys.stderr)
            return np.array([]), np.array([])

        global_min_date = min(all_work_dates)
        global_max_date = max(all_work_dates)
        total_days = (global_max_date - global_min_date).days + 1

        print(f"[Training] Date range: {global_min_date.date()} to {global_max_date.date()} ({total_days} days)", file=sys.stderr)

        # Generate all dates in the global range
        all_dates_in_range = []
        current = global_min_date
        while current <= global_max_date:
            all_dates_in_range.append(current)
            current += timedelta(days=1)

        # Second pass: generate samples for each driver
        for driver_id, assignments in driver_histories.items():
            if len(assignments) < 1:
                continue

            # Compute stats for this driver (cache it)
            stats = self._compute_driver_stats(driver_id, assignments)
            self.driver_stats[driver_id] = stats
            work_dates = stats['work_dates']
            work_dates_set = set(work_dates)

            if len(work_dates) < 1:
                continue

            # Count positives and negatives for this driver
            num_positive = len(work_dates)

            # Non-work dates for this driver (within global range)
            non_work_dates = [d for d in all_dates_in_range if d not in work_dates_set]

            # Balance: sample EQUAL number of negatives as positives
            # But ensure minimum of 5 negatives even for drivers with few positives
            num_negative_to_sample = max(min(len(non_work_dates), num_positive), 5)

            # Ensure minimum 10 total samples per driver
            min_samples_per_driver = 10
            if num_positive + num_negative_to_sample < min_samples_per_driver:
                # Add more negatives to reach minimum
                num_negative_to_sample = min(
                    len(non_work_dates),
                    min_samples_per_driver - num_positive
                )

            driver_positives = 0
            driver_negatives = 0

            # POSITIVE samples: each work date (label=1)
            for work_date in work_dates:
                # Create history up to this date (for realistic feature extraction)
                history_before = [
                    a for a in assignments
                    if pd.to_datetime(a.get('serviceDate') or a.get('date')).to_pydatetime() < work_date
                ]

                # Temporarily update stats based on history before this date
                temp_stats = self._compute_driver_stats(driver_id, history_before)
                self.driver_stats[driver_id] = temp_stats

                features = self.extract_features(driver_id, work_date, history_before)
                X_samples.append(features)
                y_labels.append(1)
                driver_ids.append(driver_id)
                driver_positives += 1

            # Restore full stats
            self.driver_stats[driver_id] = stats

            # NEGATIVE samples: sample non-work dates (label=0)
            if num_negative_to_sample > 0 and len(non_work_dates) > 0:
                # Use consistent random seed per driver for reproducibility
                np.random.seed(hash(driver_id) % (2**32))

                sample_size = min(num_negative_to_sample, len(non_work_dates))
                sampled_indices = np.random.choice(
                    len(non_work_dates),
                    size=sample_size,
                    replace=False
                )

                for idx in sampled_indices:
                    non_work_date = non_work_dates[idx]

                    # Create history up to this date
                    history_before = [
                        a for a in assignments
                        if pd.to_datetime(a.get('serviceDate') or a.get('date')).to_pydatetime() < non_work_date
                    ]

                    temp_stats = self._compute_driver_stats(driver_id, history_before)
                    self.driver_stats[driver_id] = temp_stats

                    features = self.extract_features(driver_id, non_work_date, history_before)
                    X_samples.append(features)
                    y_labels.append(0)
                    driver_ids.append(driver_id)
                    driver_negatives += 1

            # Restore full stats
            self.driver_stats[driver_id] = stats

            # Track per-driver counts
            driver_sample_counts[driver_id] = {
                'positive': driver_positives,
                'negative': driver_negatives,
                'total': driver_positives + driver_negatives
            }

        X = np.array(X_samples)
        y = np.array(y_labels)

        positive_count = np.sum(y == 1)
        negative_count = np.sum(y == 0)

        # Calculate per-driver statistics
        totals = [c['total'] for c in driver_sample_counts.values()]
        positives = [c['positive'] for c in driver_sample_counts.values()]
        negatives = [c['negative'] for c in driver_sample_counts.values()]

        print(f"\n[Training] {'='*50}", file=sys.stderr)
        print(f"[Training] TRAINING DATA SUMMARY", file=sys.stderr)
        print(f"[Training] {'='*50}", file=sys.stderr)
        print(f"[Training] Total samples: {len(X)}", file=sys.stderr)
        print(f"[Training]   Positive (worked): {positive_count}", file=sys.stderr)
        print(f"[Training]   Negative (didn't work): {negative_count}", file=sys.stderr)
        print(f"[Training]   Balance ratio: {positive_count / max(1, negative_count):.2f}", file=sys.stderr)
        print(f"[Training]", file=sys.stderr)
        print(f"[Training] Per-driver stats ({len(driver_sample_counts)} drivers):", file=sys.stderr)
        print(f"[Training]   Samples - min: {min(totals)}, max: {max(totals)}, avg: {np.mean(totals):.1f}", file=sys.stderr)
        print(f"[Training]   Positives - min: {min(positives)}, max: {max(positives)}, avg: {np.mean(positives):.1f}", file=sys.stderr)
        print(f"[Training]   Negatives - min: {min(negatives)}, max: {max(negatives)}, avg: {np.mean(negatives):.1f}", file=sys.stderr)
        print(f"[Training] {'='*50}\n", file=sys.stderr)

        return X, y

    def fit(self, driver_histories: Dict[str, List[Dict]]) -> bool:
        """
        Train the availability classifier.

        Args:
            driver_histories: {driver_id: [{serviceDate, day, time, ...}, ...]}

        Returns:
            True if training succeeded
        """
        print(f"\n{'='*60}", file=sys.stderr)
        print(f"Stage 1: Training Availability Classifier", file=sys.stderr)
        print(f"{'='*60}", file=sys.stderr)

        # Build training data
        X, y = self.build_training_data(driver_histories)

        if len(X) < 10:
            print(f"[Training] ERROR: Not enough samples ({len(X)}), need at least 10", file=sys.stderr)
            return False

        # Train/test split (80/20)
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=42, stratify=y
        )

        print(f"\n[Training] Split:", file=sys.stderr)
        print(f"  Train: {len(X_train)} samples", file=sys.stderr)
        print(f"  Test: {len(X_test)} samples", file=sys.stderr)

        # Train the model
        print(f"\n[Training] Fitting XGBClassifier...", file=sys.stderr)
        self.model.fit(X_train, y_train)
        self.is_fitted = True

        # Evaluate on test set
        y_pred = self.model.predict(X_test)
        y_proba = self.model.predict_proba(X_test)[:, 1]

        accuracy = accuracy_score(y_test, y_pred)
        precision = precision_score(y_test, y_pred, zero_division=0)
        recall = recall_score(y_test, y_pred, zero_division=0)
        f1 = f1_score(y_test, y_pred, zero_division=0)

        print(f"\n{'='*60}", file=sys.stderr)
        print(f"Stage 1 Training Results", file=sys.stderr)
        print(f"{'='*60}", file=sys.stderr)
        print(f"Training samples: {len(X_train)}", file=sys.stderr)
        print(f"Test samples: {len(X_test)}", file=sys.stderr)
        print(f"", file=sys.stderr)
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

    def predict_availability(
        self,
        driver_id: str,
        date: str,
        history: List[Dict]
    ) -> float:
        """
        Predict probability (0-1) that driver will work on date.

        For week-to-week matching: uses day-of-week frequency as primary signal.
        If driver worked Monday last week, predict high for Monday this week.

        Args:
            driver_id: Driver identifier
            date: Date string (YYYY-MM-DD)
            history: Driver's assignment history

        Returns:
            Probability 0.0-1.0
        """
        # Clear cached stats for this driver to use fresh history
        if driver_id in self.driver_stats:
            del self.driver_stats[driver_id]

        # Compute stats for this driver
        stats = self._compute_driver_stats(driver_id, history)
        self.driver_stats[driver_id] = stats

        # Parse target date
        target_date = pd.to_datetime(date).to_pydatetime()
        target_dow = (target_date.weekday() + 1) % 7  # Sun=0, Sat=6

        # For week-to-week matching: if driver worked this day-of-week in history,
        # they're likely to work it again
        weekday_counts = stats['weekday_counts']
        total_days = stats['total_days']

        # Calculate day-of-week frequency as base probability
        if total_days > 0:
            # How many times did they work on this weekday?
            times_worked_this_day = weekday_counts.get(target_dow, 0)
            # For 1-week data: if they worked this day at all, high probability
            # Scale: 0 times = 0%, 1 time = 90%, 2+ times = 95%+
            if times_worked_this_day == 0:
                freq_this_day = 0.0
            elif times_worked_this_day == 1:
                freq_this_day = 0.90
            else:
                freq_this_day = min(0.95 + (times_worked_this_day - 2) * 0.01, 0.99)
        else:
            freq_this_day = 0.0

        # If model is fitted and has good training data, blend with XGBoost
        if self.is_fitted and total_days >= 3:
            try:
                features = self.extract_features(driver_id, date, history)
                X = np.array([features])
                xgb_proba = self.model.predict_proba(X)[0][1]

                # Blend: 60% day-of-week frequency, 40% XGBoost
                blended = 0.6 * freq_this_day + 0.4 * xgb_proba
                return float(blended)
            except Exception as e:
                pass  # Fall through to frequency-only

        # For sparse data (1-week), use pure day-of-week frequency
        return float(freq_this_day)

    def save(self, model_path: str = MODEL_PATH):
        """Save model to disk."""
        if self.is_fitted:
            self.model.save_model(model_path)
            print(f"[Availability] Model saved to {model_path}", file=sys.stderr)

    def load(self, model_path: str = MODEL_PATH) -> bool:
        """Load model from disk."""
        try:
            self.model.load_model(model_path)
            self.is_fitted = True
            print(f"[Availability] Model loaded from {model_path}", file=sys.stderr)
            return True
        except Exception as e:
            print(f"[Availability] Failed to load model: {e}", file=sys.stderr)
            return False


def main():
    """CLI entry point for testing."""
    # Check if input is coming from stdin
    if not sys.stdin.isatty():
        # Read JSON from stdin
        input_data = json.loads(sys.stdin.read())
        action = input_data.get('action', 'train_and_predict')
    else:
        if len(sys.argv) < 2:
            print("Usage: python xgboost_availability.py <action>")
            print("Actions: train, predict, train_and_predict")
            sys.exit(1)
        action = sys.argv[1]
        input_data = {}

    if action == "train":
        driver_histories = input_data.get('driverHistories', {}) or input_data.get('histories', {})

        classifier = AvailabilityClassifier()
        success = classifier.fit(driver_histories)

        if success:
            classifier.save()
            print(json.dumps({'success': True, 'message': 'Model trained and saved'}))
        else:
            print(json.dumps({'success': False, 'error': 'Training failed'}))

    elif action == "predict":
        driver_id = input_data.get('driverId')
        date = input_data.get('date')
        history = input_data.get('history', [])

        classifier = AvailabilityClassifier()
        if classifier.load():
            prob = classifier.predict_availability(driver_id, date, history)
            print(json.dumps({'probability': prob}))
        else:
            print(json.dumps({'error': 'Model not found'}))

    elif action == "batch_predict":
        """
        Batch prediction for ALL drivers × ALL dates at once.
        Much faster than calling predict() for each pair.

        Input:
        {
            "action": "batch_predict",
            "drivers": [
                {"id": "driver1", "name": "Brian", "history": [{serviceDate: ...}, ...]},
                {"id": "driver2", "name": "Ray", "history": [...]},
                ...
            ],
            "dates": ["2025-12-15", "2025-12-16", ...]
        }

        Output:
        {
            "predictions": {
                "driver1": {"2025-12-15": 0.9, "2025-12-16": 0.8, ...},
                "driver2": {"2025-12-15": 0.7, ...},
                ...
            }
        }
        """
        drivers = input_data.get('drivers', [])
        dates = input_data.get('dates', [])

        classifier = AvailabilityClassifier()
        model_loaded = classifier.load()

        predictions = {}

        for driver in drivers:
            driver_id = driver.get('id')
            history = driver.get('history', [])

            # Compute stats once per driver
            stats = classifier._compute_driver_stats(driver_id, history)
            classifier.driver_stats[driver_id] = stats

            driver_predictions = {}
            for date in dates:
                prob = classifier.predict_availability(driver_id, date, history)
                driver_predictions[date] = round(prob, 3)

            predictions[driver_id] = driver_predictions

        print(json.dumps({
            'predictions': predictions,
            'driverCount': len(drivers),
            'dateCount': len(dates),
            'totalPredictions': len(drivers) * len(dates)
        }))

    elif action == "debug_features":
        # Debug: Show exact features for a driver-date pair
        driver_id = input_data.get('driver_id')
        date_str = input_data.get('date')
        history = input_data.get('history', [])

        classifier = AvailabilityClassifier()

        # Compute stats
        stats = classifier._compute_driver_stats(driver_id, history)
        classifier.driver_stats[driver_id] = stats

        # Extract features
        features = classifier.extract_features(driver_id, date_str, history)

        # Parse date for analysis
        date = pd.to_datetime(date_str).to_pydatetime()
        day_of_week = (date.weekday() + 1) % 7  # Sun=0
        day_names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

        print(f"\n{'='*60}", file=sys.stderr)
        print(f"DEBUG: Features for {driver_id[:8]}... on {date_str} ({day_names[day_of_week]})", file=sys.stderr)
        print(f"{'='*60}", file=sys.stderr)

        print(f"\nDriver Stats:", file=sys.stderr)
        print(f"  Total work dates: {len(stats['work_dates'])}", file=sys.stderr)
        print(f"  Weekday counts: {stats['weekday_counts']}", file=sys.stderr)
        print(f"  Rolling interval: {stats['rolling_interval']:.1f} days", file=sys.stderr)
        print(f"  Interval std: {stats['interval_std']:.1f}", file=sys.stderr)

        # Show frequency for each day
        total_days = stats['total_days']
        print(f"\nDay frequencies (total {total_days} shifts):", file=sys.stderr)
        for i, day in enumerate(day_names):
            count = stats['weekday_counts'].get(i, 0)
            freq = count / total_days if total_days > 0 else 0
            marker = " <-- TARGET DAY" if i == day_of_week else ""
            print(f"  {day}: {count} shifts = {freq*100:.1f}%{marker}", file=sys.stderr)

        print(f"\nExtracted Features for {day_names[day_of_week]}:", file=sys.stderr)
        for name, val in zip(FEATURE_NAMES, features):
            print(f"  {name:25s} = {val:.3f}", file=sys.stderr)

        # Key insight
        freq_this_day = features[3]  # historical_freq_this_day
        print(f"\n{'='*60}", file=sys.stderr)
        print(f"KEY INSIGHT:", file=sys.stderr)
        print(f"  historical_freq_this_day = {freq_this_day:.3f} ({freq_this_day*100:.1f}%)", file=sys.stderr)
        if freq_this_day == 0:
            print(f"  >>> Driver has NEVER worked on {day_names[day_of_week]}!", file=sys.stderr)
            print(f"  >>> This should result in LOW probability!", file=sys.stderr)
        print(f"{'='*60}\n", file=sys.stderr)

        result = {
            'features': dict(zip(FEATURE_NAMES, features)),
            'stats': {
                'total_shifts': len(stats['work_dates']),
                'weekday_counts': stats['weekday_counts'],
                'rolling_interval': stats['rolling_interval'],
                'freq_this_day': freq_this_day
            }
        }
        print(json.dumps(result))

    elif action == "test_build_training_data":
        # Just test build_training_data WITHOUT training
        driver_histories = input_data.get('histories', {})

        classifier = AvailabilityClassifier()
        X, y = classifier.build_training_data(driver_histories)

        # Output summary (detailed stats already printed to stderr)
        result = {
            'success': True,
            'total_samples': len(X),
            'positive_samples': int(np.sum(y == 1)),
            'negative_samples': int(np.sum(y == 0)),
            'balance_ratio': float(np.sum(y == 1) / max(1, np.sum(y == 0))),
            'drivers_included': len(driver_histories)
        }
        print(json.dumps(result))

    elif action == "test_extreme_cases":
        # Test extreme cases: Tuesday worker vs Never-Tuesday worker
        tuesday_worker = input_data.get('tuesdayWorker', {})
        never_tuesday = input_data.get('neverTuesdayWorker', {})
        test_date = input_data.get('testDate')

        # Load the trained model
        classifier = AvailabilityClassifier()
        model_loaded = classifier.load()

        print(f"\n{'='*60}", file=sys.stderr)
        print(f"STEP 4: Feature Importance", file=sys.stderr)
        print(f"{'='*60}", file=sys.stderr)

        if model_loaded and classifier.is_fitted:
            importance = classifier.model.feature_importances_
            print(f"\nFeature Importance (from trained model):", file=sys.stderr)
            for name, imp in sorted(zip(FEATURE_NAMES, importance), key=lambda x: -x[1]):
                bar = '█' * int(imp * 40)
                print(f"  {name:25s} {imp:.3f} {bar}", file=sys.stderr)
        else:
            print(f"WARNING: Model not loaded, cannot show feature importance", file=sys.stderr)

        print(f"\n{'='*60}", file=sys.stderr)
        print(f"STEP 5: Extreme Case Testing", file=sys.stderr)
        print(f"{'='*60}", file=sys.stderr)

        # Test Tuesday worker
        tw_id = tuesday_worker.get('driverId')
        tw_history = tuesday_worker.get('history', [])

        # Test Never-Tuesday worker
        nt_id = never_tuesday.get('driverId')
        nt_history = never_tuesday.get('history', [])

        # Compute stats for each
        tw_stats = classifier._compute_driver_stats(tw_id, tw_history)
        nt_stats = classifier._compute_driver_stats(nt_id, nt_history)

        classifier.driver_stats[tw_id] = tw_stats
        classifier.driver_stats[nt_id] = nt_stats

        # Extract features for each on test date
        tw_features = classifier.extract_features(tw_id, test_date, tw_history)
        nt_features = classifier.extract_features(nt_id, test_date, nt_history)

        print(f"\nTuesday Worker ({tw_id[:8]}...):", file=sys.stderr)
        print(f"  Total shifts: {len(tw_stats['work_dates'])}", file=sys.stderr)
        print(f"  Weekday counts: {tw_stats['weekday_counts']}", file=sys.stderr)
        print(f"  Features on {test_date}:", file=sys.stderr)
        for name, val in zip(FEATURE_NAMES, tw_features):
            print(f"    {name:25s} = {val:.3f}", file=sys.stderr)

        print(f"\nNever-Tuesday Worker ({nt_id[:8]}...):", file=sys.stderr)
        print(f"  Total shifts: {len(nt_stats['work_dates'])}", file=sys.stderr)
        print(f"  Weekday counts: {nt_stats['weekday_counts']}", file=sys.stderr)
        print(f"  Features on {test_date}:", file=sys.stderr)
        for name, val in zip(FEATURE_NAMES, nt_features):
            print(f"    {name:25s} = {val:.3f}", file=sys.stderr)

        # Predict using XGBoost model directly (not the blended predict_availability)
        tw_prob = 0.0
        nt_prob = 0.0

        if model_loaded and classifier.is_fitted:
            X_tw = np.array([tw_features])
            X_nt = np.array([nt_features])

            tw_prob = float(classifier.model.predict_proba(X_tw)[0][1])
            nt_prob = float(classifier.model.predict_proba(X_nt)[0][1])

            print(f"\n{'='*60}", file=sys.stderr)
            print(f"XGBoost Raw Predictions:", file=sys.stderr)
            print(f"  Tuesday worker:       {tw_prob:.3f} ({tw_prob*100:.1f}%)", file=sys.stderr)
            print(f"  Never-Tuesday worker: {nt_prob:.3f} ({nt_prob*100:.1f}%)", file=sys.stderr)
            print(f"  Difference:           {abs(tw_prob - nt_prob):.3f} ({abs(tw_prob - nt_prob)*100:.1f}%)", file=sys.stderr)
            print(f"{'='*60}\n", file=sys.stderr)
        else:
            print(f"\nWARNING: Model not fitted, using fallback", file=sys.stderr)

        result = {
            'tuesdayWorkerProb': tw_prob,
            'neverTuesdayProb': nt_prob,
            'difference': abs(tw_prob - nt_prob),
            'tuesdayWorkerFeatures': dict(zip(FEATURE_NAMES, tw_features)),
            'neverTuesdayFeatures': dict(zip(FEATURE_NAMES, nt_features)),
        }
        print(json.dumps(result))

    elif action == "train_and_predict":
        # Train on histories and predict for given dates
        driver_histories = input_data.get('histories', {})
        predict_dates = input_data.get('predict_dates', [])

        classifier = AvailabilityClassifier()
        success = classifier.fit(driver_histories)

        if not success:
            print(json.dumps({'error': 'Training failed'}))
            sys.exit(1)

        # Save the model
        classifier.save()

        # Get training metrics
        X, y = classifier.build_training_data(driver_histories)
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=42, stratify=y
        )
        y_pred = classifier.model.predict(X_test)
        accuracy = accuracy_score(y_test, y_pred)
        precision = precision_score(y_test, y_pred, zero_division=0)
        recall = recall_score(y_test, y_pred, zero_division=0)
        f1 = f1_score(y_test, y_pred, zero_division=0)

        # Predict for each driver on each date
        predictions = {}
        for date_str in predict_dates:
            predictions[date_str] = {}
            for driver_id, history in driver_histories.items():
                prob = classifier.predict_availability(driver_id, date_str, history)
                predictions[date_str][driver_id] = prob

        result = {
            'training': {
                'samples': len(X),
                'accuracy': accuracy,
                'precision': precision,
                'recall': recall,
                'f1': f1
            },
            'predictions': predictions
        }

        print(json.dumps(result))

    else:
        print(json.dumps({'error': f'Unknown action: {action}'}))
        sys.exit(1)


if __name__ == '__main__':
    main()
