"""Places to live on each recommendation: student residences in the district (OpenStreetMap,
build_accommodation.py) and rental searches for it on Daft.ie and Rent.ie."""
import pandas as pd
import pytest

import build_accommodation as ba
import recommender

UNIVERSITY = "TU Dublin - Grangegorman"
RATINGS = {"Rent": 1, "Commute": 2, "Shopping & Groceries": 2, "Restaurants": 3, "Healthcare": 4,
           "Recreation & Wellness": 3}


@pytest.fixture(scope="module")
def data():
    return recommender.load_data()


@pytest.mark.parametrize("name, base", [
    ("Kavanagh Court - Uninest Student Accommodation", "Kavanagh Court"),
    ("Destiny Student - Ardee Point", "Ardee Point"),
    ("Glenomena Student Residences House 1-3", "Glenomena Student Residences"),
    ("UCD Village Block D1-5", "UCD Village"),
    ("Bangor - House 1", "Bangor"),
    ("Postgraduate Residences A", "Postgraduate Residences"),
    ("Printing House Square", "Printing House Square"),
])
def test_osm_names_are_cleaned_to_the_residence_name(name, base):
    assert ba.base_name(name) == base


def test_links_are_official_sites_or_a_listing_page():
    # Uninest's Dublin residences now trade as Yugo (old links are dead). Amber was a research source only.
    res = pd.read_csv(recommender.RESIDENCES_CSV)
    web = res["Website"].fillna("")
    assert not web.str.contains("uninest|amberstudent.com/places/search").any()
    assert not web.str.contains("amberstudent").any()   # residences without their own website aren't listed
    assert res["Website"].notna().all()


def test_curated_rows_have_a_source_and_eircode_district():
    cur = pd.read_csv(recommender.RESIDENCES_CSV.replace("student_residences.csv", "student_residences_curated.csv"))
    assert cur["Source"].str.startswith("http").all()
    with_code = cur[cur["Eircode"].notna()]
    assert (with_code["Eircode"].str[:3].str.replace("D0", "D") == with_code["District"].str[:3].str.upper()).all()


def test_operator_tag_beats_a_stray_link():
    # OSM has New Mill (a Yugo residence) with a Uninest link on one copy.
    assert ba.operator_of(["New Mill"], ["https://unineststudents.ie/x"], ["Yugo"]) == "Yugo"
    assert ba.best_website(["https://unineststudents.ie/x", "https://yugo.com/new-mill"], "Yugo") == "https://yugo.com/new-mill"


@pytest.mark.parametrize("area, accommodation, expected", [
    ("D1", "private_room", "https://www.daft.ie/sharing/dublin-1-dublin?rentalPrice_to=900"),
    ("D6W", "shared_room", "https://www.daft.ie/sharing/dublin-6w-dublin?rentalPrice_to=900"),
    ("D7", "two_bed", "https://www.daft.ie/property-for-rent/dublin-7-dublin?rentalPrice_to=900&numBeds_from=2&numBeds_to=2"),
])
def test_daft_search_is_filtered_to_district_budget_and_type(area, accommodation, expected):
    links = recommender.search_links(area, accommodation, 900)
    assert links[0] == {"site": "Daft.ie", "label": links[0]["label"], "url": expected}
    assert links[1]["site"] == "Rent.ie" and f"dublin-{area[1:].lower()}/" in links[1]["url"]
    assert links[1]["url"].endswith("/rent_0-900/") and links[0]["label"] == links[1]["label"]


def test_rent_ie_link_has_bedrooms_and_budget_in_the_path():
    # Rent.ie reads its filters from the path (".../dublin-7/1_beds/rent_0-1650/"), not from ?query parameters.
    links = recommender.search_links("D7", "one_bed", 1650)
    assert links[1]["url"] == "https://www.rent.ie/houses-to-let/renting_dublin/dublin-7/1_beds/rent_0-1650/"
    assert links[1]["label"] == "1-bed homes in D7 up to €1,650"


def test_d1_lists_its_student_residences(data):
    d1 = {r["name"]: r for r in data["residences"]["D1"]}
    assert d1["The Artisan"]["operator"] == "Mezzino" and "mezzino.com" in d1["The Artisan"]["website"]
    assert {"Beckett House", "Kavanagh Court", "The Artisan", "Point Campus", "Mayor Square", "Dorset Point"} <= set(d1)
    assert d1["Kavanagh Court"]["operator"] == "Yugo" and "yugo.com" in d1["Kavanagh Court"]["website"]
    assert not d1["The Artisan"]["approximate_position"]   # building position from its Amber listing
    assert all(r["website"] is None or r["website"].startswith("http") for rs in data["residences"].values() for r in rs)


def test_every_recommendation_has_places_to_live(data):
    out = recommender.recommend(data, UNIVERSITY, 900, "private_room", RATINGS)
    for r in out["recommendations"]:
        places = r["places_to_live"]
        assert places["residences"] == data["residences"].get(r["area"], [])
        assert [l["site"] for l in places["search_links"]] == ["Daft.ie", "Rent.ie"]


def test_duplicates_and_non_student_buildings_are_left_out():
    names = set(pd.read_csv(recommender.RESIDENCES_CSV)["Name"])
    # old / development names of residences listed under their current name, and a co-living building
    assert not names & {"Aungier Street Student Accommodation", "Scape Aungier Street", "Sweeney's Corner",
                        "Swuite Dublin", "Liberties House"}
    assert {"Stephen's Quarter", "Brewers Close", "Grangegorman House"} <= names
