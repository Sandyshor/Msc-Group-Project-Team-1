#!/usr/bin/env python3
"""Compare our /route journey times and distances with Google Maps, filled in by hand.

1. collect: call /route for each start/end pair (public transport, next weekday 08:30 departure)
   and write a CSV with blank google_minutes / google_km columns.
     python tools/route_accuracy.py collect pairs.csv route_accuracy.csv [--date 2026-10-28] [--api URL]

   pairs.csv columns: label, from_lat, from_lon, to_lat, to_lon   (label is optional)

2. Fill in google_minutes and google_km by hand in Google Maps (same departure time, public
   transport, its first suggested route). The Google Maps API is never called.

3. score: mean absolute difference over the rows you filled in.
     python tools/route_accuracy.py score route_accuracy.csv
"""
import argparse
import sys
from datetime import date, timedelta

import pandas as pd
import requests

DEFAULT_API = "http://127.0.0.1:8000"
DEPARTURE_TIME = "08:30"
GOOGLE_COLUMNS = ["google_minutes", "google_km", "google_notes"]


def next_weekday(today=None):
    day = (today or date.today()) + timedelta(days=1)
    while day.weekday() >= 5:
        day += timedelta(days=1)
    return day


def route_summary(itinerary):
    if itinerary["walk_only"]:
        return "Walk only"
    return " > ".join(f"{leg['mode'].title()} {leg['line'] or ''}".strip()
                      for leg in itinerary["legs"] if leg["mode"] != "WALK")


def collect(pairs_path, out_path, when_date, api):
    pairs = pd.read_csv(pairs_path)
    missing = {"from_lat", "from_lon", "to_lat", "to_lon"} - set(pairs.columns)
    if missing:
        sys.exit(f"{pairs_path} is missing columns: {sorted(missing)}")
    when = f"{when_date.isoformat()}T{DEPARTURE_TIME}"
    print(f"Calling {api}/route for {len(pairs)} pairs, public transport, leaving {when} (Dublin time)")

    rows = []
    for i, p in enumerate(pairs.itertuples(index=False), start=1):
        row = {"pair_id": i, "label": getattr(p, "label", ""), "from_lat": p.from_lat, "from_lon": p.from_lon,
               "to_lat": p.to_lat, "to_lon": p.to_lon, "requested_departure": when}
        try:
            r = requests.get(f"{api}/route", timeout=60, params={
                "from_lat": p.from_lat, "from_lon": p.from_lon, "to_lat": p.to_lat, "to_lon": p.to_lon,
                "mode": "transit", "when": when})
            body = r.json()
        except (requests.RequestException, ValueError) as exc:
            sys.exit(f"Could not reach {api}/route ({exc}). Is the backend running?")
        if r.ok:
            best = body["itineraries"][0]  # earliest arrival, as shown first in the app
            row.update({"otp_status": "OK", "otp_minutes": best["total_minutes"], "otp_km": best["total_distance_km"],
                        "otp_walking_km": best["walking_km"], "otp_transfers": best["transfers"],
                        "otp_route": route_summary(best), "otp_departure": best["departure"],
                        "otp_arrival": best["arrival"]})
        else:
            detail = body.get("detail") or {}
            row.update({"otp_status": detail.get("code", r.status_code) if isinstance(detail, dict) else r.status_code,
                        "otp_route": detail.get("message", "") if isinstance(detail, dict) else str(detail)})
        print(f"  {i:>2}. {row['label'] or ''} {row['otp_status']} {row.get('otp_minutes', '')} min {row.get('otp_km', '')} km")
        rows.append(row)

    out = pd.DataFrame(rows)
    for c in GOOGLE_COLUMNS:
        out[c] = ""
    out.to_csv(out_path, index=False)
    print(f"Wrote {out_path}. Fill in {', '.join(GOOGLE_COLUMNS[:2])}, then run: score {out_path}")


def score(path):
    df = pd.read_csv(path)
    lines = []
    for ours, theirs, unit in (("otp_minutes", "google_minutes", "min"), ("otp_km", "google_km", "km")):
        o, g = pd.to_numeric(df[ours], errors="coerce"), pd.to_numeric(df[theirs], errors="coerce")
        both = o.notna() & g.notna()
        df[f"diff_{unit}"] = (o - g).round(2)
        if not both.any():
            lines.append(f"{unit}: no rows with both values filled in")
            continue
        diff = (o - g)[both]
        lines.append(f"{unit}: n={int(both.sum())}  mean absolute difference={diff.abs().mean():.2f} {unit}  "
                     f"mean difference (ours - Google)={diff.mean():+.2f} {unit}  "
                     f"mean absolute % difference={(diff.abs() / g[both]).mean() * 100:.1f}%")
    cols = ["pair_id", "label", "otp_minutes", "google_minutes", "diff_min", "otp_km", "google_km", "diff_km"]
    print(df[cols].to_string(index=False))
    print()
    print("\n".join(lines))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="command", required=True)
    c = sub.add_parser("collect")
    c.add_argument("pairs_csv")
    c.add_argument("out_csv")
    c.add_argument("--date", type=date.fromisoformat, help="weekday to test (default: next weekday)")
    c.add_argument("--api", default=DEFAULT_API)
    s = sub.add_parser("score")
    s.add_argument("results_csv")
    a = ap.parse_args()
    if a.command == "collect":
        when_date = a.date or next_weekday()
        if when_date.weekday() >= 5:
            sys.exit(f"{when_date} is a weekend; pick a weekday")
        collect(a.pairs_csv, a.out_csv, when_date, a.api)
    else:
        score(a.results_csv)


if __name__ == "__main__":
    main()
