"""One rent everywhere: the results page and the AI assistant use the district profile's figure for each area."""
import pytest

import chat
import district_rent
import recommender

IMPORTANCE = {"Rent": 10, "Commute": 7, "Shopping & Groceries": 7, "Restaurants": 7, "Healthcare": 7,
              "Recreation & Wellness": 7}

FAKE = {
    "rent": {"D8": {"rooms": {"double": {"n": 2, "median": 866}},
                    "homes": {"1 bed": {"n": 13, "median": 2200}}}},
    "rtb": {"D8": {"district": {"all": 1893, "1 bed": 1572, "2 bed": 2004}},
            "D11": {"district": {"all": 1700}}},
    "roomReport": {"areas": {"D8": {"single": 786, "double": 903, "sharing": 630, "oneBed": 1962, "twoBed": 2444},
                             "D11": {"single": 764, "double": 893, "sharing": 620, "oneBed": 1962, "twoBed": 2444}}},
}


@pytest.fixture(scope="module")
def data():
    return recommender.load_data()


@pytest.fixture(scope="module")
def profile():
    return district_rent.load_profile_data()


def value(code, kind):
    found = district_rent.rent_for(FAKE, code, kind)
    return found and (found["value"], found["source"])


def test_the_district_profile_rule():
    assert value("D8", "double") == (866, "listings")      # the district's own listings first
    assert value("D8", "1 bed") == (2200, "listings")
    assert value("D8", "2 bed") == (2004, "rtb")           # then the RTB average for whole homes
    assert value("D8", "single") == (786, "report")        # then the Daft.ie report
    assert value("D8", "sharing") == (630, "report")
    assert value("D11", "1 bed") == (1962, "report")       # RTB has no 1-bed figure here
    assert value("D11", "3 bed") is None
    assert district_rent.rent_for(FAKE, "D8", "1 bed")["note"] == "median of 13 Daft listings"


def test_search_choices_use_the_matching_profile_size():
    assert district_rent.SEARCH_KIND == {"private_room": "single", "shared_room": "sharing",
                                         "one_bed": "1 bed", "two_bed": "2 bed"}


@pytest.mark.parametrize("search", sorted(district_rent.SEARCH_KIND))
def test_the_recommender_uses_the_district_profile_rent(data, profile, search):
    table = data["rent_tables"][search][1]
    expected = district_rent.rent_table(profile, search)
    compared = set(data["area_data"]["Area"]) & set(expected)
    assert compared, "no areas to compare"
    for area in compared:
        assert table[area] == expected[area]["value"], area


@pytest.mark.parametrize("search, budget", [("private_room", 900), ("shared_room", 700), ("one_bed", 2000),
                                            ("two_bed", 2500)])
def test_every_result_shows_its_district_profile_rent(data, profile, search, budget):
    out = recommender.recommend(data, "TU Dublin - Grangegorman", budget, search, importance=IMPORTANCE, top_n=50)
    expected = district_rent.rent_table(profile, search)
    assert out["recommendations"]
    for rec in out["recommendations"]:
        assert rec["rent"] == round(expected[rec["area"]]["value"], 2)
        assert rec["rent_is_for"] == "district"
        assert rec["rent_source"] == expected[rec["area"]]["note"]
        assert rec["budget_difference"] == round(rec["rent"] - budget, 2)


def test_the_assistant_has_the_same_rents(profile):
    d8 = district_rent.rent_for(profile, "D8", "1 bed")["value"]
    assert "<site_rents>" in chat.SYSTEM_PROMPT
    assert f"- D8 The Liberties & Kilmainham: " in chat.SYSTEM_PROMPT
    assert f"1-bed apartment €{d8:,.0f}" in chat.SYSTEM_PROMPT


def test_a_university_residence_is_only_for_its_own_students(data):
    """A UCD student isn't matched with Trinity Hall, and doesn't see Trinity's halls under places to live."""
    importance = {**IMPORTANCE, "Safety": 7}
    out = recommender.recommend(data, "University College Dublin - Belfield", 1000, "student_shared",
                                importance=importance, top_n=50)
    for rec in out["recommendations"]:
        operators = {x.get("operator") for x in rec["places_to_live"]["residences"]}
        assert "Trinity College Dublin" not in operators
    trinity = recommender.recommend(data, "Trinity College Dublin", 1000, "student_accommodation",
                                    importance=importance, top_n=50)
    seen = {x.get("operator") for rec in trinity["recommendations"] for x in rec["places_to_live"]["residences"]}
    assert "University College Dublin" not in seen
    assert recommender.open_to({"operator": "Yugo"}, "University College Dublin - Belfield")
    assert not recommender.open_to({"operator": "Trinity College Dublin"}, "University College Dublin - Belfield")
