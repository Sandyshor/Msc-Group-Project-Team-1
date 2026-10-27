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
FIELDS = {"index", "robbery_per_100k", "public_order_per_100k", "dublin_robbery_per_100k",
          "dublin_public_order_per_100k", "crime_period", "garda_nearest_km", "lit_streets_pct", "night_transit_pct",
          "neighbourhoods"}


@pytest.fixture(scope="module")
def data():
    return recommender.load_data()


def test_every_district_has_safety_figures(data):
    assert set(data["safety"]) >= set(recommender.AREAS)
    for figures in data["safety"].values():
        assert set(figures) == FIELDS
        assert 0 <= figures["index"] <= 100
        assert 0 <= figures["lit_streets_pct"] <= 100 and 0 <= figures["night_transit_pct"] <= 100
        assert figures["robbery_per_100k"] > 0 and figures["public_order_per_100k"] > 0 and figures["garda_nearest_km"] > 0
        assert figures["crime_period"] == "2023-2025 average"


def test_figures_match_the_pipeline_output(data):
    csv = pd.read_csv(recommender.SAFETY_CSV).set_index("District")
    d7 = data["safety"]["D7"]
    assert d7["index"] == round(csv.loc["D7", "safety_index_0_100"], 1)
    assert d7["robbery_per_100k"] == round(csv.loc["D7", "robbery_per_100k"])
    assert d7["public_order_per_100k"] == round(csv.loc["D7", "public_order_per_100k"])
    assert d7["garda_nearest_km"] == round(csv.loc["D7", "garda_nearest_km"], 1)


def test_d7_scores(data):
    assert data["safety"]["D7"]["index"] == 39.8
    got = [(n["name"], round(n["score"])) for n in data["safety"]["D7"]["neighbourhoods"]]
    assert got == [("Cabra West", 64), ("Cabra", 63), ("Ashtown", 59), ("Phibsborough", 46), ("Glasnevin", 44),
                   ("Cabra East", 39), ("Smithfield", 32), ("Stoneybatter", 28), ("Grangegorman", 27), ("Oxmantown", 27)]


def test_phibsborough_matches_the_verified_source_figures(data):
    # Mountjoy station 2023-25 (CSO CJA07): robbery 32/35/39, public order 224/318/327.
    # Mountjoy's official Garda sub-district: 27,525 residents (Census 2022) and 23,407 daytime population
    # (Census 2016); people in area = (27,525 + 23,407) / 2.
    people = (27525 + 23407) / 2
    ph = next(n for n in data["safety"]["D7"]["neighbourhoods"] if n["name"] == "Phibsborough")
    # within 1: the pipeline stores rates to one decimal before the API rounds them
    assert abs(ph["robbery_per_100k"] - (32 + 35 + 39) / 3 / people * 1e5) <= 1
    assert abs(ph["public_order_per_100k"] - (224 + 318 + 327) / 3 / people * 1e5) <= 1
    assert ph["score"] == 45.6  # hand-computed against the Dublin averages (robbery 93.2, public order 787.9)


def test_glasnevin_is_listed_in_d7_and_d9(data):
    nb = pd.read_csv(recommender.SAFETY_NEIGHBOURHOODS_CSV)
    glas = nb[nb["Neighbourhood"] == "Glasnevin"].set_index("District")
    assert set(glas.index) == {"D7", "D9"}
    assert glas.loc["D7", "Station"] == "mountjoy" and glas.loc["D9", "Station"] == "santry"
    assert "Glasnevin" in {n["name"] for n in data["safety"]["D7"]["neighbourhoods"]}


def test_every_district_lists_its_neighbourhoods_safest_first(data):
    csv = pd.read_csv(recommender.SAFETY_NEIGHBOURHOODS_CSV)
    for area, figures in data["safety"].items():
        names = [n["name"] for n in figures["neighbourhoods"]]
        assert names and set(names) == set(csv.loc[csv["District"] == area, "Neighbourhood"])
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
    assert d7["Cabra West A"] > 60 > 40 > d7["Arran Quay B"]


def test_safety_map_endpoint():
    from app import app
    client = TestClient(app)
    r = client.get("/safety-map/d7")
    assert r.status_code == 200 and r.json()["areas"]["type"] == "FeatureCollection"
    assert client.get("/safety-map/D99").status_code == 404
