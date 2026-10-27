"""Tests for the station-level street-crime rates and scores in safety_pipeline.py (CSO CJA07)."""
import geopandas as gpd
import pandas as pd
import pytest

import safety_pipeline as sp

ASSAULT = "Attempts/threats to murder, assaults, harassments and related offences (03)"
ROBBERY = "Robbery, extortion and hijacking offences (06)"
PUBLIC_ORDER = "Public order and other social code offences (13)"
THEFT = "Theft and related offences (08)"
GROUPS = {"robbery_per_100k": ["06"], "public_order_per_100k": ["13"]}


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


def test_street_crime_is_robbery_and_public_order_over_three_years():
    assert sp.CFG["offence_groups"] == {"robbery_per_100k": ["06"], "public_order_per_100k": ["13"]}
    assert sp.CFG["crime_years"] == 3  # assault (03) is left out: it mixes street, domestic and prison incidents


def cja07(rows):
    return pd.DataFrame(rows, columns=["Year", "Garda Station", "Type of Offence", "VALUE"])


def every_district(points):
    """Pad the points with one ED per remaining district, all in station 'a'."""
    rest = [{"Population": 1000, "Station": "a", "District": d}
            for d in sorted(sp.EXPECTED - {p["District"] for p in points if p["District"]})]
    return pd.DataFrame(points + rest)


A, B = "1 A, D.M.R. North Central Division", "2 B, D.M.R. Southern Division"


def rows_for(years):
    rows = []
    for y in years:
        rows += [[y, A, ROBBERY, 10], [y, A, PUBLIC_ORDER, 60], [y, A, ASSAULT, 999], [y, A, THEFT, 999],
                 [y, B, ROBBERY, 2], [y, B, PUBLIC_ORDER, 8]]
    return rows


def base_rows():
    return rows_for([2023, 2024, 2025])


def test_district_rate_is_resident_weighted_over_station_areas():
    points = every_district([
        {"Population": 1000, "Station": "a", "District": "D1"},
        {"Population": 3000, "Station": "b", "District": "D1"},
        {"Population": 1000, "Station": "b", "District": None},  # outside D1-D24 but in b's area
    ])
    out, stations = sp.crime_from_stations(cja07(base_rows()), points, GROUPS)
    rates = stations.set_index("station")
    a_residents = points.loc[points["Station"] == "a", "Population"].sum()
    assert rates.loc["a", "robbery_per_100k"] == round(10 / a_residents * 1e5, 1)   # assault and theft ignored
    assert rates.loc["b", "public_order_per_100k"] == round(8 / 4000 * 1e5, 1)      # includes the resident outside D1-D24
    d1 = out.set_index("District").loc["D1", "robbery_per_100k"]
    assert d1 == pytest.approx((1000 * 10 / a_residents * 1e5 + 3000 * 2 / 4000 * 1e5) / 4000)
    assert out["crime_reference_period"].iloc[0] == "2023-2025 average"


def test_rates_use_residents_plus_daytime_population():
    points = every_district([{"Population": 1000, "Station": "b", "District": "D1"}])
    a_res = points.loc[points["Station"] == "a", "Population"].sum()
    out, stations = sp.crime_from_stations(cja07(base_rows()), points, GROUPS, daytime={"a": 3 * a_res, "b": 1000})
    st = stations.set_index("station")
    assert st.loc["a", "people_in_area"] == round((a_res + 3 * a_res) / 2)
    assert st.loc["a", "robbery_per_100k"] == round(10 / (2 * a_res) * 1e5, 1)       # busy area: rate halves
    assert st.loc["b", "robbery_per_100k"] == round(2 / 1000 * 1e5, 1)               # daytime = residents: unchanged
    assert out["dublin_robbery_per_100k"].iloc[0] == round((10 + 2) / (2 * a_res + 1000) * 1e5, 1)


def test_latest_years_with_figures_are_used():
    rows = rows_for([2022, 2023, 2024]) + [[2025, A, ROBBERY, None], [2025, B, ROBBERY, None]]
    points = every_district([{"Population": 1000, "Station": "b", "District": "D1"}])
    out, _ = sp.crime_from_stations(cja07(rows), points, GROUPS)
    assert out["crime_reference_period"].iloc[0] == "2022-2024 average"


def test_station_area_without_cso_figures_is_an_error():
    points = every_district([{"Population": 1000, "Station": "c", "District": "D1"}])
    with pytest.raises(RuntimeError, match="No CSO figures for station areas"):
        sp.crime_from_stations(cja07(base_rows()), points, GROUPS)


def test_non_dublin_stations_are_ignored():
    rows = base_rows() + [[2025, "35301 Abbeyfeale, Limerick Division", ROBBERY, 500]]
    points = every_district([{"Population": 1000, "Station": "b", "District": "D1"}])
    _, stations = sp.crime_from_stations(cja07(rows), points, GROUPS)
    assert set(stations["station"]) == {"a", "b"}


def test_dublin_scale_fifty_is_average_and_doubling_costs_25():
    s = sp.dublin_scale(pd.Series([100.0, 200.0, 50.0, 400.0, 1e6, 0.0]), 100.0)
    assert s.tolist() == [50.0, 25.0, 75.0, 0.0, 0.0, 100.0]


def test_neighbourhoods_take_their_station_rates_and_are_scored(tmp_path, monkeypatch):
    store = sp.Store(tmp_path)
    nb_csv = tmp_path / "neighbourhoods.csv"
    pd.DataFrame({"Neighbourhood": ["Quiet", "Busy", "Middle"], "District": ["D1", "D1", "D2"],
                  "Station": ["a", "b", "a"], "lon": [0, 0, 0], "lat": [0, 0, 0]}).to_csv(nb_csv, index=False)
    pd.DataFrame({"station": ["a", "b"], "robbery_per_100k": [50.0, 700.0],
                  "public_order_per_100k": [300.0, 9000.0]}).to_csv(tmp_path / "crime_by_station.csv", index=False)
    pd.DataFrame({"District": ["D1", "D1", "D2"], "Neighbourhood": ["Quiet", "Busy", "Middle"],
                  "garda_nearest_km": [0.5, 0.5, 2.0]}).to_csv(store.path("garda_neighbourhoods"), index=False)
    monkeypatch.setitem(sp.CFG, "neighbourhoods_csv", str(nb_csv))
    sp.compose_neighbourhoods(store, {"robbery_per_100k": 100.0, "public_order_per_100k": 1000.0, "garda_nearest_km": 1.0})
    out = pd.read_csv(tmp_path / "safety_neighbourhoods.csv").set_index("Neighbourhood")
    assert out.loc["Busy", "robbery_per_100k"] == 700.0 and out.loc["Quiet", "public_order_per_100k"] == 300.0
    assert out.loc["Quiet", "safety_index_0_100"] > out.loc["Middle", "safety_index_0_100"] > out.loc["Busy", "safety_index_0_100"]


def test_eds_take_their_station_rates_and_own_garda_distance(tmp_path, monkeypatch):
    store = sp.Store(tmp_path)
    pd.DataFrame({"ED_GUID": ["e1", "e2"], "ED_ENGLISH": ["ONE", "TWO"], "Station": ["a", "b"], "District": ["D1", None],
                  "Population": [1, 1], "lon": [0, 0], "lat": [0, 0]}).to_csv(tmp_path / "ed.csv", index=False)
    monkeypatch.setattr(sp, "load_ed_points", lambda: pd.read_csv(tmp_path / "ed.csv"))
    pd.DataFrame({"station": ["a", "b"], "robbery_per_100k": [100.0, 400.0],
                  "public_order_per_100k": [1000.0, 4000.0]}).to_csv(tmp_path / "crime_by_station.csv", index=False)
    pd.DataFrame({"ED_GUID": ["e1", "e2"], "garda_nearest_km": [1.0, 1.0]}).to_csv(store.path("garda_eds"), index=False)
    sp.compose_eds(store, {"robbery_per_100k": 100.0, "public_order_per_100k": 1000.0, "garda_nearest_km": 1.0})
    out = pd.read_csv(tmp_path / "safety_eds.csv").set_index("ED")
    assert out.loc["ONE", "safety_index_0_100"] == 50.0   # Dublin average on every factor
    assert out.loc["TWO", "safety_index_0_100"] == 50 - 0.85 * 50  # 4x the average crime: crime factors score 0


def test_neighbourhoods_skipped_without_inputs(tmp_path, monkeypatch):
    monkeypatch.setitem(sp.CFG, "neighbourhoods_csv", str(tmp_path / "missing.csv"))
    sp.compose_neighbourhoods(sp.Store(tmp_path), {})
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
