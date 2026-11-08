"""
Area figures the recommender needs for the County Dublin areas (A and K Eircodes), in one file.

Everything comes from data the District Profile already shows for these areas
(Frontend/public/data/county-dublin-profiles.json) plus the room rents from build_county_room_rents.py:
  - census: CSO Census 2022 small-area figures by electoral division
  - one/two-bed rent: RTB 2025 average rent (CSO RIA02, all property types - the districts use apartments)
  - room rent: Daft.ie Rental Report 2026 Q1 averages for the area's part of Dublin
      private room = mean of the single and double room in a house; shared room = the twin-room estimate
  - safety: the project's safety score and crime rates

Run from the repo root after build_county_room_rents.py:  python Backend/build_county_areas.py
Writes Data/county_dublin_areas.csv. Only areas with commute times (Data/commute_otp_county.csv) are
recommended; the others are skipped by the recommender until their commutes are calculated.
"""
import json
import os

import pandas as pd

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
PROFILES_JSON = os.path.join(ROOT, "Frontend", "public", "data", "county-dublin-profiles.json")
ROOMS_CSV = os.path.join(ROOT, "Data", "county_dublin_room_rents.csv")
OUT_CSV = os.path.join(ROOT, "Data", "county_dublin_areas.csv")
CENSUS = ["LEA", "Population", "Age_20_29", "Students", "Non_Irish_%", "Apartments_%", "Internet_Access_%"]
CRIME = ["violent", "robbery", "burglary_theft", "public_order", "damage"]


def main():
    county = json.load(open(PROFILES_JSON, encoding="utf-8"))
    rooms = pd.read_csv(ROOMS_CSV).set_index("Eircode")
    rows = []
    for code, profile in county["profiles"].items():
        census = county.get("census", {}).get(code, {})
        rtb = county.get("rtb", {}).get(code, {}).get("district", {})
        safety = county.get("safety", {}).get(code, {})
        row = {"Area": code, "Name": profile["name"], "Side": profile.get("side")}
        row.update({c: census.get(c) for c in CENSUS})
        row["One_Bed_Rent"], row["Two_Bed_Rent"] = rtb.get("1 bed"), rtb.get("2 bed")
        if code in rooms.index:
            r = rooms.loc[code]
            row["Private_Room_Rent"] = round((r["Single_Sharing"] + r["Double_Room"]) / 2)
            row["Shared_Room_Rent"] = int(r["Double_Sharing_Est"])
            row["Room_Rent_Region"] = r["Daft_Region"]
        row["Safety_Score"] = safety.get("score")
        for group in CRIME:
            row[f"{group}_per_1k"] = (safety.get("rates") or {}).get(group)
            row[f"ireland_{group}_per_1k"] = (safety.get("ireland") or {}).get(group)
        row["Main_Station"] = safety.get("station")
        row["Main_Station_Share"] = safety.get("stationShare")
        row["Garda_Nearest_km"] = safety.get("garda")
        rows.append(row)
    pd.DataFrame(rows).to_csv(OUT_CSV, index=False)
    print(pd.DataFrame(rows)[["Area", "Name", "Population", "One_Bed_Rent", "Two_Bed_Rent",
                              "Private_Room_Rent", "Shared_Room_Rent", "Safety_Score"]].to_string(index=False))


if __name__ == "__main__":
    main()
