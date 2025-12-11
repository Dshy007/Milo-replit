"""
Schedule Optimizer - Using Google OR-Tools CP-SAT Solver + scikit-learn Pattern Analysis
(Same algorithm used in hospital nurse scheduling, enhanced with ML)

CONSTRAINTS:
  1. Each block assigned to exactly one driver (hard)
  2. Each driver works at most one block per day (hard)
  3. Contract type matching: solo1->solo1, solo2->solo2 (hard)
  4. Fair distribution: min/max days per driver (configurable via slider)

OBJECTIVE:
  Maximize ML-predicted fit scores (combines day/time preferences + historical patterns)

SLIDER (minDays):
  3 = Allow 3-7 days per driver (flexible, more coverage)
  4 = Allow 4-6 days per driver (balanced)
  5 = Allow 5-5 days per driver (strict, equal distribution)

INTEGRATION:
  Uses pattern_analyzer.py for:
  - K-Means clustering (driver pattern groups: sunWed, wedSat, mixed)
  - ML fit score prediction (0-1 score for driver-block compatibility)

MINIMUM HISTORY REQUIREMENT:
  Drivers MUST have at least 1 assignment in their 8-week history to be
  eligible for AI assignment. Drivers with zero history are EXCLUDED.
  This prevents brand new drivers from being auto-assigned to blocks.
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

# Import pattern analyzer for ML-based scoring
try:
    from pattern_analyzer import PatternAnalyzer
    ML_AVAILABLE = True
except ImportError:
    ML_AVAILABLE = False
    print("[Optimizer] WARNING: pattern_analyzer not available, using raw history scores", file=sys.stderr)


def optimize_schedule(drivers: list, blocks: list, slot_history: dict, min_days: int = 3,
                      driver_histories: dict = None) -> dict:
    """
    Match blocks to drivers using CP-SAT constraint solver + ML scoring.

    Args:
        drivers: List of {id, name, contractType}
        blocks: List of {id, day, time, contractType, serviceDate}
        slot_history: {slot: {driverId: count}} - 8-week history
        min_days: Minimum days per driver (3, 4, or 5)
        driver_histories: {driver_id: [assignments]} - for ML pattern analysis (optional)
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

    # Initialize ML components if available and histories provided
    ml_profiles = {}
    ml_scores = {}
    if ML_AVAILABLE and driver_histories:
        print(f"[ML] Analyzing patterns for {len(driver_histories)} drivers...", file=sys.stderr)
        analyzer = PatternAnalyzer()
        ml_profiles = analyzer.cluster_drivers(driver_histories)
        ml_scores = analyzer.predict_fit_scores(drivers, blocks, ml_profiles, slot_history)

        # Log pattern distribution
        pattern_counts = defaultdict(int)
        for profile in ml_profiles.values():
            pattern_counts[profile.get('patternGroup', 'unknown')] += 1
        print(f"[ML] Pattern groups: {dict(pattern_counts)}", file=sys.stderr)

        # Log driver time preferences (for debugging flip-flop issues)
        print(f"[ML] Driver primary times (top 10):", file=sys.stderr)
        driver_times = []
        for d in drivers[:20]:  # Check first 20 drivers
            profile = ml_profiles.get(d["id"], {})
            preferred_times = profile.get('preferredTimes', [])
            if preferred_times:
                driver_times.append((d["name"], preferred_times[0], preferred_times))
        for name, primary, all_times in driver_times[:10]:
            print(f"  {name}: PRIMARY={primary} (all: {all_times})", file=sys.stderr)
    elif not ML_AVAILABLE:
        print("[ML] Pattern analyzer not available, using raw history", file=sys.stderr)
    else:
        print("[ML] No driver histories provided, using raw history", file=sys.stderr)

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
            ml_profiles=ml_profiles, ml_scores=ml_scores
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
                        ml_profiles: dict = None, ml_scores: dict = None) -> tuple:
    """
    Solve scheduling for one contract type using CP-SAT + ML scores.
    Returns (assignments, unassigned_block_ids, status)

    Args:
        ml_profiles: {driver_id: {patternGroup, preferredDays, ...}} from PatternAnalyzer
        ml_scores: {(driver_id, block_id): float} fit scores 0-1
    """
    ml_profiles = ml_profiles or {}
    ml_scores = ml_scores or {}

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

    # ============ FAIR DISTRIBUTION (based on slider) ============

    # Calculate min/max days per driver based on slider
    # Slider 3: allow 3-7 days (flexible)
    # Slider 4: allow 4-6 days (balanced)
    # Slider 5: allow 5-5 days (strict equal)

    total_blocks = n_blocks
    num_dates = len(dates)

    # Fair distribution: ensure reasonable spread
    # min_shifts = floor(total_blocks / n_drivers)
    # max_shifts = ceil(total_blocks / n_drivers)

    base_min = total_blocks // n_drivers
    base_max = base_min + (1 if total_blocks % n_drivers != 0 else 0)

    # Adjust based on slider
    if min_days == 5:
        # Strict: everyone gets same (or +1)
        driver_min = base_min
        driver_max = base_max
    elif min_days == 4:
        # Balanced: allow some variance
        driver_min = max(1, base_min - 1)
        driver_max = min(num_dates, base_max + 1)
    else:  # min_days == 3
        # Flexible: allow more variance for coverage
        driver_min = max(1, base_min - 2)
        driver_max = min(num_dates, base_max + 2)

    print(f"    Fair distribution: {driver_min}-{driver_max} blocks per driver", file=sys.stderr)

    for d in range(n_drivers):
        total_assigned = sum(assign[(d, b)] for b in range(n_blocks))
        model.add(total_assigned >= driver_min)
        model.add(total_assigned <= driver_max)

    # ============ OBJECTIVE: Maximize ML fit scores (or fallback to history) ============

    # Build preference scores - use ML scores if available, else raw history
    preference_score = {}
    use_ml = bool(ml_scores)

    for d, driver in enumerate(drivers):
        driver_id = driver["id"]
        for b, block in enumerate(blocks):
            block_id = block["id"]

            if use_ml:
                # Use ML-predicted fit score (0-1)
                # Convert tuple key or string key format
                ml_key = (driver_id, block_id)
                score = ml_scores.get(ml_key, 0.0)

                # Scale to integer for CP-SAT (multiply by 1000)
                preference_score[(d, b)] = int(score * 1000)
            else:
                # Fallback: use raw history count
                slot = f"{block['day']}_{block['time']}"
                history_count = slot_history.get(slot, {}).get(driver_id, 0)
                preference_score[(d, b)] = history_count

    # Log top preferences
    top_prefs = sorted(preference_score.items(), key=lambda x: -x[1])[:10]
    if top_prefs and top_prefs[0][1] > 0:
        score_type = "ML fit" if use_ml else "history"
        print(f"    Top preferences ({score_type}):", file=sys.stderr)
        for (d, b), score in top_prefs[:5]:
            if score > 0:
                driver_name = drivers[d]["name"]
                block = blocks[b]
                display_score = score / 1000 if use_ml else score
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

                    # Get ML info if available
                    ml_score = ml_scores.get((driver_id, block_id), 0.0) if use_ml else 0.0
                    driver_profile = ml_profiles.get(driver_id, {})
                    pattern_group = driver_profile.get('patternGroup', 'unknown')

                    # Determine match type based on ML score
                    if use_ml:
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
                        "mlScore": round(ml_score, 3) if use_ml else None,
                        "patternGroup": pattern_group if use_ml else None
                    })
                    assigned_blocks.add(block_id)

    unassigned = [b["id"] for b in blocks if b["id"] not in assigned_blocks]

    return assignments, unassigned, status_name


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
            driver_histories=data.get("driverHistories", None)  # NEW: for ML analysis
        )
        print(json.dumps(result))
    else:
        print(json.dumps({"error": f"Unknown action: {action}"}))
        sys.exit(1)


if __name__ == "__main__":
    main()
