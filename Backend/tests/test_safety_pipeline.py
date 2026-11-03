"""Tests for the crime scores in safety_pipeline.py (CSO CJA11 rates against the Irish town and city rate)."""
import geopandas as gpd
import pandas as pd
import pytest

import safety_pipeline as sp

ASSAULT = "Attempts/threats to murder, assaults, harassments and related offences (03)"
ROBBERY = "Robbery, extortion and hijacking offences (06)"
PUBLIC_ORDER = "Public order and other social code offences (13)"
THEFT = "Theft and related offences (08)"
TRAFFIC = "Road and traffic offences (14)"
OTHER_GROUPS = [f"Other offences ({c})" for c in ("04", "05", "07", "12")]


@pytest.mark.parametrize("label, key", [
    ("62301 Store Street, D.M.R. North Central Division", "store street"),
    ("62101 Bridewell Dublin, D.M.R. North Central Division", "bridewell"),
    ("65101 Blackrock, Co Dublin, D.M.R. Eastern Division", "blackrock"),
    ("64102 Sundrive Road, D.M.R. Southern Division", "sundrive"),
    ("65203 Dun Laoghaire, D.M.R. Eastern Division", "dun laoghaire"),
])
def test_cso_station_key_matches_map_station_names(label, key):
    assert sp.cso_station_key(label) == key
    assert key in sp.STATION_DIVISION


def test_crime_groups_weights_and_three_years():
    assert sp.CFG["categories"] == {"violent": ["03", "04", "05"], "robbery": ["06"], "burglary_theft": ["07", "08"],
                                    "public_order": ["13"], "damage": ["12"]}
    assert sp.CFG["category_weights"] == {"violent": 0.35, "robbery": 0.25, "burglary_theft": 0.20,
                                          "public_order": 0.15, "damage": 0.05}
    assert sp.CFG["crime_years"] == 3


@pytest.mark.parametrize("label, code", [("62101 Bridewell Dublin, D.M.R. North Central Division", "62101"),
                                         ("Bridewell Dublin, D.M.R. North Central Division (62101)", "62101")])
def test_station_code_and_key_from_cja07_and_cja11_labels(label, code):
    assert sp.cso_station_code(label) == code and sp.cso_station_key(label) == "bridewell"


def cja11(rows):
    return pd.DataFrame(rows, columns=["Year", "Garda Station", "Type of Offence", "VALUE"])


A, B = "A, D.M.R. North Central Division (1)", "B, D.M.R. North Central Division (2)"
TOWNS = [f"Town{i}, Cork City Division ({9 + i})" for i in range(4)]


def rows_for(years):
    rows = []
    for y in years:
        rows += [[y, A, ROBBERY, 10], [y, A, PUBLIC_ORDER, 60], [y, A, TRAFFIC, 999], [y, B, ROBBERY, 2]]
        rows += [[y, t, ROBBERY, i + 1] for i, t in enumerate(TOWNS)]
        rows += [[y, t, code, 1 if t in TOWNS else 0] for t in TOWNS + [A, B] for code in (ASSAULT, THEFT, *OTHER_GROUPS)]
        rows += [[y, t, PUBLIC_ORDER, 1 if t in TOWNS else 0] for t in TOWNS + [B]]
    return rows


def national():
    return pd.DataFrame({"code": ["9", "10", "11", "12", "1", "2"], "division": ["Cork City"] * 4 + ["DMR NC"] * 2,
                         "residents": [20000] * 4 + [99, 99], "daytime": [20000] * 4 + [3000, 1000]})


POINTS = pd.DataFrame({"Station": ["a", "a", "b"], "Population": [500, 500, 1000], "District": ["D1", None, "D1"]})


@pytest.fixture
def no_prisons(monkeypatch):
    monkeypatch.setitem(sp.CFG, "custody_stations", {})


def test_rates_are_per_1000_people_present_over_a_day(no_prisons):
    st, ref, period = sp.station_scores(cja11(rows_for([2023, 2024, 2025])), national(), POINTS)
    st = st.set_index("station")
    assert period == "2023-2025 average"
    assert st.loc["a", "residents"] == 1000                      # Dublin: residents of its EDs, not the national file
    people = round((16 * 1000 + 8 * 3000 * sp.CFG["daytime_scale"]) / 24)   # 16 h residents, 8 h daytime (scaled)
    assert st.loc["a", "people"] == people
    assert st.loc["a", "robbery_per_1k"] == pytest.approx(10 / people * 1000)   # traffic is ignored
    town_people = 4 * round((16 * 20000 + 8 * 20000 * sp.CFG["daytime_scale"]) / 24)
    assert ref["robbery"] == pytest.approx((1 + 2 + 3 + 4) / town_people * 1000)   # Irish reference: town stations only


def test_score_is_50_at_the_reference_and_never_0_or_100():
    assert list(sp.reference_score([1, 0.5, 2, 1000, 0], 1)) == pytest.approx([50, 100 / 1.5, 100 / 3, 100 / 1001, 100])
    assert sp.reference_score(1e9, 1) > 0


def test_station_score_is_the_weighted_group_scores(no_prisons):
    st, ref, _ = sp.station_scores(cja11(rows_for([2023, 2024, 2025])), national(), POINTS)
    a = st.set_index("station").loc["a"]
    expected = sum(w * 100 * ref[c] / (ref[c] + a[f"{c}_per_1k"]) for c, w in sp.CFG["category_weights"].items())
    assert a["score"] == pytest.approx(expected)
    assert st.set_index("station").loc["b", "score"] > a["score"]      # b has less crime per person


def test_latest_years_with_figures_are_used(no_prisons):
    rows = rows_for([2022, 2023, 2024]) + [[2025, A, ROBBERY, None], [2025, B, ROBBERY, None]]
    _, _, period = sp.station_scores(cja11(rows), national(), POINTS)
    assert period == "2022-2024 average"


def test_station_area_without_cso_figures_is_an_error(no_prisons):
    points = pd.concat([POINTS, pd.DataFrame({"Station": ["c"], "Population": [10], "District": ["D2"]})])
    with pytest.raises(RuntimeError, match="No CSO figures for station areas"):
        sp.station_scores(cja11(rows_for([2023, 2024, 2025])), national(), points)


def test_prison_station_is_capped_at_its_divisions_highest_other_station(monkeypatch):
    monkeypatch.setitem(sp.CFG, "custody_stations", {"a": "a prison"})
    monkeypatch.setitem(sp.CFG, "custody_categories", ["robbery"])
    st = sp.station_scores(cja11(rows_for([2023, 2024, 2025])), national(), POINTS)[0].set_index("station")
    assert st.loc["a", "robbery_per_1k"] == st.loc["b", "robbery_per_1k"]
    assert st.loc["a", "public_order_per_1k"] == pytest.approx(60 / st.loc["a", "people"] * 1000)   # other groups untouched


@pytest.mark.parametrize("score, name", [(57, "Lower recorded crime"), (56.96, "Below-benchmark crime"),
                                         (50, "Below-benchmark crime"), (49.8, "Above-benchmark crime"),
                                         (40, "Above-benchmark crime"), (39.99, "Higher recorded crime"),
                                         (5, "Higher recorded crime")])
def test_bands(score, name):
    assert sp.tier(score) == name


STATIONS = pd.DataFrame({"station": ["a", "b"], "score": [45.0, 62.0],
                         **{f"{c}_per_1k": [1.0, 2.0] for c in sp.CFG["categories"]}})


def test_areas_take_their_station_areas_score():
    out = sp.area_scores(pd.DataFrame({"Station": ["a", "b"]}), STATIONS)
    assert list(out["safety_index_0_100"]) == [45, 62]
    assert list(out["tier"]) == ["Above-benchmark crime", "Lower recorded crime"]


def test_neighbourhoods_take_their_station_areas_score(tmp_path, monkeypatch):
    store = sp.Store(tmp_path)
    nb_csv = tmp_path / "neighbourhoods.csv"
    pd.DataFrame({"Neighbourhood": ["X", "Y"], "District": ["D1", "D1"], "Station": ["a", "b"],
                  "lon": [0, 0], "lat": [0, 0]}).to_csv(nb_csv, index=False)
    pd.DataFrame({"District": ["D1", "D1"], "Neighbourhood": ["X", "Y"],
                  "garda_nearest_km": [0.5, 0.5]}).to_csv(store.path("garda_neighbourhoods"), index=False)
    monkeypatch.setitem(sp.CFG, "neighbourhoods_csv", str(nb_csv))
    sp.compose_neighbourhoods(store, STATIONS)
    out = pd.read_csv(tmp_path / "safety_neighbourhoods.csv").set_index("Neighbourhood")
    assert out.loc["X", "safety_index_0_100"] == 45.0 and out.loc["Y", "tier"] == "Lower recorded crime"
    assert list(out["Label"]) == ["X", "Y"]          # unique names keep their name


def test_compose_publishes_resident_weighted_districts(tmp_path, monkeypatch):
    store = sp.Store(tmp_path)
    eds = pd.DataFrame({"ED_GUID": [f"e{i}" for i in range(len(sp.EXPECTED) + 1)],
                        "ED_ENGLISH": ["X"] * (len(sp.EXPECTED) + 1),
                        "Population": [1000] * len(sp.EXPECTED) + [3000],
                        "Station": ["a"] * len(sp.EXPECTED) + ["b"],
                        "District": sorted(sp.EXPECTED) + ["D1"], "lon": 0, "lat": 0})
    monkeypatch.setattr(sp, "load_ed_points", lambda: eds)
    monkeypatch.setitem(sp.CFG, "neighbourhoods_csv", str(tmp_path / "none.csv"))
    STATIONS.assign(people=1, years="2023-2025 average", **{f"ireland_{c}_per_1k": 3.0 for c in sp.CFG["categories"]}).to_csv(
        tmp_path / "crime_by_station.csv", index=False)
    sp.compose(store)
    out = pd.read_csv(tmp_path / "safety_indicators.csv").set_index("District")
    assert set(out.index) == sp.EXPECTED
    assert out.loc["D1", "safety_index_0_100"] == round((1000 * 45 + 3000 * 62) / 4000, 1)
    assert out.loc["D1", "main_station"] == "b" and out.loc["D1", "main_station_share"] == 0.75
    shares = pd.read_csv(tmp_path / "district_station_shares.csv")
    d1 = shares[shares["District"] == "D1"]
    assert (d1["share"] * d1["station_score"]).sum() == pytest.approx(out.loc["D1", "safety_index_0_100"], abs=0.05)
    assert out.loc["D2", "tier"] == "Above-benchmark crime" and out.loc["D2", "ireland_violent_per_1k"] == 3.0
    assert len(pd.read_csv(tmp_path / "safety_eds.csv")) == len(eds)


def test_old_station_file_is_not_published(tmp_path):
    pd.DataFrame({"station": ["a"], "robbery_per_100k": [1.0]}).to_csv(tmp_path / "crime_by_station.csv", index=False)
    with pytest.raises(RuntimeError, match="older method"):
        sp.compose(sp.Store(tmp_path))


def test_street_check_flags_disadvantaged_areas_only(tmp_path, monkeypatch):
    dep = tmp_path / "dep.csv"
    pd.DataFrame({"kind": ["ed", "ed", "neighbourhood"], "id": ["e1", "e2", "D1|X"],
                  "pobal_index": [-15, 3, -25], "pobal_category": ["Disadvantaged", "Marginally Above Average",
                                                                  "Very Disadvantaged"]}).to_csv(dep, index=False)
    monkeypatch.setitem(sp.CFG, "area_deprivation_csv", str(dep))
    out = sp.add_street_check(pd.DataFrame({"ED_GUID": ["e1", "e2", "e3"]}), "ed", "ED_GUID")
    assert list(out["check_street"]) == [True, False, False]
    monkeypatch.setitem(sp.CFG, "area_deprivation_csv", str(tmp_path / "missing.csv"))
    assert not sp.add_street_check(pd.DataFrame({"ED_GUID": ["e1"]}), "ed", "ED_GUID")["check_street"].any()


def test_manual_overrides_replace_scores_and_bands(tmp_path, monkeypatch):
    o = tmp_path / "o.csv"
    pd.DataFrame({"kind": ["district", "ed"], "id": ["D1", "e1"], "score": [25.1, 19.4]}).to_csv(o, index=False)
    monkeypatch.setitem(sp.CFG, "manual_overrides_csv", str(o))
    df = pd.DataFrame({"District": ["D1", "D2"], "safety_index_0_100": [50.0, 60.0]})
    out = sp.apply_overrides(df, "district", df["District"])
    assert list(out["safety_index_0_100"]) == [25.1, 60.0]
    assert list(out["tier"]) == ["Higher recorded crime", "Lower recorded crime"]
    monkeypatch.setitem(sp.CFG, "manual_overrides_csv", str(tmp_path / "missing.csv"))
    assert sp.apply_overrides(df, "district", df["District"]).equals(df)


def test_neighbourhoods_skipped_without_inputs(tmp_path, monkeypatch):
    monkeypatch.setitem(sp.CFG, "neighbourhoods_csv", str(tmp_path / "missing.csv"))
    sp.compose_neighbourhoods(sp.Store(tmp_path), STATIONS)
    assert not (tmp_path / "safety_neighbourhoods.csv").exists()


def test_excluded_stations_are_known_stations():
    assert set(sp.CRIME_EXCLUDED) <= set(sp.STATION_DIVISION)


def test_official_station_areas_cover_every_cja07_dublin_station():
    areas = sp.read_station_areas()
    if areas is None:
        pytest.skip("Garda sub-district boundaries not downloaded (data/raw is git-ignored)")
    assert len(areas) == 41 and areas["key"].is_unique
    assert set(areas["key"]) <= set(sp.STATION_DIVISION)        # every area is a known CSO station
    assert "dublin airport" in set(areas["key"])               # "Airport" in the boundary file


def test_points_take_the_station_area_they_lie_in():
    from shapely.geometry import Point, box
    areas = gpd.GeoDataFrame({"key": ["raheny", "coolock"]}, geometry=[box(0, 0, 10, 10), box(10, 0, 20, 10)], crs=sp.ITM)
    pts = gpd.GeoDataFrame(geometry=[Point(5, 5), Point(15, 5), Point(25, 5)], crs=sp.ITM)
    assert list(sp.station_area_of(pts, areas)) == ["raheny", "coolock", "coolock"]   # last one: nearest area
