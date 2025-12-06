"""
Schedule Optimizer - Using Google OR-Tools CP-SAT Solver
(Same algorithm used in hospital nurse scheduling)

CONSTRAINTS:
  1. Each block assigned to exactly one driver (hard)
  2. Each driver works at most one block per day (hard)
  3. Contract type matching: solo1->solo1, solo2->solo2 (hard)
  4. Fair distribution: min/max days per driver (configurable via slider)

OBJECTIVE:
  Maximize historical preference score (drivers get slots they've worked before)

SLIDER (minDays):
  3 = Allow 3-7 days per driver (flexible, more coverage)
  4 = Allow 4-6 days per driver (balanced)
  5 = Allow 5-5 days per driver (strict, equal distribution)
"""

import json
import sys
from collections import defaultdict
from ortools.sat.python import cp_model


def optimize_schedule(drivers: list, blocks: list, slot_history: dict, min_days: int = 3) -> dict:
    """
    Match blocks to drivers using CP-SAT constraint solver.

    Args:
        drivers: List of {id, name, contractType}
        blocks: List of {id, day, time, contractType, serviceDate}
        slot_history: {slot: {driverId: count}} - 8-week history
        min_days: Minimum days per driver (3, 4, or 5)
    """

    print(f"=== CP-SAT SOLVER (minDays={min_days}) ===", file=sys.stderr)
    print(f"Input: {len(drivers)} drivers, {len(blocks)} blocks", file=sys.stderr)

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
            print(f"  {contract_type}: 0 drivers, {len(ct_blocks)} blocks -> all unassigned", file=sys.stderr)
            continue

        print(f"\n  === Solving {contract_type}: {len(ct_drivers)} drivers, {len(ct_blocks)} blocks ===", file=sys.stderr)

        assignments, unassigned, status = solve_contract_type(
            ct_drivers, ct_blocks, slot_history, min_days, driver_map
        )

        all_assignments.extend(assignments)
        all_unassigned.extend(unassigned)
        solver_status = status

    # Log results by driver
    driver_days = defaultdict(set)
    for a in all_assignments:
        driver_days[a["driverName"]].add(a["day"])

    print(f"\n=== Driver Schedules ===", file=sys.stderr)
    for name, days in sorted(driver_days.items(), key=lambda x: -len(x[1]))[:15]:
        print(f"  {name}: {len(days)} days - {', '.join(sorted(days))}", file=sys.stderr)

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
                        min_days: int, driver_map: dict) -> tuple:
    """
    Solve scheduling for one contract type using CP-SAT.
    Returns (assignments, unassigned_block_ids, status)
    """

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

    # ============ OBJECTIVE: Maximize historical preferences ============

    # Build preference scores from 8-week history
    # Higher score = driver has worked this slot more often
    preference_score = {}
    for d, driver in enumerate(drivers):
        driver_id = driver["id"]
        for b, block in enumerate(blocks):
            slot = f"{block['day']}_{block['time']}"
            # Get history count (how many times this driver worked this slot)
            history_count = slot_history.get(slot, {}).get(driver_id, 0)
            preference_score[(d, b)] = history_count

    # Log top preferences
    top_prefs = sorted(preference_score.items(), key=lambda x: -x[1])[:10]
    if top_prefs and top_prefs[0][1] > 0:
        print(f"    Top preferences:", file=sys.stderr)
        for (d, b), score in top_prefs[:5]:
            if score > 0:
                driver_name = drivers[d]["name"]
                block = blocks[b]
                print(f"      {driver_name} -> {block['day']}_{block['time']}: {score}x", file=sys.stderr)

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
                    slot = f"{block['day']}_{block['time']}"
                    history_count = slot_history.get(slot, {}).get(driver["id"], 0)

                    assignments.append({
                        "blockId": block["id"],
                        "driverId": driver["id"],
                        "driverName": driver.get("name", "Unknown"),
                        "matchType": "optimal" if history_count > 0 else "assigned",
                        "preferredTime": block["time"],
                        "actualTime": block["time"],
                        "serviceDate": block["serviceDate"],
                        "day": block["day"],
                        "historyCount": history_count,
                        "contractType": block.get("contractType", "solo1")
                    })
                    assigned_blocks.add(block["id"])

    unassigned = [b["id"] for b in blocks if b["id"] not in assigned_blocks]

    return assignments, unassigned, status_name


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No input provided"}))
        sys.exit(1)

    try:
        data = json.loads(sys.argv[1])
    except json.JSONDecodeError as e:
        print(json.dumps({"error": f"Invalid JSON: {e}"}))
        sys.exit(1)

    action = data.get("action", "optimize")

    if action == "optimize":
        result = optimize_schedule(
            drivers=data.get("drivers", []),
            blocks=data.get("blocks", []),
            slot_history=data.get("slotHistory", {}),
            min_days=data.get("minDays", 3)
        )
        print(json.dumps(result))
    else:
        print(json.dumps({"error": f"Unknown action: {action}"}))
        sys.exit(1)


if __name__ == "__main__":
    main()
