"""
Driver Availability Forecaster using skforecast + XGBoost

Predicts which drivers are likely to work on future dates based on their
historical work patterns. Uses time series forecasting to learn:
- Rolling interval patterns (e.g., driver works every ~3 days)
- Fixed weekday preferences (e.g., always works Sun/Mon/Tue)
- Seasonal variations and trends

Integrates with the existing schedule_optimizer.py to provide ML-based
availability scores instead of heuristic-based scoring.
"""

import json
import sys
import warnings
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple

# Suppress skforecast warnings (they go to stdout which breaks JSON parsing)
warnings.filterwarnings('ignore', category=UserWarning)
warnings.filterwarnings('ignore', module='skforecast')

# XGBoost regressor for gradient boosting
from xgboost import XGBRegressor

# skforecast for multi-series time series forecasting
from skforecast.recursive import ForecasterRecursiveMultiSeries

# Minimum days of history required per driver
MIN_HISTORY_DAYS = 14

# Default lag window (how many days back to look for patterns)
DEFAULT_LAGS = 14


class DriverAvailabilityForecaster:
    """
    Forecasts driver availability using XGBoost via skforecast.

    Each driver is treated as a separate time series where:
    - 1.0 = driver worked on that date
    - 0.0 = driver did not work on that date

    The forecaster learns patterns and predicts probability of working
    on future dates.
    """

    def __init__(self, lags: int = DEFAULT_LAGS):
        """
        Initialize the forecaster with XGBoost regressor.

        Args:
            lags: Number of days to look back for pattern detection
        """
        self.lags = lags
        self.forecaster = None
        self.driver_ids = []
        self.last_training_date = None
        self.is_fitted = False

    def _create_forecaster(self) -> ForecasterRecursiveMultiSeries:
        """Create a new forecaster instance with XGBoost."""
        return ForecasterRecursiveMultiSeries(
            estimator=XGBRegressor(
                n_estimators=100,
                max_depth=6,
                learning_rate=0.1,
                random_state=42,
                verbosity=0  # Suppress XGBoost warnings
            ),
            lags=self.lags,
            encoding='ordinal',  # Encode series names as ordinal numbers
            dropna_from_series=False  # Keep NaN for missing dates
        )

    def _build_multi_series(
        self,
        driver_histories: Dict[str, List[Dict]],
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None
    ) -> pd.DataFrame:
        """
        Convert driver histories to multi-series DataFrame format.

        skforecast expects:
        - DatetimeIndex as index
        - One column per driver (series)
        - Values: 1.0 (worked) or 0.0 (didn't work)

        Args:
            driver_histories: {driver_id: [{serviceDate, day, time, ...}, ...]}
            start_date: Start of date range (defaults to earliest in data)
            end_date: End of date range (defaults to latest in data)

        Returns:
            DataFrame with dates as index, driver IDs as columns
        """
        if not driver_histories:
            return pd.DataFrame()

        # Collect all work dates per driver
        driver_work_dates: Dict[str, set] = {}
        all_dates = set()

        for driver_id, assignments in driver_histories.items():
            work_dates = set()
            for assignment in assignments:
                # Try different date field names
                date_str = assignment.get('serviceDate') or assignment.get('date')
                if date_str:
                    try:
                        if isinstance(date_str, str):
                            date = pd.to_datetime(date_str).date()
                        else:
                            date = pd.to_datetime(date_str).date()
                        work_dates.add(date)
                        all_dates.add(date)
                    except:
                        continue

            if work_dates:
                driver_work_dates[driver_id] = work_dates

        if not all_dates:
            return pd.DataFrame()

        # Determine date range
        if start_date is None:
            start_date = min(all_dates)
        elif isinstance(start_date, datetime):
            start_date = start_date.date()

        if end_date is None:
            end_date = max(all_dates)
        elif isinstance(end_date, datetime):
            end_date = end_date.date()

        # Create full date range
        date_range = pd.date_range(start=start_date, end=end_date, freq='D')

        # Build DataFrame: each column is a driver, each row is a date
        data = {}
        for driver_id, work_dates in driver_work_dates.items():
            # 1.0 if worked, 0.0 if didn't work
            data[driver_id] = [
                1.0 if date.date() in work_dates else 0.0
                for date in date_range
            ]

        df = pd.DataFrame(data, index=date_range)
        df.index.name = 'date'
        df.index = pd.DatetimeIndex(df.index, freq='D')

        return df

    def fit(self, driver_histories: Dict[str, List[Dict]]) -> bool:
        """
        Train the forecaster on historical driver work patterns.

        Args:
            driver_histories: {driver_id: [{serviceDate, day, time, ...}, ...]}

        Returns:
            True if training succeeded, False otherwise
        """
        print(f"[Forecaster] Building multi-series from {len(driver_histories)} drivers...", file=sys.stderr)

        # Filter drivers with enough history
        filtered_histories = {}
        for driver_id, assignments in driver_histories.items():
            if len(assignments) >= 3:  # Need at least 3 data points
                filtered_histories[driver_id] = assignments

        if len(filtered_histories) < 1:
            print(f"[Forecaster] Not enough drivers with history (need at least 1 with 3+ assignments)", file=sys.stderr)
            return False

        print(f"[Forecaster] Using {len(filtered_histories)} drivers with sufficient history", file=sys.stderr)

        # Build multi-series DataFrame
        series_df = self._build_multi_series(filtered_histories)

        if series_df.empty or len(series_df) < self.lags + 1:
            print(f"[Forecaster] Not enough data points (need {self.lags + 1}, have {len(series_df)})", file=sys.stderr)
            return False

        print(f"[Forecaster] Series shape: {series_df.shape} (dates x drivers)", file=sys.stderr)
        print(f"[Forecaster] Date range: {series_df.index.min()} to {series_df.index.max()}", file=sys.stderr)

        # Store driver IDs for prediction
        self.driver_ids = list(series_df.columns)
        self.last_training_date = series_df.index.max()

        # Create and fit forecaster
        try:
            self.forecaster = self._create_forecaster()
            self.forecaster.fit(series=series_df)
            self.is_fitted = True
            print(f"[Forecaster] Training complete!", file=sys.stderr)
            return True
        except Exception as e:
            print(f"[Forecaster] Training failed: {e}", file=sys.stderr)
            self.is_fitted = False
            return False

    def predict(self, steps: int = 7) -> Dict[str, Dict[str, float]]:
        """
        Predict driver availability for the next N days.

        Args:
            steps: Number of days to forecast

        Returns:
            {driver_id: {date_str: probability}}
            where probability is 0.0-1.0 likelihood of working
        """
        if not self.is_fitted or self.forecaster is None:
            print(f"[Forecaster] Not fitted, returning empty predictions", file=sys.stderr)
            return {}

        try:
            # Make predictions - explicitly specify levels (driver IDs)
            predictions = self.forecaster.predict(
                steps=steps,
                levels=self.driver_ids  # Specify which series to predict
            )

            # Debug: check prediction structure
            print(f"[Forecaster] Predictions shape: {predictions.shape}, columns: {list(predictions.columns)}", file=sys.stderr)

            # skforecast returns predictions in long format with columns ['level', 'pred']
            # or in wide format depending on version. Handle both cases.
            result = {}

            if 'level' in predictions.columns and 'pred' in predictions.columns:
                # Long format: rows have (date, level, pred)
                # Index is date, 'level' is driver_id, 'pred' is the prediction
                for date_idx in predictions.index.unique():
                    date_str = date_idx.strftime('%Y-%m-%d')
                    row_data = predictions.loc[date_idx]

                    # If single row, row_data is a Series
                    if isinstance(row_data, pd.Series):
                        driver_id = str(row_data['level'])
                        pred_value = row_data['pred']
                        if driver_id not in result:
                            result[driver_id] = {}
                        prob = float(pred_value) if not pd.isna(pred_value) else 0.3
                        prob = max(0.0, min(1.0, prob))
                        result[driver_id][date_str] = round(prob, 3)
                    else:
                        # Multiple rows for this date (multiple drivers)
                        for _, row in row_data.iterrows():
                            driver_id = str(row['level'])
                            pred_value = row['pred']
                            if driver_id not in result:
                                result[driver_id] = {}
                            prob = float(pred_value) if not pd.isna(pred_value) else 0.3
                            prob = max(0.0, min(1.0, prob))
                            result[driver_id][date_str] = round(prob, 3)
            else:
                # Wide format: columns are driver IDs, index is date
                for driver_id in predictions.columns:
                    result[str(driver_id)] = {}
                    for date_idx in predictions.index:
                        date_str = date_idx.strftime('%Y-%m-%d')
                        value = predictions.loc[date_idx, driver_id]
                        prob = float(value) if not pd.isna(value) else 0.3
                        prob = max(0.0, min(1.0, prob))
                        result[str(driver_id)][date_str] = round(prob, 3)

            print(f"[Forecaster] Generated predictions for {len(result)} drivers", file=sys.stderr)
            return result

        except Exception as e:
            import traceback
            print(f"[Forecaster] Prediction failed: {e}", file=sys.stderr)
            print(f"[Forecaster] Traceback: {traceback.format_exc()}", file=sys.stderr)
            return {}

    def predict_for_blocks(
        self,
        blocks: List[Dict],
        drivers: List[Dict]
    ) -> Dict[Tuple[str, str], float]:
        """
        Predict availability scores for specific driver-block pairs.

        This is the main integration point with schedule_optimizer.py.

        Args:
            blocks: List of {id, day, time, contractType, serviceDate}
            drivers: List of {id, name, contractType}

        Returns:
            {(driver_id, block_id): score} where score is 0.0-1.0
        """
        if not self.is_fitted:
            print(f"[Forecaster] Not fitted, returning empty scores", file=sys.stderr)
            return {}

        # Get unique dates from blocks
        block_dates = set()
        block_date_map = {}  # block_id -> date_str
        for block in blocks:
            date_str = block.get('serviceDate')
            if date_str:
                block_dates.add(date_str)
                block_date_map[block['id']] = date_str

        if not block_dates:
            return {}

        # Calculate how many days to forecast
        today = self.last_training_date
        max_date = max(pd.to_datetime(d) for d in block_dates)

        # Handle timezone-naive comparison
        if hasattr(today, 'tz') and today.tz is not None:
            max_date = max_date.tz_localize(today.tz)
        elif hasattr(max_date, 'tz') and max_date.tz is not None:
            max_date = max_date.tz_localize(None)

        # Ensure both are pandas Timestamps for consistent comparison
        today_ts = pd.Timestamp(today)
        max_date_ts = pd.Timestamp(max_date)

        steps = max(1, (max_date_ts - today_ts).days + 1)
        print(f"[Forecaster] Predicting {steps} steps from {today_ts.date()} to {max_date_ts.date()}", file=sys.stderr)

        # Get predictions
        predictions = self.predict(steps=steps)

        # Build score matrix
        scores = {}
        for driver in drivers:
            driver_id = driver['id']
            driver_preds = predictions.get(driver_id, {})

            for block in blocks:
                block_id = block['id']
                date_str = block_date_map.get(block_id)

                if date_str and date_str in driver_preds:
                    scores[(driver_id, block_id)] = driver_preds[date_str]
                else:
                    # Default score if no prediction available
                    scores[(driver_id, block_id)] = 0.3

        return scores


def forecast_availability(data: Dict) -> Dict:
    """
    Main entry point for availability forecasting.

    Args:
        data: {
            'action': 'forecast',
            'driverHistories': {driver_id: [assignments]},
            'blocks': [block dicts] (optional),
            'drivers': [driver dicts] (optional),
            'steps': int (optional, default 7)
        }

    Returns:
        {
            'success': bool,
            'predictions': {driver_id: {date: probability}},
            'scores': {driver_id|block_id: score} (if blocks provided)
        }
    """
    action = data.get('action', 'forecast')
    driver_histories = data.get('driverHistories', {})
    blocks = data.get('blocks', [])
    drivers = data.get('drivers', [])
    steps = data.get('steps', 7)
    lags = data.get('lags', DEFAULT_LAGS)

    if not driver_histories:
        return {
            'success': False,
            'error': 'No driver histories provided'
        }

    # Create and train forecaster
    forecaster = DriverAvailabilityForecaster(lags=lags)

    if not forecaster.fit(driver_histories):
        return {
            'success': False,
            'error': 'Training failed - not enough data'
        }

    # Get predictions
    predictions = forecaster.predict(steps=steps)

    result = {
        'success': True,
        'predictions': predictions,
        'driversForecasted': len(predictions),
        'stepsForecasted': steps
    }

    # If blocks provided, also compute block-specific scores
    if blocks and drivers:
        scores = forecaster.predict_for_blocks(blocks, drivers)
        # Convert tuple keys to string for JSON
        result['scores'] = {f"{d}|{b}": s for (d, b), s in scores.items()}

    return result


def main():
    """CLI entry point - reads JSON from stdin, writes result to stdout."""
    try:
        input_data = sys.stdin.read().strip()
        if not input_data:
            print(json.dumps({'error': 'No input provided'}))
            sys.exit(1)

        data = json.loads(input_data)
        result = forecast_availability(data)
        print(json.dumps(result))

    except json.JSONDecodeError as e:
        print(json.dumps({'error': f'Invalid JSON: {e}'}))
        sys.exit(1)
    except Exception as e:
        print(json.dumps({'error': f'Forecasting failed: {e}'}))
        sys.exit(1)


if __name__ == '__main__':
    main()
