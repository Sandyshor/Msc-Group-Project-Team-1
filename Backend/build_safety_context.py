#!/usr/bin/env python3
"""Build safety_context.csv: other safety factors per district, shown alongside the safety score.

They are context for the Results card only; they don't change the safety score.

Indicators
  night_transit_coverage  share of the district's walkable street length within WALK_RADIUS_M (straight line)
                          of a stop with at least MIN_NIGHT_DEPARTURES bus/Luas/train departures between
                          23:00 and 05:00 on a weekday night (TFI GTFS)
  lit_share_tagged        share of walkable street length tagged lit=yes, among streets with a lit tag (OSM).
                          Only part of Dublin is tagged, so lit_tag_coverage is reported alongside.

Re-run when the GTFS timetable or the OSM extract is updated (the same files OTP uses).

Usage
  python build_safety_context.py OSM_PBF GTFS_ZIP_OR_DIR DISTRICT_BOUNDARIES_GEOJSON OUT_CSV [--night YYYY-MM-DD]
"""
import argparse
import datetime as dt
import io
import re
import zipfile
from pathlib import Path

import geopandas as gpd
import pandas as pd

import safety_pipeline as sp

NIGHT_START_HOUR, NIGHT_END_HOUR = 23, 5
MIN_NIGHT_DEPARTURES = 6     # about one an hour across the night window
WALK_RADIUS_M = 400          # about a 5-minute walk
WALKABLE = {"residential", "living_street", "unclassified", "tertiary", "secondary", "primary", "trunk",
            "tertiary_link", "secondary_link", "primary_link", "pedestrian", "footway", "path", "steps",
            "service", "cycleway"}
LIT_YES = {"yes", "24/7", "automatic", "sunset-sunrise", "limited", "interval"}
WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]


# ---------------------------------------------------------------- GTFS
class Gtfs:
    def __init__(self, path):
        self.path = Path(path)
        self.zip = zipfile.ZipFile(self.path) if self.path.suffix.lower() == ".zip" else None

    def open(self, name):
        return io.TextIOWrapper(self.zip.open(name), encoding="utf-8-sig") if self.zip else open(self.path / name, encoding="utf-8-sig")

    def read(self, name, **kw):
        with self.open(name) as f:
            return pd.read_csv(f, **kw)


def active_services(gtfs, day):
    cal = gtfs.read("calendar.txt", dtype={"service_id": str, "start_date": str, "end_date": str})
    dates = gtfs.read("calendar_dates.txt", dtype={"service_id": str, "date": str})
    s = day.strftime("%Y%m%d")
    on = set(cal[(cal[WEEKDAYS[day.weekday()]] == 1) & (cal["start_date"] <= s) & (cal["end_date"] >= s)]["service_id"])
    exc = dates[dates["date"] == s]
    return (on | set(exc[exc["exception_type"] == 1]["service_id"])) - set(exc[exc["exception_type"] == 2]["service_id"])


def night_departures(gtfs, stop_ids, night):
    """Departures per stop during the night that starts on `night` (23:00) and ends next day 05:00.

    GTFS times past midnight are written as 24:xx-28:xx on the previous service day; early trips that belong
    to the next service day are written 00:xx-04:xx.
    """
    today, tomorrow = active_services(gtfs, night), active_services(gtfs, night + dt.timedelta(days=1))
    trips = gtfs.read("trips.txt", usecols=["trip_id", "service_id"], dtype=str)
    trip_today = set(trips[trips["service_id"].isin(today)]["trip_id"])
    trip_tomorrow = set(trips[trips["service_id"].isin(tomorrow)]["trip_id"])
    counts = []
    with gtfs.open("stop_times.txt") as f:
        for ch in pd.read_csv(f, usecols=["trip_id", "departure_time", "stop_id"], dtype=str, chunksize=2_000_000):
            ch = ch[ch["stop_id"].isin(stop_ids) & ch["departure_time"].notna()]
            hour = ch["departure_time"].str.split(":").str[0].astype(int)
            late = (hour >= NIGHT_START_HOUR) & (hour < 24 + NIGHT_END_HOUR) & ch["trip_id"].isin(trip_today)
            early = (hour < NIGHT_END_HOUR) & ch["trip_id"].isin(trip_tomorrow)
            counts.append(ch[late | early].groupby("stop_id").size())
    return pd.concat(counts).groupby(level=0).sum() if counts else pd.Series(dtype=int)


def feed_version(gtfs):
    try:
        info = gtfs.read("feed_info.txt", dtype=str)
        return f"{info['feed_publisher_name'].iloc[0]} {info['feed_start_date'].iloc[0]}-{info['feed_end_date'].iloc[0]}"
    except (KeyError, FileNotFoundError):
        return ""


def default_night(today=None):
    """Next Wednesday: a typical weekday night."""
    today = today or dt.date.today()
    return today + dt.timedelta(days=(2 - today.weekday()) % 7 or 7)


# ---------------------------------------------------------------- OSM
def lit_value(other_tags):
    m = re.search(r'"lit"=>"([^"]*)"', other_tags if isinstance(other_tags, str) else "")
    if not m:
        return "unknown"
    return "yes" if m.group(1) in LIT_YES else "no" if m.group(1) == "no" else "unknown"


def walkable_streets(pbf, districts):
    lines = gpd.read_file(pbf, layer="lines", columns=["highway", "other_tags"], where="highway IS NOT NULL")
    tags = lines["other_tags"].fillna("")
    lines = lines[lines["highway"].isin(WALKABLE) & ~tags.str.contains('"access"=>"(?:private|no)"')].copy()
    lines["lit"] = lines["other_tags"].map(lit_value)
    lines = lines[["lit", "geometry"]].to_crs(sp.ITM)
    streets = gpd.overlay(lines, districts, how="intersection", keep_geom_type=True)
    streets["km"] = streets.length / 1000
    return streets


# ---------------------------------------------------------------- main
def build(pbf, gtfs_path, boundary_path, night):
    districts = gpd.read_file(boundary_path)
    districts = (districts.set_crs(4326) if districts.crs is None else districts).to_crs(sp.ITM)
    label = next(c for c in districts.columns if c != "geometry" and districts[c].astype(str).map(sp.norm_district).notna().mean() > 0.8)
    districts["District"] = districts[label].map(sp.norm_district)
    districts = districts.dropna(subset=["District"])[["District", "geometry"]]

    streets = walkable_streets(pbf, districts)

    gtfs = Gtfs(gtfs_path)
    stops = gtfs.read("stops.txt", usecols=["stop_id", "stop_lat", "stop_lon"], dtype={"stop_id": str})
    stops = gpd.GeoDataFrame(stops, geometry=gpd.points_from_xy(stops["stop_lon"], stops["stop_lat"]), crs=4326).to_crs(sp.ITM)
    near = stops[stops.intersects(districts.union_all().buffer(WALK_RADIUS_M))]
    deps = night_departures(gtfs, set(near["stop_id"]), night)
    served = near[near["stop_id"].map(deps).fillna(0) >= MIN_NIGHT_DEPARTURES]
    catchment = served.buffer(WALK_RADIUS_M).union_all()
    streets["near_night_stop"] = streets.intersects(catchment)
    covered = streets[streets["near_night_stop"]].copy()
    covered["km"] = covered.intersection(catchment).length / 1000

    g = streets.groupby("District")
    km = g["km"].sum()
    lit_yes = streets[streets["lit"] == "yes"].groupby("District")["km"].sum().reindex(km.index, fill_value=0)
    lit_no = streets[streets["lit"] == "no"].groupby("District")["km"].sum().reindex(km.index, fill_value=0)
    tagged = lit_yes + lit_no
    in_district = gpd.sjoin(served, districts, predicate="within").groupby("District").size()
    out = pd.DataFrame({
        "night_transit_coverage": (covered.groupby("District")["km"].sum().reindex(km.index, fill_value=0) / km).round(3),
        "night_stops": in_district.reindex(km.index, fill_value=0).astype(int),
        "lit_share_tagged": (lit_yes / tagged.where(tagged > 0)).round(3),
        "lit_tag_coverage": (tagged / km).round(3),
        "street_km": km.round(1),
    }).reset_index()
    out["night_checked"] = f"{night:%a %d %b %Y} {NIGHT_START_HOUR}:00-0{NIGHT_END_HOUR}:00"
    out["gtfs_feed"] = feed_version(gtfs)
    out["osm_extract"] = Path(pbf).name
    missing = sorted(sp.EXPECTED - set(out["District"]))
    if missing:
        raise RuntimeError(f"No streets found for districts {missing}")
    return out.sort_values("District", key=lambda s: s.map(lambda d: (int(re.sub(r"\D", "", d)), d)))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("osm_pbf")
    ap.add_argument("gtfs")
    ap.add_argument("district_boundaries")
    ap.add_argument("out_csv")
    ap.add_argument("--night", type=dt.date.fromisoformat, help="night to check (default: next Wednesday)")
    a = ap.parse_args()
    out = build(a.osm_pbf, a.gtfs, a.district_boundaries, a.night or default_night())
    out.to_csv(a.out_csv, index=False)
    print(out.drop(columns=["gtfs_feed", "osm_extract"]).to_string(index=False))
    print(f"\nWrote {a.out_csv}")


if __name__ == "__main__":
    main()
