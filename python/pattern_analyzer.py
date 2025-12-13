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
import pandas as pd
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

# Rolling interval pattern thresholds
# If interval std deviation is below this, driver has a rolling interval pattern
# Set to 1.8 to catch drivers like Adan who work every ~2-4 days (std ~1.5-1.7)
ROLLING_INTERVAL_STD_THRESHOLD = 1.8  # days
# If day frequency std is above this, NOT a fixed weekday pattern
WEEKDAY_PATTERN_STD_THRESHOLD = 2.0


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

        # Convert to DataFrame for cleaner processing
        df = pd.DataFrame(assignments)
        total = len(df)

        # Day frequency: get dayOfWeek or convert day/dayName to index
        if 'dayOfWeek' in df.columns:
            df['day_idx'] = df['dayOfWeek']
        elif 'day' in df.columns:
            df['day_idx'] = df['day'].str.lower().map(DAY_TO_INDEX).fillna(0).astype(int)
        elif 'dayName' in df.columns:
            df['day_idx'] = df['dayName'].str.lower().map(DAY_TO_INDEX).fillna(0).astype(int)
        else:
            df['day_idx'] = 0

        day_counts = df['day_idx'].value_counts().reindex(range(7), fill_value=0).sort_index().values

        # Time bucket: convert startTime/time to bucket (0-3)
        def time_to_bucket(time_str):
            try:
                hour = int(str(time_str).split(':')[0])
                return min(3, hour // 6)
            except (ValueError, IndexError, TypeError):
                return 2  # Default to afternoon

        time_col = 'time' if 'time' in df.columns else ('startTime' if 'startTime' in df.columns else None)
        if time_col:
            df['time_bucket'] = df[time_col].fillna('12:00').apply(time_to_bucket)
        else:
            df['time_bucket'] = 2  # Default to afternoon
        time_counts = df['time_bucket'].value_counts().reindex(range(4), fill_value=0).sort_index().values

        # Normalize frequencies
        features[0:7] = day_counts / total
        features[7:11] = time_counts / total

        # Consistency score: coefficient of variation of day counts
        if day_counts.mean() > 0:
            features[11] = day_counts.std() / (day_counts.mean() + 0.01)

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

            # Detect rolling interval pattern (like Adan's ~3 day cycle)
            interval_pattern = self._detect_interval_pattern(assignments)

            result[driver_id] = {
                'patternGroup': pattern_group,
                'preferredDays': prefs['days'],
                'preferredTimes': prefs['times'],
                'preferredContractType': prefs['contractType'],
                'consistencyScore': prefs['consistency'],
                'clusterConfidence': round(confidence, 3),
                'assignmentsAnalyzed': num_assignments,
                # Rolling interval pattern (detected from consecutive block spacing)
                'rollingPattern': interval_pattern
            }

        return result

    def _analyze_cluster_profiles(self, X: np.ndarray, labels: np.ndarray) -> Dict[int, str]:
        """
        Analyze clusters to determine pattern group labels using Pandas.

        Looks at day frequency patterns to classify:
        - sunWed: Primarily Sun-Mon-Tue-Wed
        - wedSat: Primarily Wed-Thu-Fri-Sat
        - mixed: No clear pattern
        """
        # Create DataFrame with day frequencies and cluster labels
        day_cols = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
        df = pd.DataFrame(X[:, 0:7], columns=day_cols)
        df['cluster'] = labels

        n_clusters = int(max(labels)) + 1
        print(f"[K-Means DEBUG] Analyzing {n_clusters} clusters", file=sys.stderr)

        # Group by cluster and compute mean day frequencies
        cluster_means = df.groupby('cluster')[day_cols].mean()

        cluster_profiles = {}
        for cluster_id in range(n_clusters):
            if cluster_id not in cluster_means.index:
                cluster_profiles[cluster_id] = 'mixed'
                continue

            avg_days = cluster_means.loc[cluster_id]
            driver_count = (df['cluster'] == cluster_id).sum()

            # Debug: show day distribution
            day_pcts = ' '.join([f"{day}:{avg_days[day]:.2f}" for day in day_cols])
            print(f"[K-Means DEBUG] Cluster {cluster_id} ({driver_count} drivers): {day_pcts}", file=sys.stderr)

            # Calculate sun-wed vs wed-sat scores
            sun_wed_score = avg_days['Sun'] + avg_days['Mon'] + avg_days['Tue'] + avg_days['Wed'] * 0.5
            wed_sat_score = avg_days['Wed'] * 0.5 + avg_days['Thu'] + avg_days['Fri'] + avg_days['Sat']

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

    def _detect_interval_pattern(self, assignments: List[Dict]) -> Dict:
        """
        Detect if driver has a rolling interval pattern (like Adan's ~3-day cycle).

        This is fundamentally different from fixed weekday patterns:
        - Fixed weekday: Works Sat/Sun/Mon every week (calendar-driven)
        - Rolling interval: Works every N days regardless of weekday (cycle-driven)

        Algorithm:
        1. Order blocks chronologically by serviceDate
        2. Calculate interval (days) between consecutive blocks
        3. Compute interval statistics: median, mean, std deviation
        4. If std deviation is low → rolling pattern, high → no rolling pattern

        Returns:
            {
                'hasRollingPattern': bool,
                'intervalDays': float,      # Average days between blocks
                'intervalStdDev': float,    # How consistent the interval is
                'confidence': float,        # 0-1 confidence in the pattern
                'intervals': List[int]      # Raw intervals for debugging
            }
        """
        if len(assignments) < 3:
            return {
                'hasRollingPattern': False,
                'intervalDays': None,
                'intervalStdDev': None,
                'confidence': 0.0,
                'intervals': []
            }

        # Get service dates and sort chronologically
        df = pd.DataFrame(assignments)

        # Find date column
        date_col = None
        for col in ['serviceDate', 'date', 'startTimestamp']:
            if col in df.columns:
                date_col = col
                break

        if date_col is None:
            return {
                'hasRollingPattern': False,
                'intervalDays': None,
                'intervalStdDev': None,
                'confidence': 0.0,
                'intervals': []
            }

        # Convert to datetime and sort
        df['_date'] = pd.to_datetime(df[date_col])
        df = df.sort_values('_date')

        # Calculate intervals between consecutive blocks
        dates = df['_date'].values
        intervals = []
        for i in range(1, len(dates)):
            diff = (dates[i] - dates[i-1]) / np.timedelta64(1, 'D')  # Convert to days
            intervals.append(float(diff))

        if not intervals:
            return {
                'hasRollingPattern': False,
                'intervalDays': None,
                'intervalStdDev': None,
                'confidence': 0.0,
                'intervals': []
            }

        # Calculate statistics
        intervals_arr = np.array(intervals)
        median_interval = float(np.median(intervals_arr))
        mean_interval = float(np.mean(intervals_arr))
        std_interval = float(np.std(intervals_arr))

        # Determine if this is a rolling pattern
        # Low std deviation = consistent intervals = rolling pattern
        has_rolling = std_interval <= ROLLING_INTERVAL_STD_THRESHOLD and len(intervals) >= 4

        # Confidence based on std deviation (lower = more confident)
        if std_interval > 0:
            confidence = max(0.0, 1.0 - (std_interval / 5.0))  # Scale: 0-5 days std → 1-0 confidence
        else:
            confidence = 1.0

        # Get the most recent work date (for predicting next work date)
        last_date = df['_date'].max()
        last_date_str = str(last_date)[:10] if pd.notna(last_date) else None

        print(f"[Interval Pattern] intervals={intervals[:10]}, median={median_interval:.1f}, std={std_interval:.2f}, rolling={has_rolling}, last={last_date_str}", file=sys.stderr)

        return {
            'hasRollingPattern': has_rolling,
            'intervalDays': round(mean_interval, 1),
            'intervalMedian': round(median_interval, 1),
            'intervalStdDev': round(std_interval, 2),
            'confidence': round(confidence, 3),
            'intervals': intervals[:10],  # First 10 for debugging
            'lastWorkDate': last_date_str  # Most recent date for prediction
        }

    def _calculate_preferences(self, assignments: List[Dict]) -> Dict:
        """
        Calculate driver preferences from assignment history using Pandas.
        """
        if not assignments:
            return {
                'days': [],
                'times': [],
                'contractType': 'solo1',
                'consistency': 0.0
            }

        df = pd.DataFrame(assignments)
        total = len(df)
        threshold = total * 0.25

        # Day frequency - check for 'day' (from Node.js) or 'dayName'
        day_col = 'day' if 'day' in df.columns else ('dayName' if 'dayName' in df.columns else None)
        if day_col:
            day_freq = df[day_col].str.lower().value_counts()
            preferred_days = day_freq[day_freq >= threshold].index.tolist()
            if not preferred_days:
                preferred_days = day_freq.head(3).index.tolist()
        else:
            day_freq = pd.Series(dtype=float)
            preferred_days = []

        # Time frequency - top 3 (check for 'time' from Node.js or 'startTime')
        time_col = 'time' if 'time' in df.columns else ('startTime' if 'startTime' in df.columns else None)
        if time_col:
            time_freq = df[time_col].dropna().value_counts()
            preferred_times = time_freq.head(3).index.tolist()
        else:
            preferred_times = []

        # Contract type - mode (most common)
        contract_col = df['soloType'] if 'soloType' in df.columns else df.get('contractType')
        if contract_col is not None and len(contract_col.dropna()) > 0:
            contract_type = contract_col.str.lower().mode().iloc[0]
        else:
            contract_type = 'solo1'

        # Consistency score from day frequency variance
        if day_col and len(day_freq) > 0:
            counts = day_freq.values
            consistency = 1.0 - (np.std(counts) / (np.mean(counts) + 0.01))
            consistency = max(0.0, min(1.0, consistency))
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
        2. Time preference match (HEAVILY weighted for consistency)
        3. Historical slot frequency (day+time specific)
        4. Pattern group alignment
        5. Rolling interval pattern matching (NEW)

        TIME CONSISTENCY: Drivers should work the same time slot across days.
        A driver who always works 16:30 should NOT be assigned to 17:30.

        ROLLING PATTERN: For drivers like Adan who work every N days regardless
        of weekday, we boost blocks that fall on their predicted next work date.

        Args:
            drivers: List of driver dicts with id, contractType
            blocks: List of block dicts with id, day, time, contractType
            driver_profiles: Output from cluster_drivers()
            slot_history: {slot: {driverId: count}}

        Returns:
            {(driver_id, block_id): score} where score is 0-1
        """
        scores = {}

        # Pre-compute each driver's PRIMARY time slot (most frequent time worked)
        driver_primary_time = {}
        driver_last_work_date = {}
        for driver_id, profile in driver_profiles.items():
            preferred_times = profile.get('preferredTimes', [])
            if preferred_times:
                # First preferred time is the most frequent
                driver_primary_time[driver_id] = preferred_times[0]

            # Get last work date for rolling pattern calculations
            rolling = profile.get('rollingPattern', {})
            if rolling.get('hasRollingPattern'):
                # We need to find the most recent date from their assignments
                # This is stored in the profile during _detect_interval_pattern
                # For now, we'll calculate predicted dates relative to block dates
                pass

        # Parse block dates for rolling pattern matching
        block_dates = {}
        for block in blocks:
            block_id = block['id']
            date_str = block.get('serviceDate') or block.get('date')
            if date_str:
                try:
                    block_dates[block_id] = pd.to_datetime(date_str)
                except:
                    pass

        for driver in drivers:
            driver_id = driver['id']
            driver_ct = driver.get('contractType', 'solo1').lower()
            profile = driver_profiles.get(driver_id, {})

            preferred_days = set(profile.get('preferredDays', []))
            preferred_times = profile.get('preferredTimes', [])
            primary_time = driver_primary_time.get(driver_id)

            # Get rolling pattern info for this driver
            rolling = profile.get('rollingPattern', {})
            has_rolling = rolling.get('hasRollingPattern', False)
            interval_days = rolling.get('intervalDays')
            last_work_date_str = rolling.get('lastWorkDate')
            rolling_confidence = rolling.get('confidence', 0.0)

            # Parse last work date for rolling pattern matching
            last_work_date = None
            if has_rolling and last_work_date_str and interval_days:
                try:
                    last_work_date = pd.to_datetime(last_work_date_str)
                except:
                    pass

            for block in blocks:
                block_id = block['id']
                block_ct = block.get('contractType', 'solo1').lower()
                block_day = block.get('day', '').lower()
                block_time = block.get('time', '')

                # Start with base score
                score = 0.2

                # Contract type match (hard requirement reflected in score)
                if driver_ct != block_ct:
                    scores[(driver_id, block_id)] = 0.0
                    continue

                # Day preference match (+0.2)
                if block_day in preferred_days:
                    score += 0.2

                # TIME CONSISTENCY SCORING (most important for schedule stability)
                # Primary time match: BIG bonus if this is driver's most frequent time
                if primary_time and block_time == primary_time:
                    score += 0.35  # Strong bonus for exact primary time match
                elif block_time in preferred_times:
                    score += 0.15  # Smaller bonus for any preferred time

                # Historical SLOT match (day+time specific) - CRITICAL for consistency
                # This rewards drivers who have historically worked THIS EXACT slot
                slot_key = f"{block_day}_{block_time}"
                history_count = slot_history.get(slot_key, {}).get(driver_id, 0)
                if history_count > 0:
                    # Stronger bonus for slot-specific history (up to +0.25)
                    # A driver who worked monday_16:30 five times gets priority
                    history_bonus = min(0.25, 0.08 * np.log1p(history_count))
                    score += history_bonus

                # ROLLING PATTERN MATCHING (NEW)
                # For drivers like Adan who work every N days, boost blocks on predicted dates
                if has_rolling and last_work_date and interval_days and block_id in block_dates:
                    block_date = block_dates[block_id]
                    days_since_last = (block_date - last_work_date).days

                    if days_since_last > 0:
                        # Calculate how close this block is to the predicted next work date(s)
                        # Predicted dates: lastWorkDate + N*interval for N=1,2,3...
                        # We check the first 3 predicted dates

                        best_distance = float('inf')
                        for n in range(1, 4):  # Check next 3 predicted work dates
                            predicted_days = interval_days * n
                            distance = abs(days_since_last - predicted_days)
                            best_distance = min(best_distance, distance)

                        # Bonus based on proximity to predicted date
                        # 0 days off = +0.25, 1 day off = +0.15, 2 days off = +0.05
                        if best_distance <= 2:
                            rolling_bonus = (0.25 - 0.10 * best_distance) * rolling_confidence
                            score += max(0, rolling_bonus)
                            # print(f"[Rolling] {driver_id[:8]}.. block {block_date.date()}: days_since={days_since_last}, interval={interval_days}, dist={best_distance:.1f}, bonus={rolling_bonus:.3f}", file=sys.stderr)

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
