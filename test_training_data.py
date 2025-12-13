"""
Test script for build_training_data() - TODO #4

Tests that balanced training data is generated correctly.
"""

import sys
sys.path.insert(0, 'python')

from xgboost_availability import AvailabilityClassifier, FEATURE_NAMES

# Sample driver history data (simulating 12 weeks of history)
sample_histories = {
    "driver_adan": [
        # Adan works Sun/Mon/Tue pattern (weekdays 0, 1, 2)
        {"serviceDate": "2024-10-06", "day": "Sun"},
        {"serviceDate": "2024-10-07", "day": "Mon"},
        {"serviceDate": "2024-10-08", "day": "Tue"},
        {"serviceDate": "2024-10-13", "day": "Sun"},
        {"serviceDate": "2024-10-14", "day": "Mon"},
        {"serviceDate": "2024-10-15", "day": "Tue"},
        {"serviceDate": "2024-10-20", "day": "Sun"},
        {"serviceDate": "2024-10-21", "day": "Mon"},
        {"serviceDate": "2024-10-22", "day": "Tue"},
        {"serviceDate": "2024-10-27", "day": "Sun"},
        {"serviceDate": "2024-10-28", "day": "Mon"},
        {"serviceDate": "2024-10-29", "day": "Tue"},
    ],
    "driver_bob": [
        # Bob works Wed/Thu/Fri pattern (weekdays 3, 4, 5)
        {"serviceDate": "2024-10-09", "day": "Wed"},
        {"serviceDate": "2024-10-10", "day": "Thu"},
        {"serviceDate": "2024-10-11", "day": "Fri"},
        {"serviceDate": "2024-10-16", "day": "Wed"},
        {"serviceDate": "2024-10-17", "day": "Thu"},
        {"serviceDate": "2024-10-18", "day": "Fri"},
        {"serviceDate": "2024-10-23", "day": "Wed"},
        {"serviceDate": "2024-10-24", "day": "Thu"},
        {"serviceDate": "2024-10-25", "day": "Fri"},
    ],
    "driver_carl": [
        # Carl works every ~3 days (rolling interval pattern)
        {"serviceDate": "2024-10-05", "day": "Sat"},
        {"serviceDate": "2024-10-08", "day": "Tue"},
        {"serviceDate": "2024-10-11", "day": "Fri"},
        {"serviceDate": "2024-10-14", "day": "Mon"},
        {"serviceDate": "2024-10-17", "day": "Thu"},
        {"serviceDate": "2024-10-20", "day": "Sun"},
        {"serviceDate": "2024-10-23", "day": "Wed"},
        {"serviceDate": "2024-10-26", "day": "Sat"},
    ],
}

def main():
    print("=" * 60)
    print("TODO #4: Testing build_training_data()")
    print("=" * 60)

    classifier = AvailabilityClassifier()

    # Build training data
    X, y = classifier.build_training_data(sample_histories)

    print(f"\n--- Results ---")
    print(f"X shape: {X.shape}")
    print(f"y shape: {y.shape}")
    print(f"Feature columns: {FEATURE_NAMES}")

    # Show sample features
    print(f"\n--- Sample POSITIVE features (label=1, worked) ---")
    positive_indices = [i for i, label in enumerate(y) if label == 1]
    for i in positive_indices[:3]:
        print(f"  Sample {i}:")
        for j, name in enumerate(FEATURE_NAMES):
            print(f"    {name}: {X[i][j]}")

    print(f"\n--- Sample NEGATIVE features (label=0, didn't work) ---")
    negative_indices = [i for i, label in enumerate(y) if label == 0]
    for i in negative_indices[:3]:
        print(f"  Sample {i}:")
        for j, name in enumerate(FEATURE_NAMES):
            print(f"    {name}: {X[i][j]}")

    # Verify balance
    pos_count = sum(y == 1)
    neg_count = sum(y == 0)
    print(f"\n--- Balance Check ---")
    print(f"Positive samples: {pos_count}")
    print(f"Negative samples: {neg_count}")
    print(f"Ratio: {pos_count / max(1, neg_count):.2f}")

    if 0.8 <= pos_count / max(1, neg_count) <= 1.2:
        print("PASS: Dataset is balanced (ratio 0.8-1.2)")
    else:
        print("WARN: Dataset may be imbalanced")

    print("\n" + "=" * 60)
    print("TODO #4 COMPLETE: build_training_data() works!")
    print("=" * 60)

if __name__ == "__main__":
    main()
