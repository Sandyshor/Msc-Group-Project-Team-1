"""Safety as a factor the student rates: each place's relative crime score, scored from 30 (0) to 60 (1)."""
import pytest

import recommender

UNIVERSITY = "TU Dublin - Grangegorman"
BASE = {"Rent": 7, "Commute": 7, "Shopping & Groceries": 7, "Restaurants": 7, "Healthcare": 7,
        "Recreation & Wellness": 7}


@pytest.fixture(scope="module")
def data():
    return recommender.load_data()


def picks(result):
    return [(r["area"], r["neighbourhood"]["name"], r["match_score"]) for r in result["recommendations"]]


def test_safety_can_be_left_out(data):
    without = recommender.recommend(data, UNIVERSITY, 1000, "private_room", importance=BASE)
    at_zero = recommender.recommend(data, UNIVERSITY, 1000, "private_room", importance={**BASE, "Safety": 0})
    assert picks(without) == picks(at_zero)


def test_rating_safety_picks_safer_places(data):
    without = recommender.recommend(data, UNIVERSITY, 1000, "private_room", importance=BASE)
    with_safety = recommender.recommend(data, UNIVERSITY, 1000, "private_room", importance={**BASE, "Safety": 10})

    def mean_safety(result):
        scores = [r["neighbourhood"]["safety_score"] for r in result["recommendations"]]
        return sum(scores) / len(scores)

    assert mean_safety(with_safety) > mean_safety(without)


def test_safety_shows_in_the_breakdown(data):
    result = recommender.recommend(data, UNIVERSITY, 1000, "private_room", importance={**BASE, "Safety": 10})
    first = result["recommendations"][0]["breakdown"][0]
    assert first["factor"] == "Safety" and first["value"].startswith("Safety score ")
    assert 0 <= first["score"] <= 100
