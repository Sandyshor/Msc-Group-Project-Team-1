#!/usr/bin/env python3
"""Find My Dublin - automated relative crime score pipeline.

Method (recorded crime only, normalised against an Irish reference rate):
  1. Every Garda station in Ireland (CSO CJA11, recorded crime incidents by Garda station, average of the latest
     3 calendar years) gets a rate per 1,000 people in five groups: violent (35%), robbery (25%), burglary and
     theft (20%), public order (15%) and criminal damage (5%). The rate's denominator is the average number of
     people present over a day: residents (Census 2022) for 16 hours and the daytime population (Census 2016
     Workplace Zones, scaled to 2022 by the national rise in people at work) for 8 hours.
  2. The Irish reference rate for each group = all incidents / all people over Ireland's town and city stations.
     Each group scores 100 x reference / (reference + rate): 50 at the reference rate, 67 at half of it, 33 at
     double. It never reaches 0 or 100. The station score is the weighted average of its group scores.
  3. A postal district's score is an estimate: the resident-weighted average of the scores of the Garda station
     areas its residents live in (district_station_shares.csv lists each share, so every district score can be
     reproduced by hand). Named neighbourhoods show the score of the station area they lie in.
Areas classed Disadvantaged or worse in the Pobal HP Deprivation Index 2022 are flagged "check the street": station
figures can hide local problems there, so the site asks users to look at the specific street. The flag does not
change the score. Scores listed in data/safety/manual_overrides.csv replace the calculated ones (see CRIME_SCORE.md).
Bands compare with the Irish reference, from the unrounded score: Lower recorded crime (57 or higher, under 3/4
of the reference rate), Below-benchmark crime (50 to below 57), Above-benchmark crime (40 to below 50, up to 1.5x),
Higher recorded crime (below 40, more than 1.5x). The score is a comparative index, not a probability of becoming
a victim: 70 is not twice as safe as 35 (it means a rate of 0.43x the reference; 35 means 1.86x). Distance to the
nearest Garda station is shown alongside but is not part of the score.

Each source is cached separately; if a refresh fails or looks implausible, the last validated copy is kept and
the problem is logged in safety_metadata.json.

Run:  python safety_pipeline.py [--force] [--cso-csv CJA11_FILE] [--stations FILE]
"""
import argparse, hashlib, io, json, logging, os, re, sys, time, unicodedata
from datetime import datetime, timezone
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import requests

log = logging.getLogger("safety")

CFG = {
    # Every Dublin ED: residents, Garda station area, postal district, centre (build_station_map.py)
    "ed_points_csv": "data/safety/ed_points.csv",
    # Residents and daytime population of every Garda station area in Ireland (build_national_stations.py)
    "national_stations_csv": "data/safety/national_stations.csv",
    # Official Garda station areas: CSO Census 2011 boundary files, "Garda Sub Districts" (Nov 2013), one polygon
    # per station, all of Ireland. Only the one-off builders read it (build_station_map.py,
    # build_neighbourhoods.py, build_national_stations.py).
    # https://www.cso.ie/en/media/csoie/census/census2011boundaryfiles/Garda_Sub_Districts.zip
    "sub_districts_shp": "data/raw/garda_sub_districts/Garda Sub Districts/Census2011_Garda_Subdistricts_Nov2013.shp",
    # Named neighbourhoods with their Garda station area (build_neighbourhoods.py); optional
    "neighbourhoods_csv": "data/safety/neighbourhoods.csv",
    # Pobal deprivation category per ED and neighbourhood (build_area_deprivation.py); optional. Areas in these
    # categories are flagged "check the street" on the site; the score is unchanged.
    "area_deprivation_csv": "data/safety/area_deprivation.csv",
    "check_street_categories": ["Disadvantaged", "Very Disadvantaged", "Extremely Disadvantaged"],
    # Project-team overrides of calculated scores (kind district/ed/neighbourhood, id, score); recorded in
    # CRIME_SCORE.md, Appendix A9. Optional.
    "manual_overrides_csv": "data/safety/manual_overrides.csv",
    "out_dir": "data/safety",
    # CJA11: recorded crime incidents by Garda station and offence group, per calendar year (New Garda Operating
    # Model divisions; the station figures are the same as the older CJA07 table).
    "cso_crime_csv": "https://ws.cso.ie/public/api.restful/PxStat.Data.Cube_API.ReadDataset/CJA11/CSV/1.0/en",
    "overpass": ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"],
    # Crime groups (CSO ICCS offence groups) and weights. Theft from the person is inside theft (08) and can't be
    # separated at station level. Left out: drugs (10) and weapons (11), which mostly reflect where Gardai
    # search; fraud (09), traffic (14), offences against justice (15, recorded at the courts) and other (16).
    "categories": {
        "violent": ["03", "04", "05"],          # assault and harassment, dangerous acts, kidnapping
        "robbery": ["06"],
        "burglary_theft": ["07", "08"],
        "public_order": ["13"],
        "damage": ["12"],                        # criminal damage to property
    },
    "category_weights": {"violent": 0.35, "robbery": 0.25, "burglary_theft": 0.20, "public_order": 0.15, "damage": 0.05},
    "crime_years": 3,          # average the latest 3 calendar years so small station counts aren't one-year noise
    # Denominator: people present on an average day = (home_hours x residents + day_hours x daytime population) / 24.
    # Daytime population is Census 2016 (the latest Workplace Zones); it is scaled to 2022 by the national change in
    # persons at work, Census 2016 2,006,641 -> Census 2022 2,320,297.
    "home_hours": 16, "day_hours": 8,
    "daytime_scale": 2320297 / 2006641,
    # The Irish reference: stations with at least this many residents - Ireland's towns and cities (105 stations).
    "min_reference_residents": 15000,
    # Prisons inside a station area add offences that didn't happen on its streets: those stations' violent rate
    # is capped at the highest other station's in the same division.
    "custody_stations": {"mountjoy": "Mountjoy Prison and the Dochas Centre",
                         "ronanstown": "Cloverhill and Wheatfield prisons"},
    "custody_categories": ["violent"],
    # Bands by the unrounded score. 57 = 3/4 of the reference rate, 50 = the reference, 40 = 1.5x.
    "tiers": [(57, "Lower recorded crime"), (50, "Below-benchmark crime"), (40, "Above-benchmark crime"), (0, "Higher recorded crime")],
    "refresh_days": {"crime": 30, "garda": 30},
    "max_change_ratio": 2.0,
}

EXPECTED = {f"D{i}" for i in list(range(1, 19)) + [20, 22, 24]} | {"D6W"}
ITM = 2157

# Public Garda stations per DMR division, from garda.ie (station directory / designated stations /
# crime-prevention pages). O'Connell Street (North Central) is from Wikipedia's list of Garda districts.
_S = {
    "D.M.R. South Central Garda Division": ["pearse street", "kevin street", "kilmainham", "donnybrook", "irishtown"],
    "D.M.R. North Central Garda Division": ["store street", "bridewell", "fitzgibbon street", "mountjoy", "o'connell street"],
    "D.M.R. North Garda Division": ["ballymun", "santry", "coolock", "raheny", "clontarf", "howth", "malahide",
                                    "swords", "dublin airport", "balbriggan", "garristown", "lusk", "rush", "skerries"],
    "D.M.R. East Garda Division": ["blackrock", "dundrum", "stepaside", "cabinteely", "dun laoghaire", "shankill"],
    "D.M.R. South Garda Division": ["tallaght", "rathfarnham", "crumlin", "sundrive", "terenure", "rathmines"],
    "D.M.R. West Garda Division": ["blanchardstown", "finglas", "cabra", "clondalkin", "ballyfermot", "rathcoole",
                                   "lucan", "ronanstown"],
}
STATION_DIVISION = {k: div for div, ks in _S.items() for k in ks}

# Stations that don't get their own crime area: their surroundings go to the nearest other station.
CRIME_EXCLUDED = {
    "dublin airport": "almost no residents, so a per-resident rate is meaningless",
    "o'connell street": "no separate CSO figures (recorded under a neighbouring station)",
    "stepaside": "no separate CSO figures (recorded under a neighbouring station)",
}

# ---------------------------------------------------------------- helpers
def norm_district(label):
    m = re.search(r"D(?:UBLIN)?\s*0?(\d{1,2})\s*(W)?", str(label).upper())
    return f"D{int(m.group(1))}{'W' if m.group(2) else ''}" if m else None


def find_col(df, key):
    for c in df.columns:
        if key in c.lower():
            return c
    raise RuntimeError(f"No column containing '{key}'. Columns found: {list(df.columns)}")


def fetch(url, retries=3, timeout=180):
    last = None
    for i in range(retries):
        try:
            r = requests.get(url, timeout=timeout, headers={"User-Agent": "FindYourDublin-student-project"})
            r.raise_for_status()
            return r.content
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(5 * (i + 1))
    raise RuntimeError(f"Fetch failed for {url}: {last}")


def overpass(query, endpoints):
    last = None
    for ep in endpoints:
        try:
            r = requests.post(ep, data={"data": query}, timeout=300, headers={"User-Agent": "FindYourDublin-student-project"})
            r.raise_for_status()
            return r.json()["elements"]
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(10)
    raise RuntimeError(f"All Overpass endpoints failed: {last}")


def load_ed_points():
    """Every Dublin ED: Population, Station area, District (None outside D1-D24), lon/lat (build_station_map.py)."""
    d = pd.read_csv(CFG["ed_points_csv"])
    d["District"] = d["District"].map(lambda v: norm_district(v) if pd.notna(v) else None)
    if not EXPECTED <= set(d["District"].dropna()):
        raise RuntimeError(f"ED points file must cover {sorted(EXPECTED)}")
    return d


def load_district_points():
    """ED centres inside D1-D24, as ITM points with resident counts."""
    d = load_ed_points().dropna(subset=["District"])
    g = gpd.GeoDataFrame(d[["District", "Population"]], geometry=gpd.points_from_xy(d["lon"], d["lat"]), crs=4326)
    return g.to_crs(ITM)


def station_key(name):
    n = unicodedata.normalize("NFKD", str(name)).encode("ascii", "ignore").decode().lower()
    n = re.sub(r"\s*garda station\s*$", "", n).strip()
    return re.sub(r"\s+road$", "", n)


def cso_station_key(label):
    """CSO station label -> station key: '62101 Bridewell Dublin, D.M.R. North Central Division' (CJA07) or
    'Bridewell Dublin, D.M.R. North Central Division (62101)' (CJA11) -> 'bridewell'."""
    name = re.sub(r"^\d+\s+", "", str(label).split(",")[0])
    return re.sub(r"\s+dublin$", "", station_key(name))


def cso_station_code(label):
    """CSO station code from a CJA07 ('62101 Bridewell ...') or CJA11 ('Bridewell ... (62101)') label."""
    m = re.match(r"^(\d+)\s", str(label)) or re.search(r"\((\d+)\)\s*$", str(label))
    return m.group(1) if m else None


def clean_stations(g):
    """Keep only public DMR Garda stations (drops units, offices, airport police, out-of-DMR stations, duplicates)."""
    g = g.copy()
    g["key"] = g["name"].map(station_key) if "name" in g else None
    g = g[g["key"].isin(STATION_DIVISION)].drop_duplicates("key")
    g["Division"] = g["key"].map(STATION_DIVISION)
    return g


def read_stations_file(path):
    g = gpd.read_file(path)
    g = (g.set_crs(4326) if g.crs is None else g).to_crs(ITM)
    g["geometry"] = g.geometry.centroid
    return clean_stations(g)


def read_stations_overpass():
    els = overpass('[out:json][timeout:120];nwr["amenity"="police"](53.15,-6.65,53.50,-6.00);out center tags;', CFG["overpass"])
    rows = []
    for x in els:
        lon = x.get("lon", x.get("center", {}).get("lon"))
        lat = x.get("lat", x.get("center", {}).get("lat"))
        if lon is not None:
            rows.append({"name": x.get("tags", {}).get("name"), "lon": lon, "lat": lat})
    g = gpd.GeoDataFrame(pd.DataFrame(rows), geometry=gpd.points_from_xy([r["lon"] for r in rows], [r["lat"] for r in rows]), crs=4326)
    return clean_stations(g.to_crs(ITM))


def nearest_station(lm, st):
    sx, sy = st.geometry.x.values, st.geometry.y.values
    dist = np.hypot(lm.geometry.x.values[:, None] - sx[None, :], lm.geometry.y.values[:, None] - sy[None, :])
    idx = dist.argmin(axis=1)
    return idx, dist.min(axis=1) / 1000


# ---------------------------------------------------------------- official station areas
SUB_DISTRICT_KEYS = {"airport": "dublin airport"}   # sub-district name -> CJA07 station key, where they differ


def read_station_areas(path=None):
    """Dublin Garda sub-districts (one per station) as ITM polygons with a station 'key'; None without the file."""
    path = Path(path or CFG["sub_districts_shp"])
    if not path.exists():
        return None
    g = gpd.read_file(path)
    g = g[g["REGION"].str.contains("Dublin", na=False)].to_crs(ITM)
    g["key"] = g["SUB_DIST"].map(station_key).replace(SUB_DISTRICT_KEYS)
    return g[["key", "geometry"]].reset_index(drop=True)


def station_area_of(pts, areas):
    """Station key of the sub-district each point lies in (the nearest one for points just outside, e.g. on the coast)."""
    pts = pts[["geometry"]].reset_index(drop=True)
    j = gpd.sjoin(pts, areas, predicate="within", how="left")
    j = j[~j.index.duplicated()]
    miss = j["key"].isna()
    if miss.any():
        near = gpd.sjoin_nearest(pts[miss], areas, how="left")
        j.loc[miss, "key"] = near[~near.index.duplicated()]["key"]
    return j["key"].values


# ---------------------------------------------------------------- River Liffey rule
# North Central and North divisions lie entirely north of the Liffey; South Central, South and East entirely
# south (Wikipedia, List of Garda districts). West has stations on both banks. Hand-traced approximate
# centre line (lon, lat), Leixlip to the bay - accurate to roughly 100-200 m, so points near it are flagged.
LIFFEY = [(-6.500, 53.3620), (-6.448, 53.3575), (-6.400, 53.3550), (-6.375, 53.3520), (-6.344, 53.3490),
          (-6.315, 53.3465), (-6.295, 53.3465), (-6.273, 53.3455), (-6.2593, 53.3473), (-6.252, 53.3478),
          (-6.239, 53.3465), (-6.229, 53.3455), (-6.200, 53.3440), (-6.150, 53.3400)]
NEAR_RIVER_M = 250


def river_side(gdf):
    """'N' or 'S' of the Liffey for each point, plus distance (m) to the traced line."""
    from shapely.geometry import LineString
    line = gpd.GeoSeries([LineString(LIFFEY)], crs=4326).to_crs(gdf.crs).iloc[0]
    pts = gdf.to_crs(4326)
    lons, lats = np.array([x for x, _ in LIFFEY]), np.array([y for _, y in LIFFEY])
    river_lat = np.interp(pts.geometry.x.values, lons, lats)
    side = np.where(pts.geometry.y.values > river_lat, "N", "S")
    return side, gdf.geometry.distance(line).values


def nearest_station_same_side(pts, st):
    """Nearest station on the same bank of the Liffey (ignores the river east of the bay / west of Leixlip)."""
    ps, pd_ = river_side(pts)
    ss, _ = river_side(st)
    sx, sy = st.geometry.x.values, st.geometry.y.values
    dist = np.hypot(pts.geometry.x.values[:, None] - sx[None, :], pts.geometry.y.values[:, None] - sy[None, :])
    dist = np.where(ps[:, None] == ss[None, :], dist, np.inf)
    idx = dist.argmin(axis=1)
    return idx, dist.min(axis=1) / 1000, ps, pd_



# ---------------------------------------------------------------- crime
def offence_code(label):
    """ICCS group code of a CJA07 offence label, e.g. 'Robbery, extortion and hijacking offences (06)' -> '06'."""
    m = re.search(r"\((\d{2})\)\s*$", str(label))
    return m.group(1) if m else None


def reference_score(rate, reference):
    """0-100 against the Irish reference rate: 100 x reference / (reference + rate). 50 at the reference, 67 at
    half of it, 33 at double; never 0 or 100."""
    return 100 * reference / (reference + np.asarray(rate, dtype=float))


def tier(score):
    """Band for a 0-100 score, from the unrounded score (49.96 is below 50)."""
    if pd.isna(score):
        return None
    return next(name for cut, name in CFG["tiers"] if float(score) >= cut)


def station_scores(df, national, points, n_years=3):
    """Crime rates and scores for every Garda station in Ireland (CSO CJA11 or CJA07, calendar years).

    national: residents and daytime population per station code (build_national_stations.py). Dublin stations use
    the residents of the EDs our map gives them (points), so station and area figures agree.
    Returns (all stations, Irish reference rates per 1,000 people, period).
    """
    cats, weights = CFG["categories"], CFG["category_weights"]
    year_col, st_col, off_col = find_col(df, "year"), find_col(df, "garda station"), find_col(df, "offence")
    val_col = next((c for c in df.columns if c.upper() == "VALUE"), None) or find_col(df, "value")
    df = df.copy()
    df[val_col] = pd.to_numeric(df[val_col], errors="coerce")
    df["code"] = df[off_col].map(offence_code)
    codes = sorted({c for cs in cats.values() for c in cs})
    missing_groups = sorted(set(codes) - set(df["code"].dropna()))
    if missing_groups:
        raise RuntimeError(f"Offence groups {missing_groups} not in the CSO file")
    years = sorted(df.loc[df[val_col].notna(), year_col].unique())
    if len(years) < n_years:
        raise RuntimeError(f"Need {n_years} years of station figures, found {years}")
    used = years[-n_years:]
    sub = df[df[year_col].isin(used) & df["code"].isin(codes)]
    incidents = sub.pivot_table(index=st_col, columns="code", values=val_col, aggfunc="sum") / len(used)
    incidents = incidents.reindex(columns=codes, fill_value=0).fillna(0)

    nat = national.assign(code=national["code"].astype(str)).set_index("code")
    t = pd.DataFrame({"label": incidents.index})
    t["station"] = t["label"].map(cso_station_key)
    t["code"] = t["label"].map(cso_station_code)
    t["division"] = t["code"].map(nat["division"])
    t["residents"] = t["code"].map(nat["residents"])
    t["daytime"] = t["code"].map(nat["daytime"])
    dublin = t["label"].str.contains("D.M.R.", regex=False)
    t.loc[dublin, "residents"] = t.loc[dublin, "station"].map(points.groupby("Station")["Population"].sum())
    unmapped = sorted(set(points["Station"]) - set(t.loc[dublin, "station"]))
    if unmapped:
        raise RuntimeError(f"No CSO figures for station areas {unmapped} in {used}")
    t = t.dropna(subset=["residents"]).reset_index(drop=True)
    dublin = t["label"].str.contains("D.M.R.", regex=False)
    daytime = t["daytime"].fillna(t["residents"] / CFG["daytime_scale"]) * CFG["daytime_scale"]
    t["people"] = ((CFG["home_hours"] * t["residents"] + CFG["day_hours"] * daytime) / 24).round(0)
    for cat, cs in cats.items():
        t[f"{cat}_per_year"] = incidents[cs].sum(axis=1).reindex(t["label"]).values
        t[f"{cat}_per_1k"] = t[f"{cat}_per_year"] / t["people"] * 1000

    # Prisons: cap their stations at the highest other station in the same division.
    for key, why in CFG["custody_stations"].items():
        row = t.index[dublin & (t["station"] == key)]
        if not len(row):
            continue
        same_div = (t["division"] == t.loc[row[0], "division"]) & (t["station"] != key)
        for cat in CFG["custody_categories"]:
            cap = t.loc[same_div, f"{cat}_per_1k"].max()
            if t.loc[row[0], f"{cat}_per_1k"] > cap:
                log.info("%s %s rate %.1f capped at %.1f per 1,000 (%s)", key, cat, t.loc[row[0], f"{cat}_per_1k"], cap, why)
                t.loc[row[0], f"{cat}_per_1k"] = cap
                t.loc[row[0], f"{cat}_per_year"] = cap * t.loc[row[0], "people"] / 1000

    ref = t[t["residents"] >= CFG["min_reference_residents"]]
    reference = {cat: ref[f"{cat}_per_year"].sum() / ref["people"].sum() * 1000 for cat in cats}
    t["score"] = sum(w * reference_score(t[f"{cat}_per_1k"], reference[cat]) for cat, w in weights.items())
    period = f"{int(used[0])} (calendar year)" if len(used) == 1 else f"{int(used[0])}-{int(used[-1])} average"
    log.info("Irish reference: %d town and city stations; per 1,000 people %s; %s", len(ref),
             {c: round(v, 2) for c, v in reference.items()}, period)
    return t, reference, period


def area_scores(areas, stations):
    """Each area takes its Garda station area's score and crime rates (crime isn't published below station level)."""
    s = stations.set_index("station")
    a = areas.copy()
    a["safety_index_0_100"] = a["Station"].map(s["score"])
    a["tier"] = a["safety_index_0_100"].map(tier)
    for cat in CFG["categories"]:
        a[f"{cat}_per_1k"] = a["Station"].map(s[f"{cat}_per_1k"])
    return a


def add_street_check(areas, kind, id_col):
    """Pobal index and category (a separate indicator, not part of the score) and the 'check the street' flag for
    each area; none of them if the file isn't there."""
    p = Path(CFG["area_deprivation_csv"])
    if not p.exists():
        return areas.assign(pobal_index=None, pobal_category=None, check_street=False)
    dep = pd.read_csv(p)
    dep = dep[dep["kind"] == kind].set_index("id")
    out = areas.assign(pobal_index=areas[id_col].map(dep["pobal_index"]),
                       pobal_category=areas[id_col].map(dep["pobal_category"]))
    out["check_street"] = out["pobal_category"].isin(CFG["check_street_categories"])
    return out


def apply_overrides(df, kind, ids):
    """Replace calculated scores with those in manual_overrides.csv for this kind (district, ed, neighbourhood)."""
    p = Path(CFG["manual_overrides_csv"])
    if not p.exists():
        return df
    o = pd.read_csv(p)
    o = o[o["kind"] == kind].set_index("id")["score"]
    new = ids.map(o)
    df = df.copy()
    df["safety_index_0_100"] = new.fillna(df["safety_index_0_100"])
    df["tier"] = df["safety_index_0_100"].map(tier)
    return df


# ---------------------------------------------------------------- pipeline
class Store:
    def __init__(self, out_dir):
        self.dir = Path(out_dir)
        (self.dir / "intermediate").mkdir(parents=True, exist_ok=True)
        (self.dir / "archive").mkdir(exist_ok=True)
        self.meta_path = self.dir / "safety_metadata.json"
        self.meta = json.loads(self.meta_path.read_text()) if self.meta_path.exists() else {}

    def due(self, src, days, force):
        last = self.meta.get(src, {}).get("last_success_utc")
        if force or not last:
            return True
        return (datetime.now(timezone.utc) - datetime.fromisoformat(last)).days >= days

    def path(self, name):
        return self.dir / "intermediate" / f"{name}.csv"

    def accept(self, src, name, new, num_cols, note=""):
        p = self.path(name)
        if p.exists():
            old = pd.read_csv(p)
            for c in num_cols:
                if c not in old:  # method changed since the last copy - nothing comparable
                    continue
                o, n = old[c].sum(), new[c].sum()
                if o > 0 and n > 0 and not (1 / CFG["max_change_ratio"] <= n / o <= CFG["max_change_ratio"]):
                    self.fail(src, f"rejected: {c} total changed {o:.1f} -> {n:.1f}; kept previous copy")
                    return False
        new.to_csv(p, index=False)
        self.meta[src] = {"last_success_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                          "status": "ok", "note": note}
        return True

    def fail(self, src, msg):
        log.error("%s: %s", src, msg)
        prev = self.meta.get(src, {})
        prev.update({"status": "stale", "last_error": msg,
                     "last_attempt_utc": datetime.now(timezone.utc).isoformat(timespec="seconds")})
        self.meta[src] = prev

    def save_meta(self):
        self.meta_path.write_text(json.dumps(self.meta, indent=2))


def run_garda(store, local=None):
    st = read_stations_file(local) if local else read_stations_overpass()
    if len(st) < 20:
        raise RuntimeError(f"Only {len(st)} public DMR stations recognised (expected ~40) - refusing to publish")
    pts = load_district_points()
    _, d = nearest_station(pts, st)
    # Population-weighted: the typical resident's distance to the nearest station.
    pts = pts.assign(wd=d * pts["Population"])
    g = pts.groupby("District")[["wd", "Population"]].sum()
    out = (g["wd"] / g["Population"]).rename("garda_nearest_km").reset_index()
    out["stations_used"] = len(st)
    if not store.accept("garda", "garda", out, ["stations_used"], note=f"{len(st)} public DMR stations (OSM)"):
        return
    # Own distance for every ED (heat map) and every named neighbourhood.
    eds = load_ed_points()
    _, km = nearest_station(gpd.GeoDataFrame(eds, geometry=gpd.points_from_xy(eds["lon"], eds["lat"]), crs=4326).to_crs(ITM), st)
    eds[["ED_GUID"]].assign(garda_nearest_km=km).to_csv(store.path("garda_eds"), index=False)
    if Path(CFG["neighbourhoods_csv"]).exists():
        nb = pd.read_csv(CFG["neighbourhoods_csv"])
        points = gpd.GeoDataFrame(nb, geometry=gpd.points_from_xy(nb["lon"], nb["lat"]), crs=4326).to_crs(ITM)
        _, km = nearest_station(points, st)
        nb[["District", "Neighbourhood"]].assign(garda_nearest_km=km).to_csv(store.path("garda_neighbourhoods"), index=False)




CRIME_PER_YEAR = [f"{c}_per_year" for c in CFG["categories"]]
CRIME_PER_1K = [f"{c}_per_1k" for c in CFG["categories"]]


def run_crime(store, local=None):
    raw = Path(local).read_bytes() if local else fetch(CFG["cso_crime_csv"])
    df = pd.read_csv(io.BytesIO(raw), low_memory=False)
    national = pd.read_csv(CFG["national_stations_csv"], dtype={"code": str})
    stations, reference, period = station_scores(df, national, load_ed_points(), CFG["crime_years"])
    dublin = stations[stations["label"].str.contains("D.M.R.", regex=False)].assign(years=period)
    for cat, v in reference.items():
        dublin[f"ireland_{cat}_per_1k"] = v
    cols = ["station", "division", "residents", "daytime", "people", *CRIME_PER_YEAR, *CRIME_PER_1K,
            *[f"ireland_{c}" for c in CRIME_PER_1K], "score", "years"]
    out = dublin[cols].round({**{c: 1 for c in CRIME_PER_YEAR}, **{c: 2 for c in CRIME_PER_1K},
                              **{f"ireland_{c}": 2 for c in CRIME_PER_1K}, "score": 1})
    if store.accept("crime", "crime", out, CRIME_PER_YEAR, note=period):
        out.to_csv(store.dir / "crime_by_station.csv", index=False)
        nat_cols = ["label", "residents", "daytime", "people", *CRIME_PER_1K, "score"]
        stations[nat_cols].round(2).to_csv(store.path("national_station_scores"), index=False)
        store.meta["crime"]["sha256"] = hashlib.sha256(raw).hexdigest()[:16]


def compose(store):
    path = store.dir / "crime_by_station.csv"
    stations = pd.read_csv(path) if path.exists() else None
    if stations is None or "people" not in stations:
        raise RuntimeError(f"{path} missing or from an older method - run the crime step (--force)")

    eds = add_street_check(area_scores(load_ed_points(), stations), "ed", "ED_GUID")
    # Overrides are set per ED, so districts and their station-area parts are always averages of what is shown.
    eds = apply_overrides(eds, "ed", eds["ED_GUID"])
    if eds["safety_index_0_100"].isna().any():
        raise RuntimeError(f"No station score for {sorted(eds.loc[eds['safety_index_0_100'].isna(), 'Station'].unique())}")

    # Districts (an estimate): resident-weighted average of their EDs' station-area figures.
    d = eds.dropna(subset=["District"])
    cols = ["safety_index_0_100", *CRIME_PER_1K]
    w = d[cols].mul(d["Population"], axis=0).groupby(d["District"]).sum()
    base = w.div(d.groupby("District")["Population"].sum(), axis=0).reset_index()
    if set(base["District"]) != EXPECTED:
        raise RuntimeError(f"Scores must cover exactly {sorted(EXPECTED)}")
    base["District"] = pd.Categorical(base["District"], sorted(EXPECTED, key=lambda x: (int(re.sub(r"\D", "", x)), x)))
    base = base.sort_values("District")
    base["District"] = base["District"].astype(str)
    base["tier"] = base["safety_index_0_100"].map(tier)
    # Which station areas make up each district, and how much: the district score is exactly
    # sum(share x station score), published in district_station_shares.csv so it can be checked by hand.
    share = d.groupby(["District", "Station"])["Population"].sum()
    comp = share.rename("residents").reset_index()
    comp["share"] = comp["residents"] / comp.groupby("District")["residents"].transform("sum")
    # Each part's score = resident-weighted average of its EDs (the station score, unless an ED is overridden)
    part = (d["safety_index_0_100"] * d["Population"]).groupby([d["District"], d["Station"]]).sum() / share
    comp["station_score"] = [round(part[(r.District, r.Station)], 1) for r in comp.itertuples()]
    comp = comp.sort_values(["District", "share"], ascending=[True, False],
                            key=lambda c: c.map(lambda x: (int(re.sub(r"\D", "", x)), x)) if c.name == "District" else c)
    comp.round({"share": 4}).to_csv(store.dir / "district_station_shares.csv", index=False)
    base["main_station"] = base["District"].map(share.groupby(level=0).idxmax().map(lambda k: k[1]))
    base["main_station_share"] = base["District"].map((share.groupby(level=0).max() / share.groupby(level=0).sum()).round(2))
    # Share of the district's residents in areas to check street by street
    base["check_street_share"] = base["District"].map(
        d[d["check_street"]].groupby("District")["Population"].sum() / d.groupby("District")["Population"].sum()).fillna(0).round(3)
    for c in CRIME_PER_1K:
        base[f"ireland_{c}"] = stations[f"ireland_{c}"].iloc[0]
    base["crime_reference_period"] = stations["years"].iloc[0]
    if store.path("garda").exists():
        base = base.merge(pd.read_csv(store.path("garda")), on="District", how="left")
    base = base.round({"safety_index_0_100": 1, **{c: 2 for c in CRIME_PER_1K}, "garda_nearest_km": 3})
    base["generated_utc"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    out = store.dir / "safety_indicators.csv"
    tmp = out.with_suffix(".tmp")
    base.to_csv(tmp, index=False)
    os.replace(tmp, out)
    base.to_csv(store.dir / "archive" / f"safety_indicators_{datetime.now(timezone.utc):%Y%m%d}.csv", index=False)
    log.info("Published %s (%d districts)", out, len(base))
    for name, step in (("Neighbourhood", lambda: compose_neighbourhoods(store, stations)),
                       ("ED (heat map)", lambda: compose_eds(store, eds))):
        try:
            step()
        except Exception as e:  # noqa: BLE001 - district scores are already published; don't fail the run
            log.error("%s scores not updated: %s", name, e)


def compose_neighbourhoods(store, stations):
    """safety_neighbourhoods.csv: each named neighbourhood with the score and crime rates of the Garda station area
    it lies in. A place listed in two districts (it straddles the boundary, e.g. Glasnevin in D7 and D9) is each
    district's own part of it, placed by its own point, and is labelled 'Glasnevin (D7 part)'."""
    if not Path(CFG["neighbourhoods_csv"]).exists():
        log.warning("Neighbourhood scores skipped: no %s", CFG["neighbourhoods_csv"])
        return
    nb = area_scores(pd.read_csv(CFG["neighbourhoods_csv"]), stations)
    nb = add_street_check(nb.assign(id=nb["District"] + "|" + nb["Neighbourhood"]), "neighbourhood", "id")
    shared = nb["Neighbourhood"].map(nb["Neighbourhood"].value_counts()) > 1
    nb["Label"] = nb["Neighbourhood"].where(~shared, nb["Neighbourhood"] + " (" + nb["District"] + " part)")
    if nb["safety_index_0_100"].isna().any():
        raise RuntimeError(f"No station score for {sorted(nb.loc[nb['safety_index_0_100'].isna(), 'Station'].unique())}")
    nb = apply_overrides(nb, "neighbourhood", nb["id"])
    if store.path("garda_neighbourhoods").exists():
        nb = nb.merge(pd.read_csv(store.path("garda_neighbourhoods")), on=["District", "Neighbourhood"], how="left")
    cols = ["District", "Neighbourhood", "Label", "Station", "safety_index_0_100", "tier", "check_street", "pobal_category",
            *CRIME_PER_1K, "garda_nearest_km"]
    nb = nb.reindex(columns=cols).round({"safety_index_0_100": 1, **{c: 2 for c in CRIME_PER_1K}, "garda_nearest_km": 3})
    nb.to_csv(store.dir / "safety_neighbourhoods.csv", index=False)
    log.info("Published neighbourhood scores (%d neighbourhoods)", len(nb))


def compose_eds(store, eds):
    """safety_eds.csv: every ED's score, for the heat map. The shapes are in safety_map_areas.geojson
    (build_safety_map.py)."""
    eds = eds.rename(columns={"ED_ENGLISH": "ED"})
    if store.path("garda_eds").exists():
        eds = eds.merge(pd.read_csv(store.path("garda_eds")), on="ED_GUID", how="left")
    cols = ["ED_GUID", "ED", "Station", "safety_index_0_100", "tier", "check_street", "pobal_category", *CRIME_PER_1K,
            "garda_nearest_km"]
    eds = eds.reindex(columns=cols).round({"safety_index_0_100": 1, **{c: 2 for c in CRIME_PER_1K}, "garda_nearest_km": 3})
    eds.to_csv(store.dir / "safety_eds.csv", index=False)
    log.info("Published ED scores (%d EDs)", len(eds))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--only", default="crime,garda")
    ap.add_argument("--cso-csv", help="use a downloaded CJA11 (or CJA07) CSV instead of fetching")
    ap.add_argument("--stations", help="use a downloaded OSM police GeoJSON instead of Overpass")
    a = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    store = Store(CFG["out_dir"])
    steps = {"crime": (run_crime, a.cso_csv), "garda": (run_garda, a.stations)}
    for name in a.only.split(","):
        fn, local = steps[name]
        if not (local or store.due(name, CFG["refresh_days"][name], a.force)):
            log.info("%s: not due, skipping", name)
            continue
        try:
            fn(store, local)
        except Exception as e:  # noqa: BLE001
            store.fail(name, str(e))
    try:
        compose(store)
    except Exception as e:  # noqa: BLE001
        store.save_meta()
        log.error("Compose failed, previous safety_indicators.csv left untouched: %s", e)
        sys.exit(1)
    store.save_meta()
    if any(v.get("status") == "stale" for v in store.meta.values()):
        sys.exit(2)


if __name__ == "__main__":
    main()
