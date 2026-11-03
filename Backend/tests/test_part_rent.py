"""Room rent for each part of a district: its own listings when it has enough, otherwise the district's average."""
import pandas as pd
import pytest

import recommender

UNIVERSITY = "TU Dublin - Grangegorman"
IMPORTANCE = {"Rent": 10, "Commute": 7, "Shopping & Groceries": 7, "Restaurants": 7, "Healthcare": 7,
              "Recreation & Wellness": 7}


@pytest.fixture(scope="module")
def data():
    return recommender.load_data()


def test_listing_names_are_matched_to_parts():
    parts = pd.DataFrame({"Area": ["D1", "D3", "D15", "D7", "D7"],
                          "Part": ["International Financial Services Centre", "Marino", "Blanchardstown Village",
                                   "Cabra", "Cabra West"]})
    rooms = pd.DataFrame({"Area": ["D1", "D3", "D15", "D7", "D7", "D7"],
                          "Neighbourhood": ["IFSC", "Marino (part)", "Blanchardstown", "Cabra", "Arbour Hill", None]})
    assert recommender._listing_parts(rooms, parts) == [
        "International Financial Services Centre", "Marino", "Blanchardstown Village", "Cabra", None, None]


def test_parts_need_enough_listings_for_their_own_rent(data):
    own = data["part_rent"]["private_room"]
    assert not own.empty
    assert (own["count"] >= recommender.MIN_ROOM_LISTINGS).all()


def test_a_part_with_its_own_listings_uses_their_average(data):
    result = recommender.recommend(data, UNIVERSITY, 900, "private_room", importance=IMPORTANCE, top_n=50)
    own = data["part_rent"]["private_room"]
    district = data["rent_tables"]["private_room"][1]
    for rec in result["recommendations"]:
        key = (rec["area"], rec["neighbourhood"]["name"])
        if key in own.index:
            assert rec["rent_is_for"] == "neighbourhood"
            assert rec["rent"] == round(own.loc[key, "mean"], 2) and rec["rent_listings"] == own.loc[key, "count"]
        else:
            assert rec["rent_is_for"] == "district"
            assert rec["rent"] == round(district[rec["area"]], 2)
        assert rec["budget_difference"] == round(rec["rent"] - 900, 2)


def test_apartments_still_use_district_averages(data):
    result = recommender.recommend(data, UNIVERSITY, 2000, "one_bed", importance=IMPORTANCE)
    assert all(rec["rent_is_for"] == "district" for rec in result["recommendations"])
