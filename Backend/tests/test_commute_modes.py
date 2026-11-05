"""Each recommendation carries its commute by every way of travelling, for the results page's "Getting there"."""
import pytest

import recommender

IMPORTANCE = {"Rent": 7, "Commute": 7, "Shopping & Groceries": 7, "Restaurants": 7, "Healthcare": 7,
              "Recreation & Wellness": 7}


@pytest.fixture(scope="module")
def data():
    return recommender.load_data()


@pytest.mark.parametrize("mode", list(recommender.TRAVEL_MODES))
def test_the_searched_mode_matches_the_card(data, mode):
    result = recommender.recommend(data, "TU Dublin - Blanchardstown", 1000, "private_room",
                                   importance=IMPORTANCE, travel_mode=mode)
    for rec in result["recommendations"]:
        assert set(rec["commute_by_mode"]) == set(recommender.TRAVEL_MODES)
        assert rec["commute_by_mode"][mode]["minutes"] == rec["commute_minutes"]
        assert rec["commute_by_mode"][mode]["walk_faster"] == rec["walk_faster"]


def test_university_location_is_given(data):
    result = recommender.recommend(data, "Trinity College Dublin", 1000, "private_room", importance=IMPORTANCE)
    assert result["university_location"] == {"lat": pytest.approx(53.34, abs=0.01), "lon": pytest.approx(-6.25, abs=0.01)}
