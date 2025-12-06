"""
Schedule Optimizer - DRIVER-CENTRIC WEEKLY PATTERN MATCHING

Strategy:
1. Build each driver's weekly pattern (which days they work, which slots)
2. Sort drivers by total historical shifts (most active first)
3. For each driver, give them ONE block on EACH day they historically work
4. This ensures drivers get their full weekly schedule preserved

Example: If Firas worked Saturday, Sunday, Monday historically,
he should get one block on each of those days this week.
"""

import json
import sys
from collections import defaultdict


def optimize_schedule(drivers: list, blocks: list, slot_history: dict = None) -> dict:
    """
    Match blocks to drivers based on 8-week slot history.
    Uses DRIVER-CENTRIC approach: give each driver their weekly pattern.

    Args:
        drivers: List of driver objects (id, name)
        blocks: List of block objects (id, day, time, contractType, serviceDate)
        slot_history: dict mapping SLOT -> { driverId: count, ... }
            Example: {"monday_16:30": {"driver-123": 5, "driver-456": 3}}

    Returns:
        dict with assignments, unassigned, stats
    """

    print("=== DRIVER-CENTRIC WEEKLY PATTERN OPTIMIZER ===", file=sys.stderr)
    print(f"=== Input: {len(drivers)} drivers, {len(blocks)} blocks, {len(slot_history or {})} slots with history ===", file=sys.stderr)

    slot_history = slot_history or {}

    # Build driver lookup
    driver_map = {d["id"]: d for d in drivers}

    # STEP 1: Build each driver's weekly pattern
    # driver_pattern[driver_id] = {day: {slot: count, ...}, ...}
    # Also track total shifts per driver
    driver_pattern = defaultdict(lambda: defaultdict(dict))
    driver_total_shifts = defaultdict(int)

    for slot, driver_counts in slot_history.items():
        day = slot.split("_")[0]  # e.g., "monday" from "monday_16:30"
        for driver_id, count in driver_counts.items():
            driver_pattern[driver_id][day][slot] = count
            driver_total_shifts[driver_id] += count

    # Log driver patterns
    print(f"  Found {len(driver_pattern)} drivers with history", file=sys.stderr)
    for driver_id, days in list(driver_pattern.items())[:5]:
        name = driver_map.get(driver_id, {}).get("name", "Unknown")
        day_list = list(days.keys())
        total = driver_total_shifts[driver_id]
        print(f"    {name}: {len(day_list)} days, {total} total shifts - {day_list}", file=sys.stderr)

    # STEP 2: Group blocks by day and slot
    blocks_by_day = defaultdict(list)  # day -> [blocks]
    blocks_by_slot = defaultdict(list)  # slot -> [blocks]
    for block in blocks:
        day = block["day"]
        slot = f"{day}_{block['time']}"
        blocks_by_day[day].append(block)
        blocks_by_slot[slot].append(block)

    print(f"  Blocks by day: {dict((d, len(b)) for d, b in blocks_by_day.items())}", file=sys.stderr)

    # STEP 3: Sort drivers by total historical shifts (most active first)
    # This gives priority to drivers who work the most
    sorted_drivers = sorted(
        driver_pattern.keys(),
        key=lambda d: -driver_total_shifts[d]
    )

    assignments = []
    assigned_blocks = set()
    assigned_drivers_today = defaultdict(set)  # date -> set of driver IDs

    # STEP 4: For each driver, give them blocks on their historical days
    for driver_id in sorted_drivers:
        if driver_id not in driver_map:
            continue

        driver = driver_map[driver_id]
        driver_days = driver_pattern[driver_id]

        # Sort this driver's days by how often they work that day (most frequent first)
        sorted_days = sorted(
            driver_days.keys(),
            key=lambda d: -sum(driver_days[d].values())
        )

        for day in sorted_days:
            # Find all blocks on this day
            day_blocks = blocks_by_day.get(day, [])
            if not day_blocks:
                continue

            # Get this driver's preferred slots for this day (sorted by count)
            day_slots = driver_days[day]
            sorted_slots = sorted(day_slots.keys(), key=lambda s: -day_slots[s])

            # Try to assign a block on this day
            assigned_this_day = False
            for slot in sorted_slots:
                slot_blocks = blocks_by_slot.get(slot, [])
                for block in slot_blocks:
                    if block["id"] in assigned_blocks:
                        continue

                    # Check driver not already working this date
                    if driver_id in assigned_drivers_today[block["serviceDate"]]:
                        continue

                    # Assign!
                    count = day_slots[slot]
                    assignments.append({
                        "blockId": block["id"],
                        "driverId": driver_id,
                        "driverName": driver.get("name", "Unknown"),
                        "matchType": "history",
                        "preferredTime": block["time"],
                        "actualTime": block["time"],
                        "serviceDate": block["serviceDate"],
                        "day": block["day"],
                        "historyCount": count
                    })
                    assigned_blocks.add(block["id"])
                    assigned_drivers_today[block["serviceDate"]].add(driver_id)
                    assigned_this_day = True
                    print(f"    {driver['name']} -> {day} ({slot}, {count}x history)", file=sys.stderr)
                    break

                if assigned_this_day:
                    break

    # Find unassigned blocks
    unassigned = [b["id"] for b in blocks if b["id"] not in assigned_blocks]

    print(f"=== Result: {len(assignments)} assigned, {len(unassigned)} unassigned ===", file=sys.stderr)

    return {
        "assignments": assignments,
        "unassigned": unassigned,
        "stats": {
            "totalBlocks": len(blocks),
            "totalDrivers": len(drivers),
            "assigned": len(assignments),
            "unassigned": len(unassigned),
            "solverStatus": "DRIVER_PATTERN_MATCH"
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
        # Now expecting slotHistory instead of lastWeekAssignments
        slot_history = input_data.get("slotHistory", {})
        result = optimize_schedule(drivers, blocks, slot_history)
        print(json.dumps(result, indent=2))
    else:
        print(json.dumps({"error": f"Unknown action: {action}"}))
        sys.exit(1)


if __name__ == "__main__":
    main()
