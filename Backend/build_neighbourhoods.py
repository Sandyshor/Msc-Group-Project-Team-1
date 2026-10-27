#!/usr/bin/env python3
"""Build neighbourhoods.csv: named neighbourhoods inside D1-D24, for neighbourhood safety scores.

Names and locations are OpenStreetMap place points (suburb, neighbourhood, quarter, village, town).
Each neighbourhood is placed in the postal district its point lies in, and in the Garda station area
(official Garda sub-district) its point lies in - the same rule build_station_map.py uses for Census EDs. safety_pipeline.py then gives it that station area's crime rate and its own distance to the
nearest Garda station. Places that straddle districts can also be listed in another district via
EXTRA_PLACEMENTS (needs data/safety/ed_points.csv from build_station_map.py).

Re-run when the OSM extract or the stations change.

Usage
  python build_neighbourhoods.py OSM_PBF STATIONS_GEOJSON DISTRICT_BOUNDARIES_GEOJSON OUT_CSV
"""
import sys

import geopandas as gpd
import pandas as pd

import safety_pipeline as sp
from build_station_map import assign_stations, order, read_districts

PLACE_TYPES = ("suburb", "neighbourhood", "quarter", "village", "town")

# Neighbourhoods that straddle districts: OSM has one point per place, so a place is otherwise listed only in
# the district its point lies in. Each extra placement uses a Census ED that is part of the place and whose
# centre lies in the extra district; the ED's centre and station area stand in for the place there.
EXTRA_PLACEMENTS = [
    # Glasnevin's OSM point is in D9, but the Botanic C ED (part of Glasnevin, 2,362 residents) is in D7.
    {"Neighbourhood": "Glasnevin", "District": "D7", "ED": "BOTANIC C"},
]


def main(pbf, stations_path, boundary_path, out_csv):
    where = "name IS NOT NULL AND place IN (" + ",".join(f"'{t}'" for t in PLACE_TYPES) + ")"
    places = gpd.read_file(pbf, layer="points", columns=["name", "place"], where=where).to_crs(sp.ITM)
    places = gpd.sjoin(places, read_districts(boundary_path), predicate="within").drop(columns="index_right")
    places = places.drop_duplicates(["District", "name"]).reset_index(drop=True)

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
