"""
XGBoost Pipeline - Two-Stage Driver-Block Matching

Stage 1: AvailabilityClassifier - filters drivers by predicted availability
Stage 2: DriverBlockRanker - ranks available drivers for each block

Usage:
    python xgboost_pipeline.py < input.json

Input JSON:
{
    "action": "predict",
    "blocks": [...],
    "drivers": [...],
    "histories": {...}
}
"""

import sys
import json
import os
from typing import List, Dict, Any, Tuple, Optional

# Import our Stage 1 and Stage 2 models
from xgboost_availability import AvailabilityClassifier
from xgboost_ranker import DriverBlockRanker


class XGBoostPipeline:
    """
    Two-stage pipeline for driver-block matching.

    Stage 1: Filter drivers by availability (probability > threshold)
    Stage 2: Rank available drivers for each block
    """

    def __init__(self, availability_threshold: float = 0.5):
        """
        Initialize the pipeline by loading both models.

        Args:
            availability_threshold: Minimum availability score to pass Stage 1 filter
        """
        self.availability_threshold = availability_threshold

        # Load Stage 1: Availability Classifier
        self.availability_model = AvailabilityClassifier()
        availability_path = os.path.join(os.path.dirname(__file__), 'models', 'availability_model.json')
        if os.path.exists(availability_path):
            self.availability_model.load(availability_path)
            print(f"[Pipeline] Loaded Stage 1 model from {availability_path}", file=sys.stderr)
        else:
            print(f"[Pipeline] WARNING: No Stage 1 model found at {availability_path}", file=sys.stderr)

        # Load Stage 2: Driver-Block Ranker
        self.ranker_model = DriverBlockRanker()
        ranker_path = os.path.join(os.path.dirname(__file__), 'models', 'ranker_model.json')
        if os.path.exists(ranker_path):
            self.ranker_model.load(ranker_path)
            print(f"[Pipeline] Loaded Stage 2 model from {ranker_path}", file=sys.stderr)
        else:
            print(f"[Pipeline] WARNING: No Stage 2 model found at {ranker_path}", file=sys.stderr)

    def filter_available_drivers(
        self,
        date: str,
        drivers: List[Dict[str, Any]],
        histories: Dict[str, List[Dict[str, Any]]]
    ) -> List[Tuple[Dict[str, Any], float]]:
        """
        Stage 1: Filter drivers by predicted availability for a given date.

        Args:
            date: Target date (YYYY-MM-DD)
            drivers: List of driver dicts with 'id', 'contractType'
            histories: Dict mapping driver_id -> list of work history records

        Returns:
            List of (driver, availability_score) tuples for drivers above threshold
        """
        import pandas as pd

        # Parse target date
        target_date = pd.to_datetime(date).to_pydatetime()

        available_drivers = []

        for driver in drivers:
            driver_id = driver.get('id')
            driver_history = histories.get(driver_id, [])

            # Extract features for this driver on target date
            features = self.availability_model.extract_features(
                driver_id,
                target_date,
                driver_history
            )

            # Predict availability probability
            if self.availability_model.is_fitted:
                import numpy as np
                X = np.array([features])
                proba = self.availability_model.model.predict_proba(X)[0][1]  # Probability of class 1 (will work)
            else:
                # No model trained - use frequency heuristic
                # Feature 3 is historical_freq_this_day
                proba = features[3] if features[3] > 0 else 0.5

            # Add to available list if above threshold
            if proba >= self.availability_threshold:
                available_drivers.append((driver, float(proba)))

        # Sort by availability score (highest first)
        available_drivers.sort(key=lambda x: x[1], reverse=True)

        print(f"[Pipeline] Stage 1: {len(available_drivers)}/{len(drivers)} drivers pass availability filter (threshold={self.availability_threshold})", file=sys.stderr)

        return available_drivers

    def rank_drivers_for_block(
        self,
        block: Dict[str, Any],
        available_drivers: List[Tuple[Dict[str, Any], float]],
        histories: Dict[str, List[Dict[str, Any]]]
    ) -> List[Tuple[str, float]]:
        """
        Stage 2: Rank available drivers for a specific block.

        Args:
            block: Block dict with 'serviceDate', 'contractType', 'startTime'
            available_drivers: List of (driver, availability_score) from Stage 1
            histories: Dict mapping driver_id -> list of work history records

        Returns:
            Sorted list of (driver_id, combined_score) tuples, highest first
        """
        # TODO: Implement in Part 11c
        pass

    def get_best_matches(
        self,
        blocks: List[Dict[str, Any]],
        drivers: List[Dict[str, Any]],
        histories: Dict[str, List[Dict[str, Any]]]
    ) -> Dict[str, List[Tuple[str, float]]]:
        """
        Full pipeline: Get best driver matches for each block.

        Args:
            blocks: List of blocks to fill
            drivers: List of all drivers
            histories: Dict mapping driver_id -> list of work history records

        Returns:
            Dict mapping block_id -> [(driver_id, score), ...] sorted by score
        """
        # TODO: Implement in Part 11c
        pass


def main():
    """Main entry point for CLI usage."""
    # Read JSON input from stdin
    input_data = json.load(sys.stdin)
    action = input_data.get('action', 'predict')

    if action == 'predict':
        # Initialize pipeline
        pipeline = XGBoostPipeline(
            availability_threshold=input_data.get('availabilityThreshold', 0.5)
        )

        blocks = input_data.get('blocks', [])
        drivers = input_data.get('drivers', [])
        histories = input_data.get('histories', {})

        # Get best matches for all blocks
        results = pipeline.get_best_matches(blocks, drivers, histories)

        print(json.dumps({
            'success': True,
            'matches': results
        }))

    elif action == 'filter':
        # Just run Stage 1 filtering
        pipeline = XGBoostPipeline(
            availability_threshold=input_data.get('availabilityThreshold', 0.5)
        )

        date = input_data.get('date')
        drivers = input_data.get('drivers', [])
        histories = input_data.get('histories', {})

        available = pipeline.filter_available_drivers(date, drivers, histories)

        print(json.dumps({
            'success': True,
            'available': [(d['id'], score) for d, score in available] if available else []
        }))

    else:
        print(json.dumps({
            'success': False,
            'error': f'Unknown action: {action}'
        }))


if __name__ == '__main__':
    main()
