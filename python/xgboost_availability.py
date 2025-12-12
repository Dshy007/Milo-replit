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
            n_estimators=100,
            max_depth=6,
            learning_rate=0.1,
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

        For each driver:
        - POSITIVE samples: dates they worked (label=1)
        - NEGATIVE samples: sampled dates they didn't work (label=0)

        Balanced sampling: ~1:1 ratio of positive to negative samples.

        Returns: (X, y) where X is features and y is labels
        """
        X_samples = []
        y_labels = []

        print(f"[Training] Building training data from {len(driver_histories)} drivers...", file=sys.stderr)

        for driver_id, assignments in driver_histories.items():
            if len(assignments) < 1:
                continue  # Need at least 1 shift

            # Compute stats for this driver (cache it)
            stats = self._compute_driver_stats(driver_id, assignments)
            self.driver_stats[driver_id] = stats
            work_dates = stats['work_dates']

            if len(work_dates) < 1:
                continue

            # Get date range for this driver
            min_date = min(work_dates)
            max_date = max(work_dates)
            work_dates_set = set(work_dates)

            # Generate all dates in range
            all_dates_in_range = []
            current = min_date
            while current <= max_date:
                all_dates_in_range.append(current)
                current += timedelta(days=1)

            # Non-work dates (for negative samples)
            non_work_dates = [d for d in all_dates_in_range if d not in work_dates_set]

            # POSITIVE samples: each work date (label=1)
            # For week-to-week matching, use ALL work dates as positive samples
            for work_date in work_dates:
                # Create history up to this date (for realistic feature extraction)
                history_before = [
                    a for a in assignments
                    if pd.to_datetime(a.get('serviceDate') or a.get('date')).to_pydatetime() < work_date
                ]

                # Even with no prior history, we can still use day-of-week features
                if len(history_before) >= 0:  # Allow all samples
                    # Temporarily update stats based on history before this date
                    temp_stats = self._compute_driver_stats(driver_id, history_before)
                    self.driver_stats[driver_id] = temp_stats

                    features = self.extract_features(driver_id, work_date, history_before)
                    X_samples.append(features)
                    y_labels.append(1)

            # Restore full stats
            self.driver_stats[driver_id] = stats

            # NEGATIVE samples: sample non-work dates (label=0)
            # Sample approximately same number as positive samples for balance
            num_positive = len([d for d in work_dates[2:]])
            num_negative_to_sample = min(len(non_work_dates), num_positive)

            if num_negative_to_sample > 0:
                # Sample evenly across the date range
                np.random.seed(42)
                sampled_non_work = np.random.choice(
                    len(non_work_dates),
                    size=num_negative_to_sample,
                    replace=False
                )

                for idx in sampled_non_work:
                    non_work_date = non_work_dates[idx]

                    # Create history up to this date
                    history_before = [
                        a for a in assignments
                        if pd.to_datetime(a.get('serviceDate') or a.get('date')).to_pydatetime() < non_work_date
                    ]

                    if len(history_before) >= 0:  # Allow all samples
                        temp_stats = self._compute_driver_stats(driver_id, history_before)
                        self.driver_stats[driver_id] = temp_stats

                        features = self.extract_features(driver_id, non_work_date, history_before)
                        X_samples.append(features)
                        y_labels.append(0)

            # Restore full stats
            self.driver_stats[driver_id] = stats

        X = np.array(X_samples)
        y = np.array(y_labels)

        positive_count = np.sum(y == 1)
        negative_count = np.sum(y == 0)

        print(f"[Training] Generated {len(X)} samples:", file=sys.stderr)
        print(f"[Training]   Positive (worked): {positive_count}", file=sys.stderr)
        print(f"[Training]   Negative (didn't work): {negative_count}", file=sys.stderr)
        print(f"[Training]   Balance ratio: {positive_count / max(1, negative_count):.2f}", file=sys.stderr)

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
