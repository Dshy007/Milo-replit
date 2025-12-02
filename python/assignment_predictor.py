#!/usr/bin/env python3
"""
Driver Assignment Predictor
Uses historical data to match drivers to blocks based on previous week patterns.

Key logic:
1. If a driver ran a specific block last week, they get highest priority for that block
2. If no exact match, find drivers who ran similar blocks (same day of week, same time slot)
3. Fall back to contract type matching if no historical patterns found
4. Distribute workload evenly - don't assign same driver to all blocks
"""

import sys
import json
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional, Set
from collections import defaultdict

class AssignmentPredictor:
    def __init__(self, historical_data: List[Dict] = None):
        """Initialize predictor with historical data"""
        self.historical_data = historical_data or []
        self._build_driver_patterns()

    def _build_driver_patterns(self):
        """Build lookup tables for historical driver patterns"""
        # Map: blockId -> list of (driverId, serviceDate, dayOfWeek)
        self.block_history = defaultdict(list)

        # Map: (dayOfWeek, startTime) -> list of (driverId, blockId, serviceDate)
        self.time_slot_history = defaultdict(list)

        # Map: driverId -> set of blockIds they've driven
        self.driver_blocks = defaultdict(set)

        # Map: driverId -> count of assignments (for workload balancing)
        self.driver_assignment_count = defaultdict(int)

        for record in self.historical_data:
            driver_id = record.get('driverId')
            block_id = record.get('blockId')
            service_date = record.get('serviceDate')
            day_of_week = record.get('dayOfWeek')
            start_time = record.get('startTime')

            if driver_id and block_id:
                self.block_history[block_id].append({
                    'driverId': driver_id,
                    'serviceDate': service_date,
                    'dayOfWeek': day_of_week,
                    'startTime': start_time
                })

                self.driver_blocks[driver_id].add(block_id)
                self.driver_assignment_count[driver_id] += 1

                if day_of_week is not None and start_time:
                    time_key = (int(day_of_week), start_time)
                    self.time_slot_history[time_key].append({
                        'driverId': driver_id,
                        'blockId': block_id,
                        'serviceDate': service_date
                    })

    def find_exact_block_match(self, block_id: str, day_of_week: int = None) -> List[Dict]:
        """Find drivers who ran this exact block before, prioritizing recent assignments"""
        matches = []
        seen_drivers = set()

        # Sort by service date (most recent first)
        history = sorted(
            self.block_history.get(block_id, []),
            key=lambda x: x.get('serviceDate', ''),
            reverse=True
        )

        for record in history:
            driver_id = record['driverId']
            if driver_id in seen_drivers:
                continue
            seen_drivers.add(driver_id)

            # Bonus if same day of week
            day_match = day_of_week is not None and record.get('dayOfWeek') == day_of_week

            matches.append({
                'driverId': driver_id,
                'reason': 'Ran this exact block before',
                'dayMatch': day_match,
                'recency': len(matches)  # Lower is more recent
            })

            if len(matches) >= 5:  # Top 5 historical drivers
                break

        return matches

    def find_time_slot_match(self, day_of_week: int, start_time: str) -> List[Dict]:
        """Find drivers who typically work this time slot"""
        if day_of_week is None or not start_time:
            return []

        time_key = (int(day_of_week), start_time)
        history = self.time_slot_history.get(time_key, [])

        # Count frequency per driver
        driver_freq = defaultdict(int)
        for record in history:
            driver_freq[record['driverId']] += 1

        # Sort by frequency
        sorted_drivers = sorted(driver_freq.items(), key=lambda x: x[1], reverse=True)

        return [
            {'driverId': d[0], 'frequency': d[1], 'reason': f'Works this time slot {d[1]} times'}
            for d in sorted_drivers[:5]
        ]

    def check_driver_availability(self, driver: Dict, shift_start: str, shift_end: str) -> Dict[str, Any]:
        """Check if driver is available for the shift"""
        # Basic availability check - in production would check against existing assignments
        return {
            'available': True,
            'reason': 'Available',
            'compliance_score': 1.0,
            'rest_hours': 10,
            'next_available': shift_start
        }

    def predict_assignments(self,
                          blocks: List[Dict],
                          drivers: List[Dict],
                          constraints: Dict = None) -> List[Dict]:
        """
        Predict optimal driver-to-block assignments based on historical patterns.

        SIMPLIFIED SCORING:
        - 100%: Same Block ID + Same Driver (ran it last week)
        - 100%: Same Day + Same Start Time + Same Driver (ran this slot)
        - 90%: Same Block ID + Driver ran it before (older than last week)
        - 75%: Driver has worked similar time slots frequently
        - 50%: Contract type match only
        - 25%: Fallback (driver available but no history)
        """
        recommendations = []
        constraints = constraints or {}

        # Track assignments in this session to balance workload
        session_assignments = defaultdict(int)

        # Create driver lookup
        driver_lookup = {d.get('id'): d for d in drivers}

        for block in blocks:
            block_id = block.get('blockId')
            contract_type = (block.get('contractType') or '').lower()
            shift_start = block.get('shiftStart')
            shift_end = block.get('shiftEnd')
            day_of_week = block.get('dayOfWeek')  # 0=Sunday, 6=Saturday
            start_time = block.get('startTime')

            # Score each driver
            driver_scores = []

            # Find historical matches
            exact_matches = self.find_exact_block_match(block_id, day_of_week)
            exact_match_drivers = {m['driverId']: m for m in exact_matches}

            time_slot_matches = self.find_time_slot_match(day_of_week, start_time)
            time_slot_drivers = {m['driverId']: m for m in time_slot_matches}

            for driver in drivers:
                driver_id = driver.get('id')
                driver_name = driver.get('name', 'Unknown')
                driver_type = (driver.get('type') or '').lower()

                score = 0.0
                reasons = []
                match_type = None

                # Priority 1: EXACT BLOCK MATCH = 100%
                if driver_id in exact_match_drivers:
                    match = exact_match_drivers[driver_id]
                    recency = match.get('recency', 99)
                    if recency == 0:
                        # Most recent = last week = 100%
                        score = 1.0
                        match_type = 'perfect_block'
                        reasons.append(f'★ Ran block {block_id} last week')
                    else:
                        # Ran it before but not last week = 90%
                        score = 0.90
                        match_type = 'block_history'
                        reasons.append(f'✓ Ran block {block_id} before ({recency+1} weeks ago)')

                # Priority 2: SAME DAY + SAME TIME = 100%
                elif driver_id in time_slot_drivers:
                    match = time_slot_drivers[driver_id]
                    freq = match.get('frequency', 1)
                    # Same day + same start time = 100%
                    score = 1.0
                    match_type = 'perfect_timeslot'
                    reasons.append(f'★ Works this day/time ({freq}x)')

                # Priority 3: CONTRACT TYPE MATCH ONLY
                elif driver_type == contract_type:
                    score = 0.50
                    match_type = 'contract'
                    reasons.append('○ Contract type match (no history)')

                # Priority 4: FALLBACK - available but no match
                else:
                    score = 0.25
                    match_type = 'fallback'
                    reasons.append('△ Available (no matching history)')

                # Adjust for workload balance (small penalty for over-assignment)
                session_count = session_assignments.get(driver_id, 0)
                if session_count > 5:
                    score = max(0.1, score - 0.15)
                    reasons.append(f'⚠ Heavy load ({session_count} blocks this session)')
                elif session_count > 3:
                    score = max(0.1, score - 0.05)

                # Availability check
                availability = self.check_driver_availability(driver, shift_start, shift_end)
                if not availability['available']:
                    score = 0
                    reasons = [availability['reason']]

                # Ensure score is between 0 and 1
                score = max(0, min(1, score))

                driver_scores.append({
                    'driver_id': driver_id,
                    'driver_name': driver_name,
                    'score': round(score, 2),
                    'reasons': reasons if reasons else ['No historical pattern'],
                    'availability': availability
                })

            # Sort by score (descending)
            driver_scores.sort(key=lambda x: x['score'], reverse=True)

            # Track top recommendation for workload balancing
            if driver_scores and driver_scores[0]['score'] > 0:
                top_driver = driver_scores[0]['driver_id']
                session_assignments[top_driver] += 1

            # Return top 3 recommendations
            recommendations.append({
                'block_id': block_id,
                'contract_type': contract_type,
                'shift_start': shift_start,
                'shift_end': shift_end,
                'recommendations': driver_scores[:3]
            })

        return recommendations

    def analyze_coverage(self, schedule: List[Dict], date_range: Dict) -> Dict[str, Any]:
        """Analyze schedule coverage and identify gaps"""
        total_slots = len(schedule)
        filled_slots = sum(1 for s in schedule if s.get('driverId'))

        coverage = (filled_slots / total_slots * 100) if total_slots > 0 else 0

        gaps = [
            {
                'block_id': s.get('blockId'),
                'date': s.get('date'),
                'contract_type': s.get('contractType'),
                'priority': 'high' if s.get('contractType') == 'team' else 'medium'
            }
            for s in schedule if not s.get('driverId')
        ]

        recommendations = []
        if coverage < 80:
            recommendations.append('Coverage below 80% - consider hiring additional drivers')
        if len(gaps) > 0:
            recommendations.append(f'{len(gaps)} unfilled blocks - review driver availability')

        return {
            'coverage_percentage': round(coverage, 2),
            'total_slots': total_slots,
            'filled_slots': filled_slots,
            'gaps': gaps,
            'overstaffed': [],
            'recommendations': recommendations
        }


def run_prediction(data: Dict) -> Dict[str, Any]:
    """Main entry point for predictions"""
    try:
        predictor = AssignmentPredictor(
            historical_data=data.get('historical', [])
        )

        action = data.get('action', 'predict')

        if action == 'predict':
            blocks = data.get('blocks', [])
            drivers = data.get('drivers', [])
            constraints = data.get('constraints', {})

            recommendations = predictor.predict_assignments(blocks, drivers, constraints)

            return {
                'success': True,
                'action': 'predict',
                'recommendations': recommendations,
                'historical_records': len(data.get('historical', [])),
                'blocks_processed': len(blocks),
                'drivers_available': len(drivers)
            }

        elif action == 'analyze_coverage':
            schedule = data.get('schedule', [])
            date_range = data.get('date_range', {})

            analysis = predictor.analyze_coverage(schedule, date_range)

            return {
                'success': True,
                'action': 'analyze_coverage',
                'analysis': analysis
            }

        else:
            return {
                'success': False,
                'error': f'Unknown action: {action}'
            }

    except Exception as e:
        import traceback
        return {
            'success': False,
            'error': str(e),
            'error_type': type(e).__name__,
            'traceback': traceback.format_exc()
        }


if __name__ == '__main__':
    # Read from stdin if no arguments (for large payloads)
    # Or from command line argument for backward compatibility
    if len(sys.argv) == 2:
        input_data = json.loads(sys.argv[1])
    else:
        # Read from stdin
        input_str = sys.stdin.read()
        if not input_str.strip():
            print(json.dumps({'success': False, 'error': 'No input provided. Pass JSON via stdin or as argument.'}))
            sys.exit(1)
        input_data = json.loads(input_str)

    result = run_prediction(input_data)
    print(json.dumps(result, indent=2))
