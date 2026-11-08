"""
Room rents for the County Dublin areas (A and K Eircodes), which have no room listings of their own.

Source: Daft.ie Rental Report 2026 Q1, "Snapshot of average room rent in Dublin, by market and type" (p. 24),
average listed monthly rents for North Dublin County, South Dublin County and West Dublin, typed into
Data/daft_room_rents_2026q1.csv. Report: https://www.rte.ie/documents/news/2026/05/daft.ie-rental-report-2026q1.pdf

  single sharing  = Daft "single room in a house, no en suite"
  double room     = Daft "double room in a house, no en suite"
  double sharing  = ESTIMATE per person for a twin/shared room. Daft doesn't report twin rooms, so it is the
                    double-room figure x the twin-to-double ratio in the project's own Dublin listings (Data/D*.xlsx).

Run from the repo root:  python Backend/build_county_room_rents.py
Writes Data/county_dublin_room_rents.csv and adds "roomReport" to Frontend/public/data/county-dublin-profiles.json.
"""
import glob
import json
import os

import pandas as pd

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
DAFT_CSV = os.path.join(ROOT, "Data", "daft_room_rents_2026q1.csv")
OUT_CSV = os.path.join(ROOT, "Data", "county_dublin_room_rents.csv")
PROFILES_JSON = os.path.join(ROOT, "Frontend", "public", "data", "county-dublin-profiles.json")
REPORT = "Daft.ie Rental Report 2026 Q1"
REPORT_URL = "https://www.rte.ie/documents/news/2026/05/daft.ie-rental-report-2026q1.pdf"

# Daft's Dublin markets: Fingal = North Dublin County, Dún Laoghaire-Rathdown = South Dublin County,
# Lucan/Adamstown = West Dublin
REGION = {
    "A41": "North Dublin County", "A42": "North Dublin County", "A45": "North Dublin County",
    "K32": "North Dublin County", "K34": "North Dublin County", "K36": "North Dublin County",
    "K45": "North Dublin County", "K56": "North Dublin County", "K67": "North Dublin County",
    "A94": "South Dublin County", "A96": "South Dublin County",
    "K78": "West Dublin",
}
SHARED_LABELS = ["twin", "shared", "twin & shared"]


def twin_to_double_ratio():
    """Mean twin/shared room rent (per person) / mean double room rent, in the project's Dublin room listings."""
    rooms = pd.concat([pd.read_excel(f) for f in glob.glob(os.path.join(ROOT, "Data", "D*.xlsx"))])
    rooms = rooms[rooms["Listing Type"].astype(str).str.contains("room", case=False)]
    kind = rooms["Room type"].astype(str).str.strip().str.lower()
    shared, double = rooms[kind.isin(SHARED_LABELS)]["Rent"], rooms[kind == "double"]["Rent"]
    return shared.mean() / double.mean(), len(shared), len(double)


def main():
    daft = pd.read_csv(DAFT_CSV)
    house = daft[(daft["Setting"] == "House") & (daft["Ensuite"] == "No")]
    rent = house.pivot(index="Region", columns="Room", values="Monthly_Rent")
    ratio, n_shared, n_double = twin_to_double_ratio()

    profiles = json.load(open(PROFILES_JSON, encoding="utf-8"))
    rows, report = [], {}
    for code, region in REGION.items():
        single, double = int(rent.loc[region, "Single"]), int(rent.loc[region, "Double"])
        sharing = int(round(double * ratio / 5) * 5)
        name = profiles["profiles"][code]["name"]
        rows.append({"Eircode": code, "Area": name, "Daft_Region": region,
                     "Single_Sharing": single, "Double_Room": double, "Double_Sharing_Est": sharing,
                     "Source": REPORT, "Source_URL": REPORT_URL})
        report[code] = {"region": region, "single": single, "double": double, "sharing": sharing}

    pd.DataFrame(rows).to_csv(OUT_CSV, index=False)
    profiles["roomReport"] = {
        "source": REPORT, "url": REPORT_URL,
        "basis": "Average listed rent for a room in a house without en suite.",
        "sharingNote": (f"Per person in a twin or shared room. Estimated as {ratio:.0%} of the double-room rent, "
                        f"the twin-to-double ratio in our Dublin listings ({n_shared} twin/shared, {n_double} double)."),
        "areas": report,
    }
    with open(PROFILES_JSON, "w", encoding="utf-8") as f:
        json.dump(profiles, f, ensure_ascii=False, separators=(",", ":"))
    print(f"twin/double ratio {ratio:.3f} ({n_shared} vs {n_double} listings)")
    print(pd.DataFrame(rows)[["Eircode", "Area", "Daft_Region", "Single_Sharing", "Double_Room", "Double_Sharing_Est"]].to_string(index=False))


if __name__ == "__main__":
    main()
