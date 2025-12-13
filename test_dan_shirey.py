"""
Test predict_availability for Dan Shirey (Wed/Thu/Fri pattern)
vs Adan Galvan (Sun/Mon/Tue pattern)

Shows that XGBoost learns EACH driver's individual pattern - no clustering!
"""

import sys
sys.path.insert(0, 'python')

from xgboost_availability import AvailabilityClassifier, FEATURE_NAMES

# Adan's history: Sun/Mon/Tue pattern
adan_history = [
    {"serviceDate": "2024-10-20", "day": "Sun"},
    {"serviceDate": "2024-10-21", "day": "Mon"},
    {"serviceDate": "2024-10-22", "day": "Tue"},
    {"serviceDate": "2024-10-27", "day": "Sun"},
    {"serviceDate": "2024-10-28", "day": "Mon"},
    {"serviceDate": "2024-10-29", "day": "Tue"},
    {"serviceDate": "2024-11-03", "day": "Sun"},
    {"serviceDate": "2024-11-04", "day": "Mon"},
    {"serviceDate": "2024-11-05", "day": "Tue"},
    {"serviceDate": "2024-11-10", "day": "Sun"},
    {"serviceDate": "2024-11-11", "day": "Mon"},
    {"serviceDate": "2024-11-12", "day": "Tue"},
    {"serviceDate": "2024-11-17", "day": "Sun"},
    {"serviceDate": "2024-11-18", "day": "Mon"},
    {"serviceDate": "2024-11-19", "day": "Tue"},
    {"serviceDate": "2024-11-24", "day": "Sun"},
    {"serviceDate": "2024-11-25", "day": "Mon"},
    {"serviceDate": "2024-11-26", "day": "Tue"},
    {"serviceDate": "2024-12-01", "day": "Sun"},
    {"serviceDate": "2024-12-02", "day": "Mon"},
    {"serviceDate": "2024-12-03", "day": "Tue"},
    {"serviceDate": "2024-12-08", "day": "Sun"},
    {"serviceDate": "2024-12-09", "day": "Mon"},
    {"serviceDate": "2024-12-10", "day": "Tue"},
]

# Dan Shirey's history: Wed/Thu/Fri pattern
dan_history = [
    {"serviceDate": "2024-10-23", "day": "Wed"},
    {"serviceDate": "2024-10-24", "day": "Thu"},
    {"serviceDate": "2024-10-25", "day": "Fri"},
    {"serviceDate": "2024-10-30", "day": "Wed"},
    {"serviceDate": "2024-10-31", "day": "Thu"},
    {"serviceDate": "2024-11-01", "day": "Fri"},
    {"serviceDate": "2024-11-06", "day": "Wed"},
    {"serviceDate": "2024-11-07", "day": "Thu"},
    {"serviceDate": "2024-11-08", "day": "Fri"},
    {"serviceDate": "2024-11-13", "day": "Wed"},
    {"serviceDate": "2024-11-14", "day": "Thu"},
    {"serviceDate": "2024-11-15", "day": "Fri"},
    {"serviceDate": "2024-11-20", "day": "Wed"},
    {"serviceDate": "2024-11-21", "day": "Thu"},
    {"serviceDate": "2024-11-22", "day": "Fri"},
    {"serviceDate": "2024-11-27", "day": "Wed"},
    {"serviceDate": "2024-11-28", "day": "Thu"},
    {"serviceDate": "2024-11-29", "day": "Fri"},
    {"serviceDate": "2024-12-04", "day": "Wed"},
    {"serviceDate": "2024-12-05", "day": "Thu"},
    {"serviceDate": "2024-12-06", "day": "Fri"},
]

# Training data
training_histories = {
    "adan_galvan": adan_history,
    "dan_shirey": dan_history,
}


def main():
    print("=" * 70)
    print("Comparing Two Drivers with OPPOSITE Patterns")
    print("=" * 70)
    print("\nAdan Galvan: Works Sun/Mon/Tue")
    print("Dan Shirey:  Works Wed/Thu/Fri")
    print()

    # Train model
    classifier = AvailabilityClassifier()
    success = classifier.fit(training_histories)

    if not success:
        print("ERROR: Training failed!")
        return

    # Test dates
    test_dates = [
        ("2024-12-15", "Sun"),
        ("2024-12-16", "Mon"),
        ("2024-12-17", "Tue"),
        ("2024-12-18", "Wed"),
        ("2024-12-19", "Thu"),
        ("2024-12-20", "Fri"),
        ("2024-12-21", "Sat"),
    ]

    print("\n" + "=" * 70)
    print("Predictions for Week of Dec 15-21")
    print("=" * 70)
    print(f"{'Date':<12} {'Day':<5} {'Adan (S/M/T)':>15} {'Dan (W/T/F)':>15} {'Who Should Work?'}")
    print("-" * 70)

    for date_str, day in test_dates:
        adan_prob = classifier.predict_availability("adan_galvan", date_str, adan_history)
        dan_prob = classifier.predict_availability("dan_shirey", date_str, dan_history)

        # Determine expected worker
        if day in ["Sun", "Mon", "Tue"]:
            expected = "ADAN"
            adan_mark = "<--"
            dan_mark = ""
        elif day in ["Wed", "Thu", "Fri"]:
            expected = "DAN"
            adan_mark = ""
            dan_mark = "<--"
        else:
            expected = "NEITHER"
            adan_mark = ""
            dan_mark = ""

        print(f"{date_str:<12} {day:<5} {adan_prob:>12.1%} {adan_mark:>3} {dan_prob:>12.1%} {dan_mark:>3}")

    # Show feature comparison for same day (Wed Dec 18)
    print("\n" + "=" * 70)
    print("Feature Comparison for Wed Dec 18")
    print("=" * 70)

    # Clear caches
    classifier.driver_stats = {}

    adan_features = classifier.extract_features("adan_galvan", "2024-12-18", adan_history)
    dan_features = classifier.extract_features("dan_shirey", "2024-12-18", dan_history)

    print(f"{'Feature':<30} {'Adan':>10} {'Dan':>10} {'Difference'}")
    print("-" * 70)
    for i, name in enumerate(FEATURE_NAMES):
        diff = dan_features[i] - adan_features[i]
        diff_str = f"+{diff:.3f}" if diff > 0 else f"{diff:.3f}"
        print(f"{name:<30} {adan_features[i]:>10.3f} {dan_features[i]:>10.3f} {diff_str:>10}")

    print("\n" + "=" * 70)
    print("KEY INSIGHT: Same model, same features, different drivers!")
    print("XGBoost uses historical_freq_this_day to distinguish patterns.")
    print("=" * 70)


if __name__ == "__main__":
    main()
