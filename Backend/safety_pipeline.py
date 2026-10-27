#!/usr/bin/env python3
"""Find Your Dublin - automated safety indicator pipeline (lean version).

Indicators (street safety): robbery and public order offences per person in the area (CSO CJA07, Garda-station
level, average of the latest 3 calendar years; residents + daytime population) and distance to the nearest Garda
station (OSM). Scores compare each area with the Dublin average (50 = average). Each source is cached separately; if a refresh fails or looks
implausible, the last validated copy is kept and the problem is logged in safety_metadata.json.

Run:  python safety_pipeline.py [--force] [--cso-csv CJA07_FILE] [--stations FILE]
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
    # Daytime population per station area (build_station_map.py, Census 2016 Workplace Zones); optional.
    # Rates are per (residents + daytime population) / 2, so busy areas where few people live aren't
    # judged on residents alone.
    "station_daytime_csv": "data/safety/station_daytime.csv",
    # Official Garda station areas: CSO Census 2011 boundary files, "Garda Sub Districts" (Nov 2013), one polygon
    # per station - the same 41 Dublin stations CJA07 reports crime for. Only the one-off builders read it
    # (build_station_map.py, build_neighbourhoods.py); without it they fall back to the nearest-station rule.
    # https://www.cso.ie/en/media/csoie/census/census2011boundaryfiles/Garda_Sub_Districts.zip
    "sub_districts_shp": "data/raw/garda_sub_districts/Garda Sub Districts/Census2011_Garda_Subdistricts_Nov2013.shp",
    # Named neighbourhoods with their Garda station area (build_neighbourhoods.py); optional
    "neighbourhoods_csv": "data/safety/neighbourhoods.csv",
    "out_dir": "data/safety",
    "cso_cja07_csv": "https://ws.cso.ie/public/api.restful/PxStat.Data.Cube_API.ReadDataset/CJA07/CSV/1.0/en",
    "overpass": ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"],
    # Street safety: offence groups that mostly happen in public. Assault (03) is left out because it mixes
    # street, domestic and prison incidents (Mountjoy, Cloverhill and Wheatfield prisons inflate their stations).
    "offence_groups": {"robbery_per_100k": ["06"], "public_order_per_100k": ["13"]},
    "crime_years": 3,          # average the latest 3 calendar years so small station counts aren't one-year noise
    "weights": {"robbery_per_100k": 0.55, "public_order_per_100k": 0.30, "garda_nearest_km": 0.15},
    "higher_is_safer": {"robbery_per_100k": False, "public_order_per_100k": False, "garda_nearest_km": False},
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
    """CJA07 label -> station key, e.g. '62101 Bridewell Dublin, D.M.R. North Central Division' -> 'bridewell'."""
    name = re.sub(r"^\d+\s+", "", str(label).split(",")[0])
    return re.sub(r"\s+dublin$", "", station_key(name))


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


def crime_from_stations(df, points, groups, n_years=3, daytime=None):
    """District crime rates from station-level CSO data (CJA07, calendar years).

    groups: {output column: [ICCS group codes added together]}, e.g. {"robbery_per_100k": ["06"]}.
    points: every Dublin ED with Population, Station (whose area it is in) and District (None outside D1-D24).
    daytime: optional {station: daytime population}. People in an area = (residents + daytime) / 2, else residents.
    A station's rate = its yearly incidents (averaged over the latest n_years) / people in its area; a district's
    rate = the resident-weighted average over its EDs. The Dublin average (all incidents / all people) is
    returned in dublin_<column>. Returns (district rates, per-station table).
    """
    year_col, st_col, off_col = find_col(df, "year"), find_col(df, "garda station"), find_col(df, "offence")
    val_col = next((c for c in df.columns if c.upper() == "VALUE"), None) or find_col(df, "value")
    df = df[df[st_col].astype(str).str.contains("D.M.R.", regex=False)].copy()
    df[val_col] = pd.to_numeric(df[val_col], errors="coerce")
    df["code"] = df[off_col].map(offence_code)
    codes = sorted({c for cs in groups.values() for c in cs})
    missing_groups = sorted(set(codes) - set(df["code"].dropna()))
    if missing_groups:
        raise RuntimeError(f"Offence groups {missing_groups} not in the CSO file")
    years = sorted(df.loc[df[val_col].notna(), year_col].unique())
    if len(years) < n_years:
        raise RuntimeError(f"Need {n_years} years of Dublin station figures, found {years}")
    used = years[-n_years:]
    log.info("Offence groups used: %s; years %s", sorted(set(df.loc[df["code"].isin(codes), off_col])), used)

    sub = df[df[year_col].isin(used) & df["code"].isin(codes)].copy()
    sub["Station"] = sub[st_col].map(cso_station_key)
    incidents = sub.pivot_table(index="Station", columns="code", values=val_col, aggfunc="sum") / len(used)
    residents = points.groupby("Station")["Population"].sum()
    missing = sorted(set(residents.index) - set(incidents.index))
    if missing:
        raise RuntimeError(f"No CSO figures for station areas {missing} in {used}")
    unused = sorted(set(incidents.index) - set(residents.index))
    if unused:
        log.info("CSO stations without an area (excluded or no map location): %s", unused)

    if daytime is None:
        people = residents
    else:
        day = pd.Series(daytime).reindex(residents.index)
        if day.isna().any():
            raise RuntimeError(f"No daytime population for station areas {sorted(day[day.isna()].index)}")
        people = (residents + day) / 2
    stations = pd.DataFrame({"residents_in_area": residents, "daytime_population": None if daytime is None else day,
                             "people_in_area": people.round(0)}).rename_axis("station")
    d = points.dropna(subset=["District"]).copy()
    out, averages = None, {}
    for col, group_codes in groups.items():
        per_year = incidents[group_codes].sum(axis=1).reindex(residents.index)
        rate = per_year / people * 1e5
        averages[col] = per_year.sum() / people.sum() * 1e5
        stations[col.replace("_per_100k", "_per_year")] = per_year.round(1)
        stations[col] = rate.round(1)
        d["weighted"] = d["Station"].map(rate) * d["Population"]
        g = d.groupby("District")[["weighted", "Population"]].sum()
        part = (g["weighted"] / g["Population"]).rename(col).reset_index()
        out = part if out is None else out.merge(part, on="District")
    if set(out["District"]) != EXPECTED:
        raise RuntimeError(f"Crime rates must cover exactly {sorted(EXPECTED)}")
    for col, avg in averages.items():
        out[f"dublin_{col}"] = round(avg, 1)
    period = f"{int(used[0])} (calendar year)" if len(used) == 1 else f"{int(used[0])}-{int(used[-1])} average"
    out["crime_reference_period"] = period
    stations = stations.reset_index()
    stations["years"] = period
    return out, stations


# ---------------------------------------------------------------- scoring
def dublin_scale(values, average, higher_is_safer=False):
    """0-100 against the Dublin average: 50 = average, each doubling of a crime rate costs 25 points and each
    halving adds 25 (so 2x the average = 25, half = 75), clipped to 0-100."""
    with np.errstate(divide="ignore"):
        step = 25 * np.log2(values / average)
    return (50 + step if higher_is_safer else 50 - step).clip(0, 100)


def weighted_score(df, averages):
    """Weighted 0-100 street safety score against the Dublin averages, plus confidence and indicators used.

    An indicator missing for an area is left out of that area's score (confidence drops).
    """
    w, up = CFG["weights"], CFG["higher_is_safer"]
    parts = {col: dublin_scale(df[col], averages[col], up[col]) for col, wt in w.items()
             if col in df and col in averages and wt > 0}
    total_w = sum(w[c] for c in parts)
    num = sum(parts[c].fillna(0) * w[c] for c in parts)
    avail = sum(parts[c].notna().astype(float) * w[c] for c in parts)
    used = [",".join(c for c in parts if pd.notna(parts[c].iloc[i])) for i in range(len(df))]
    return (num / avail.replace(0, np.nan)).round(1), (avail / total_w).round(2), used


def dublin_averages(base):
    """Dublin averages from a composed district table: crime from the dublin_* columns, Garda distance = mean."""
    averages = {col: base[f"dublin_{col}"].iloc[0] for col in CFG["offence_groups"]}
    averages["garda_nearest_km"] = base["garda_nearest_km"].mean()
    return averages


def score(df, averages):
    df["safety_index_0_100"], df["confidence"], df["indicators_used"] = weighted_score(df, averages)
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


def run_crime(store, local=None):
    raw = Path(local).read_bytes() if local else fetch(CFG["cso_cja07_csv"])
    df = pd.read_csv(io.BytesIO(raw), low_memory=False)
    daytime = None
    if Path(CFG["station_daytime_csv"]).exists():
        daytime = pd.read_csv(CFG["station_daytime_csv"]).set_index("Station")["daytime_population"]
    else:
        log.warning("No %s - crime rates are per resident only", CFG["station_daytime_csv"])
    out, stations = crime_from_stations(df, load_ed_points(), CFG["offence_groups"], CFG["crime_years"], daytime)
    if store.accept("crime", "crime", out, list(CFG["offence_groups"]), note=out["crime_reference_period"].iloc[0]):
        stations.to_csv(store.dir / "crime_by_station.csv", index=False)
        store.meta["crime"]["sha256"] = hashlib.sha256(raw).hexdigest()[:16]


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


def compose(store):
    base = pd.DataFrame({"District": sorted(EXPECTED, key=lambda d: (int(re.sub(r"\D", "", d)), d))})
    for name in ("crime", "garda"):
        p = store.path(name)
        if p.exists():
            base = base.merge(pd.read_csv(p), on="District", how="left")
    crime_cols = list(CFG["offence_groups"])
    if any(c not in base or base[c].isna().any() for c in crime_cols):
        raise RuntimeError(f"Crime indicators {crime_cols} missing for some districts - not publishing")
    averages = dublin_averages(base)
    base = score(base, averages)
    for c in base.select_dtypes("number").columns:
        base[c] = base[c].round(3)
    base["generated_utc"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    out = store.dir / "safety_indicators.csv"
    tmp = out.with_suffix(".tmp")
    base.to_csv(tmp, index=False)
    os.replace(tmp, out)
    base.to_csv(store.dir / "archive" / f"safety_indicators_{datetime.now(timezone.utc):%Y%m%d}.csv", index=False)
    log.info("Published %s (%d districts)", out, len(base))
    for name, step in (("Neighbourhood", compose_neighbourhoods), ("ED (heat map)", compose_eds)):
        try:
            step(store, averages)
        except Exception as e:  # noqa: BLE001 - district scores are already published; don't fail the run
            log.error("%s scores not updated: %s", name, e)


def compose_neighbourhoods(store, averages):
    """safety_neighbourhoods.csv: each neighbourhood scored like a district (its station area's crime rates,
    its own Garda distance) against the same Dublin averages."""
    sources = [Path(CFG["neighbourhoods_csv"]), store.dir / "crime_by_station.csv", store.path("garda_neighbourhoods")]
    if not all(p.exists() for p in sources):
        log.warning("Neighbourhood scores skipped: missing %s", [str(p) for p in sources if not p.exists()])
        return
    nb = pd.read_csv(sources[0])
    station_rates = pd.read_csv(sources[1]).set_index("station")
    crime_cols = list(CFG["offence_groups"])
    for col in crime_cols:
        nb[col] = nb["Station"].map(station_rates[col])
    nb = nb.merge(pd.read_csv(sources[2]), on=["District", "Neighbourhood"], how="left")
    if nb[crime_cols].isna().any().any():
        raise RuntimeError(f"No crime rates for station areas {sorted(nb.loc[nb[crime_cols].isna().any(axis=1), 'Station'].unique())}")
    nb["safety_index_0_100"], nb["confidence"], _ = weighted_score(nb, averages)
    cols = ["District", "Neighbourhood", "Station", *crime_cols, "garda_nearest_km", "safety_index_0_100", "confidence"]
    nb = nb[cols].round({**{c: 1 for c in crime_cols}, "garda_nearest_km": 3})
    nb.to_csv(store.dir / "safety_neighbourhoods.csv", index=False)
    log.info("Published neighbourhood scores (%d neighbourhoods)", len(nb))


def compose_eds(store, averages):
    """safety_eds.csv: every ED scored the same way (its station area's crime rates, its own Garda distance), for
    the heat map. The shapes are in safety_map_areas.geojson (build_safety_map.py)."""
    sources = [store.dir / "crime_by_station.csv", store.path("garda_eds")]
    if not all(p.exists() for p in sources):
        log.warning("ED scores skipped: missing %s", [str(p) for p in sources if not p.exists()])
        return
    eds = load_ed_points()[["ED_GUID", "ED_ENGLISH", "Station"]].rename(columns={"ED_ENGLISH": "ED"})
    station_rates = pd.read_csv(sources[0]).set_index("station")
    crime_cols = list(CFG["offence_groups"])
    for col in crime_cols:
        eds[col] = eds["Station"].map(station_rates[col])
    eds = eds.merge(pd.read_csv(sources[1]), on="ED_GUID", how="left")
    if eds[crime_cols].isna().any().any():
        raise RuntimeError(f"No crime rates for station areas {sorted(eds.loc[eds[crime_cols].isna().any(axis=1), 'Station'].unique())}")
    eds["safety_index_0_100"], _, _ = weighted_score(eds, averages)
    cols = ["ED_GUID", "ED", "Station", *crime_cols, "garda_nearest_km", "safety_index_0_100"]
    eds[cols].round({**{c: 1 for c in crime_cols}, "garda_nearest_km": 3}).to_csv(store.dir / "safety_eds.csv", index=False)
    log.info("Published ED scores (%d EDs)", len(eds))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--only", default="crime,garda")
    ap.add_argument("--cso-csv", help="use a downloaded CJA07 CSV instead of fetching")
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
