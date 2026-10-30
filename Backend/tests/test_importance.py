"""Importance sliders (0-10) on /recommend, and the older 1-4 ratings that map onto the same scale."""
import pytest
from fastapi.testclient import TestClient

import recommender

UNIVERSITY = "TU Dublin - Grangegorman"
RATINGS = {"Rent": 1, "Commute": 2, "Shopping & Groceries": 2, "Restaurants": 3, "Healthcare": 4,
           "Recreation & Wellness": 3}
SAME_AS_RATINGS = {name: recommender.RATING_TO_IMPORTANCE[r] for name, r in RATINGS.items()}


@pytest.fixture(scope="module")
def data():
    return recommender.load_data()


def picks(result):
    return [(r["area"], r["neighbourhood"]["name"], r["match_score"]) for r in result["recommendations"]]


def test_ratings_and_matching_importance_give_the_same_results(data):
    by_rating = recommender.recommend(data, UNIVERSITY, 900, "private_room", RATINGS)
    by_importance = recommender.recommend(data, UNIVERSITY, 900, "private_room", importance=SAME_AS_RATINGS)
    assert picks(by_rating) == picks(by_importance)


def test_only_the_ratio_between_factors_matters_for_the_ranking(data):
    """Rent 10 / Commute 5 ranks like Rent 6 / Commute 3 (the penalties aside, which use the absolute value)."""
    others = {"Shopping & Groceries": 0, "Restaurants": 0, "Healthcare": 0, "Recreation & Wellness": 0}
    a = recommender.recommend(data, UNIVERSITY, 2000, "private_room", importance={"Rent": 4, "Commute": 2, **others},
                              max_commute=25)
    b = recommender.recommend(data, UNIVERSITY, 2000, "private_room", importance={"Rent": 8, "Commute": 4, **others},
                              max_commute=25)
    assert [r["area"] for r in a["recommendations"]] == [r["area"] for r in b["recommendations"]]


def test_more_importance_on_rent_favours_cheaper_places(data):
    base = {name: 7 for name in RATINGS}
    normal = recommender.recommend(data, UNIVERSITY, 800, "private_room", importance=base)
    rent_first = recommender.recommend(data, UNIVERSITY, 800, "private_room", importance={**base, "Rent": 10, "Commute": 1})
    assert rent_first["recommendations"][0]["rent"] <= normal["recommendations"][0]["rent"]


def test_breakdown_shows_importance_and_its_words(data):
    result = recommender.recommend(data, UNIVERSITY, 900, "private_room", importance={**SAME_AS_RATINGS, "Rent": 9})
    rows = result["recommendations"][0]["breakdown"]
    assert rows[0]["factor"] == "Rent" and rows[0]["importance"] == 9
    assert rows[0]["importance_label"] == "Very important"
    assert [r["importance"] for r in rows] == sorted((r["importance"] for r in rows), reverse=True)
    assert recommender.importance_label(0) == "Not important"
    assert recommender.importance_label(2) == "Slightly important"
    assert recommender.importance_label(7) == "Important"


def test_all_zero_is_refused(data):
    with pytest.raises(recommender.RecommendationError):
        recommender.recommend(data, UNIVERSITY, 900, "private_room", importance={name: 0 for name in RATINGS})


def test_api_accepts_importance_and_checks_its_range():
    import app

    client = TestClient(app.app)
    body = {"university": UNIVERSITY, "budget": 900, "accommodation": "private_room"}
    assert client.post("/recommend", json={**body, "importance": SAME_AS_RATINGS}).status_code == 200
    assert client.post("/recommend", json={**body, "ratings": RATINGS}).status_code == 200
    assert client.post("/recommend", json={**body, "importance": {**SAME_AS_RATINGS, "Rent": 11}}).status_code == 422
    assert client.post("/recommend", json=body).status_code == 422
