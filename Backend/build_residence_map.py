"""
Every student residence with its exact location, for the website's maps (the district map and the
"Getting there" map on the results page).

Reads the same files as the recommender (data/accommodation/student_residences.csv plus the published prices),
so the maps and the results always list the same residences.

Run from the repo root after build_accommodation.py:  python Backend/build_residence_map.py
Writes Frontend/public/data/student-residences.json.
"""
import json
import os

import recommender

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT_JSON = os.path.join(ROOT, "Frontend", "public", "data", "student-residences.json")


def main():
    residences = recommender.load_residences()
    rows = []
    for district, items in residences.items():
        for r in items:
            price = r.get("price") or {}
            rows.append({
                "name": r["name"],
                "operator": r.get("operator") or None,
                "website": r.get("website") or None,
                "address": r.get("address") or None,
                "district": district,
                "lat": round(float(r["lat"]), 6),
                "lon": round(float(r["lon"]), 6),
                "approx": bool(r.get("approximate_position")),
                "from": price.get("monthly_from"),  # euro a month, the cheapest room
                "to": price.get("monthly_to"),
                "rooms": price.get("room_types") or None,
            })
    rows.sort(key=lambda x: (x["district"], x["name"]))
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump({"source": "OpenStreetMap and the residences' own websites", "residences": rows}, f,
                  ensure_ascii=False, separators=(",", ":"))
    print(f"{len(rows)} residences in {len({r['district'] for r in rows})} districts -> {OUT_JSON}")


if __name__ == "__main__":
    main()
