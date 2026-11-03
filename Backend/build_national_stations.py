#!/usr/bin/env python3
"""Build national_stations.csv: people in every Garda station area in Ireland, for the Irish reference rate.

safety_pipeline.py ranks each Dublin station against every station in the country (the CSO CJA07 table covers
~564), so it needs a population for each one. Method:
  1. Census 2022 population per Electoral Division (CSO SAPS, all of Ireland).
  2. Each ED belongs to the official Garda sub-district its centre lies in (CSO boundary file, Nov 2013;
     safety_pipeline.CFG["sub_districts_shp"]), and sub-district populations are summed.
  3. Daytime population (people working or studying there, CSO Census 2016 Workplace Zones, T11_T) is placed
     the same way, by each workplace zone's centre.
  4. Each CJA07 station is matched to its sub-district by name within the same Garda division (spellings
     differ, e.g. 'Caher' / 'Cahir', '[SS]' suffixes). Stations that can't be matched (mostly Gaeltacht
     stations listed under their Irish names) are left out of the national reference and listed in the output.
     The station code is kept, so the pipeline can read CJA07 or CJA11 (same stations, newer Garda divisions).

Re-run when the Census or the boundary file changes.

Usage
  python build_national_stations.py ED_BOUNDARIES SAPS_CSV CJA07_CSV WORKPLACE_ZONES_SHP OUT_CSV
"""
import difflib
import re
import sys

import geopandas as gpd
import pandas as pd

import safety_pipeline as sp
from build_station_map import pick, read_csv_any

MIN_MATCH = 0.8   # name similarity needed to accept a fuzzy match within a division

# CJA07 lists Gaeltacht stations by their Irish names; the boundary file uses the English ones.
IRISH_NAMES = {
    "na cealla beaga": "killybegs", "an craoslach": "creeslough", "an fail carrach": "falcarragh",
    "dun fionnachaid": "dunfanaghy", "ailt an chorraiin": "burtonport", "an charraig": "carrick",
    "an clochain liath": "dungloe", "ard an raitha": "ardara", "na gleannta": "glenties", "kerrykeel": "carrowkeel",
    "donegal town": "donegal", "beal an mhuirthead": "belmullet", "gleann na muaidhe": "glenamoy",
    "gob an choire": "achill sound", "an maim": "maum", "cloch na ron": "roundstone", "sraith salach": "recess",
    "gaillimh": "galway", "leach seoirse": "loughgeorge", "an cheathru rua": "carraroe", "an spideal": "spiddal",
    "bothar na tra": "salthill", "cill ronain": "kilronan", "indreabhain": "inverin", "maigh cuilinn": "moycullen",
    "schull": "skull", "beal atha an ghaorthaidh": "ballingeary", "baile bhuirne": "ballyvourney",
    "an coirean": "waterville", "baile an fheirtearaigh": "ballyferriter", "baile atha bui": "athboy",
    "kells ceanannus mor": "kells", "carrig na bhfear": "carrignavar", "an rinn": "ring",
}


def name_key(s):
    """Comparable station name: 'Ballyferriter [SS]' -> 'ballyferriter', 'Corofin Co. Clare' -> 'corofin'."""
    n = sp.station_key(s)
    n = IRISH_NAMES.get(n, n)
    n = re.sub(r"\[ss\]|\bco\.? \w+$|\bdublin$", "", n)
    return re.sub(r"[^a-z]", "", n)


def division_key(s):
    """'D.M.R. Northern Division' / 'DMR North' -> 'dmrnorth' (CJA07 and the boundary file word DMR ones differently)."""
    k = re.sub(r"[^a-z ]", "", re.sub(r"division", "", str(s).lower()))
    return re.sub(r"(north|south|east|west)ern\b", r"\1", k).replace(" ", "")


def match_stations(cso, subs):
    """CSO station label -> sub-district row index, by exact then fuzzy name within the same division."""
    out = {}
    for label, div in cso[["label", "division"]].itertuples(index=False):
        cands = subs[subs["div"] == division_key(div)]
        key = name_key(re.sub(r"^\d+\s+", "", label.split(",")[0]))
        exact = cands[cands["name"] == key]
        if len(exact):
            out[label] = exact.index[0]
            continue
        scores = cands["name"].map(lambda n: difflib.SequenceMatcher(None, key, n).ratio())
        if len(scores) and scores.max() >= MIN_MATCH:
            out[label] = scores.idxmax()
    return out


def main(ed_path, saps_path, cja07_path, wpz_path, out_csv):
    subs = gpd.read_file(sp.CFG["sub_districts_shp"]).to_crs(sp.ITM)
    subs["name"], subs["div"] = subs["SUB_DIST"].map(name_key), subs["DIVISION"].map(division_key)

    ed = gpd.read_file(ed_path).to_crs(sp.ITM)
    saps = read_csv_any(saps_path)
    pop_col = pick(saps.columns, "t1_1agett", exact="T1_1AGETT")
    ed = ed.merge(saps[["GUID", pop_col]], left_on=pick(ed.columns, "ed_guid", "guid"), right_on="GUID")
    centres = ed[[pop_col, "geometry"]].copy()
    centres["geometry"] = ed.geometry.representative_point()
    j = gpd.sjoin_nearest(centres, subs[["geometry"]], how="left")
    j = j[~j.index.duplicated()]
    residents = j.groupby("index_right")[pop_col].sum()
    wpz = gpd.read_file(wpz_path, columns=["T11_T"]).to_crs(sp.ITM)
    wpz["geometry"] = wpz.geometry.representative_point()
    w = gpd.sjoin_nearest(wpz, subs[["geometry"]], how="left")
    daytime = w[~w.index.duplicated()].groupby("index_right")["T11_T"].sum()
    print(f"{len(ed)} EDs, {int(ed[pop_col].sum()):,} residents -> {residents.size} of {len(subs)} sub-districts")

    raw = read_csv_any(cja07_path, usecols=lambda c: "station" in c.lower())
    st_col = pick(raw.columns, "garda station")
    cso = pd.DataFrame({"label": raw[st_col].drop_duplicates().astype(str)})
    cso["division"] = cso["label"].str.split(",").str[-1].str.strip()
    matched = match_stations(cso, subs)
    cso["sub_index"] = cso["label"].map(matched)
    cso["sub_district"] = cso["sub_index"].map(lambda i: subs.loc[i, "SUB_DIST"] if pd.notna(i) else None)
    cso["residents"] = cso["sub_index"].map(lambda i: residents.get(i, 0) if pd.notna(i) else None)
    cso["daytime"] = cso["sub_index"].map(lambda i: daytime.get(i, 0) if pd.notna(i) else None)
    # Two CSO stations matched to one sub-district would double its people: split them evenly.
    dup = cso["sub_index"].notna() & cso.duplicated("sub_index", keep=False)
    if dup.any():
        print("Shared sub-districts (people split evenly):", cso.loc[dup, ["label", "sub_district"]].values.tolist())
        share = cso.loc[dup].groupby("sub_index")["label"].transform("size")
        cso.loc[dup, "residents"] = cso.loc[dup, "residents"] / share
        cso.loc[dup, "daytime"] = cso.loc[dup, "daytime"] / share
    cso["station"] = cso["label"].map(sp.cso_station_key)
    cso["code"] = cso["label"].map(sp.cso_station_code)
    cso = cso.sort_values("label")
    cso[["code", "label", "station", "division", "sub_district", "residents", "daytime"]].to_csv(out_csv, index=False)
    miss = cso[cso["sub_district"].isna()]
    print(f"Matched {len(cso) - len(miss)} of {len(cso)} CSO stations; unmatched (left out of the national ranking):")
    print("  " + "; ".join(miss["label"].str.split(",").str[0]))
    print(f"Wrote {out_csv}")


if __name__ == "__main__":
    if len(sys.argv) != 6:
        sys.exit(__doc__)
    main(*sys.argv[1:6])
