"""
Schedule Optimizer using Google OR-Tools CP-SAT Solver

This module matches drivers to weekly runs (blocks) based on:
- Driver preferences (days + ONE preferred time per driver)
- Available runs/blocks with their times
- Constraint: Match preferred time when available, closest time otherwise

Usage:
  python schedule_optimizer.py '{"action":"optimize","drivers":[...],"blocks":[...]}'

Based on: https://developers.google.com/optimization/scheduling/employee_scheduling
"""

import json
import sys
from ortools.sat.python import cp_model


def time_to_minutes(time_str: str) -> int:
    """Convert HH:MM to minutes since midnight."""
    if not time_str:
        return 0
    parts = time_str.replace(":", "").strip()
    if len(parts) == 4:
        hours = int(parts[:2])
        mins = int(parts[2:])
    else:
        parts = time_str.split(":")
        hours = int(parts[0])
        mins = int(parts[1]) if len(parts) > 1 else 0
    return hours * 60 + mins


def minutes_to_time(minutes: int) -> str:
    """Convert minutes since midnight to HH:MM."""
    hours = (minutes // 60) % 24
    mins = minutes % 60
    return f"{hours:02d}:{mins:02d}"


def optimize_schedule(drivers: list, blocks: list) -> dict:
    """
    Use CP-SAT solver to assign drivers to blocks.

    Args:
        drivers: List of driver objects with:
            - id: string
            - name: string
            - preferredDays: list of day names (lowercase)
            - preferredTime: string (HH:MM) - ONE time for ALL days
            - contractType: 'solo1' or 'solo2'

        blocks: List of block objects with:
            - id: string (block ID)
            - day: string (lowercase day name)
            - time: string (HH:MM)
            - contractType: 'solo1' or 'solo2'
            - serviceDate: string (YYYY-MM-DD)

    Returns:
        dict with:
            - assignments: list of {blockId, driverId, driverName, matchType}
            - unassigned: list of block IDs that couldn't be assigned
            - stats: summary statistics
    """

    model = cp_model.CpModel()

    # Filter drivers and blocks by contract type for matching
    # Create assignment variables: x[d][b] = 1 if driver d is assigned to block b

    num_drivers = len(drivers)
    num_blocks = len(blocks)

    if num_drivers == 0 or num_blocks == 0:
        return {
            "assignments": [],
            "unassigned": [b["id"] for b in blocks],
            "stats": {"totalBlocks": num_blocks, "assigned": 0, "unassigned": num_blocks}
        }

    # Create boolean variables for each (driver, block) pair
    x = {}
    for d_idx, driver in enumerate(drivers):
        for b_idx, block in enumerate(blocks):
            x[(d_idx, b_idx)] = model.NewBoolVar(f"x_{d_idx}_{b_idx}")

    # Constraint 1: Each block assigned to at most one driver
    for b_idx in range(num_blocks):
        model.Add(sum(x[(d_idx, b_idx)] for d_idx in range(num_drivers)) <= 1)

    # Constraint 2: Contract type must match
    for d_idx, driver in enumerate(drivers):
        driver_contract = driver.get("contractType", "solo1").lower()
        for b_idx, block in enumerate(blocks):
            block_contract = block.get("contractType", "solo1").lower()
            if driver_contract != block_contract:
                model.Add(x[(d_idx, b_idx)] == 0)

    # Constraint 3: Driver can only work one block per day
    # Group blocks by date
    blocks_by_date = {}
    for b_idx, block in enumerate(blocks):
        date = block.get("serviceDate", block.get("day", ""))
        if date not in blocks_by_date:
            blocks_by_date[date] = []
        blocks_by_date[date].append(b_idx)

    for d_idx in range(num_drivers):
        for date, block_indices in blocks_by_date.items():
            # At most one block per driver per day
            model.Add(sum(x[(d_idx, b_idx)] for b_idx in block_indices) <= 1)

    # Constraint 4: Solo2 drivers need 48-hour gaps (skip for simplicity now)
    # This would require more complex temporal constraints

    # Objective: Maximize assignments with preference for matching times
    # Score:
    #   - Perfect match (day + exact time): 100
    #   - Day match + close time (within 2 hours): 50
    #   - Day match + any time: 10
    #   - No day match: 0 (don't assign)

    objective_terms = []

    for d_idx, driver in enumerate(drivers):
        pref_days = [d.lower() for d in driver.get("preferredDays", [])]
        pref_time = driver.get("preferredTime", "")
        pref_minutes = time_to_minutes(pref_time) if pref_time else None

        for b_idx, block in enumerate(blocks):
            block_day = block.get("day", "").lower()
            block_time = block.get("time", "")
            block_minutes = time_to_minutes(block_time)

            # Check if day matches
            day_matches = block_day in pref_days if pref_days else True

            if not day_matches:
                # Don't assign if day doesn't match preferred days
                model.Add(x[(d_idx, b_idx)] == 0)
                continue

            # Calculate time difference
            if pref_minutes is not None:
                time_diff = abs(block_minutes - pref_minutes)
                # Handle wraparound
                time_diff = min(time_diff, 1440 - time_diff)

                if time_diff == 0:
                    # Perfect time match
                    score = 100
                elif time_diff <= 60:
                    # Within 1 hour
                    score = 80
                elif time_diff <= 120:
                    # Within 2 hours
                    score = 50
                else:
                    # More than 2 hours - still allow but low score
                    score = 10
            else:
                # No preferred time - neutral score
                score = 50

            objective_terms.append(score * x[(d_idx, b_idx)])

    # Maximize total score
    model.Maximize(sum(objective_terms))

    # Solve
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 30.0  # 30 second timeout
    status = solver.Solve(model)

    # Extract results
    assignments = []
    assigned_blocks = set()

    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        for d_idx, driver in enumerate(drivers):
            for b_idx, block in enumerate(blocks):
                if solver.Value(x[(d_idx, b_idx)]) == 1:
                    # Determine match type
                    pref_time = driver.get("preferredTime", "")
                    block_time = block.get("time", "")

                    if pref_time and block_time:
                        pref_min = time_to_minutes(pref_time)
                        block_min = time_to_minutes(block_time)
                        diff = abs(pref_min - block_min)
                        diff = min(diff, 1440 - diff)

                        if diff == 0:
                            match_type = "exact"
                        elif diff <= 60:
                            match_type = "close"
                        else:
                            match_type = "fallback"
                    else:
                        match_type = "default"

                    assignments.append({
                        "blockId": block["id"],
                        "driverId": driver["id"],
                        "driverName": driver.get("name", "Unknown"),
                        "matchType": match_type,
                        "preferredTime": pref_time,
                        "actualTime": block_time,
                        "serviceDate": block.get("serviceDate", ""),
                        "day": block.get("day", "")
                    })
                    assigned_blocks.add(block["id"])

    # Find unassigned blocks
    unassigned = [b["id"] for b in blocks if b["id"] not in assigned_blocks]

    return {
        "assignments": assignments,
        "unassigned": unassigned,
        "stats": {
            "totalBlocks": num_blocks,
            "totalDrivers": num_drivers,
            "assigned": len(assignments),
            "unassigned": len(unassigned),
            "solverStatus": solver.StatusName(status)
        }
    }


def main():
    """Main entry point - reads JSON from command line argument."""
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No input provided"}))
        sys.exit(1)

    try:
        input_data = json.loads(sys.argv[1])
    except json.JSONDecodeError as e:
        print(json.dumps({"error": f"Invalid JSON: {str(e)}"}))
        sys.exit(1)

    action = input_data.get("action", "optimize")

    if action == "optimize":
        drivers = input_data.get("drivers", [])
        blocks = input_data.get("blocks", [])
        result = optimize_schedule(drivers, blocks)
        print(json.dumps(result))
    else:
        print(json.dumps({"error": f"Unknown action: {action}"}))
        sys.exit(1)


if __name__ == "__main__":
    main()
