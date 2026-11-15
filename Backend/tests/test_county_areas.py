"""County Dublin areas (A and K Eircodes) in the recommender: those with OTP commute times are compared
alongside D1-D24, with Daft.ie report room rents, RTB home rents and the project's safety scores."""
import pandas as pd
import pytest

import district_rent
import recommender

IMPORTANCE = {name: 5 for name in ["Rent", "Safety", "Commute", "Shopping & Groceries", "Restaurants",
                                   "Healthcare", "Recreation & Wellness"]}


@pytest.fixture(scope="module")
def data():
    return recommender.load_data()


def county_areas(data):
    points = data["commute_points"]
    return set(points.loc[~points["Area"].str.startswith("D"), "Area"])


def test_only_county_areas_with_commute_times_are_compared(data):
    otp = pd.read_csv(recommender._path(recommender.COUNTY_COMMUTE_FILE))
    assert county_areas(data) == set(otp["Area"])
    assert {"A94", "A96", "K36", "K67", "K78"} <= county_areas(data)


def test_county_rents_come_from_their_district_profiles(data):
    profile = district_rent.load_profile_data()
    tables = data["rent_tables"]
    for area in county_areas(data):
        for search, kind in district_rent.SEARCH_KIND.items():
            assert tables[search][1][area] == district_rent.rent_for(profile, area, kind)["value"]


def test_dun_laoghaire_is_the_match_for_iadt(data):
    result = recommender.recommend(data, "IADT - Dun Laoghaire", 1000, "private_room", importance=IMPORTANCE)
    top = result["recommendations"][0]
    assert top["area"] == "A96" and top["neighbourhood"]["name"] == "Dún Laoghaire"
    assert top["rent_source"] == "Daft.ie report 2026 Q1 average"
    assert top["safety"]["index"] > 0
    links = top["places_to_live"]["search_links"]
    assert links[0]["url"].startswith("https://www.daft.ie/sharing/dun-laoghaire-dublin")
    assert "/renting_dublin/dun-laoghaire/" in links[1]["url"]
    # no ethnicity breakdown for County Dublin: the sentence must not dangle
    assert "biggest groups are ." not in top["profile"] and "biggest groups are" not in top["profile"]


def test_district_results_say_where_their_rent_comes_from(data):
    result = recommender.recommend(data, "TU Dublin - Grangegorman", 1200, "private_room", importance=IMPORTANCE)
    for rec in result["recommendations"]:
        assert rec["rent_source"]
