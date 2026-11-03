"""Safety figures on each recommendation (display only - not used for ranking): the district safety score,
the neighbourhood scores inside it, and other safety factors."""
import copy

import pandas as pd
import pytest
from fastapi.testclient import TestClient

import recommender

UNIVERSITY = "TU Dublin - Grangegorman"
RATINGS = {"Rent": 1, "Commute": 2, "Shopping & Groceries": 2, "Restaurants": 3, "Healthcare": 4,
           "Recreation & Wellness": 3}
FIELDS = {"index", "tier", "main_station", "main_station_pct", "station_areas", "check_street_pct", "areas_to_check",
          "crime_per_1k", "ireland_crime_per_1k", "crime_period",
          "garda_nearest_km", "lit_streets_pct", "night_transit_pct", "neighbourhoods"}
TIERS = {"Lower recorded crime", "Below-benchmark crime", "Above-benchmark crime", "Higher recorded crime"}


@pytest.fixture(scope="module")
def data():
    return recommender.load_data()


def test_every_district_has_safety_figures(data):
    assert set(data["safety"]) >= set(recommender.AREAS)
    for figures in data["safety"].values():
        assert set(figures) == FIELDS
        assert 0 <= figures["index"] <= 100
        assert 0 <= figures["lit_streets_pct"] <= 100 and 0 <= figures["night_transit_pct"] <= 100
        assert figures["tier"] in TIERS and figures["garda_nearest_km"] > 0
        assert set(figures["crime_per_1k"]) == set(recommender.CRIME_GROUPS)
        assert all(v > 0 for v in figures["crime_per_1k"].values())
        assert figures["crime_period"] == "2023-2025 average"


def test_figures_match_the_pipeline_output(data):
    csv = pd.read_csv(recommender.SAFETY_CSV).set_index("District")
    d7 = data["safety"]["D7"]
    assert d7["index"] == round(csv.loc["D7", "safety_index_0_100"], 1)
    assert d7["tier"] == csv.loc["D7", "tier"]
    assert d7["crime_per_1k"]["violent"] == round(csv.loc["D7", "violent_per_1k"], 1)
    assert d7["ireland_crime_per_1k"]["burglary_theft"] == round(float(csv.loc["D7", "ireland_burglary_theft_per_1k"]), 1)
    assert d7["main_station"] == "bridewell" and d7["main_station_pct"] == 36
    assert d7["garda_nearest_km"] == round(csv.loc["D7", "garda_nearest_km"], 1)


def test_d7_scores(data):
    d7 = data["safety"]["D7"]
    assert d7["index"] == 43.4 and d7["tier"] == "Above-benchmark crime"
    got = [(n["name"], round(n["score"])) for n in d7["neighbourhoods"]]
    assert got == [("Ashtown (D7 part)", 59), ("Cabra", 59), ("Cabra West", 59), ("Navan Road", 59),
                   ("Cabra East", 37), ("Glasnevin (D7 part)", 37), ("Phibsborough", 37), ("Arbour Hill", 34),
                   ("Broadstone", 34), ("Grangegorman", 34), ("Oxmantown", 34), ("Smithfield", 34), ("Stoneybatter", 34)]


def test_every_district_score_is_reproducible_from_its_station_areas(data):
    overridden = set(pd.read_csv(recommender.os.path.join(recommender.os.path.dirname(recommender.SAFETY_CSV),
                                                          "manual_overrides.csv")).query("kind == 'district'")["id"])
    for area, figures in data["safety"].items():
        if area in overridden:
            continue
        parts = figures["station_areas"]
        assert parts and sum(p["share_pct"] for p in parts) in (99, 100, 101)
        rebuilt = sum(p["share_pct"] / 100 * p["score"] for p in parts)
        assert abs(rebuilt - figures["index"]) < 0.6, area   # shares are shown as whole percents


def test_d20_is_mostly_ronanstown(data):
    parts = {p["station"]: p for p in data["safety"]["D20"]["station_areas"]}
    assert parts["Ronanstown"]["share_pct"] == 72 and parts["Ballyfermot"]["share_pct"] == 28


def test_disadvantaged_areas_ask_users_to_check_the_street(data):
    d10 = data["safety"]["D10"]
    assert "Cherry Orchard" in d10["areas_to_check"] and d10["check_street_pct"] > 0
    cherry = next(n for n in d10["neighbourhoods"] if n["name"] == "Cherry Orchard")
    assert cherry["check_street"]
    assert cherry["score"] == 22.2 and d10["index"] == 25.1     # manual_overrides.csv (CRIME_SCORE.md A9)
    assert data["safety"]["D14"]["areas_to_check"] == []


def test_names_in_two_districts_are_labelled_as_parts(data):
    d7 = {n["name"] for n in data["safety"]["D7"]["neighbourhoods"]}
    d9 = {n["name"] for n in data["safety"]["D9"]["neighbourhoods"]}
    assert "Glasnevin (D7 part)" in d7 and "Glasnevin (D9 part)" in d9


def test_d2_lists_its_well_known_areas(data):
    # Only Temple Bar is an OSM place point in D2; the rest come from data/safety/extra_places.csv
    names = {n["name"] for n in data["safety"]["D2"]["neighbourhoods"]}
    assert {"Temple Bar", "Grafton Street", "St Stephen's Green", "Merrion Square", "Trinity College"} <= names


def test_no_score_is_zero(data):
    scores = [f["index"] for f in data["safety"].values()]
    scores += [n["score"] for f in data["safety"].values() for n in f["neighbourhoods"]]
    assert min(scores) > 15 and max(scores) < 80


def test_phibsborough_matches_the_verified_source_figures(data):
    # Mountjoy station 2023-25 (CSO CJA11) violent = assault 354/441/462 + dangerous acts 88/92/110 + kidnapping
    # 3/3/3; people over a day = (16 h x 27,525 residents, Census 2022 + 8 h x 23,407 daytime, Census 2016, scaled
    # by 2,320,297 / 2,006,641 people at work 2016 -> 2022) / 24 = 27,372.
    ph = next(n for n in data["safety"]["D7"]["neighbourhoods"] if n["name"] == "Phibsborough")
    people = round((16 * 27525 + 8 * 23407 * 2320297 / 2006641) / 24)
    violent = (354 + 441 + 462 + 88 + 92 + 110 + 3 * 3) / 3 / people * 1000
    assert abs(ph["crime_per_1k"]["violent"] - violent) <= 0.05
    # 0.35 x 100 x 11.27/(11.27+20.37) + robbery, burglary and theft, public order and damage the same way
    assert ph["score"] == 36.9 and ph["tier"] == "Higher recorded crime"


def test_glasnevin_is_listed_in_d7_and_d9(data):
    nb = pd.read_csv(recommender.SAFETY_NEIGHBOURHOODS_CSV)
    glas = nb[nb["Neighbourhood"] == "Glasnevin"].set_index("District")
    assert set(glas.index) == {"D7", "D9"}
    assert glas.loc["D7", "Station"] == "mountjoy" and glas.loc["D9", "Station"] == "santry"
    assert "Glasnevin (D7 part)" in {n["name"] for n in data["safety"]["D7"]["neighbourhoods"]}


def test_every_district_lists_its_neighbourhoods_safest_first(data):
    csv = pd.read_csv(recommender.SAFETY_NEIGHBOURHOODS_CSV)
    for area, figures in data["safety"].items():
        names = [n["name"] for n in figures["neighbourhoods"]]
        assert names and set(names) == set(csv.loc[csv["District"] == area, "Label"])
        scores = [n["score"] for n in figures["neighbourhoods"]]
        assert scores == sorted(scores, reverse=True) and all(0 <= s <= 100 for s in scores)


def test_other_factors_come_from_the_context_file(data):
    ctx = pd.read_csv(recommender.SAFETY_CONTEXT_CSV).set_index("District")
    assert data["safety"]["D1"]["lit_streets_pct"] == round(ctx.loc["D1", "lit_share_tagged"] * 100)
    assert data["safety"]["D1"]["night_transit_pct"] == round(ctx.loc["D1", "night_transit_coverage"] * 100)


def test_missing_context_and_neighbourhood_files_leave_those_blank(tmp_path):
    figures = recommender.load_safety(recommender.SAFETY_CSV, str(tmp_path / "a.csv"), str(tmp_path / "b.csv"))["D1"]
    assert figures["lit_streets_pct"] is None and figures["night_transit_pct"] is None
    assert figures["neighbourhoods"] == [] and figures["index"] is not None


def test_other_factors_do_not_change_the_score(tmp_path):
    with_context = recommender.load_safety()
    without = recommender.load_safety(recommender.SAFETY_CSV, str(tmp_path / "missing.csv"))
    assert {a: f["index"] for a, f in with_context.items()} == {a: f["index"] for a, f in without.items()}


def test_missing_safety_file_gives_no_figures(tmp_path):
    assert recommender.load_safety(str(tmp_path / "missing.csv")) == {}


def test_recommendations_carry_their_areas_safety(data):
    out = recommender.recommend(data, UNIVERSITY, 900, "private_room", RATINGS)
    assert out["recommendations"]
    for r in out["recommendations"]:
        assert r["safety"] == data["safety"][r["area"]]


def test_safety_does_not_change_rankings(data):
    without = copy.copy(data)
    without["safety"] = {}
    a = recommender.recommend(data, UNIVERSITY, 900, "private_room", RATINGS)["recommendations"]
    b = recommender.recommend(without, UNIVERSITY, 900, "private_room", RATINGS)["recommendations"]
    assert [(r["area"], r["match_score"]) for r in a] == [(r["area"], r["match_score"]) for r in b]
    assert all(r["safety"] is None for r in b)


def test_recommend_endpoint_returns_safety():
    from app import app
    r = TestClient(app).post("/recommend", json={"university": UNIVERSITY, "budget": 900,
                                                 "accommodation": "private_room", "ratings": RATINGS})
    assert r.status_code == 200, r.text
    assert all(set(rec["safety"]) == FIELDS for rec in r.json()["recommendations"])


def test_every_district_has_a_heat_map_of_scored_areas(data):
    eds = pd.read_csv(recommender.SAFETY_EDS_CSV).set_index("ED_GUID")
    assert set(data["safety_maps"]) == set(data["safety"])
    for area, heat in data["safety_maps"].items():
        features = heat["areas"]["features"]
        assert features and all(0 <= f["properties"]["score"] <= 100 for f in features)
        w, s, e, n = heat["bounds"]
        assert -6.6 < w < e < -6.0 and 53.1 < s < n < 53.7  # D18 reaches the Wicklow border
        assert {p["name"] for p in heat["places"]} == {nb["name"] for nb in data["safety"][area]["neighbourhoods"]}
        assert heat["outline"]["type"] in ("Polygon", "MultiPolygon")
    d7 = {f["properties"]["ed"]: f["properties"]["score"] for f in data["safety_maps"]["D7"]["areas"]["features"]}
    assert d7["Botanic C"] == round(eds.set_index("ED").loc["BOTANIC C", "safety_index_0_100"], 1)
    assert d7["Cabra West A"] > 50 > 40 > d7["Arran Quay B"]


def test_safety_map_endpoint():
    from app import app
    client = TestClient(app)
    r = client.get("/safety-map/d7")
    assert r.status_code == 200 and r.json()["areas"]["type"] == "FeatureCollection"
    assert client.get("/safety-map/D99").status_code == 404
