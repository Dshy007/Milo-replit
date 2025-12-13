"""
Test tie-breaking logic in ownership model.

Scenario:
- Driver A: 6 total assignments, 5 in last 8 weeks
- Driver B: 6 total assignments, 1 in last 8 weeks (was on vacation)
- Expected winner: Driver A (more recent activity)
"""

import json
import sys
from datetime import datetime, timedelta

# Build test assignments
today = datetime.now()

assignments = []

# Driver A: 6 assignments, 5 recent (in last 8 weeks), 1 old
# Recent dates (within 8 weeks)
for i in range(5):
    date = (today - timedelta(weeks=i+1)).strftime('%Y-%m-%d')
    assignments.append({
        'driverId': 'driver-a',
        'driverName': 'Driver A',
        'soloType': 'solo1',
        'tractorId': 'Tractor_1',
        'startTime': '16:30',
        'dayOfWeek': 1,  # Monday
        'serviceDate': date
    })
# Old date (12 weeks ago)
assignments.append({
    'driverId': 'driver-a',
    'driverName': 'Driver A',
    'soloType': 'solo1',
    'tractorId': 'Tractor_1',
    'startTime': '16:30',
    'dayOfWeek': 1,
    'serviceDate': (today - timedelta(weeks=12)).strftime('%Y-%m-%d')
})

# Driver B: 6 assignments, 1 recent (in last 8 weeks), 5 old (was on vacation recently)
# Recent date (within 8 weeks)
assignments.append({
    'driverId': 'driver-b',
    'driverName': 'Driver B',
    'soloType': 'solo1',
    'tractorId': 'Tractor_1',
    'startTime': '16:30',
    'dayOfWeek': 1,
    'serviceDate': (today - timedelta(weeks=2)).strftime('%Y-%m-%d')
})
# Old dates (10-15 weeks ago - before vacation)
for i in range(5):
    date = (today - timedelta(weeks=10+i)).strftime('%Y-%m-%d')
    assignments.append({
        'driverId': 'driver-b',
        'driverName': 'Driver B',
        'soloType': 'solo1',
        'tractorId': 'Tractor_1',
        'startTime': '16:30',
        'dayOfWeek': 1,
        'serviceDate': date
    })

print("=" * 70)
print("TEST: Tie-breaking by recent 8-week count")
print("=" * 70)
print(f"\nDriver A: 6 total (5 in last 8 weeks, 1 old)")
print(f"Driver B: 6 total (1 in last 8 weeks, 5 old - was on vacation)")
print(f"\nExpected winner: Driver A")
print("\n" + "=" * 70)

# Train the model
from python.xgboost_ownership import OwnershipClassifier

classifier = OwnershipClassifier()

# Prepare data (fit encoders)
classifier.solo_type_encoder.fit(['solo1', 'solo2'])
classifier.tractor_encoder.fit([f'Tractor_{i}' for i in range(1, 11)])
classifier.driver_encoder.fit(['Driver A', 'Driver B'])

# Process assignments
for a in assignments:
    solo_type = a.get('soloType', 'solo1')
    tractor_id = a.get('tractorId', 'Tractor_1')
    driver_name = a.get('driverName', 'Unknown')
    day_of_week = a.get('dayOfWeek', 0)
    service_date = a.get('serviceDate', '')

    from python.xgboost_ownership import get_canonical_time
    canonical_time = get_canonical_time(solo_type, tractor_id)
    slot_key = classifier._make_slot_key(solo_type, tractor_id, canonical_time, day_of_week)
    classifier.slot_ownership[slot_key][driver_name].append(service_date)

# Show what we have
slot_key = list(classifier.slot_ownership.keys())[0]
ownership = classifier.slot_ownership[slot_key]

print("\nSlot ownership data:")
for driver, dates in ownership.items():
    cutoff = (datetime.now() - timedelta(weeks=8)).strftime('%Y-%m-%d')
    recent = sum(1 for d in dates if d >= cutoff)
    print(f"  {driver}: {len(dates)} total, {recent} in last 8 weeks")
    print(f"    Dates: {sorted(dates)}")

# Now predict
print("\n" + "=" * 70)
print("PREDICTION:")
print("=" * 70)

result = classifier.predict_owner(
    solo_type='solo1',
    tractor_id='Tractor_1',
    day_of_week=1
)

print(f"\nWinner: {result[0]}")
print(f"Confidence: {result[1]:.1%}")

if result[0] == 'Driver A':
    print("\nPASS: Tie-breaking correctly selected Driver A (more recent activity)")
else:
    print("\nFAIL: Expected Driver A to win")
