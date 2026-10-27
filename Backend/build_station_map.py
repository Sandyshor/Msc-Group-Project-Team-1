#!/usr/bin/env python3
"""Build ed_points.csv: every Dublin Electoral Division (ED) with its residents, Garda station area and district.

Method
  1. Census 2022 population per ED (CSO Small Area Population Statistics).
  2. Each ED belongs to the Garda station area its centre lies in: the official Garda sub-districts (CSO
     Census 2011 boundary files, Nov 2013 - one per station, matching the stations CJA07 reports crime for;
     safety_pipeline.CFG["sub_districts_shp"]). Without that file, the fallback is the nearest Garda station
     on the SAME BANK of the Liffey, leaving out stations without their own CSO figures
     (safety_pipeline.CRIME_EXCLUDED).
  3. Each ED is placed in the postal district its centre lies in (blank outside D1-D24).

safety_pipeline.py turns this into crime rates per station area and per district, and uses the ED
centres for the population-weighted distance to the nearest Garda station.

With the optional Census 2016 Workplace Zones shapefile, it also writes station_daytime.csv next to
OUT_CSV: each station area's daytime population (people working or studying there), so busy areas
where few people live aren't judged on residents alone.

Usage
  python build_station_map.py ED_BOUNDARIES SAPS_CSV STATIONS_GEOJSON DISTRICT_BOUNDARIES_GEOJSON OUT_CSV [WORKPLACE_ZONES_SHP]
"""
import re
import sys
from pathlib import Path

import geopandas as gpd
import pandas as pd

import safety_pipeline as sp

DUBLIN_WORDS = ("dublin", "fingal", "dún laoghaire", "dun laoghaire", "rathdown")


def pick(cols, *needles, exact=None):
    if exact and exact in cols:
        return exact
    for n in needles:
        for c in cols:
            if n in c.lower():
                return c
    raise RuntimeError(f"Could not find a column like {needles} in {list(cols)}")


def read_csv_any(path, **kw):
    for enc in ("utf-8", "cp1252", "latin-1"):
        try:
            return pd.read_csv(path, encoding=enc, **kw)
        except UnicodeDecodeError:
            continue
    raise RuntimeError(f"Could not decode {path}")


def load_dublin_eds(ed_path, saps_path, log=print):
    """Dublin EDs (ITM polygons) with their Census population column. Returns (eds, population_column)."""
    if str(ed_path).lower().endswith(".csv"):
        raise RuntimeError("The boundary file is a CSV (attributes only, no coordinates). Download the Electoral Division "
                           "boundaries as GeoJSON or Shapefile instead.")
    ed = gpd.read_file(ed_path)
    saps = read_csv_any(saps_path)
    pop_col = pick(saps.columns, "t1_1agett", "agett", exact="T1_1AGETT")
    # find the join key: any boundary column whose values match SAPS GUID/GEOGID
    best = (0, None, None)
    for bcol in [c for c in ed.columns if c != "geometry"]:
        vals = set(ed[bcol].astype(str))
        for scol in ("GUID", "GEOGID"):
            if scol in saps.columns:
                n = len(vals & set(saps[scol].astype(str)))
                if n > best[0]:
                    best = (n, bcol, scol)
    if best[1] is None or best[0] < 0.9 * len(ed):
        raise RuntimeError(f"No boundary column matches SAPS GUID/GEOGID (best overlap {best[0]} of {len(ed)} EDs). "
                           f"Boundary columns: {list(ed.columns)}")
    key_b, key_s = best[1], best[2]
    df = ed.merge(saps[[key_s, pop_col]].rename(columns={key_s: key_b}), on=key_b, how="inner")
    log(f"EDs in boundary file: {len(ed)}; matched to SAPS via {key_b}={key_s}: {len(df)}; population column: {pop_col}")

    df = (df.set_crs(4326) if df.crs is None else df).to_crs(sp.ITM)
    county_col = next((c for c in df.columns if any(k in c.lower() for k in ("county", "contae"))
                       and df[c].astype(str).str.lower().str.contains("|".join(DUBLIN_WORDS)).any()), None)
    if county_col is None:
        raise RuntimeError("No county column in the boundary file to pick out Dublin EDs")
    df = df[df[county_col].astype(str).str.lower().apply(lambda v: any(w in v for w in DUBLIN_WORDS))]
    log(f"Dublin EDs (column '{county_col}'): {len(df)}, {int(df[pop_col].sum()):,} residents")
    return df, pop_col


def read_districts(boundary_path):
    b = gpd.read_file(boundary_path)
    b = (b.set_crs(4326) if b.crs is None else b).to_crs(sp.ITM)
    label_col = next(c for c in b.columns if c != "geometry"
                     and b[c].astype(str).map(sp.norm_district).notna().mean() > 0.8)
    b["District"] = b[label_col].map(sp.norm_district)
    return b.dropna(subset=["District"])[["District", "geometry"]]


def order(d):
    return (int(re.sub(r"\D", "", d)), d)


def assign_stations(pts, stations, areas):
    """Station area key for each point: the official sub-district it's in, or the nearest-station fallback."""
    if areas is not None:
        return sp.station_area_of(pts, areas)
    idx, _, _, _ = sp.nearest_station_same_side(pts, stations)
    return stations["key"].values[idx]


def write_station_daytime(wpz_path, stations, areas, out_csv):
    """Census 2016 daytime population (T11_T: workers + students in the zone) per Garda station area."""
    w = gpd.read_file(wpz_path, columns=["COUNTYNAME", "T11_T"])
    w = (w.set_crs(sp.ITM) if w.crs is None else w).to_crs(sp.ITM)
    w = w[w["COUNTYNAME"].str.lower().apply(lambda v: any(x in v for x in DUBLIN_WORDS))].copy()
    w["geometry"] = w.geometry.representative_point()
    w["Station"] = assign_stations(w, stations, areas)
    out = w.groupby("Station")["T11_T"].sum().astype(int).rename("daytime_population").reset_index()
    out["source"] = "Census 2016 Workplace Zones (T11_T)"
    out.to_csv(out_csv, index=False)
    print(f"Daytime population: {len(w)} Dublin workplace zones, {int(w['T11_T'].sum()):,} people -> {out_csv}")


def main(ed_path, saps_path, stations_path, boundary_path, out_csv, wpz_path=None):
    st = sp.read_stations_file(stations_path)
    stations = st[~st["key"].isin(sp.CRIME_EXCLUDED)].reset_index(drop=True)
    areas = sp.read_station_areas()
    print(f"Station areas: {'official Garda sub-districts (' + str(len(areas)) + ')' if areas is not None else 'nearest station (fallback)'}")
    if wpz_path:
        write_station_daytime(wpz_path, stations, areas, str(Path(out_csv).with_name("station_daytime.csv")))
    eds, pop_col = load_dublin_eds(ed_path, saps_path)

    centres = eds.copy()
    centres["geometry"] = eds.geometry.centroid
    centres["Station"] = assign_stations(centres, stations, areas)
    centres = gpd.sjoin(centres, read_districts(boundary_path), predicate="within", how="left").drop_duplicates("ED_GUID")
    missing = sorted(sp.EXPECTED - set(centres["District"].dropna()))
    if missing:
        raise RuntimeError(f"No ED centres fall inside districts {missing} - check the boundary file")

    wgs = centres.to_crs(4326)
    out = pd.DataFrame({"ED_GUID": centres["ED_GUID"], "ED_ENGLISH": centres["ED_ENGLISH"],
                        "Population": centres[pop_col].astype(int), "Station": centres["Station"],
                        "District": centres["District"], "lon": wgs.geometry.x.round(6), "lat": wgs.geometry.y.round(6)})
    out.sort_values(["Station", "ED_ENGLISH"]).to_csv(out_csv, index=False)

    in_districts = out.dropna(subset=["District"])
    share = (in_districts.groupby(["District", "Station"])["Population"].sum()
             / in_districts.groupby("District")["Population"].sum()).round(2)
    print(f"{out['Station'].nunique()} station areas; {len(out)} EDs, {len(in_districts)} inside D1-D24")
    for d in sorted(sp.EXPECTED, key=order):
        parts = share[d].sort_values(ascending=False)
        print(f"  {d:4s} " + ", ".join(f"{s} {w:.0%}" for s, w in parts.items()))
    print(f"\nWrote {out_csv}")


if __name__ == "__main__":
    if len(sys.argv) not in (6, 7):
        sys.exit(__doc__)
    main(*sys.argv[1:7])
