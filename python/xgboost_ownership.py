"""
XGBoost Ownership Model

Predicts who OWNS each slot based on historical patterns.
KEY TUPLE: (soloType, tractorId, canonicalStartTime, dayOfWeek) -> driver_name

This is a multi-class classification problem where:
- Input: slot features (contract type, tractor, time, day)
- Output: driver who historically owns that slot

Usage:
    python xgboost_ownership.py < input.json

Input JSON:
{
    "action": "train",
    "assignments": [
        {
            "driverId": "uuid",
            "driverName": "John Doe",
            "soloType": "solo1",
            "tractorId": "Tractor_1",
            "startTime": "16:30",
            "dayOfWeek": 0
        },
        ...
    ]
}
"""

import sys
import json
import os
import numpy as np
import pandas as pd
from datetime import datetime
from typing import Dict, List, Any, Tuple, Optional
from collections import defaultdict

from xgboost import XGBClassifier
from sklearn.preprocessing import LabelEncoder
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, classification_report

# Model save paths
MODEL_PATH = os.path.join(os.path.dirname(__file__), 'models', 'ownership_model.json')
ENCODERS_PATH = os.path.join(os.path.dirname(__file__), 'models', 'ownership_encoders.json')

# Canonical start times from contracts (STATIC lookup)
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

# Day names for display
DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']


def time_to_minutes(time_str: str) -> int:
    """Convert HH:MM to minutes since midnight."""
    parts = time_str.split(':')
    return int(parts[0]) * 60 + int(parts[1] if len(parts) > 1 else 0)


def get_canonical_time(solo_type: str, tractor_id: str) -> str:
    """Get canonical start time for a contract slot."""
    key = f"{solo_type}_{tractor_id}"
    return CANONICAL_START_TIMES.get(key, "00:00")


class OwnershipClassifier:
    """
    Multi-class XGBClassifier for predicting slot ownership.

    Features:
    - solo_type_encoded: 0=solo1, 1=solo2
    - tractor_encoded: 0-9 for Tractor_1 through Tractor_10
    - canonical_time_minutes: minutes since midnight (0-1439)
    - day_of_week: 0-6 (Sunday=0)

    Output: driver_name (multi-class)
    """

    def __init__(self):
        self.model = XGBClassifier(
            n_estimators=100,
            max_depth=6,
            learning_rate=0.1,
            objective='multi:softprob',
            eval_metric='mlogloss',
            random_state=42,
            verbosity=0
        )
        self.is_fitted = False

        # Encoders for categorical features
        self.solo_type_encoder = LabelEncoder()
        self.tractor_encoder = LabelEncoder()
        self.driver_encoder = LabelEncoder()

        # Slot ownership: stores list of service dates per driver per slot (for tie-breaking)
        self.slot_ownership: Dict[str, Dict[str, List[str]]] = defaultdict(lambda: defaultdict(list))

    def _make_slot_key(self, solo_type: str, tractor_id: str, canonical_time: str, day_of_week: int) -> str:
        """Create unique key for a slot."""
        return f"{solo_type}|{tractor_id}|{canonical_time}|{day_of_week}"

    def extract_features(
        self,
        solo_type: str,
        tractor_id: str,
        canonical_time: str,
        day_of_week: int
    ) -> List[float]:
        """
        Extract features for a slot.

        Returns: [solo_type_enc, tractor_enc, time_minutes, day_of_week]
        """
        # Encode solo type (with fallback for unseen)
        try:
            solo_enc = self.solo_type_encoder.transform([solo_type])[0]
        except ValueError:
            solo_enc = 0  # Default to solo1

        # Encode tractor (with fallback)
        try:
            tractor_enc = self.tractor_encoder.transform([tractor_id])[0]
        except ValueError:
            tractor_enc = 0  # Default

        # Time in minutes
        time_minutes = time_to_minutes(canonical_time)

        return [
            float(solo_enc),
            float(tractor_enc),
            float(time_minutes),
            float(day_of_week)
        ]

    def build_training_data(
        self,
        assignments: List[Dict[str, Any]]
    ) -> Tuple[np.ndarray, np.ndarray]:
        """
        Build training data from historical assignments.

        Each assignment becomes one training sample.
        Group by slot to track ownership counts.
        """
        print(f"[Ownership] Building training data from {len(assignments)} assignments...", file=sys.stderr)

        # Extract unique values for encoders
        solo_types = list(set(a.get('soloType', 'solo1') for a in assignments))
        tractor_ids = list(set(a.get('tractorId', 'Tractor_1') for a in assignments))
        driver_names = list(set(a.get('driverName', 'Unknown') for a in assignments))

        self.solo_type_encoder.fit(solo_types)
        self.tractor_encoder.fit(tractor_ids)
        self.driver_encoder.fit(driver_names)

        print(f"[Ownership] Solo types: {solo_types}", file=sys.stderr)
        print(f"[Ownership] Tractors: {sorted(tractor_ids)}", file=sys.stderr)
        print(f"[Ownership] Drivers: {len(driver_names)}", file=sys.stderr)

        X_samples = []
        y_labels = []

        for a in assignments:
            solo_type = a.get('soloType', 'solo1')
            tractor_id = a.get('tractorId', 'Tractor_1')
            driver_name = a.get('driverName', 'Unknown')
            day_of_week = a.get('dayOfWeek', 0)

            # Get canonical time from lookup (not raw start time)
            canonical_time = get_canonical_time(solo_type, tractor_id)

            # Track slot ownership for fallback (store service dates for tie-breaking)
            slot_key = self._make_slot_key(solo_type, tractor_id, canonical_time, day_of_week)
            service_date = a.get('serviceDate', '')
            self.slot_ownership[slot_key][driver_name].append(service_date)

            # Extract features
            features = self.extract_features(solo_type, tractor_id, canonical_time, day_of_week)
            X_samples.append(features)

            # Encode driver label
            driver_enc = self.driver_encoder.transform([driver_name])[0]
            y_labels.append(driver_enc)

        X = np.array(X_samples)
        y = np.array(y_labels)

        print(f"[Ownership] Training samples: {len(X)}", file=sys.stderr)
        print(f"[Ownership] Unique slots: {len(self.slot_ownership)}", file=sys.stderr)
        print(f"[Ownership] Unique drivers: {len(self.driver_encoder.classes_)}", file=sys.stderr)

        return X, y

    def fit(self, assignments: List[Dict[str, Any]]) -> bool:
        """Train the ownership classifier."""
        print(f"\n{'='*60}", file=sys.stderr)
        print(f"Training Ownership Classifier", file=sys.stderr)
        print(f"{'='*60}", file=sys.stderr)

        X, y = self.build_training_data(assignments)

        if len(X) < 10:
            print(f"[Ownership] ERROR: Not enough samples ({len(X)})", file=sys.stderr)
            return False

        # Need at least 2 classes
        unique_classes = len(np.unique(y))
        if unique_classes < 2:
            print(f"[Ownership] ERROR: Need at least 2 drivers, got {unique_classes}", file=sys.stderr)
            return False

        # Train/test split
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=42, stratify=y
        )

        print(f"\n[Ownership] Split:", file=sys.stderr)
        print(f"  Train: {len(X_train)} samples", file=sys.stderr)
        print(f"  Test: {len(X_test)} samples", file=sys.stderr)

        # Update model for correct number of classes
        self.model.set_params(num_class=unique_classes)

        # Train
        print(f"\n[Ownership] Fitting XGBClassifier...", file=sys.stderr)
        self.model.fit(X_train, y_train)
        self.is_fitted = True

        # Evaluate
        y_pred = self.model.predict(X_test)
        accuracy = accuracy_score(y_test, y_pred)

        print(f"\n{'='*60}", file=sys.stderr)
        print(f"Ownership Training Results", file=sys.stderr)
        print(f"{'='*60}", file=sys.stderr)
        print(f"Test Accuracy: {accuracy:.3f} ({accuracy*100:.1f}%)", file=sys.stderr)

        # Feature importance
        importance = self.model.feature_importances_
        feature_names = ['solo_type', 'tractor_id', 'canonical_time', 'day_of_week']
        print(f"\nFeature Importance:", file=sys.stderr)
        for name, imp in sorted(zip(feature_names, importance), key=lambda x: -x[1]):
            bar = '█' * int(imp * 40)
            print(f"  {name:20s} {imp:.3f} {bar}", file=sys.stderr)

        print(f"{'='*60}\n", file=sys.stderr)

        return True

    def predict_owner(
        self,
        solo_type: str,
        tractor_id: str,
        day_of_week: int,
        canonical_time: Optional[str] = None
    ) -> Tuple[str, float]:
        """
        Predict who owns a slot.

        Args:
            solo_type: 'solo1' or 'solo2'
            tractor_id: 'Tractor_1', etc.
            day_of_week: 0-6 (Sunday=0)
            canonical_time: Optional override; uses lookup if not provided

        Returns:
            (driver_name, confidence)
        """
        # Get canonical time from lookup if not provided
        if canonical_time is None:
            canonical_time = get_canonical_time(solo_type, tractor_id)

        # Check slot ownership history first (most reliable)
        slot_key = self._make_slot_key(solo_type, tractor_id, canonical_time, day_of_week)

        if slot_key in self.slot_ownership:
            # Return driver with most assignments to this slot
            ownership = self.slot_ownership[slot_key]
            if ownership:
                # Convert date lists to counts
                counts = {driver: len(dates) for driver, dates in ownership.items()}
                max_count = max(counts.values())

                # Find all drivers tied for max
                tied_drivers = [d for d, c in counts.items() if c == max_count]

                if len(tied_drivers) == 1:
                    best_driver_name = tied_drivers[0]
                else:
                    # Tie-breaker: count last 8 weeks only
                    from datetime import timedelta
                    cutoff = (datetime.now() - timedelta(weeks=8)).strftime('%Y-%m-%d')
                    recent_counts = {}
                    for driver in tied_drivers:
                        recent_counts[driver] = sum(1 for d in ownership[driver] if d >= cutoff)
                    best_driver_name = max(recent_counts.items(), key=lambda x: x[1])[0]
                    print(f"[Ownership] Tie-break: {counts} -> recent 8wk: {recent_counts} -> winner: {best_driver_name}", file=sys.stderr)

                total = sum(counts.values())
                confidence = counts[best_driver_name] / total
                return (best_driver_name, confidence)

        # Fall back to XGBoost model
        if self.is_fitted:
            features = self.extract_features(solo_type, tractor_id, canonical_time, day_of_week)
            X = np.array([features])

            proba = self.model.predict_proba(X)[0]
            best_idx = np.argmax(proba)
            confidence = proba[best_idx]

            driver_name = self.driver_encoder.inverse_transform([best_idx])[0]
            return (driver_name, float(confidence))

        return ("Unknown", 0.0)

    def get_ownership_distribution(
        self,
        solo_type: str,
        tractor_id: str,
        day_of_week: int,
        canonical_time: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Get full ownership distribution for a slot.

        Returns:
            {
                'slot_type': 'owned' | 'rotating',
                'owner': driver_name or None,
                'owner_share': 0.0-1.0,
                'shares': { driver_name: share, ... },
                'total_assignments': int
            }

        Classification:
            - OWNED: One driver has >= 70% of assignments
            - ROTATING: No driver has >= 70% (shared slot)
        """
        OWNERSHIP_THRESHOLD = 0.70  # 70% to be considered "owner"

        if canonical_time is None:
            canonical_time = get_canonical_time(solo_type, tractor_id)

        slot_key = self._make_slot_key(solo_type, tractor_id, canonical_time, day_of_week)

        if slot_key not in self.slot_ownership or not self.slot_ownership[slot_key]:
            return {
                'slot_type': 'unknown',
                'owner': None,
                'owner_share': 0.0,
                'shares': {},
                'total_assignments': 0
            }

        ownership = self.slot_ownership[slot_key]
        counts = {driver: len(dates) for driver, dates in ownership.items()}
        total = sum(counts.values())

        if total == 0:
            return {
                'slot_type': 'unknown',
                'owner': None,
                'owner_share': 0.0,
                'shares': {},
                'total_assignments': 0
            }

        # Calculate shares for all drivers
        shares = {driver: count / total for driver, count in counts.items()}

        # Find top driver
        top_driver = max(shares.items(), key=lambda x: x[1])
        top_share = top_driver[1]

        # Classify slot
        if top_share >= OWNERSHIP_THRESHOLD:
            slot_type = 'owned'
            owner = top_driver[0]
        else:
            slot_type = 'rotating'
            owner = None

        return {
            'slot_type': slot_type,
            'owner': owner,
            'owner_share': top_share,
            'shares': shares,
            'total_assignments': total
        }

    def get_driver_pattern(self, driver_name: str) -> Dict[str, Any]:
        """
        Get a driver's typical work pattern from slot ownership data.
        Used to cap assignments at their pattern rather than a blanket 6-day max.

        Returns:
            {
                'driver': driver_name,
                'typical_days': 5,
                'day_list': ['sunday', 'monday', 'tuesday', 'wednesday', 'saturday'],
                'day_counts': {'sunday': 3, 'monday': 2, ...},
                'confidence': 0.85
            }
        """
        MIN_TOTAL_PER_DAY = 2  # Need 2+ TOTAL assignments on a day to count

        if not self.slot_ownership:
            return {
                'driver': driver_name,
                'typical_days': 6,  # Default to safety max
                'day_list': [],
                'day_counts': {},
                'confidence': 0.0
            }

        # Step 1: Sum ALL assignments per day of week (across all slots)
        day_totals: Dict[int, int] = {}

        for slot_key, owners in self.slot_ownership.items():
            if driver_name not in owners:
                continue

            parts = slot_key.split('|')
            if len(parts) != 4:
                continue

            day_of_week = int(parts[3])
            assignments = owners[driver_name]
            count = len(assignments) if isinstance(assignments, list) else assignments

            # Add to day total (sum across ALL slots for this day)
            day_totals[day_of_week] = day_totals.get(day_of_week, 0) + count

        # Step 2: Filter to days with 2+ total assignments
        day_counts = {dow: cnt for dow, cnt in day_totals.items() if cnt >= MIN_TOTAL_PER_DAY}

        typical_days = len(day_counts)

        if typical_days == 0:
            return {
                'driver': driver_name,
                'typical_days': 6,
                'day_list': [],
                'day_counts': {},
                'confidence': 0.0
            }

        # Sort days by count (most worked first)
        sorted_days = sorted(day_counts.keys(), key=lambda d: day_counts[d], reverse=True)
        day_list = [DAY_NAMES[d] for d in sorted_days]

        # Confidence based on consistency
        counts = list(day_counts.values())
        mean_count = sum(counts) / len(counts)
        variance = sum((c - mean_count) ** 2 for c in counts) / len(counts)
        std_dev = variance ** 0.5
        confidence = max(0.0, min(1.0, 1.0 - (std_dev / (mean_count + 1))))

        return {
            'driver': driver_name,
            'typical_days': typical_days,
            'day_list': day_list,
            'day_counts': {DAY_NAMES[k]: v for k, v in day_counts.items()},
            'confidence': round(confidence, 3)
        }

    def save(self, model_path: str = MODEL_PATH, encoders_path: str = ENCODERS_PATH):
        """Save model and encoders to disk."""
        if self.is_fitted:
            # Save XGBoost model
            self.model.save_model(model_path)
            print(f"[Ownership] Model saved to {model_path}", file=sys.stderr)

            # Save encoders and slot ownership
            encoders_data = {
                'solo_type_classes': self.solo_type_encoder.classes_.tolist(),
                'tractor_classes': self.tractor_encoder.classes_.tolist(),
                'driver_classes': self.driver_encoder.classes_.tolist(),
                'slot_ownership': {k: dict(v) for k, v in self.slot_ownership.items()}
            }

            os.makedirs(os.path.dirname(encoders_path), exist_ok=True)
            with open(encoders_path, 'w') as f:
                json.dump(encoders_data, f, indent=2)
            print(f"[Ownership] Encoders saved to {encoders_path}", file=sys.stderr)

    def load(self, model_path: str = MODEL_PATH, encoders_path: str = ENCODERS_PATH) -> bool:
        """Load model and encoders from disk."""
        try:
            # Load XGBoost model
            self.model.load_model(model_path)
            self.is_fitted = True
            print(f"[Ownership] Model loaded from {model_path}", file=sys.stderr)

            # Load encoders
            with open(encoders_path, 'r') as f:
                encoders_data = json.load(f)

            self.solo_type_encoder.fit(encoders_data['solo_type_classes'])
            self.tractor_encoder.fit(encoders_data['tractor_classes'])
            self.driver_encoder.fit(encoders_data['driver_classes'])

            # Load slot ownership (now stores list of dates per driver)
            self.slot_ownership = defaultdict(lambda: defaultdict(list))
            for k, v in encoders_data.get('slot_ownership', {}).items():
                for driver, dates_or_count in v.items():
                    # Handle both old format (count) and new format (list of dates)
                    if isinstance(dates_or_count, list):
                        self.slot_ownership[k][driver] = dates_or_count
                    else:
                        # Legacy: convert count to empty list (no tie-breaking possible)
                        self.slot_ownership[k][driver] = [''] * dates_or_count

            print(f"[Ownership] Encoders loaded from {encoders_path}", file=sys.stderr)
            return True

        except Exception as e:
            print(f"[Ownership] Failed to load: {e}", file=sys.stderr)
            return False


def main():
    """CLI entry point."""
    input_data = json.load(sys.stdin)
    action = input_data.get('action', 'train')

    if action == 'train':
        assignments = input_data.get('assignments', [])

        classifier = OwnershipClassifier()
        success = classifier.fit(assignments)

        if success:
            classifier.save()
            print(json.dumps({'success': True, 'message': 'Ownership model trained and saved'}))
        else:
            print(json.dumps({'success': False, 'error': 'Training failed'}))

    elif action == 'predict':
        solo_type = input_data.get('soloType', 'solo1')
        tractor_id = input_data.get('tractorId', 'Tractor_1')
        day_of_week = input_data.get('dayOfWeek', 0)
        canonical_time = input_data.get('canonicalTime')

        classifier = OwnershipClassifier()
        if classifier.load():
            driver, confidence = classifier.predict_owner(solo_type, tractor_id, day_of_week, canonical_time)
            print(json.dumps({
                'driver': driver,
                'confidence': confidence,
                'slot': f"{solo_type}_{tractor_id}_{DAY_NAMES[day_of_week]}"
            }))
        else:
            print(json.dumps({'error': 'Model not found'}))

    elif action == 'test_predictions':
        # Test multiple predictions
        test_cases = input_data.get('testCases', [])

        classifier = OwnershipClassifier()
        if not classifier.load():
            print(json.dumps({'error': 'Model not found'}))
            return

        results = []
        for tc in test_cases:
            solo_type = tc.get('soloType', 'solo1')
            tractor_id = tc.get('tractorId', 'Tractor_1')
            day_of_week = tc.get('dayOfWeek', 0)
            canonical_time = get_canonical_time(solo_type, tractor_id)

            driver, confidence = classifier.predict_owner(solo_type, tractor_id, day_of_week)

            results.append({
                'slot': f"{solo_type}_{tractor_id}_{DAY_NAMES[day_of_week]}",
                'canonicalTime': canonical_time,
                'predictedOwner': driver,
                'confidence': f"{confidence*100:.1f}%"
            })

        print(json.dumps({'predictions': results}, indent=2))

    elif action == 'show_ownership':
        # Show slot ownership summary
        classifier = OwnershipClassifier()
        if not classifier.load():
            print(json.dumps({'error': 'Model not found'}))
            return

        # Summarize ownership
        summary = []
        for slot_key, owners in sorted(classifier.slot_ownership.items()):
            parts = slot_key.split('|')
            if len(parts) == 4:
                solo_type, tractor, time, dow = parts
                # Convert lists to counts (new format stores list of dates)
                counts = {driver: len(dates) if isinstance(dates, list) else dates
                          for driver, dates in owners.items()}
                best_owner = max(counts.items(), key=lambda x: x[1])
                total = sum(counts.values())
                summary.append({
                    'slot': f"{solo_type}_{tractor}_{DAY_NAMES[int(dow)]}",
                    'time': time,
                    'owner': best_owner[0],
                    'count': best_owner[1],
                    'total': total,
                    'percentage': f"{best_owner[1]/total*100:.0f}%"
                })

        print(json.dumps({'slots': summary}, indent=2))

    elif action == 'get_distribution':
        # Get ownership distribution for a single slot (owned vs rotating classification)
        solo_type = input_data.get('soloType', 'solo1')
        tractor_id = input_data.get('tractorId', 'Tractor_1')
        day_of_week = input_data.get('dayOfWeek', 0)
        canonical_time = input_data.get('canonicalTime')

        classifier = OwnershipClassifier()
        if not classifier.load():
            print(json.dumps({'error': 'Model not found'}))
            return

        dist = classifier.get_ownership_distribution(solo_type, tractor_id, day_of_week, canonical_time)
        dist['slot'] = f"{solo_type}_{tractor_id}_{DAY_NAMES[day_of_week]}"
        print(json.dumps(dist, indent=2))

    elif action == 'get_driver_pattern':
        # Get a driver's typical work pattern (days per week + which days)
        driver_name = input_data.get('driverName', '')

        if not driver_name:
            print(json.dumps({'error': 'driverName is required'}))
            return

        classifier = OwnershipClassifier()
        if not classifier.load():
            print(json.dumps({'error': 'Model not found'}))
            return

        pattern = classifier.get_driver_pattern(driver_name)
        print(json.dumps(pattern, indent=2))

    elif action == 'get_all_patterns':
        # Get patterns for all drivers
        classifier = OwnershipClassifier()
        if not classifier.load():
            print(json.dumps({'error': 'Model not found'}))
            return

        patterns = {}
        for driver_name in classifier.driver_encoder.classes_:
            patterns[driver_name] = classifier.get_driver_pattern(driver_name)

        # Sort by typical_days descending
        sorted_patterns = sorted(patterns.items(), key=lambda x: x[1]['typical_days'], reverse=True)
        print(json.dumps({
            'patterns': dict(sorted_patterns),
            'count': len(patterns)
        }, indent=2))

    else:
        print(json.dumps({'error': f'Unknown action: {action}'}))
        sys.exit(1)


if __name__ == '__main__':
    main()
