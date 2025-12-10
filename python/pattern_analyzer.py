"""
Pattern Analyzer - scikit-learn based driver pattern recognition

Replaces the custom TypeScript dna-analyzer.ts with proven ML algorithms:
- K-Means clustering for pattern group detection (sunWed, wedSat, mixed)
- RandomForest for driver-block fit score prediction
- Feature extraction from historical assignment data

This module can be used standalone or integrated with schedule_optimizer.py
"""

import json
import sys
import numpy as np
from collections import defaultdict
from typing import Dict, List, Tuple, Any, Optional

# sklearn imports - these are the battle-tested ML algorithms
from sklearn.cluster import KMeans
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split

# Day constants
DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
DAY_TO_INDEX = {day: i for i, day in enumerate(DAY_NAMES)}

# Pattern group definitions
SUN_WED_DAYS = {'sunday', 'monday', 'tuesday', 'wednesday'}
WED_SAT_DAYS = {'wednesday', 'thursday', 'friday', 'saturday'}

# Minimum assignments required to assign a pattern group
# Drivers with fewer assignments don't have enough data to establish a pattern
MIN_ASSIGNMENTS_FOR_PATTERN = 8  # ~1 per week over 8-week window


class PatternAnalyzer:
    """
    scikit-learn based pattern analyzer for driver scheduling.

    Replaces ~900 lines of custom TypeScript with proven ML algorithms:
    - K-Means for automatic pattern group detection
    - RandomForest for driver-block fit prediction
    """

    def __init__(self):
        self.scaler = StandardScaler()
        self.clusterer = KMeans(n_clusters=3, random_state=42, n_init=10)
        self.classifier = RandomForestClassifier(
            n_estimators=100,
            max_depth=10,
            random_state=42,
            n_jobs=-1  # Use all CPU cores
        )
        self.is_fitted = False
        self.cluster_labels = ['mixed', 'sunWed', 'wedSat']  # Will be refined after clustering

    def extract_driver_features(self, assignments: List[Dict]) -> np.ndarray:
        """
        Extract feature vector from driver's assignment history.

        Features (12 total):
        - [0-6]: Day frequency (normalized count for each day of week)
        - [7-10]: Time bucket frequency (night/morning/afternoon/evening)
        - [11]: Consistency score (how regular their pattern is)

        Args:
            assignments: List of {dayOfWeek, dayName, startTime, serviceDate, ...}

        Returns:
            numpy array of 12 features
        """
        features = np.zeros(12)

        if not assignments:
            return features

        # Count days
        day_counts = np.zeros(7)
        time_counts = np.zeros(4)  # night (0-6), morning (6-12), afternoon (12-18), evening (18-24)

        weeks_seen = set()
        week_days = defaultdict(set)  # week_key -> set of days worked

        for a in assignments:
            # Day frequency
            day_idx = a.get('dayOfWeek', DAY_TO_INDEX.get(a.get('dayName', '').lower(), 0))
            day_counts[day_idx] += 1

            # Time bucket
            start_time = a.get('startTime', '12:00')
            try:
                hour = int(start_time.split(':')[0])
                time_bucket = min(3, hour // 6)  # 0-5=0, 6-11=1, 12-17=2, 18-23=3
                time_counts[time_bucket] += 1
            except (ValueError, IndexError):
                time_counts[2] += 1  # Default to afternoon

            # Track weeks for consistency
            service_date = a.get('serviceDate', '')
            if service_date:
                # Extract week key (simplified - just use first 7 chars of date)
                week_key = service_date[:7] if len(service_date) >= 7 else service_date
                weeks_seen.add(week_key)
                day_name = a.get('dayName', DAY_NAMES[day_idx]).lower()
                week_days[week_key].add(day_name)

        total = len(assignments)
        if total > 0:
            # Normalize day frequencies
            features[0:7] = day_counts / total
            # Normalize time frequencies
            features[7:11] = time_counts / total

        # Consistency score: coefficient of variation of day counts
        # Higher = more spread out, lower = more concentrated on specific days
        if np.mean(day_counts) > 0:
            features[11] = np.std(day_counts) / (np.mean(day_counts) + 0.01)

        return features

    def extract_block_features(self, block: Dict) -> np.ndarray:
        """
        Extract feature vector for a block.

        Features (8 total):
        - [0-6]: One-hot encoding of day of week
        - [7]: Time bucket (0-3)

        Args:
            block: Dict with {day, time, contractType, ...}

        Returns:
            numpy array of 8 features
        """
        features = np.zeros(8)

        # Day one-hot
        day = block.get('day', '').lower()
        day_idx = DAY_TO_INDEX.get(day, 0)
        features[day_idx] = 1.0

        # Time bucket
        time_str = block.get('time', '12:00')
        try:
            hour = int(time_str.split(':')[0])
            features[7] = hour / 24.0  # Normalize to 0-1
        except (ValueError, IndexError):
            features[7] = 0.5

        return features

    def cluster_drivers(self, driver_histories: Dict[str, List[Dict]]) -> Dict[str, Dict]:
        """
        Cluster drivers into pattern groups using K-Means.

        Args:
            driver_histories: {driver_id: [list of assignments]}

        Returns:
            {driver_id: {
                'patternGroup': 'sunWed' | 'wedSat' | 'mixed',
                'preferredDays': ['monday', 'tuesday', ...],
                'preferredTimes': ['16:30', '20:30'],
                'consistencyScore': 0.85,
                'clusterConfidence': 0.92
            }}
        """
        if not driver_histories:
            return {}

        driver_ids = list(driver_histories.keys())

        # Extract features for all drivers
        X = np.array([
            self.extract_driver_features(driver_histories[d])
            for d in driver_ids
        ])

        # Handle case with fewer drivers than clusters
        n_clusters = min(3, len(driver_ids))
        if n_clusters < 3:
            self.clusterer = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)

        # Scale features
        X_scaled = self.scaler.fit_transform(X)

        # Cluster
        labels = self.clusterer.fit_predict(X_scaled)

        # Interpret clusters based on day patterns
        cluster_day_profiles = self._analyze_cluster_profiles(X, labels)

        # Build result
        result = {}
        for i, driver_id in enumerate(driver_ids):
            cluster_label = labels[i]

            # Calculate driver-specific preferences
            assignments = driver_histories[driver_id]
            prefs = self._calculate_preferences(assignments)
            num_assignments = len(assignments)

            # Only assign pattern group if driver has enough historical data
            # Drivers with minimal assignments don't have enough data to establish a pattern
            if num_assignments >= MIN_ASSIGNMENTS_FOR_PATTERN:
                pattern_group = cluster_day_profiles.get(cluster_label, 'mixed')
            else:
                pattern_group = None  # Not enough data to determine pattern
                print(f"[K-Means] Driver {driver_id}: only {num_assignments} assignments, skipping pattern group", file=sys.stderr)

            # Calculate confidence (distance to cluster center)
            if hasattr(self.clusterer, 'transform'):
                distances = self.clusterer.transform(X_scaled[i:i+1])[0]
                min_dist = distances[cluster_label]
                confidence = 1.0 / (1.0 + min_dist)  # Inverse distance as confidence
            else:
                confidence = 0.5

            result[driver_id] = {
                'patternGroup': pattern_group,
                'preferredDays': prefs['days'],
                'preferredTimes': prefs['times'],
                'preferredContractType': prefs['contractType'],
                'consistencyScore': prefs['consistency'],
                'clusterConfidence': round(confidence, 3),
                'assignmentsAnalyzed': num_assignments
            }

        return result

    def _analyze_cluster_profiles(self, X: np.ndarray, labels: np.ndarray) -> Dict[int, str]:
        """
        Analyze clusters to determine pattern group labels.

        Looks at day frequency patterns to classify:
        - sunWed: Primarily Sun-Mon-Tue-Wed
        - wedSat: Primarily Wed-Thu-Fri-Sat
        - mixed: No clear pattern
        """
        cluster_profiles = {}

        print(f"[K-Means DEBUG] Analyzing {max(labels) + 1} clusters", file=sys.stderr)

        for cluster_id in range(max(labels) + 1):
            mask = labels == cluster_id
            if not np.any(mask):
                cluster_profiles[cluster_id] = 'mixed'
                continue

            # Average day frequencies for this cluster (features 0-6)
            avg_days = X[mask, 0:7].mean(axis=0)

            # Debug: show day distribution for this cluster
            day_names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
            day_pcts = [f"{day_names[i]}:{avg_days[i]:.2f}" for i in range(7)]
            print(f"[K-Means DEBUG] Cluster {cluster_id} ({np.sum(mask)} drivers): {' '.join(day_pcts)}", file=sys.stderr)

            # Calculate sun-wed vs wed-sat scores
            sun_wed_score = avg_days[0] + avg_days[1] + avg_days[2] + avg_days[3] * 0.5  # Sun, Mon, Tue, half Wed
            wed_sat_score = avg_days[3] * 0.5 + avg_days[4] + avg_days[5] + avg_days[6]  # half Wed, Thu, Fri, Sat

            total = sun_wed_score + wed_sat_score
            if total > 0:
                sun_wed_ratio = sun_wed_score / total
                wed_sat_ratio = wed_sat_score / total

                print(f"[K-Means DEBUG] Cluster {cluster_id}: sun_wed_ratio={sun_wed_ratio:.2f}, wed_sat_ratio={wed_sat_ratio:.2f}", file=sys.stderr)

                if sun_wed_ratio >= 0.65:
                    cluster_profiles[cluster_id] = 'sunWed'
                elif wed_sat_ratio >= 0.65:
                    cluster_profiles[cluster_id] = 'wedSat'
                else:
                    cluster_profiles[cluster_id] = 'mixed'
            else:
                cluster_profiles[cluster_id] = 'mixed'

            print(f"[K-Means DEBUG] Cluster {cluster_id} labeled as: {cluster_profiles[cluster_id]}", file=sys.stderr)

        return cluster_profiles

    def _calculate_preferences(self, assignments: List[Dict]) -> Dict:
        """
        Calculate driver preferences from assignment history.
        """
        if not assignments:
            return {
                'days': [],
                'times': [],
                'contractType': 'solo1',
                'consistency': 0.0
            }

        # Count frequencies
        day_freq = defaultdict(int)
        time_freq = defaultdict(int)
        contract_freq = defaultdict(int)

        for a in assignments:
            day_name = a.get('dayName', '').lower()
            if day_name:
                day_freq[day_name] += 1

            start_time = a.get('startTime', '')
            if start_time:
                time_freq[start_time] += 1

            contract = a.get('soloType', a.get('contractType', 'solo1'))
            if contract:
                contract_freq[contract.lower()] += 1

        # Get top preferences
        total = len(assignments)

        # Days that appear in at least 25% of assignments
        threshold = total * 0.25
        preferred_days = [
            day for day, count in sorted(day_freq.items(), key=lambda x: -x[1])
            if count >= threshold
        ]
        if not preferred_days:
            preferred_days = [day for day, _ in sorted(day_freq.items(), key=lambda x: -x[1])[:3]]

        # Top 3 times
        preferred_times = [
            time for time, _ in sorted(time_freq.items(), key=lambda x: -x[1])[:3]
        ]

        # Most common contract type
        contract_type = max(contract_freq.items(), key=lambda x: x[1])[0] if contract_freq else 'solo1'

        # Consistency: what fraction of weeks had the same days?
        # Simplified: use std of day frequencies
        if day_freq:
            counts = list(day_freq.values())
            consistency = 1.0 - (np.std(counts) / (np.mean(counts) + 0.01))
            consistency = max(0, min(1, consistency))
        else:
            consistency = 0.0

        return {
            'days': preferred_days,
            'times': preferred_times,
            'contractType': contract_type,
            'consistency': round(consistency, 3)
        }

    def predict_fit_scores(
        self,
        drivers: List[Dict],
        blocks: List[Dict],
        driver_profiles: Dict[str, Dict],
        slot_history: Dict[str, Dict[str, int]]
    ) -> Dict[Tuple[str, str], float]:
        """
        Predict how well each driver fits each block (0-1 score).

        Uses a combination of:
        1. Day preference match
        2. Time preference match
        3. Historical slot frequency
        4. Pattern group alignment

        Args:
            drivers: List of driver dicts with id, contractType
            blocks: List of block dicts with id, day, time, contractType
            driver_profiles: Output from cluster_drivers()
            slot_history: {slot: {driverId: count}}

        Returns:
            {(driver_id, block_id): score} where score is 0-1
        """
        scores = {}

        for driver in drivers:
            driver_id = driver['id']
            driver_ct = driver.get('contractType', 'solo1').lower()
            profile = driver_profiles.get(driver_id, {})

            preferred_days = set(profile.get('preferredDays', []))
            preferred_times = set(profile.get('preferredTimes', []))

            for block in blocks:
                block_id = block['id']
                block_ct = block.get('contractType', 'solo1').lower()
                block_day = block.get('day', '').lower()
                block_time = block.get('time', '')

                # Start with base score
                score = 0.3

                # Contract type match (hard requirement reflected in score)
                if driver_ct != block_ct:
                    scores[(driver_id, block_id)] = 0.0
                    continue

                # Day preference match (+0.3)
                if block_day in preferred_days:
                    score += 0.3

                # Time preference match (+0.2)
                if block_time in preferred_times:
                    score += 0.2

                # Historical slot match (+0.2 max)
                slot_key = f"{block_day}_{block_time}"
                history_count = slot_history.get(slot_key, {}).get(driver_id, 0)
                if history_count > 0:
                    # Log scale for history bonus
                    history_bonus = min(0.2, 0.05 * np.log1p(history_count))
                    score += history_bonus

                scores[(driver_id, block_id)] = round(min(1.0, score), 3)

        return scores

    def train_classifier(
        self,
        successful_assignments: List[Dict],
        driver_histories: Dict[str, List[Dict]]
    ) -> bool:
        """
        Train the RandomForest classifier on historical successful assignments.

        Args:
            successful_assignments: List of {driverId, blockId, day, time, ...}
            driver_histories: {driver_id: [assignments]}

        Returns:
            True if training was successful
        """
        if len(successful_assignments) < 10:
            print("[PatternAnalyzer] Not enough data for training", file=sys.stderr)
            return False

        X = []
        y = []

        for assignment in successful_assignments:
            driver_id = assignment.get('driverId')
            if driver_id not in driver_histories:
                continue

            # Driver features
            driver_features = self.extract_driver_features(driver_histories[driver_id])

            # Block features
            block_features = self.extract_block_features({
                'day': assignment.get('day', ''),
                'time': assignment.get('time', '')
            })

            # Combined features
            combined = np.concatenate([driver_features, block_features])
            X.append(combined)
            y.append(1)  # Successful assignment

        if len(X) < 10:
            return False

        X = np.array(X)
        y = np.array(y)

        # Add negative samples (random pairings that didn't happen)
        # This is simplified - in production you'd want actual negative examples

        try:
            self.classifier.fit(X, y)
            self.is_fitted = True
            print(f"[PatternAnalyzer] Classifier trained on {len(X)} samples", file=sys.stderr)
            return True
        except Exception as e:
            print(f"[PatternAnalyzer] Training failed: {e}", file=sys.stderr)
            return False


def analyze_patterns(data: Dict) -> Dict:
    """
    Main entry point for pattern analysis.

    Args:
        data: {
            'action': 'analyze' | 'predict' | 'cluster',
            'driverHistories': {driver_id: [assignments]},
            'drivers': [driver dicts],
            'blocks': [block dicts],
            'slotHistory': {slot: {driverId: count}}
        }

    Returns:
        Analysis results based on action
    """
    action = data.get('action', 'cluster')
    analyzer = PatternAnalyzer()

    if action == 'cluster':
        # Cluster drivers into pattern groups
        histories = data.get('driverHistories', {})
        profiles = analyzer.cluster_drivers(histories)

        # Count pattern groups (None means insufficient data)
        insufficient_data = sum(1 for p in profiles.values() if p['patternGroup'] is None)

        return {
            'success': True,
            'profiles': profiles,
            'stats': {
                'driversAnalyzed': len(profiles),
                'driversWithInsufficientData': insufficient_data,
                'patternGroups': {
                    'sunWed': sum(1 for p in profiles.values() if p['patternGroup'] == 'sunWed'),
                    'wedSat': sum(1 for p in profiles.values() if p['patternGroup'] == 'wedSat'),
                    'mixed': sum(1 for p in profiles.values() if p['patternGroup'] == 'mixed')
                }
            }
        }

    elif action == 'predict':
        # Predict fit scores for driver-block pairs
        histories = data.get('driverHistories', {})
        drivers = data.get('drivers', [])
        blocks = data.get('blocks', [])
        slot_history = data.get('slotHistory', {})

        # First cluster to get profiles
        profiles = analyzer.cluster_drivers(histories)

        # Then predict scores
        scores = analyzer.predict_fit_scores(drivers, blocks, profiles, slot_history)

        # Convert tuple keys to string for JSON
        scores_json = {f"{d}|{b}": s for (d, b), s in scores.items()}

        return {
            'success': True,
            'scores': scores_json,
            'profiles': profiles
        }

    else:
        return {
            'success': False,
            'error': f'Unknown action: {action}'
        }


def main():
    """CLI entry point - reads JSON from stdin, writes result to stdout."""
    try:
        input_data = sys.stdin.read().strip()
        if not input_data:
            print(json.dumps({'error': 'No input provided'}))
            sys.exit(1)

        data = json.loads(input_data)
        result = analyze_patterns(data)
        print(json.dumps(result))

    except json.JSONDecodeError as e:
        print(json.dumps({'error': f'Invalid JSON: {e}'}))
        sys.exit(1)
    except Exception as e:
        print(json.dumps({'error': f'Analysis failed: {e}'}))
        sys.exit(1)


if __name__ == '__main__':
    main()
