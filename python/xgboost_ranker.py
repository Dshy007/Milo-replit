"""
XGBoost Driver-Block Ranker (Stage 2)

Learning-to-rank model that ranks candidate drivers for a specific block.
Uses XGBRanker with LambdaMART (rank:ndcg objective).

Features (7 per driver-block pair):
  0. availability_score (float 0-1): From Stage 1 predict_proba
  1. contract_type_match (bool 0/1): Does driver type match block?
  2. time_slot_frequency (int): How many times worked this time slot
  3. same_day_freq (float 0-1): % times worked on this weekday
  4. days_since_last_worked (int): Gap since last assignment
  5. avg_days_per_week (float): Driver's average work frequency
  6. rolling_interval_match (float 0-1): How well date fits pattern

Training:
  - Groups: Each block is a group (qid)
  - Positive label: Driver who WAS assigned (relevance=1)
  - Negative labels: Candidate drivers who WEREN'T (relevance=0)

Output:
  - rank_drivers_for_block() returns sorted [(driver_id, score), ...]
"""

import json
import sys
import os
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
from collections import defaultdict

from xgboost import XGBRanker
from sklearn.model_selection import GroupShuffleSplit

# Model save path
MODEL_PATH = os.path.join(os.path.dirname(__file__), 'models', 'ranker_model.json')

# Feature names for debugging
RANKER_FEATURE_NAMES = [
    'availability_score',
    'contract_type_match',
    'time_slot_frequency',
    'same_day_freq',
    'days_since_last_worked',
    'avg_days_per_week',
    'rolling_interval_match'
]


class DriverBlockRanker:
    """
    Stage 2: XGBRanker for driver-block matching.

    Ranks candidate drivers for a block based on:
    - Stage 1 availability score
    - Contract type match
    - Time slot familiarity
    - Day-of-week patterns
    - Work frequency patterns
    """

    def __init__(self, availability_model=None):
        """
        Initialize ranker.

        Args:
            availability_model: Optional AvailabilityClassifier from Stage 1
        """
        self.model = XGBRanker(
            objective='rank:ndcg',
            tree_method='hist',
            lambdarank_num_pair_per_sample=8,
            lambdarank_pair_method='topk',
            n_estimators=100,
            max_depth=6,
            learning_rate=0.1,
            random_state=42,
            verbosity=0
        )
        self.availability_model = availability_model
        self.is_fitted = False
        self.driver_stats_cache = {}

    def _parse_time_slot(self, time_str: str) -> str:
        """
        Parse time string to time slot bucket.

        Time slots:
        - 'early_morning': 00:00-06:00
        - 'morning': 06:00-12:00
        - 'afternoon': 12:00-18:00
        - 'evening': 18:00-24:00
        """
        try:
            if isinstance(time_str, str):
                # Handle formats like "14:30" or "2:30 PM"
                if 'AM' in time_str.upper() or 'PM' in time_str.upper():
                    # 12-hour format
                    try:
                        dt = datetime.strptime(time_str.upper().strip(), '%I:%M %p')
                        hour = dt.hour
                    except:
                        try:
                            dt = datetime.strptime(time_str.upper().strip(), '%I:%M%p')
                            hour = dt.hour
                        except:
                            return 'unknown'
                else:
                    # 24-hour format
                    parts = time_str.split(':')
                    hour = int(parts[0])
            else:
                return 'unknown'

            if hour < 6:
                return 'early_morning'
            elif hour < 12:
                return 'morning'
            elif hour < 18:
                return 'afternoon'
            else:
                return 'evening'
        except:
            return 'unknown'

    def _compute_driver_stats(self, driver_id: str, history: List[Dict]) -> Dict:
        """
        Compute statistics for a driver.

        Returns dict with:
        - work_dates: sorted list of dates worked
        - weekday_counts: {0-6: count}
        - time_slot_counts: {slot: count}
        - rolling_interval: average days between shifts
        - avg_days_per_week: average work frequency
        """
        if driver_id in self.driver_stats_cache:
            return self.driver_stats_cache[driver_id]

        if not history:
            return {
                'work_dates': [],
                'weekday_counts': defaultdict(int),
                'time_slot_counts': defaultdict(int),
                'total_days': 0,
                'rolling_interval': 3.0,
                'avg_days_per_week': 0.0
            }

        work_dates = []
        weekday_counts = defaultdict(int)
        time_slot_counts = defaultdict(int)

        for assignment in history:
            date_str = assignment.get('serviceDate') or assignment.get('date')
            time_str = assignment.get('time') or assignment.get('startTime') or ''

            if date_str:
                try:
                    if isinstance(date_str, str):
                        date = pd.to_datetime(date_str).to_pydatetime()
                    else:
                        date = pd.to_datetime(date_str).to_pydatetime()

                    work_dates.append(date)
                    weekday = (date.weekday() + 1) % 7  # Sun=0, Sat=6
                    weekday_counts[weekday] += 1

                    # Count time slots
                    slot = self._parse_time_slot(time_str)
                    time_slot_counts[slot] += 1
                except:
                    continue

        work_dates = sorted(set(work_dates))

        # Compute rolling interval
        rolling_interval = 3.0
        if len(work_dates) >= 2:
            intervals = []
            for i in range(1, len(work_dates)):
                gap = (work_dates[i] - work_dates[i-1]).days
                if gap > 0 and gap < 30:
                    intervals.append(gap)
            if intervals:
                rolling_interval = np.mean(intervals)

        # Compute average days per week
        if len(work_dates) >= 2:
            date_range = (work_dates[-1] - work_dates[0]).days
            weeks = max(1, date_range / 7)
            avg_days_per_week = len(work_dates) / weeks
        else:
            avg_days_per_week = len(work_dates)

        stats = {
            'work_dates': work_dates,
            'weekday_counts': dict(weekday_counts),
            'time_slot_counts': dict(time_slot_counts),
            'total_days': len(work_dates),
            'rolling_interval': rolling_interval,
            'avg_days_per_week': avg_days_per_week
        }

        self.driver_stats_cache[driver_id] = stats
        return stats

    def extract_features(
        self,
        driver: Dict,
        block: Dict,
        driver_history: List[Dict],
        availability_score: float = 0.5
    ) -> List[float]:
        """
        Extract 7 features for a driver-block pair.

        Features:
        0. availability_score (float 0-1): From Stage 1
        1. contract_type_match (bool 0/1): Does driver type match block?
        2. time_slot_frequency (int): How many times worked this time slot
        3. same_day_freq (float 0-1): % times worked on this weekday
        4. days_since_last_worked (int): Gap since last assignment
        5. avg_days_per_week (float): Driver's average work frequency
        6. rolling_interval_match (float 0-1): How well date fits pattern

        Returns: [avail, type_match, slot_freq, day_freq, days_since, avg_per_week, interval_match]
        """
        # Get driver stats
        driver_id = driver.get('id') or driver.get('driverId')
        stats = self._compute_driver_stats(driver_id, driver_history)

        # Feature 0: availability_score (from Stage 1)
        avail = float(availability_score)

        # Feature 1: contract_type_match
        driver_type = (driver.get('contractType') or driver.get('type') or '').lower()
        block_type = (block.get('contractType') or block.get('soloType') or '').lower()
        type_match = 1.0 if driver_type == block_type else 0.0

        # Feature 2: time_slot_frequency
        block_time = block.get('startTime') or block.get('time') or ''
        block_slot = self._parse_time_slot(block_time)
        slot_freq = float(stats['time_slot_counts'].get(block_slot, 0))

        # Feature 3: same_day_freq
        block_date_str = block.get('serviceDate') or block.get('date')
        if block_date_str:
            block_date = pd.to_datetime(block_date_str).to_pydatetime()
            block_dow = (block_date.weekday() + 1) % 7  # Sun=0
        else:
            block_dow = 0
            block_date = datetime.now()

        total_days = stats['total_days']
        if total_days > 0:
            day_count = stats['weekday_counts'].get(block_dow, 0)
            same_day_freq = day_count / total_days
        else:
            same_day_freq = 0.0

        # Feature 4: days_since_last_worked
        work_dates = stats['work_dates']
        if work_dates and block_date_str:
            past_dates = [d for d in work_dates if d < block_date]
            if past_dates:
                days_since = (block_date - max(past_dates)).days
            else:
                days_since = 14
        else:
            days_since = 14
        days_since = min(days_since, 30)

        # Feature 5: avg_days_per_week
        avg_per_week = stats['avg_days_per_week']

        # Feature 6: rolling_interval_match
        rolling_interval = stats['rolling_interval']
        if rolling_interval > 0:
            # How close is days_since to rolling_interval?
            deviation = abs(days_since - rolling_interval)
            # Exponential decay: 1.0 if perfect match, lower for bigger deviation
            interval_match = np.exp(-deviation / rolling_interval)
        else:
            interval_match = 0.5

        return [
            avail,
            type_match,
            float(slot_freq),
            float(same_day_freq),
            float(days_since),
            float(avg_per_week),
            float(interval_match)
        ]

    def build_training_data(
        self,
        historical_blocks: List[Dict],
        driver_histories: Dict[str, List[Dict]],
        all_drivers: List[Dict]
    ) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
        """
        Build training data for the ranker.

        For each historical block:
        - Get the driver who WAS assigned (label=1)
        - Get N candidate drivers who could have been assigned (label=0)
        - Same qid for all candidates of same block

        Args:
            historical_blocks: List of {blockId, driverId, serviceDate, contractType, ...}
            driver_histories: {driver_id: [{serviceDate, ...}, ...]}
            all_drivers: List of {id, contractType, ...}

        Returns:
            (X, y, qid) where:
            - X: feature matrix
            - y: relevance labels (1=assigned, 0=not)
            - qid: group IDs (same block = same group)
        """
        X_samples = []
        y_labels = []
        qids = []

        print(f"[Ranker] Building training data from {len(historical_blocks)} blocks...", file=sys.stderr)

        # Group blocks by ID to avoid duplicates
        blocks_seen = set()

        for block_idx, block in enumerate(historical_blocks):
            block_id = block.get('blockId') or block.get('id')
            if block_id in blocks_seen:
                continue
            blocks_seen.add(block_id)

            assigned_driver_id = block.get('driverId') or block.get('assignedDriverId')
            if not assigned_driver_id:
                continue

            block_type = (block.get('contractType') or block.get('soloType') or '').lower()
            if not block_type:
                continue

            # Get candidate drivers (same contract type)
            candidates = []
            for driver in all_drivers:
                driver_id = driver.get('id') or driver.get('driverId')
                driver_type = (driver.get('contractType') or driver.get('type') or '').lower()

                # Match contract type
                if driver_type == block_type:
                    candidates.append(driver)

            if len(candidates) < 2:
                continue

            # Ensure assigned driver is in candidates
            assigned_driver = None
            for d in candidates:
                if (d.get('id') or d.get('driverId')) == assigned_driver_id:
                    assigned_driver = d
                    break

            if not assigned_driver:
                continue

            # Sample negative candidates (limit to 5 per block for efficiency)
            negative_candidates = [
                d for d in candidates
                if (d.get('id') or d.get('driverId')) != assigned_driver_id
            ]

            if len(negative_candidates) > 5:
                np.random.seed(block_idx)
                negative_indices = np.random.choice(
                    len(negative_candidates), size=5, replace=False
                )
                negative_candidates = [negative_candidates[i] for i in negative_indices]

            # Get history up to block date
            block_date_str = block.get('serviceDate') or block.get('date')
            if block_date_str:
                block_date = pd.to_datetime(block_date_str).to_pydatetime()
            else:
                continue

            # Create samples for this block group
            group_id = len(blocks_seen)

            # Calculate block day-of-week (needed for availability calculation)
            block_dow = (block_date.weekday() + 1) % 7  # Sun=0, Sat=6

            # POSITIVE: assigned driver (label=1)
            history = driver_histories.get(assigned_driver_id, [])
            # Filter history to before block date
            history_before = [
                h for h in history
                if pd.to_datetime(h.get('serviceDate') or h.get('date')).to_pydatetime() < block_date
            ]

            # Calculate availability score (simplified for training)
            if history_before:
                stats = self._compute_driver_stats(assigned_driver_id, history_before)
                avail = stats['weekday_counts'].get(block_dow, 0) / max(1, stats['total_days'])
            else:
                avail = 0.5

            features = self.extract_features(assigned_driver, block, history_before, avail)
            X_samples.append(features)
            y_labels.append(1)
            qids.append(group_id)

            # NEGATIVE: candidate drivers (label=0)
            for neg_driver in negative_candidates:
                neg_id = neg_driver.get('id') or neg_driver.get('driverId')
                neg_history = driver_histories.get(neg_id, [])

                # Filter history to before block date
                neg_history_before = [
                    h for h in neg_history
                    if pd.to_datetime(h.get('serviceDate') or h.get('date')).to_pydatetime() < block_date
                ]

                # Calculate availability score
                if neg_history_before:
                    stats = self._compute_driver_stats(neg_id, neg_history_before)
                    avail = stats['weekday_counts'].get(block_dow, 0) / max(1, stats['total_days'])
                else:
                    avail = 0.5

                features = self.extract_features(neg_driver, block, neg_history_before, avail)
                X_samples.append(features)
                y_labels.append(0)
                qids.append(group_id)

        X = np.array(X_samples)
        y = np.array(y_labels)
        qid = np.array(qids)

        positive_count = np.sum(y == 1)
        negative_count = np.sum(y == 0)
        unique_groups = len(set(qids))

        print(f"[Ranker] Generated {len(X)} samples:", file=sys.stderr)
        print(f"[Ranker]   Positive (assigned): {positive_count}", file=sys.stderr)
        print(f"[Ranker]   Negative (not assigned): {negative_count}", file=sys.stderr)
        print(f"[Ranker]   Groups (blocks): {unique_groups}", file=sys.stderr)

        return X, y, qid

    def fit(
        self,
        historical_blocks: List[Dict],
        driver_histories: Dict[str, List[Dict]],
        all_drivers: List[Dict]
    ) -> bool:
        """
        Train the ranker model.

        Args:
            historical_blocks: List of block assignments
            driver_histories: {driver_id: [{serviceDate, ...}, ...]}
            all_drivers: List of driver info

        Returns:
            True if training succeeded
        """
        print(f"\n{'='*60}", file=sys.stderr)
        print(f"Stage 2: Training Driver-Block Ranker", file=sys.stderr)
        print(f"{'='*60}", file=sys.stderr)

        # Build training data
        X, y, qid = self.build_training_data(historical_blocks, driver_histories, all_drivers)

        if len(X) < 10:
            print(f"[Ranker] ERROR: Not enough samples ({len(X)}), need at least 10", file=sys.stderr)
            return False

        # Group-based train/test split
        unique_groups = np.unique(qid)
        n_groups = len(unique_groups)

        if n_groups < 5:
            print(f"[Ranker] ERROR: Not enough groups ({n_groups}), need at least 5", file=sys.stderr)
            return False

        # Shuffle and split groups 80/20
        np.random.seed(42)
        shuffled_groups = np.random.permutation(unique_groups)
        split_idx = int(0.8 * n_groups)
        train_groups = set(shuffled_groups[:split_idx])
        test_groups = set(shuffled_groups[split_idx:])

        # Create train/test masks
        train_mask = np.array([g in train_groups for g in qid])
        test_mask = np.array([g in test_groups for g in qid])

        X_train, y_train, qid_train = X[train_mask], y[train_mask], qid[train_mask]
        X_test, y_test, qid_test = X[test_mask], y[test_mask], qid[test_mask]

        print(f"\n[Ranker] Split:", file=sys.stderr)
        print(f"  Train: {len(X_train)} samples, {len(set(qid_train))} groups", file=sys.stderr)
        print(f"  Test: {len(X_test)} samples, {len(set(qid_test))} groups", file=sys.stderr)

        # Train the model
        print(f"\n[Ranker] Fitting XGBRanker...", file=sys.stderr)
        self.model.fit(X_train, y_train, qid=qid_train)
        self.is_fitted = True

        # Evaluate with NDCG
        ndcg_5 = self._calculate_ndcg(X_test, y_test, qid_test, k=5)
        ndcg_10 = self._calculate_ndcg(X_test, y_test, qid_test, k=10)

        print(f"\n{'='*60}", file=sys.stderr)
        print(f"Stage 2 Training Results", file=sys.stderr)
        print(f"{'='*60}", file=sys.stderr)
        print(f"Training samples: {len(X_train)}", file=sys.stderr)
        print(f"Test samples: {len(X_test)}", file=sys.stderr)
        print(f"Training groups: {len(set(qid_train))}", file=sys.stderr)
        print(f"Test groups: {len(set(qid_test))}", file=sys.stderr)
        print(f"", file=sys.stderr)
        print(f"Metrics:", file=sys.stderr)
        print(f"  NDCG@5:  {ndcg_5:.3f}", file=sys.stderr)
        print(f"  NDCG@10: {ndcg_10:.3f}", file=sys.stderr)

        # Feature importance
        importance = self.model.feature_importances_
        print(f"\nFeature Importance:", file=sys.stderr)
        for name, imp in sorted(zip(RANKER_FEATURE_NAMES, importance), key=lambda x: -x[1]):
            bar = '█' * int(imp * 20)
            print(f"  {name:25s} {imp:.3f} {bar}", file=sys.stderr)

        print(f"{'='*60}\n", file=sys.stderr)

        return True

    def _calculate_ndcg(
        self,
        X: np.ndarray,
        y: np.ndarray,
        qid: np.ndarray,
        k: int = 5
    ) -> float:
        """Calculate NDCG@k for the test set."""
        if len(X) == 0:
            return 0.0

        # Get predictions
        scores = self.model.predict(X)

        # Calculate NDCG per group
        unique_groups = np.unique(qid)
        ndcg_scores = []

        for group in unique_groups:
            mask = qid == group
            group_y = y[mask]
            group_scores = scores[mask]

            if len(group_y) < 2:
                continue

            # Sort by predicted scores (descending)
            sorted_indices = np.argsort(-group_scores)
            sorted_y = group_y[sorted_indices][:k]

            # Calculate DCG
            dcg = 0.0
            for i, rel in enumerate(sorted_y):
                dcg += rel / np.log2(i + 2)  # i+2 because log2(1) = 0

            # Calculate ideal DCG (sort by true relevance)
            ideal_sorted = np.sort(group_y)[::-1][:k]
            idcg = 0.0
            for i, rel in enumerate(ideal_sorted):
                idcg += rel / np.log2(i + 2)

            if idcg > 0:
                ndcg_scores.append(dcg / idcg)
            else:
                ndcg_scores.append(1.0)  # All zeros = perfect

        return np.mean(ndcg_scores) if ndcg_scores else 0.0

    def rank_drivers_for_block(
        self,
        block: Dict,
        candidate_drivers: List[Dict],
        driver_histories: Dict[str, List[Dict]],
        availability_scores: Dict[str, float] = None
    ) -> List[Tuple[str, float]]:
        """
        Rank candidate drivers for a block.

        Args:
            block: Block info {id, serviceDate, contractType, startTime, ...}
            candidate_drivers: List of {id, contractType, ...}
            driver_histories: {driver_id: [{serviceDate, ...}, ...]}
            availability_scores: Optional {driver_id: score} from Stage 1

        Returns:
            Sorted list of [(driver_id, score), ...] highest to lowest
        """
        if not self.is_fitted:
            print("[Ranker] Model not fitted, returning empty ranking", file=sys.stderr)
            return []

        if not candidate_drivers:
            return []

        availability_scores = availability_scores or {}

        # Extract features for each candidate
        X_candidates = []
        driver_ids = []

        for driver in candidate_drivers:
            driver_id = driver.get('id') or driver.get('driverId')
            history = driver_histories.get(driver_id, [])
            avail = availability_scores.get(driver_id, 0.5)

            features = self.extract_features(driver, block, history, avail)
            X_candidates.append(features)
            driver_ids.append(driver_id)

        X = np.array(X_candidates)

        # Get ranking scores
        scores = self.model.predict(X)

        # Sort by score (descending)
        sorted_indices = np.argsort(-scores)
        ranked = [(driver_ids[i], float(scores[i])) for i in sorted_indices]

        return ranked

    def save(self, model_path: str = MODEL_PATH):
        """Save model to disk."""
        if self.is_fitted:
            self.model.save_model(model_path)
            print(f"[Ranker] Model saved to {model_path}", file=sys.stderr)

    def load(self, model_path: str = MODEL_PATH) -> bool:
        """Load model from disk."""
        try:
            self.model.load_model(model_path)
            self.is_fitted = True
            print(f"[Ranker] Model loaded from {model_path}", file=sys.stderr)
            return True
        except Exception as e:
            print(f"[Ranker] Failed to load model: {e}", file=sys.stderr)
            return False


def main():
    """CLI entry point for testing."""
    if not sys.stdin.isatty():
        input_data = json.loads(sys.stdin.read())
        action = input_data.get('action', 'train')
    else:
        if len(sys.argv) < 2:
            print("Usage: python xgboost_ranker.py <action>")
            print("Actions: train, rank")
            sys.exit(1)
        action = sys.argv[1]
        input_data = {}

    if action == "train":
        historical_blocks = input_data.get('blocks', [])
        driver_histories = input_data.get('histories', {})
        all_drivers = input_data.get('drivers', [])

        ranker = DriverBlockRanker()
        success = ranker.fit(historical_blocks, driver_histories, all_drivers)

        if success:
            ranker.save()
            print(json.dumps({'success': True, 'message': 'Ranker trained and saved'}))
        else:
            print(json.dumps({'success': False, 'error': 'Training failed'}))

    elif action == "rank":
        block = input_data.get('block', {})
        candidates = input_data.get('candidates', [])
        histories = input_data.get('histories', {})
        availability_scores = input_data.get('availabilityScores', {})

        ranker = DriverBlockRanker()
        if ranker.load():
            rankings = ranker.rank_drivers_for_block(
                block, candidates, histories, availability_scores
            )
            print(json.dumps({'rankings': rankings}))
        else:
            print(json.dumps({'error': 'Model not found'}))

    else:
        print(json.dumps({'error': f'Unknown action: {action}'}))
        sys.exit(1)


if __name__ == '__main__':
    main()
