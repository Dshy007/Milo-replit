"""
Schedule Optimizer - Using Google OR-Tools CP-SAT Solver + XGBoost/scikit-learn ML

CONSTRAINTS:
  1. Each block assigned to exactly one driver (hard)
  2. Each driver works at most one block per day (hard)
  3. Contract type matching: solo1->solo1, solo2->solo2 (hard)
  4. Fair distribution: min/max days per driver (configurable via slider)

OBJECTIVE:
  Maximize ML-predicted fit scores using XGBoost time series forecasting

SCORING MODES:
  1. XGBoost (default): Uses skforecast + XGBoost to predict driver availability
     - Learns rolling interval patterns (e.g., every ~3 days)
     - Learns fixed weekday preferences
     - Captures non-linear feature interactions
  2. K-Means fallback: If XGBoost fails, falls back to pattern_analyzer.py
  3. Raw history: If all ML fails, uses simple history counts

SLIDER (minDays):
  3 = Allow 3-7 days per driver (flexible, more coverage)
  4 = Allow 4-6 days per driver (balanced)
  5 = Allow 5-5 days per driver (strict, equal distribution)

MINIMUM HISTORY REQUIREMENT:
  Drivers MUST have at least 1 assignment in their 8-week history to be
  eligible for AI assignment. Drivers with zero history are EXCLUDED.
"""

import json
import sys
import os
from collections import defaultdict
from ortools.sat.python import cp_model

# Minimum history threshold: drivers need at least this many assignments in 8 weeks
# to be eligible for AI scheduling. Drivers with zero history are EXCLUDED.
MIN_HISTORY_FOR_ASSIGNMENT = 1

# Add script directory to path for sibling imports (works from any CWD)
script_dir = os.path.dirname(os.path.abspath(__file__))
if script_dir not in sys.path:
    sys.path.insert(0, script_dir)

# Import XGBoost availability forecaster (primary ML)
try:
    from availability_forecaster import DriverAvailabilityForecaster
    XGBOOST_AVAILABLE = True
except ImportError:
    XGBOOST_AVAILABLE = False
    print("[Optimizer] WARNING: XGBoost forecaster not available", file=sys.stderr)

# Import pattern analyzer for fallback ML-based scoring
try:
    from pattern_analyzer import PatternAnalyzer
    ML_AVAILABLE = True
except ImportError:
    ML_AVAILABLE = False
    print("[Optimizer] WARNING: pattern_analyzer not available, using raw history scores", file=sys.stderr)


def optimize_schedule(drivers: list, blocks: list, slot_history: dict, min_days: int = 3,
                      driver_histories: dict = None, driver_preferences: dict = None) -> dict:
    """
    Match blocks to drivers using CP-SAT constraint solver + ML scoring.

    Args:
        drivers: List of {id, name, contractType}
        blocks: List of {id, day, time, contractType, serviceDate}
        slot_history: {slot: {driverId: count}} - 8-week history
        min_days: Minimum days per driver (3, 4, or 5) - global default
        driver_histories: {driver_id: [assignments]} - for ML pattern analysis (optional)
        driver_preferences: {driver_id: {minDays, maxDays, allowedDays}} - per-driver overrides (optional)
    """

    print(f"=== CP-SAT SOLVER + ML (minDays={min_days}) ===", file=sys.stderr)
    print(f"Input: {len(drivers)} drivers, {len(blocks)} blocks", file=sys.stderr)

    # ============ FILTER DRIVERS BY HISTORY ============
    # Exclude drivers with zero history - they should not be auto-assigned
    driver_histories = driver_histories or {}

    original_count = len(drivers)
    eligible_drivers = []
    excluded_drivers = []

    for d in drivers:
        driver_id = d["id"]
        history_count = len(driver_histories.get(driver_id, []))
        if history_count >= MIN_HISTORY_FOR_ASSIGNMENT:
            eligible_drivers.append(d)
        else:
            excluded_drivers.append(d["name"])

    if excluded_drivers:
        print(f"[FILTER] Excluded {len(excluded_drivers)} drivers with <{MIN_HISTORY_FOR_ASSIGNMENT} history assignments:", file=sys.stderr)
        for name in excluded_drivers[:10]:  # Show first 10
            print(f"  - {name} (0 history)", file=sys.stderr)
        if len(excluded_drivers) > 10:
            print(f"  ... and {len(excluded_drivers) - 10} more", file=sys.stderr)

    print(f"[FILTER] {original_count} total drivers -> {len(eligible_drivers)} eligible for assignment", file=sys.stderr)

    # Use filtered drivers for optimization
    drivers = eligible_drivers

    # Initialize ML components - try XGBoost first, then fall back to K-Means
    ml_profiles = {}
    ml_scores = {}
    xgboost_scores = {}
    scoring_method = "raw_history"

    if driver_histories:
        # Try XGBoost forecaster first (primary ML)
        if XGBOOST_AVAILABLE:
            print(f"[XGBoost] Training availability forecaster on {len(driver_histories)} drivers...", file=sys.stderr)
            try:
                forecaster = DriverAvailabilityForecaster(lags=14)
                if forecaster.fit(driver_histories):
                    xgboost_scores = forecaster.predict_for_blocks(blocks, drivers)
                    if xgboost_scores:
                        scoring_method = "xgboost"
                        print(f"[XGBoost] Generated {len(xgboost_scores)} driver-block scores", file=sys.stderr)

                        # Log sample predictions
                        sample_scores = list(xgboost_scores.items())[:5]
                        print(f"[XGBoost] Sample predictions:", file=sys.stderr)
                        for (driver_id, block_id), score in sample_scores:
                            driver_name = next((d["name"] for d in drivers if d["id"] == driver_id), "Unknown")
                            print(f"  {driver_name}: {score:.3f}", file=sys.stderr)
                else:
                    print(f"[XGBoost] Training failed, falling back to K-Means", file=sys.stderr)
            except Exception as e:
                print(f"[XGBoost] Error: {e}, falling back to K-Means", file=sys.stderr)

        # Fall back to K-Means pattern analyzer if XGBoost didn't work
        if scoring_method != "xgboost" and ML_AVAILABLE:
            print(f"[K-Means] Analyzing patterns for {len(driver_histories)} drivers...", file=sys.stderr)
            analyzer = PatternAnalyzer()
            ml_profiles = analyzer.cluster_drivers(driver_histories)
            ml_scores = analyzer.predict_fit_scores(drivers, blocks, ml_profiles, slot_history)
            scoring_method = "kmeans"

            # Log pattern distribution
            pattern_counts = defaultdict(int)
            rolling_pattern_drivers = []
            for driver_id, profile in ml_profiles.items():
                pattern_counts[profile.get('patternGroup', 'unknown')] += 1
                rolling = profile.get('rollingPattern', {})
                if rolling.get('hasRollingPattern'):
                    rolling_pattern_drivers.append({
                        'driverId': driver_id,
                        'intervalDays': rolling.get('intervalDays'),
                        'intervalStdDev': rolling.get('intervalStdDev'),
                        'confidence': rolling.get('confidence')
                    })
            print(f"[K-Means] Pattern groups: {dict(pattern_counts)}", file=sys.stderr)

            if rolling_pattern_drivers:
                print(f"[K-Means] Drivers with rolling interval patterns: {len(rolling_pattern_drivers)}", file=sys.stderr)
                for rp in rolling_pattern_drivers[:5]:
                    print(f"  {rp['driverId'][:8]}...: every ~{rp['intervalDays']} days (std={rp['intervalStdDev']}, conf={rp['confidence']})", file=sys.stderr)

    print(f"[Optimizer] Using scoring method: {scoring_method.upper()}", file=sys.stderr)

    if not blocks:
        return {
            "assignments": [],
            "unassigned": [],
            "stats": {
                "totalBlocks": 0,
                "totalDrivers": len(drivers),
                "assigned": 0,
                "unassigned": 0,
                "solverStatus": "NO_BLOCKS"
            }
        }

    # Build lookup maps
    driver_map = {d["id"]: d for d in drivers}
    block_map = {b["id"]: b for b in blocks}

    # Group drivers and blocks by contract type
    drivers_by_ct = defaultdict(list)
    for d in drivers:
        ct = (d.get("contractType") or "solo1").lower()
        drivers_by_ct[ct].append(d)

    blocks_by_ct = defaultdict(list)
    for b in blocks:
        ct = (b.get("contractType") or "solo1").lower()
        blocks_by_ct[ct].append(b)

    print(f"  Drivers by CT: {dict((k, len(v)) for k, v in drivers_by_ct.items())}", file=sys.stderr)
    print(f"  Blocks by CT: {dict((k, len(v)) for k, v in blocks_by_ct.items())}", file=sys.stderr)

    all_assignments = []
    all_unassigned = []
    solver_status = "UNKNOWN"

    # Process each contract type separately
    for contract_type in ["solo1", "solo2", "team"]:
        ct_drivers = drivers_by_ct.get(contract_type, [])
        ct_blocks = blocks_by_ct.get(contract_type, [])

        if not ct_blocks:
            continue

        if not ct_drivers:
            # No drivers for this contract type - all blocks unassigned
            all_unassigned.extend([b["id"] for b in ct_blocks])
            print(f"  {contract_type}: 0 eligible drivers, {len(ct_blocks)} blocks -> all unassigned", file=sys.stderr)
            continue

        print(f"\n  === Solving {contract_type}: {len(ct_drivers)} drivers, {len(ct_blocks)} blocks ===", file=sys.stderr)

        assignments, unassigned, status = solve_contract_type(
            ct_drivers, ct_blocks, slot_history, min_days, driver_map,
            ml_profiles=ml_profiles, ml_scores=ml_scores,
            xgboost_scores=xgboost_scores, scoring_method=scoring_method,
            driver_preferences=driver_preferences or {}
        )

        all_assignments.extend(assignments)
        all_unassigned.extend(unassigned)
        solver_status = status

    # Log results by driver
    driver_days = defaultdict(set)
    for a in all_assignments:
        driver_days[a["driverName"]].add(a["day"])

    print(f"\n=== Driver Schedules (ALL drivers) ===", file=sys.stderr)

    # Show ALL solo1 drivers
    solo1_drivers = [(name, days) for name, days in driver_days.items()
                     if any(a["contractType"].lower() == "solo1" for a in all_assignments if a["driverName"] == name)]
    print(f"\n  SOLO1 Drivers ({len(solo1_drivers)}):", file=sys.stderr)
    for name, days in sorted(solo1_drivers, key=lambda x: -len(x[1])):
        print(f"    {name}: {len(days)} days - {', '.join(sorted(days))}", file=sys.stderr)

    # Show ALL solo2 drivers
    solo2_drivers = [(name, days) for name, days in driver_days.items()
                     if any(a["contractType"].lower() == "solo2" for a in all_assignments if a["driverName"] == name)]
    print(f"\n  SOLO2 Drivers ({len(solo2_drivers)}):", file=sys.stderr)
    for name, days in sorted(solo2_drivers, key=lambda x: -len(x[1])):
        print(f"    {name}: {len(days)} days - {', '.join(sorted(days))}", file=sys.stderr)

    print(f"\n=== Result: {len(all_assignments)} assigned, {len(all_unassigned)} unassigned ===", file=sys.stderr)

    return {
        "assignments": all_assignments,
        "unassigned": all_unassigned,
        "stats": {
            "totalBlocks": len(blocks),
            "totalDrivers": len(drivers),
            "assigned": len(all_assignments),
            "unassigned": len(all_unassigned),
            "solverStatus": solver_status
        }
    }


def solve_contract_type(drivers: list, blocks: list, slot_history: dict,
                        min_days: int, driver_map: dict,
                        ml_profiles: dict = None, ml_scores: dict = None,
                        xgboost_scores: dict = None, scoring_method: str = "raw_history",
                        driver_preferences: dict = None) -> tuple:
    """
    Solve scheduling for one contract type using CP-SAT + ML scores.
    Returns (assignments, unassigned_block_ids, status)

    Args:
        ml_profiles: {driver_id: {patternGroup, preferredDays, ...}} from PatternAnalyzer
        ml_scores: {(driver_id, block_id): float} fit scores 0-1 from K-Means
        xgboost_scores: {(driver_id, block_id): float} fit scores 0-1 from XGBoost
        scoring_method: "xgboost", "kmeans", or "raw_history"
        driver_preferences: {driver_id: {minDays, maxDays, allowedDays}} - per-driver overrides
    """
    ml_profiles = ml_profiles or {}
    ml_scores = ml_scores or {}
    xgboost_scores = xgboost_scores or {}
    driver_preferences = driver_preferences or {}

    model = cp_model.CpModel()

    # Index mappings
    driver_ids = [d["id"] for d in drivers]
    block_ids = [b["id"] for b in blocks]

    n_drivers = len(driver_ids)
    n_blocks = len(block_ids)

    # Get unique dates from blocks
    dates = sorted(set(b["serviceDate"] for b in blocks))
    date_to_blocks = defaultdict(list)
    for i, b in enumerate(blocks):
        date_to_blocks[b["serviceDate"]].append(i)

    # Decision variables: assign[d][b] = 1 if driver d assigned to block b
    assign = {}
    for d in range(n_drivers):
        for b in range(n_blocks):
            assign[(d, b)] = model.new_bool_var(f"assign_d{d}_b{b}")

    # ============ HARD CONSTRAINTS ============

    # Constraint 1: Each block assigned to exactly one driver
    for b in range(n_blocks):
        model.add_exactly_one(assign[(d, b)] for d in range(n_drivers))

    # Constraint 2: Each driver works at most one block per date
    for d in range(n_drivers):
        for date, block_indices in date_to_blocks.items():
            model.add_at_most_one(assign[(d, b)] for b in block_indices)

    # ============ FAIR DISTRIBUTION (per-driver preferences + slider fallback) ============

    # Calculate DEFAULT min/max days per driver based on slider
    # Slider 3: allow 3-7 days (flexible)
    # Slider 4: allow 4-6 days (balanced)
    # Slider 5: allow 5-5 days (strict equal)

    total_blocks = n_blocks
    num_dates = len(dates)

    # Fair distribution baseline
    base_min = total_blocks // n_drivers
    base_max = base_min + (1 if total_blocks % n_drivers != 0 else 0)

    # Default range based on slider
    if min_days == 5:
        default_driver_min = base_min
        default_driver_max = base_max
    elif min_days == 4:
        default_driver_min = max(1, base_min - 1)
        default_driver_max = min(num_dates, base_max + 1)
    else:  # min_days == 3
        default_driver_min = max(1, base_min - 2)
        default_driver_max = min(num_dates, base_max + 2)

    print(f"    Default distribution: {default_driver_min}-{default_driver_max} blocks per driver", file=sys.stderr)

    # Build map of block indices by day for day restrictions
    day_to_blocks = defaultdict(list)
    for b, block in enumerate(blocks):
        day_to_blocks[block["day"].lower()].append(b)

    # Apply per-driver constraints (with preferences override)
    drivers_with_prefs = []
    for d, driver in enumerate(drivers):
        driver_id = driver["id"]
        prefs = driver_preferences.get(driver_id, {})

        # Get per-driver min/max (or use defaults)
        d_min = prefs.get("minDays") if prefs.get("minDays") is not None else default_driver_min
        d_max = prefs.get("maxDays") if prefs.get("maxDays") is not None else default_driver_max

        # Ensure min <= max and within bounds
        d_min = max(0, min(d_min, num_dates))
        d_max = max(d_min, min(d_max, num_dates))

        total_assigned = sum(assign[(d, b)] for b in range(n_blocks))
        model.add(total_assigned >= d_min)
        model.add(total_assigned <= d_max)

        # If driver has allowedDays restriction, block them from other days
        allowed_days = prefs.get("allowedDays")
        if allowed_days and len(allowed_days) > 0:
            allowed_days_lower = [day.lower() for day in allowed_days]
            # For each day NOT in allowed days, forbid assignment
            for day, block_indices in day_to_blocks.items():
                if day not in allowed_days_lower:
                    for b in block_indices:
                        model.add(assign[(d, b)] == 0)
            drivers_with_prefs.append((driver["name"], d_min, d_max, allowed_days))
        elif d_min != default_driver_min or d_max != default_driver_max:
            drivers_with_prefs.append((driver["name"], d_min, d_max, None))

    if drivers_with_prefs:
        print(f"    Drivers with custom preferences:", file=sys.stderr)
        for name, d_min, d_max, allowed in drivers_with_prefs[:10]:
            days_str = f", only {allowed}" if allowed else ""
            print(f"      {name}: {d_min}-{d_max} days{days_str}", file=sys.stderr)
        if len(drivers_with_prefs) > 10:
            print(f"      ... and {len(drivers_with_prefs) - 10} more", file=sys.stderr)

    # ============ OBJECTIVE: Maximize ML fit scores (XGBoost > K-Means > history) ============

    # Build preference scores based on scoring method
    preference_score = {}

    for d, driver in enumerate(drivers):
        driver_id = driver["id"]
        for b, block in enumerate(blocks):
            block_id = block["id"]
            ml_key = (driver_id, block_id)

            if scoring_method == "xgboost" and ml_key in xgboost_scores:
                # Primary: XGBoost time series forecast (0-1)
                score = xgboost_scores.get(ml_key, 0.0)
                preference_score[(d, b)] = int(score * 1000)

            elif scoring_method == "kmeans" and ml_key in ml_scores:
                # Fallback: K-Means pattern analyzer (0-1)
                score = ml_scores.get(ml_key, 0.0)
                preference_score[(d, b)] = int(score * 1000)

            else:
                # Last resort: raw history count
                slot = f"{block['day']}_{block['time']}"
                history_count = slot_history.get(slot, {}).get(driver_id, 0)
                preference_score[(d, b)] = history_count

    # Log top preferences
    top_prefs = sorted(preference_score.items(), key=lambda x: -x[1])[:10]
    if top_prefs and top_prefs[0][1] > 0:
        print(f"    Top preferences ({scoring_method}):", file=sys.stderr)
        for (d, b), score in top_prefs[:5]:
            if score > 0:
                driver_name = drivers[d]["name"]
                block = blocks[b]
                display_score = score / 1000 if scoring_method in ["xgboost", "kmeans"] else score
                print(f"      {driver_name} -> {block['day']}_{block['time']}: {display_score}", file=sys.stderr)

    # Objective: maximize sum of preference scores for assigned blocks
    model.maximize(
        sum(preference_score[(d, b)] * assign[(d, b)]
            for d in range(n_drivers)
            for b in range(n_blocks))
    )

    # ============ SOLVE ============

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 30.0  # Timeout

    status = solver.solve(model)

    status_names = {
        cp_model.OPTIMAL: "OPTIMAL",
        cp_model.FEASIBLE: "FEASIBLE",
        cp_model.INFEASIBLE: "INFEASIBLE",
        cp_model.MODEL_INVALID: "MODEL_INVALID",
        cp_model.UNKNOWN: "UNKNOWN"
    }
    status_name = status_names.get(status, "UNKNOWN")

    print(f"    Solver status: {status_name}", file=sys.stderr)
    print(f"    Objective value: {solver.objective_value}", file=sys.stderr)

    # ============ EXTRACT RESULTS ============

    assignments = []
    assigned_blocks = set()

    if status in [cp_model.OPTIMAL, cp_model.FEASIBLE]:
        for d in range(n_drivers):
            for b in range(n_blocks):
                if solver.value(assign[(d, b)]) == 1:
                    driver = drivers[d]
                    block = blocks[b]
                    driver_id = driver["id"]
                    block_id = block["id"]
                    slot = f"{block['day']}_{block['time']}"
                    history_count = slot_history.get(slot, {}).get(driver_id, 0)

                    # Get ML score based on scoring method
                    if scoring_method == "xgboost":
                        ml_score = xgboost_scores.get((driver_id, block_id), 0.0)
                    elif scoring_method == "kmeans":
                        ml_score = ml_scores.get((driver_id, block_id), 0.0)
                    else:
                        ml_score = 0.0

                    driver_profile = ml_profiles.get(driver_id, {})
                    pattern_group = driver_profile.get('patternGroup', 'unknown')

                    # Determine match type based on scoring method and score
                    if scoring_method == "xgboost":
                        if ml_score >= 0.7:
                            match_type = "xgb_excellent"
                        elif ml_score >= 0.5:
                            match_type = "xgb_good"
                        elif ml_score >= 0.3:
                            match_type = "xgb_fair"
                        else:
                            match_type = "xgb_assigned"
                    elif scoring_method == "kmeans":
                        if ml_score >= 0.8:
                            match_type = "ml_excellent"
                        elif ml_score >= 0.6:
                            match_type = "ml_good"
                        elif ml_score >= 0.4:
                            match_type = "ml_fair"
                        else:
                            match_type = "ml_assigned"
                    else:
                        match_type = "optimal" if history_count > 0 else "assigned"

                    assignments.append({
                        "blockId": block_id,
                        "driverId": driver_id,
                        "driverName": driver.get("name", "Unknown"),
                        "matchType": match_type,
                        "preferredTime": block["time"],
                        "actualTime": block["time"],
                        "serviceDate": block["serviceDate"],
                        "day": block["day"],
                        "historyCount": history_count,
                        "contractType": block.get("contractType", "solo1"),
                        "mlScore": round(ml_score, 3) if scoring_method in ["xgboost", "kmeans"] else None,
                        "patternGroup": pattern_group if scoring_method == "kmeans" else None,
                        "scoringMethod": scoring_method
                    })
                    assigned_blocks.add(block_id)

    unassigned = [b["id"] for b in blocks if b["id"] not in assigned_blocks]

    return assignments, unassigned, status_name


def optimize_with_precomputed_scores(drivers: list, blocks: list, score_matrix: dict, min_days: int = 3) -> dict:
    """
    Optimize schedule using PRE-COMPUTED scores from the pipeline.

    This function does NOT:
    - Build its own slot_history
    - Run XGBoost or K-Means
    - Calculate ownership scores

    It ONLY:
    - Uses the scores passed in from the pipeline
    - Finds the globally optimal assignment via CP-SAT

    Args:
        drivers: List of {id, name, contractType}
        blocks: List of {id, day, time, contractType, serviceDate}
        score_matrix: {blockId: {driverId: score}} - PRE-COMPUTED by pipeline
        min_days: Minimum days per driver (fairness constraint)
    """
    print(f"=== OR-Tools with Pipeline Scores (minDays={min_days}) ===", file=sys.stderr)
    print(f"Input: {len(drivers)} drivers, {len(blocks)} blocks", file=sys.stderr)
    print(f"Score matrix: {len(score_matrix)} blocks with pre-computed scores", file=sys.stderr)

    if not blocks or not drivers:
        return {
            "assignments": [],
            "unassigned": [b["id"] for b in blocks],
            "stats": {
                "totalBlocks": len(blocks),
                "totalDrivers": len(drivers),
                "assigned": 0,
                "unassigned": len(blocks),
                "solverStatus": "NO_INPUT"
            }
        }

    model = cp_model.CpModel()

    # Index mappings
    driver_ids = [d["id"] for d in drivers]
    block_ids = [b["id"] for b in blocks]
    driver_map = {d["id"]: d for d in drivers}

    n_drivers = len(driver_ids)
    n_blocks = len(block_ids)

    # Get unique dates for one-block-per-day constraint
    date_to_blocks = defaultdict(list)
    for i, b in enumerate(blocks):
        date_to_blocks[b.get("serviceDate", b["day"])].append(i)

    # Decision variables: assign[d][b] = 1 if driver d assigned to block b
    assign = {}
    for d in range(n_drivers):
        for b in range(n_blocks):
            assign[(d, b)] = model.new_bool_var(f"assign_d{d}_b{b}")

    # ============ HARD CONSTRAINTS ============

    # Constraint 1: Each block assigned to exactly one driver
    for b in range(n_blocks):
        model.add_exactly_one(assign[(d, b)] for d in range(n_drivers))

    # Constraint 2: Each driver works at most one block per date
    for d in range(n_drivers):
        for date, block_indices in date_to_blocks.items():
            model.add_at_most_one(assign[(d, b)] for b in block_indices)

    # Constraint 3: Fair distribution (min/max days per driver)
    # When more drivers than blocks, allow 0 minimum to avoid INFEASIBLE
    num_dates = len(date_to_blocks)
    base_min = n_blocks // n_drivers if n_drivers > 0 else 0
    base_max = base_min + (1 if n_blocks % n_drivers != 0 else 0)

    # Slider adjusts flexibility
    if min_days >= 5:
        driver_min = base_min
        driver_max = base_max
    elif min_days == 4:
        driver_min = max(0, base_min - 1)  # Allow 0 when more drivers than blocks
        driver_max = min(num_dates, base_max + 1)
    else:
        driver_min = max(0, base_min - 2)  # Allow 0 when more drivers than blocks
        driver_max = min(num_dates, base_max + 2)

    # Ensure max is at least 1 (drivers can get at least one block if available)
    driver_max = max(1, driver_max)

    print(f"  Distribution: {driver_min}-{driver_max} blocks per driver", file=sys.stderr)

    for d in range(n_drivers):
        total_assigned = sum(assign[(d, b)] for b in range(n_blocks))
        model.add(total_assigned >= driver_min)
        model.add(total_assigned <= driver_max)

    # ============ OBJECTIVE: Maximize pre-computed pipeline scores ============

    # Convert scores to integers (CP-SAT requires integers)
    preference_score = {}
    for d, driver in enumerate(drivers):
        driver_id = driver["id"]
        for b, block in enumerate(blocks):
            block_id = block["id"]
            # Get pre-computed score from pipeline (0-1 float)
            block_scores = score_matrix.get(block_id, {})
            score = block_scores.get(driver_id, 0.0)
            # Scale to integer (0-1000)
            preference_score[(d, b)] = int(score * 1000)

    # Log top scores
    top_scores = sorted(preference_score.items(), key=lambda x: -x[1])[:5]
    if top_scores and top_scores[0][1] > 0:
        print(f"  Top pipeline scores:", file=sys.stderr)
        for (d, b), score in top_scores:
            driver_name = drivers[d]["name"]
            block = blocks[b]
            print(f"    {driver_name} -> {block['day']}_{block['time']}: {score/1000:.3f}", file=sys.stderr)

    # Objective: maximize sum of pre-computed scores
    model.maximize(
        sum(preference_score[(d, b)] * assign[(d, b)]
            for d in range(n_drivers)
            for b in range(n_blocks))
    )

    # ============ SOLVE ============

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 30.0

    status = solver.solve(model)

    status_names = {
        cp_model.OPTIMAL: "OPTIMAL",
        cp_model.FEASIBLE: "FEASIBLE",
        cp_model.INFEASIBLE: "INFEASIBLE",
        cp_model.MODEL_INVALID: "MODEL_INVALID",
        cp_model.UNKNOWN: "UNKNOWN"
    }
    status_name = status_names.get(status, "UNKNOWN")

    print(f"  Solver status: {status_name}", file=sys.stderr)
    print(f"  Objective value: {solver.objective_value}", file=sys.stderr)

    # ============ EXTRACT RESULTS ============

    assignments = []
    assigned_blocks = set()

    if status in [cp_model.OPTIMAL, cp_model.FEASIBLE]:
        for d in range(n_drivers):
            for b in range(n_blocks):
                if solver.value(assign[(d, b)]) == 1:
                    driver = drivers[d]
                    block = blocks[b]
                    driver_id = driver["id"]
                    block_id = block["id"]

                    # Get the pipeline score
                    block_scores = score_matrix.get(block_id, {})
                    pipeline_score = block_scores.get(driver_id, 0.0)

                    assignments.append({
                        "blockId": block_id,
                        "driverId": driver_id,
                        "driverName": driver.get("name", "Unknown"),
                        "matchType": "pipeline_optimal",
                        "day": block["day"],
                        "time": block["time"],
                        "serviceDate": block.get("serviceDate", block["day"]),
                        "contractType": block.get("contractType", "solo1"),
                        "pipelineScore": round(pipeline_score, 3),
                        "scoringMethod": "pipeline"
                    })
                    assigned_blocks.add(block_id)

    unassigned = [b["id"] for b in blocks if b["id"] not in assigned_blocks]

    # Log driver assignment counts
    driver_counts = defaultdict(int)
    for a in assignments:
        driver_counts[a["driverName"]] += 1

    print(f"\n  Driver assignments:", file=sys.stderr)
    for name, count in sorted(driver_counts.items(), key=lambda x: -x[1]):
        print(f"    {name}: {count} blocks", file=sys.stderr)

    print(f"\n=== Result: {len(assignments)} assigned, {len(unassigned)} unassigned ===", file=sys.stderr)

    return {
        "assignments": assignments,
        "unassigned": unassigned,
        "stats": {
            "totalBlocks": len(blocks),
            "totalDrivers": len(drivers),
            "assigned": len(assignments),
            "unassigned": len(unassigned),
            "solverStatus": status_name
        }
    }


def main():
    # Read from stdin (handles large data that exceeds command line limits)
    try:
        input_data = sys.stdin.read().strip()
        if not input_data:
            print(json.dumps({"error": "No input provided"}))
            sys.exit(1)
        data = json.loads(input_data)
    except json.JSONDecodeError as e:
        print(json.dumps({"error": f"Invalid JSON: {e}"}))
        sys.exit(1)

    action = data.get("action", "optimize")

    if action == "optimize":
        result = optimize_schedule(
            drivers=data.get("drivers", []),
            blocks=data.get("blocks", []),
            slot_history=data.get("slotHistory", {}),
            min_days=data.get("minDays", 3),
            driver_histories=data.get("driverHistories", None),  # for ML analysis
            driver_preferences=data.get("driverPreferences", None)  # per-driver min/max/allowedDays
        )
        print(json.dumps(result))

    elif action == "optimize_with_scores":
        # NEW: Use pre-computed scores from pipeline (no duplicate ML/history logic)
        result = optimize_with_precomputed_scores(
            drivers=data.get("drivers", []),
            blocks=data.get("blocks", []),
            score_matrix=data.get("scoreMatrix", {}),
            min_days=data.get("minDays", 3),
        )
        print(json.dumps(result))

    else:
        print(json.dumps({"error": f"Unknown action: {action}"}))
        sys.exit(1)


if __name__ == "__main__":
    main()
