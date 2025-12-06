"""
Schedule Optimizer - Clean Slot-Based Matching

SLIDER: Minimum Days Per Week (3, 4, 5)
  - Only assign drivers who can work at least X days this week
  - Based on their history of working specific slots

CONTRACT MATCHING:
  - solo1 blocks -> solo1 drivers only
  - solo2 blocks -> solo2 drivers only
  - Uses driver's contractType field

ALGORITHM:
  1. Group blocks by contract type
  2. Filter drivers by contract type
  3. For each block, find drivers with history on that slot
  4. Assign best available (most history, not already booked that day)
"""

import json
import sys
from collections import defaultdict


def optimize_schedule(drivers: list, blocks: list, slot_history: dict, min_days: int = 3) -> dict:
    """
    Match blocks to drivers.

    Args:
        drivers: List of {id, name, contractType}
        blocks: List of {id, day, time, contractType, serviceDate}
        slot_history: {slot: {driverId: count}}
        min_days: Minimum days a driver should work (3, 4, or 5)
    """

    print(f"=== SLOT MATCHER (minDays={min_days}) ===", file=sys.stderr)
    print(f"Input: {len(drivers)} drivers, {len(blocks)} blocks", file=sys.stderr)

    # Build lookups
    driver_map = {d["id"]: d for d in drivers}

    # Figure out how many days each driver CAN work based on history
    driver_available_days = defaultdict(set)
    for slot, driver_counts in slot_history.items():
        day = slot.split("_")[0]
        for driver_id in driver_counts:
            driver_available_days[driver_id].add(day)

    # Filter drivers who can work at least min_days
    qualified_drivers = set()
    for driver_id, days in driver_available_days.items():
        if len(days) >= min_days:
            qualified_drivers.add(driver_id)

    print(f"  {len(qualified_drivers)} drivers can work {min_days}+ days", file=sys.stderr)

    # Group blocks by contract type
    blocks_by_contract = defaultdict(list)
    for block in blocks:
        ct = (block.get("contractType") or "solo1").lower()
        blocks_by_contract[ct].append(block)

    # Group drivers by contract type
    drivers_by_contract = defaultdict(list)
    for driver in drivers:
        ct = (driver.get("contractType") or "solo1").lower()
        drivers_by_contract[ct].append(driver)

    print(f"  Blocks: {dict((k, len(v)) for k, v in blocks_by_contract.items())}", file=sys.stderr)
    print(f"  Drivers: {dict((k, len(v)) for k, v in drivers_by_contract.items())}", file=sys.stderr)

    # Track assignments
    assignments = []
    assigned_blocks = set()
    driver_dates = defaultdict(set)  # driver_id -> dates working

    # Process each contract type separately
    for contract_type in ["solo1", "solo2", "team"]:
        ct_blocks = blocks_by_contract.get(contract_type, [])
        ct_drivers = drivers_by_contract.get(contract_type, [])

        if not ct_blocks or not ct_drivers:
            continue

        print(f"  Processing {contract_type}: {len(ct_blocks)} blocks, {len(ct_drivers)} drivers", file=sys.stderr)

        # Sort blocks by how "hard" they are to fill (fewer candidates first)
        def get_candidates(block):
            slot = f"{block['day']}_{block['time']}"
            candidates = slot_history.get(slot, {})
            # Filter: must be in ct_drivers, must be qualified, must have history
            valid = []
            for d in ct_drivers:
                if d["id"] in candidates and d["id"] in qualified_drivers:
                    valid.append((d["id"], candidates[d["id"]]))
            return valid

        sorted_blocks = sorted(ct_blocks, key=lambda b: len(get_candidates(b)))

        for block in sorted_blocks:
            if block["id"] in assigned_blocks:
                continue

            slot = f"{block['day']}_{block['time']}"
            service_date = block["serviceDate"]

            candidates = get_candidates(block)
            if not candidates:
                continue

            # Sort by history count (most experienced first)
            candidates.sort(key=lambda x: -x[1])

            # Find first available driver
            for driver_id, count in candidates:
                if service_date in driver_dates[driver_id]:
                    continue  # Already working this date

                driver = driver_map[driver_id]
                assignments.append({
                    "blockId": block["id"],
                    "driverId": driver_id,
                    "driverName": driver.get("name", "Unknown"),
                    "matchType": "history",
                    "preferredTime": block["time"],
                    "actualTime": block["time"],
                    "serviceDate": service_date,
                    "day": block["day"],
                    "historyCount": count,
                    "contractType": contract_type
                })
                assigned_blocks.add(block["id"])
                driver_dates[driver_id].add(service_date)
                print(f"    {slot}: {driver['name']} ({count}x)", file=sys.stderr)
                break

    # Count unassigned
    unassigned = [b["id"] for b in blocks if b["id"] not in assigned_blocks]

    # Log results by driver
    driver_assignments = defaultdict(list)
    for a in assignments:
        driver_assignments[a["driverName"]].append(a["day"])

    print(f"\n=== Driver Schedules ===", file=sys.stderr)
    for name, days in sorted(driver_assignments.items(), key=lambda x: -len(x[1]))[:10]:
        print(f"  {name}: {len(days)} days - {', '.join(sorted(set(days)))}", file=sys.stderr)

    print(f"\n=== Result: {len(assignments)} assigned, {len(unassigned)} unassigned ===", file=sys.stderr)

    return {
        "assignments": assignments,
        "unassigned": unassigned,
        "stats": {
            "totalBlocks": len(blocks),
            "totalDrivers": len(drivers),
            "assigned": len(assignments),
            "unassigned": len(unassigned),
            "solverStatus": "SLOT_MATCHER"
        }
    }


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
