import json

with open('python/models/ownership_encoders.json', 'r') as f:
    data = json.load(f)

ownership = data.get('slot_ownership', {})

# Count Mike's assignments per day across ALL slots
day_counts = {}  # day_of_week -> total count
day_slots = {}   # day_of_week -> list of slot counts

for slot_key, owners in ownership.items():
    if 'Michael Shane Burton' not in owners:
        continue

    parts = slot_key.split('|')
    if len(parts) != 4:
        continue

    dow = int(parts[3])

    val = owners['Michael Shane Burton']
    count = len(val) if isinstance(val, list) else val

    if dow not in day_counts:
        day_counts[dow] = 0
        day_slots[dow] = []

    day_counts[dow] += count
    day_slots[dow].append((slot_key, count))

print('=== MIKE BURTON - ASSIGNMENTS PER DAY ===')
dow_names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
for dow in sorted(day_counts.keys()):
    print(f'{dow_names[dow]}: {day_counts[dow]} total assignments')
    for slot, cnt in day_slots[dow]:
        parts = slot.split('|')
        print(f'  {parts[1]} {parts[2]}: {cnt}')

print()
print('=== PROBLEM ANALYSIS ===')
print('MIN_ASSIGNMENTS=2 filters per SLOT, not per DAY')
print('Mike has many slots with 1 assignment each')
print('Only days where SOME slot has 2+ count')
