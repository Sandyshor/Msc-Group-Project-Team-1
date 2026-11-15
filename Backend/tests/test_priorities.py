"""The student's priorities decide the ranking (Docs/RECOMMENDATION_LOGIC.md).

  * weights are the slider values squared, so a factor rated 10 counts four times one rated 5;
  * safety is scored from 20 (0) to 80 (1), either side of the benchmark the safety score uses (50);
  * a neighbourhood that borrows its nearest commute point's time has it adjusted for how much nearer or
    further from the university it is.
"""
import numpy as np
import pytest

import recommender

OTHERS = ["Shopping & Groceries", "Restaurants", "Healthcare", "Recreation & Wellness"]
ALL_FIVE = {name: 5 for name in ["Rent", "Commute", "Safety", *OTHERS]}
# Campuses whose own neighbourhood has more recorded crime than the suburbs around it: the searches that used
# to put a place 20+ minutes away first even when the commute was the top priority
INNER_CAMPUSES = ["DCU - St Patrick's Campus", "National College of Art and Design", "Dublin Business School",
                  "TU Dublin - Bolton Street", "Griffith College Dublin"]


@pytest.fixture(scope="module")
def data():
    return recommender.load_data()


def search(data, university, importance, budget=1200, top_n=3):
    return recommender.recommend(data, university, budget, "private_room", importance=importance,
                                 top_n=top_n)["recommendations"]


def mean_commute(results):
    return sum(r["commute_minutes"] for r in results) / len(results)


@pytest.mark.parametrize("university", INNER_CAMPUSES)
def test_commute_as_top_priority_puts_a_nearby_place_first(data, university):
    everything = search(data, university, {**ALL_FIVE, "Commute": 10}, top_n=60)
    affordable = [r for r in everything if r["rent"] <= 1200]
    shortest = min(r["commute_minutes"] for r in affordable)
    assert everything[0]["commute_minutes"] <= shortest + 10


def test_raising_a_priority_moves_the_top_three_towards_it(data):
    for university in data["universities"]:
        default = search(data, university, ALL_FIVE)
        commute_first = search(data, university, {**ALL_FIVE, "Commute": 10})
        assert mean_commute(commute_first) <= mean_commute(default) + 0.5, university


def test_a_ten_counts_four_times_a_five(data):
    """Only rent and commute rated: the match score is their scores weighted 4 to 1 (before any penalty)."""
    importance = {**{name: 0 for name in ALL_FIVE}, "Commute": 10, "Rent": 5}
    for result in search(data, "University College Dublin - Belfield", importance, budget=2000):
        if result["commute_penalty_pct"] or result["budget_penalty_pct"]:
            continue
        score = {b["factor"]: b["score"] for b in result["breakdown"]}
        assert result["match_score"] == pytest.approx((4 * score["Commute"] + score["Rent"]) / 5, abs=0.6)


def test_same_ratings_at_any_level_give_the_same_matches(data):
    """Only the balance between the sliders matters, not how high they all are."""
    fives = search(data, "Trinity College Dublin", ALL_FIVE, budget=2000, top_n=5)
    nines = search(data, "Trinity College Dublin", {name: 9 for name in ALL_FIVE}, budget=2000, top_n=5)
    assert [r["area"] for r in fives] == [r["area"] for r in nines]
    assert fives[0]["match_score"] == nines[0]["match_score"]


def test_safety_is_scored_either_side_of_the_benchmark(data):
    assert (recommender.SAFETY_WORST + recommender.SAFETY_BEST) / 2 == 50
    for result in search(data, "TU Dublin - Grangegorman", {**ALL_FIVE, "Safety": 10}, top_n=10):
        shown = next(b for b in result["breakdown"] if b["factor"] == "Safety")
        index = result["neighbourhood"]["safety_score"]
        assert shown["score"] == pytest.approx((index - 20) / 60 * 100, abs=1)


def test_a_borrowed_commute_time_is_adjusted_for_distance(data):
    """Navan Road has no time of its own to TU Dublin Grangegorman and borrows Cabra's, 1.8 km nearer the campus."""
    university = "TU Dublin - Grangegorman"
    walk = recommender._part_commutes(data, university, "walk").set_index(["Area", "Part"])
    navan_road, cabra = walk.loc[("D7", "Navan Road")], walk.loc[("D7", "Cabra")]
    assert navan_road["Commute Estimated"] and navan_road["Commute Point"] == "Cabra"
    assert navan_road["Minutes"] > cabra["Minutes"] + 10


@pytest.mark.parametrize("mode, fastest_kmh", [("walk", 6.5), ("cycle", 22), ("public_transport", 40)])
def test_no_estimated_commute_is_faster_than_the_mode_can_go(data, mode, fastest_kmh):
    for university in data["universities"]:
        campus = recommender._university_location(data, university)
        parts = recommender._part_commutes(data, university, mode)
        parts = parts[parts["Commute Estimated"] & parts["Minutes"].notna()]
        km = recommender._km(campus["lat"], campus["lon"], parts["Origin_Latitude"], parts["Origin_Longitude"])
        speed = km / (parts["Minutes"].to_numpy(dtype=float) / 60)
        assert np.all((speed <= fastest_kmh) | (km < 1.5)), (university, parts.loc[speed > fastest_kmh, "Part"].tolist())


def test_places_with_their_own_commute_time_keep_it(data):
    university = "University College Dublin - Belfield"
    own = data["neighbourhood_commute"]
    own = own[(own["University"] == university) & (own["Mode"] == "public_transport")].set_index(["Area", "Part"])
    parts = recommender._part_commutes(data, university, "public_transport")
    exact = parts[(parts["Kind"] == "neighbourhood") & ~parts["Commute Estimated"]]
    assert len(exact) > 50
    for _, part in exact.iterrows():
        assert part["Minutes"] == pytest.approx(own.loc[(part["Area"], part["Part"]), "Minutes"])
