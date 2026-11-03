#!/usr/bin/env python3
"""Build neighbourhoods.csv: named neighbourhoods inside D1-D24, for neighbourhood safety scores.

Names and locations are OpenStreetMap place points (suburb, neighbourhood, quarter, village, town).
Each neighbourhood is placed in the postal district its point lies in, and in the Garda station area
(official Garda sub-district) its point lies in - the same rule build_station_map.py uses for Census EDs. safety_pipeline.py then gives it that station area's crime rate and its own distance to the
nearest Garda station. Places that straddle districts can also be listed in another district via
EXTRA_PLACEMENTS (needs data/safety/ed_points.csv from build_station_map.py).

Well-known areas OSM doesn't tag as a place (in D2: Grafton Street, St Stephen's Green, Grand Canal Dock...)
are added from EXTRA_PLACES_CSV, a hand-checked list of district, area name and the OSM names to look for.
Each is placed on its OSM feature inside that district: a park, campus or estate outline first, then the
middle of the street, then named points. Names that can't be found inside the district are listed and left out.

Re-run when the OSM extract or the stations change.

Usage
  python build_neighbourhoods.py OSM_PBF STATIONS_GEOJSON DISTRICT_BOUNDARIES_GEOJSON OUT_CSV
"""
import sys

import geopandas as gpd
import pandas as pd
from shapely.ops import linemerge, unary_union

import safety_pipeline as sp
from build_station_map import assign_stations, order, read_districts

PLACE_TYPES = ("suburb", "neighbourhood", "quarter", "village", "town")
EXTRA_PLACES_CSV = "data/safety/extra_places.csv"

# Neighbourhoods that straddle districts: OSM has one point per place, so a place is otherwise listed only in
# the district its point lies in. Each extra placement uses a Census ED that is part of the place and whose
# centre lies in the extra district; the ED's centre and station area stand in for the place there.
EXTRA_PLACEMENTS = [
    # Glasnevin's OSM point is in D9, but the Botanic C ED (part of Glasnevin, 2,362 residents) is in D7.
    {"Neighbourhood": "Glasnevin", "District": "D7", "ED": "BOTANIC C"},
]


def locate_extra_places(pbf, districts, path=EXTRA_PLACES_CSV):
    """ITM points for the hand-listed areas: (rows found, names not found inside their district)."""
    wanted = pd.read_csv(path)
    names = sorted({n for ns in wanted["osm_names"] for n in ns.split("|")})
    where = "name IN (" + ",".join("'" + n.replace("'", "''") + "'" for n in names) + ")"
    layers = {layer: gpd.read_file(pbf, layer=layer, columns=["name"], where=where).to_crs(sp.ITM)
              for layer in ("multipolygons", "lines", "points")}
    found, missing = [], []
    for _, w in wanted.iterrows():
        area = districts.loc[districts["District"] == w["District"], "geometry"].union_all()
        point = None
        for layer in ("multipolygons", "lines", "points"):
            g = layers[layer]
            g = g[g["name"].isin(w["osm_names"].split("|"))]
            g = g[g.geometry.representative_point().within(area)]
            if g.empty:
                continue
            if layer == "multipolygons":
                point = g.loc[g.geometry.area.idxmax(), "geometry"].representative_point()
            elif layer == "lines":
                merged = unary_union(list(g.geometry))
                merged = linemerge(merged) if merged.geom_type == "MultiLineString" else merged
                longest = max(getattr(merged, "geoms", [merged]), key=lambda line: line.length)
                point = longest.interpolate(0.5, normalized=True)
            else:
                point = unary_union(list(g.geometry)).centroid
            break
        if point is None:
            missing.append(f"{w['District']} {w['Neighbourhood']}")
        else:
            found.append({"name": w["Neighbourhood"], "place": "area (hand-listed)", "District": w["District"],
                          "geometry": point})
    return gpd.GeoDataFrame(found, crs=sp.ITM), missing


def main(pbf, stations_path, boundary_path, out_csv):
    where = "name IS NOT NULL AND place IN (" + ",".join(f"'{t}'" for t in PLACE_TYPES) + ")"
    places = gpd.read_file(pbf, layer="points", columns=["name", "place"], where=where).to_crs(sp.ITM)
    places = gpd.sjoin(places, read_districts(boundary_path), predicate="within").drop(columns="index_right")
    places = places.drop_duplicates(["District", "name"]).reset_index(drop=True)
    extra, missing = locate_extra_places(pbf, read_districts(boundary_path))
    if missing:
        print(f"Not found in OSM inside their district (left out): {', '.join(missing)}")
    places = pd.concat([places, extra], ignore_index=True).drop_duplicates(["District", "name"]).reset_index(drop=True)

    st = sp.read_stations_file(stations_path)
    stations = st[~st["key"].isin(sp.CRIME_EXCLUDED)].reset_index(drop=True)
    station = assign_stations(places, stations, sp.read_station_areas())
    wgs = places.to_crs(4326)
    out = pd.DataFrame({"Neighbourhood": places["name"], "Place_Type": places["place"],
                        "District": places["District"], "Station": station,
                        "lon": wgs.geometry.x.round(6), "lat": wgs.geometry.y.round(6)})
    eds = pd.read_csv(sp.CFG["ed_points_csv"]).set_index("ED_ENGLISH")
    extra = []
    for e in EXTRA_PLACEMENTS:
        ed = eds.loc[e["ED"]]
        if ed["District"] != e["District"]:
            raise RuntimeError(f"{e['ED']} is in {ed['District']}, not {e['District']} - check EXTRA_PLACEMENTS")
        extra.append({"Neighbourhood": e["Neighbourhood"], "Place_Type": f"part (ED {e['ED']})",
                      "District": e["District"], "Station": ed["Station"], "lon": ed["lon"], "lat": ed["lat"]})
    out = pd.concat([out, pd.DataFrame(extra)], ignore_index=True)
    out = out.sort_values(["District", "Station", "Neighbourhood"],
                          key=lambda s: s.map(order) if s.name == "District" else s)
    out.to_csv(out_csv, index=False)
    print(f"{len(out)} neighbourhoods in {out['District'].nunique()} districts -> {out_csv}")


if __name__ == "__main__":
    if len(sys.argv) != 5:
        sys.exit(__doc__)
    main(*sys.argv[1:5])
