#!/usr/bin/env python3
"""Pre-calculate commute times for the recommender with OpenTripPlanner.

For every district landmark (5 per district) and every university, ask OTP for the best
journey by public transport, on foot and by bike, and save them all to Data/commute_otp.csv.
The recommender reads that file, so searches stay fast and keep working when OTP is off.

Public transport is planned to ARRIVE BY 09:00 on the next weekday (a typical first lecture).
Re-run it whenever the TFI timetables (graph.obj) are rebuilt.

Run from the Backend folder, with OTP running:
    OTP_URL=http://localhost:8080/otp/gtfs/v1 python tools/build_commute_matrix.py
"""
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta

import pandas as pd
from fastapi import HTTPException

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import routing  # noqa: E402  (needs the Backend folder on the path)

DATA_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "Data")
POINTS_FILE = os.path.join(DATA_FOLDER, "Dublin_D1_D24_All_University_Commutes_clean_updated.csv")
OUTPUT = os.path.join(DATA_FOLDER, "commute_otp.csv")

ARRIVE_BY = "09:00"
# recommender travel mode -> routing.py mode
MODES = {"public_transport": "transit", "walk": "walk", "cycle": "bike"}
WORKERS = 4  # parallel requests; OTP on a laptop or the 2-CPU VM copes with 4


def next_weekday():
    day = date.today() + timedelta(days=1)
    while day.weekday() >= 5:  # Saturday, Sunday
        day += timedelta(days=1)
    return day


def best_journey(job):
    row, mode, when = job
    try:
        result = routing.plan_route(row.Origin_Latitude, row.Origin_Longitude,
                                    row.Destination_Latitude, row.Destination_Longitude,
                                    MODES[mode], when, arrive_by=(mode == "public_transport"))
    except HTTPException as error:
        detail = error.detail if isinstance(error.detail, dict) else {"code": str(error.detail)}
        if detail.get("code") in ("OTP_UNAVAILABLE", "OTP_ERROR"):
            raise SystemExit(f"OpenTripPlanner is not answering at {routing.OTP_URL}: {detail.get('message')}")
        return None
    best = min(result["itineraries"], key=lambda itinerary: itinerary["total_minutes"])
    return {
        "Area": row.District, "Direction": row.Direction, "Landmark": row.Landmark,
        "University": row.University, "Mode": mode,
        "Minutes": best["total_minutes"], "Distance_km": best["total_distance_km"],
        "Transfers": best["transfers"],
    }


def main():
    points = pd.read_csv(POINTS_FILE)[[
        "District", "Direction", "Landmark", "Origin_Latitude", "Origin_Longitude",
        "University", "Destination_Latitude", "Destination_Longitude",
    ]].drop_duplicates(["District", "Landmark", "University"])
    when = f"{next_weekday().isoformat()}T{ARRIVE_BY}"
    jobs = [(row, mode, when) for row in points.itertuples(index=False) for mode in MODES]
    print(f"Planning {len(jobs)} journeys ({len(points)} landmark-university pairs x {len(MODES)} modes), "
          f"public transport arriving by {when}, using {routing.OTP_URL}")

    rows, missing = [], 0
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        for done, result in enumerate(pool.map(best_journey, jobs), start=1):
            if result is None:
                missing += 1
            else:
                rows.append(result)
            if done % 250 == 0 or done == len(jobs):
                print(f"   {done}/{len(jobs)} done")

    matrix = pd.DataFrame(rows)
    matrix["Arrive_By"] = when
    matrix["Calculated_At"] = datetime.now(routing.DUBLIN_TZ).isoformat(timespec="seconds")
    matrix["Source"] = routing.SOURCE_LABEL
    matrix.to_csv(OUTPUT, index=False)
    print(f"Saved {len(matrix)} journeys to {OUTPUT} ({missing} had no route)")
    print(matrix.groupby("Mode")["Minutes"].describe()[["count", "mean", "min", "max"]].round(1).to_string())


if __name__ == "__main__":
    main()
