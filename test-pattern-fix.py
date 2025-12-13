#!/usr/bin/env python3
"""
Test get_driver_pattern fix - before/after comparison
"""

import json
import sys
sys.path.insert(0, 'python')

from xgboost_ownership import OwnershipClassifier

def main():
    # Load the model
    classifier = OwnershipClassifier()
    if not classifier.load():
        print("Error: Model not found")
        return

    # Test drivers
    test_drivers = [
        "Michael Shane Burton",
        "Joshua ALLEN Green",
        "Tareef THAMER Mahdi",
        "Isaac Kiragu",
        "Brian Worts",
    ]

    print("=" * 70)
    print("GET_DRIVER_PATTERN FIX - TESTING MULTIPLE DRIVERS")
    print("=" * 70)
    print("\nFix: Now counts TOTAL assignments per day, not per-slot minimums")
    print("A day counts if driver has 2+ total assignments that day\n")

    for driver_name in test_drivers:
        pattern = classifier.get_driver_pattern(driver_name)

        print(f"\n{driver_name}:")
        print(f"  typical_days: {pattern['typical_days']}")
        print(f"  day_list: {pattern['day_list']}")
        print(f"  day_counts: {pattern['day_counts']}")
        print(f"  confidence: {pattern['confidence']:.0%}")

    # Show raw data for Mike to verify
    print("\n" + "=" * 70)
    print("MIKE BURTON - RAW DATA VERIFICATION")
    print("=" * 70)

    mike_data = {}
    for slot_key, owners in classifier.slot_ownership.items():
        if "Michael Shane Burton" not in owners:
            continue
        parts = slot_key.split('|')
        if len(parts) != 4:
            continue
        dow = int(parts[3])
        dow_names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
        day_name = dow_names[dow]

        val = owners["Michael Shane Burton"]
        count = len(val) if isinstance(val, list) else val

        if day_name not in mike_data:
            mike_data[day_name] = 0
        mike_data[day_name] += count

    print("\nMike's TOTAL assignments per day:")
    for day, count in sorted(mike_data.items(), key=lambda x: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].index(x[0])):
        status = "✓ counts (>=2)" if count >= 2 else "✗ skipped (<2)"
        print(f"  {day}: {count} total assignments {status}")

if __name__ == '__main__':
    main()
