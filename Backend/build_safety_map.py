#!/usr/bin/env python3
"""Build safety_map_areas.geojson: the shapes for the safety heat map on each Results card.

Each Census 2022 Electoral Division (ED) is cut along the postal-district boundaries, so every district is
fully covered by ED pieces. Each piece keeps its ED_GUID; safety_pipeline.py scores the EDs
(safety_eds.csv), and the backend joins the two. Only shapes live here, so the weekly refresh never needs
the 264 MB ED file.

It also writes the district outlines next to it (safety_map_districts.geojson), which the map uses to fade out
the rest of Dublin.

Re-run when the ED or district boundaries change (needs data/safety/ed_points.csv from build_station_map.py).

Usage
  python build_safety_map.py ED_BOUNDARIES_GEOJSON DISTRICT_BOUNDARIES_GEOJSON OUT_GEOJSON
"""
import sys
from pathlib import Path

import geopandas as gpd
import pandas as pd
import shapely

import safety_pipeline as sp
from build_station_map import order, read_districts

MIN_PIECE_M2 = 20_000   # drop slivers under 2 ha left where the ED and district boundaries disagree slightly
SIMPLIFY_M = 8          # simplify outlines to ~8 m: invisible at district zoom, keeps the file small


def main(ed_path, boundary_path, out_path):
    eds = pd.read_csv(sp.CFG["ed_points_csv"])
    ed = gpd.read_file(ed_path, columns=["ED_GUID"])
    ed = ed[ed["ED_GUID"].isin(eds["ED_GUID"])]
    ed = (ed.set_crs(4326) if ed.crs is None else ed).to_crs(sp.ITM)
    ed["geometry"] = ed.geometry.make_valid()

    districts = read_districts(boundary_path).dissolve("District", as_index=False)
    pieces = gpd.overlay(ed, districts, how="intersection", keep_geom_type=True)
    pieces = pieces.dissolve(["District", "ED_GUID"], as_index=False)
    pieces = pieces[pieces.geometry.area >= MIN_PIECE_M2].copy()
    pieces["geometry"] = pieces.geometry.simplify(SIMPLIFY_M, preserve_topology=True)
    pieces = pieces.merge(eds[["ED_GUID", "ED_ENGLISH"]], on="ED_GUID").rename(columns={"ED_ENGLISH": "ED"})
    pieces = pieces.to_crs(4326)
    pieces["geometry"] = shapely.set_precision(pieces.geometry.values, 1e-5)
    pieces = pieces[~pieces.geometry.is_empty]

    missing = sp.EXPECTED - set(pieces["District"])
    if missing:
        raise RuntimeError(f"No ED pieces for {sorted(missing)}")
    pieces = pieces.sort_values(["District", "ED"], key=lambda s: s.map(order) if s.name == "District" else s)
    pieces[["District", "ED_GUID", "ED", "geometry"]].to_file(out_path, driver="GeoJSON")
    print(f"{len(pieces)} ED pieces in {pieces['District'].nunique()} districts -> {out_path}")

    outlines = districts[districts["District"].isin(sp.EXPECTED)].copy()
    outlines["geometry"] = outlines.geometry.simplify(SIMPLIFY_M, preserve_topology=True)
    outlines = outlines.to_crs(4326)
    outlines["geometry"] = shapely.set_precision(outlines.geometry.values, 1e-5)
    outlines_path = str(Path(out_path).with_name("safety_map_districts.geojson"))
    outlines[["District", "geometry"]].to_file(outlines_path, driver="GeoJSON")
    print(f"{len(outlines)} district outlines -> {outlines_path}")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    main(*sys.argv[1:4])
