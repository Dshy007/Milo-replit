#!/usr/bin/env python3
"""
Driver Assignment Predictor
Uses historical data and rules to suggest optimal driver-to-block assignments
"""

import sys
import json
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from typing import Dict, List, Any

class AssignmentPredictor:
    def __init__(self, historical_data: List[Dict] = None):
        """Initialize predictor with optional historical data"""
        self.historical_data = historical_data or []
        
    def calculate_driver_affinity(self, driver_id: str, block_id: str) -> float:
        """
        Calculate how well a driver matches a block based on history
        Returns score 0-1 (higher is better)
        """
        # Count past assignments
        past_assignments = 0
        successful_assignments = 0
        
        for record in self.historical_data:
            if record.get('driverId') == driver_id and record.get('blockId') == block_id:
                past_assignments += 1
                if record.get('completed', True):
                    successful_assignments += 1
        
        if past_assignments == 0:
            return 0.5  # Neutral score for new combinations
        
        return successful_assignments / past_assignments
    
    def check_driver_availability(self, driver: Dict, shift_start: str, shift_end: str) -> Dict[str, Any]:
        """
        Check if driver is available and compliant for the shift
        Returns: {available: bool, reason: str, compliance_score: float}
        """
        # TODO: Implement rest period calculations
        # TODO: Check against existing assignments
        # TODO: Verify hours of service compliance
        
        return {
            'available': True,
            'reason': 'Available',
            'compliance_score': 1.0,
            'rest_hours': 10,  # Placeholder
            'next_available': shift_start
        }
    
    def predict_assignments(self, 
                          blocks: List[Dict], 
                          drivers: List[Dict],
                          constraints: Dict = None) -> List[Dict]:
        """
        Predict optimal driver-to-block assignments
        
        Args:
            blocks: List of blocks needing assignment
            drivers: List of available drivers
            constraints: Additional constraints (max_hours, required_skills, etc.)
        
        Returns:
            List of recommendations with confidence scores
        """
        recommendations = []
        constraints = constraints or {}
        
        for block in blocks:
            block_id = block.get('blockId')
            contract_type = block.get('contractType', '').lower()
            shift_start = block.get('shiftStart')
            shift_end = block.get('shiftEnd')
            
            # Score each driver for this block
            driver_scores = []
            
            for driver in drivers:
                driver_id = driver.get('id')
                driver_type = driver.get('type', '').lower()
                
                # Base compatibility score
                score = 0.0
                reasons = []
                
                # Contract type matching
                if driver_type == contract_type:
                    score += 0.4
                    reasons.append('Contract type match')
                elif driver_type == 'team' and contract_type in ['solo1', 'solo2']:
                    score += 0.2
                    reasons.append('Team driver can cover solo')
                
                # Historical affinity
                affinity = self.calculate_driver_affinity(driver_id, block_id)
                score += affinity * 0.3
                if affinity > 0.7:
                    reasons.append('High historical success')
                
                # Availability check
                availability = self.check_driver_availability(driver, shift_start, shift_end)
                if availability['available']:
                    score += 0.3 * availability['compliance_score']
                    reasons.append(availability['reason'])
                else:
                    score = 0  # Not available = zero score
                    reasons = [availability['reason']]
                
                driver_scores.append({
                    'driver_id': driver_id,
                    'driver_name': driver.get('name'),
                    'score': score,
                    'reasons': reasons,
                    'availability': availability
                })
            
            # Sort by score
            driver_scores.sort(key=lambda x: x['score'], reverse=True)
            
            # Top 3 recommendations
            recommendations.append({
                'block_id': block_id,
                'contract_type': contract_type,
                'shift_start': shift_start,
                'shift_end': shift_end,
                'recommendations': driver_scores[:3]
            })
        
        return recommendations
    
    def analyze_coverage(self, schedule: List[Dict], date_range: Dict) -> Dict[str, Any]:
        """
        Analyze schedule coverage and identify gaps
        
        Returns:
            {
                'coverage_percentage': float,
                'gaps': List[Dict],
                'overstaffed': List[Dict],
                'recommendations': List[str]
            }
        """
        # Count filled vs unfilled slots
        total_slots = len(schedule)
        filled_slots = sum(1 for s in schedule if s.get('driverId'))
        
        coverage = (filled_slots / total_slots * 100) if total_slots > 0 else 0
        
        # Identify gaps (unfilled blocks)
        gaps = [
            {
                'block_id': s.get('blockId'),
                'date': s.get('date'),
                'contract_type': s.get('contractType'),
                'priority': 'high' if s.get('contractType') == 'team' else 'medium'
            }
            for s in schedule if not s.get('driverId')
        ]
        
        # Generate recommendations
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
            'overstaffed': [],  # TODO: Implement overstaffing detection
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
                'recommendations': recommendations
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
        return {
            'success': False,
            'error': str(e),
            'error_type': type(e).__name__
        }

if __name__ == '__main__':
    if len(sys.argv) != 2:
        print(json.dumps({'success': False, 'error': 'Usage: assignment_predictor.py <json_input>'}))
        sys.exit(1)
    
    input_data = json.loads(sys.argv[1])
    result = run_prediction(input_data)
    print(json.dumps(result, indent=2))
