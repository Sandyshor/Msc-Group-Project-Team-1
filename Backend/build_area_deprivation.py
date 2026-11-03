#!/usr/bin/env python3
"""Build area_deprivation.csv: the official deprivation category of every Dublin ED and named neighbourhood.

Used only to decide where the website asks users to check the specific street. Garda crime figures are published
per station area, so they can hide local problems inside it; areas classed Disadvantaged or worse are flagged
instead of being given a reassuring crime rating. It does not change the relative crime score.

Source: Pobal HP Deprivation Index 2022, Electoral Division level, relative index and category (CC BY 4.0).
https://www.pobal.ie/wp-content/uploads/2024/01/hp-deprivation-index-scores-2022.csv
A neighbourhood takes the ED its point lies in (the nearest ED for points just outside one).

Usage
  python build_area_deprivation.py ED_BOUNDARIES POBAL_CSV OUT_CSV
"""
import sys

import geopandas as gpd
import pandas as pd

import safety_pipeline as sp
from build_station_map import pick, read_csv_any


def main(ed_path, pobal_path, out_csv):
    ed = gpd.read_file(ed_path).to_crs(sp.ITM)
    pobal = read_csv_any(pobal_path, thousands=",")
    id_col = pick(ed.columns, "ed_id_str")
    ed[id_col] = ed[id_col].astype(str)
    pobal["ED_ID_STR"] = pobal[pick(pobal.columns, "ed_id_str")].astype(str)
    pobal = pobal.rename(columns={pick(pobal.columns, "std_rel_wt", exact="Index22_ED_std_rel_wt"): "pobal_index",
                                  pick(pobal.columns, "rel_wt_lab", exact="Index22_ED_rel_wt_lab"): "pobal_category"})
    ed = ed.merge(pobal[["ED_ID_STR", "pobal_index", "pobal_category"]], left_on=id_col, right_on="ED_ID_STR", how="left")

    eds = pd.read_csv(sp.CFG["ed_points_csv"])[["ED_GUID"]].merge(
        ed[["ED_GUID", "pobal_index", "pobal_category"]], on="ED_GUID", how="left")
    if eds["pobal_category"].isna().any():
        raise RuntimeError(f"No Pobal category for {eds['pobal_category'].isna().sum()} Dublin EDs")

    nb = pd.read_csv(sp.CFG["neighbourhoods_csv"])
    pts = gpd.GeoDataFrame(nb[["District", "Neighbourhood"]], geometry=gpd.points_from_xy(nb["lon"], nb["lat"]),
                           crs=4326).to_crs(sp.ITM)
    j = gpd.sjoin_nearest(pts, ed[["pobal_index", "pobal_category", "geometry"]], how="left")
    j = j[~j.index.duplicated()]

    out = pd.concat([
        eds.assign(kind="ed", id=eds["ED_GUID"]),
        j.assign(kind="neighbourhood", id=j["District"] + "|" + j["Neighbourhood"]),
    ], ignore_index=True)[["kind", "id", "pobal_index", "pobal_category"]]
    out["pobal_index"] = out["pobal_index"].round(2)
    out.to_csv(out_csv, index=False)
    print(out[out["kind"] == "neighbourhood"]["pobal_category"].value_counts().to_string())
    print(f"Wrote {out_csv}")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    main(*sys.argv[1:4])
