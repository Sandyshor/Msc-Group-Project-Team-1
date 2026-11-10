"""
Every bus stop in County Dublin with the routes that stop there, for the website's maps
(Frontend/public/data/dublin-bus-stops.geojson: the district map's "Bus stops" layer and the results map).

Source: the official Transport for Ireland timetable (GTFS) - the same GTFS_All.zip the journey planner
(OpenTripPlanner) is built from. A stop's routes are the bus routes whose trips stop there.
The zip is read as it is (stop_times.txt is ~500 MB), nothing is unpacked.

Run from the repo root:  python Backend/build_bus_stops.py [path/to/GTFS_All.zip]
(default: ~/dublin-otp/GTFS_All.zip, or the GTFS_ZIP environment variable)
"""
import csv
import io
import json
import os
import sys
import zipfile
from collections import defaultdict

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = os.path.join(ROOT, "Frontend", "public", "data", "dublin-bus-stops.geojson")
GTFS_ZIP = (sys.argv[1] if len(sys.argv) > 1 else
            os.getenv("GTFS_ZIP", os.path.expanduser("~/dublin-otp/GTFS_All.zip")))
# County Dublin with a margin (the County Dublin areas reach Balbriggan and the Naul in the north), and west to
# Maynooth so the bus stops at Maynooth University are on the map too
BOUNDS = {"min_lat": 53.17, "max_lat": 53.65, "min_lon": -6.70, "max_lon": -5.98}
# GTFS route_type for buses: 3, and the extended 700-799 range
is_bus = lambda route_type: route_type == "3" or route_type.startswith("7")  # noqa: E731


def rows(z, name):
    with z.open(name) as raw:
        yield from csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig"))


def natural(route):
    digits = "".join(c for c in route if c.isdigit())
    return (int(digits) if digits else 10 ** 6, route)


def main():
    z = zipfile.ZipFile(GTFS_ZIP)
    agencies = {a["agency_id"]: a["agency_name"] for a in rows(z, "agency.txt")}
    routes = {r["route_id"]: (r["route_short_name"] or r["route_long_name"], agencies.get(r["agency_id"]))
              for r in rows(z, "routes.txt") if is_bus(r["route_type"])}
    trip_route = {t["trip_id"]: t["route_id"] for t in rows(z, "trips.txt") if t["route_id"] in routes}

    stops = {}
    for s in rows(z, "stops.txt"):
        if s.get("location_type") not in ("", "0", None):
            continue  # stations and entrances, not stops
        lat, lon = float(s["stop_lat"]), float(s["stop_lon"])
        if BOUNDS["min_lat"] <= lat <= BOUNDS["max_lat"] and BOUNDS["min_lon"] <= lon <= BOUNDS["max_lon"]:
            stops[s["stop_id"]] = s

    served = defaultdict(set)
    operators = defaultdict(set)
    for i, st in enumerate(rows(z, "stop_times.txt")):
        stop_id = st["stop_id"]
        if stop_id in stops:
            route_id = trip_route.get(st["trip_id"])
            if route_id:
                name, agency = routes[route_id]
                served[stop_id].add(name)
                if agency:
                    operators[stop_id].add(agency)
        if i and i % 5_000_000 == 0:
            print(f"   {i:,} stop times read")

    features = []
    for stop_id, s in stops.items():
        if not served[stop_id]:
            continue  # no bus stops here (e.g. only a train or Luas uses it)
        code = s.get("stop_code") or ""
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(float(s["stop_lon"]), 6), round(float(s["stop_lat"]), 6)]},
            "properties": {
                "name": s["stop_name"],
                "ref": code if code not in ("", "0") else None,
                "routes": ";".join(sorted(served[stop_id], key=natural)),
                "operator": "; ".join(sorted(operators[stop_id])) or None,
            },
        })
    features.sort(key=lambda f: (f["properties"]["name"], f["geometry"]["coordinates"]))
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection",
                   "source": "Transport for Ireland GTFS timetable (all bus operators), "
                             f"{os.path.basename(GTFS_ZIP)}",
                   "features": features}, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(features)} bus stops with their routes -> {OUT}")


if __name__ == "__main__":
    main()
