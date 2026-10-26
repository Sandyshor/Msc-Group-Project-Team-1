"""
Prints the top 3 areas for a fixed set of test searches, so results can be
compared before and after a change to the data or the scoring.

Run from the repo root:  python Backend/check_results.py > results_before.txt
"""
import recommender

# Every factor "Important" so no single preference dominates the comparison
RATINGS = {factor["name"]: 2 for factor in recommender.FACTORS}

TESTS = [
    ("Trinity College Dublin", 1500, "one_bed", "public_transport", None),
    ("University College Dublin - Belfield", 1000, "private_room", "public_transport", None),
    ("DCU - St Patrick's Campus", 1000, "private_room", "cycle", 10),
    ("TU Dublin - Grangegorman", 800, "shared_room", "walk", None),
    ("National College of Ireland - IFSC", 2200, "two_bed", "public_transport", 30),
]

data = recommender.load_data()
for university, budget, accommodation, mode, limit in TESTS:
    title = f"{university} | {accommodation} EUR{budget} | {mode}" + (f" <= {limit} min" if limit else "")
    print(title)
    try:
        result = recommender.recommend(data, university, budget, accommodation, RATINGS,
                                       travel_mode=mode, max_commute=limit)
    except recommender.RecommendationError as error:
        print(f"   no result: {error}\n")
        continue
    print(f"   areas compared: {result['areas_compared']}")
    for rec in result["recommendations"]:
        print(f"   #{rec['rank']} {rec['area']:<4} rent EUR{rec['rent']:>7,.0f}  "
              f"commute {rec['commute_minutes']:>3} min  match {rec['match_score']:.1f}%")
    print()
