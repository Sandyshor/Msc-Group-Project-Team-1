"""
Downloads the latest RTB average rents from the CSO (table RIA02, open data, CC BY 4.0)
and keeps the newest year for Dublin postal districts.

Run from the repo root:  python Backend/refresh_rents.py
Writes Data/RTB_latest.csv (same columns as the RTB_Clean*.csv files).
"""
import io
import os

import pandas as pd
import requests

CSO_URL = "https://ws.cso.ie/public/api.restful/PxStat.Data.Cube_API.ReadDataset/RIA02/CSV/1.0/en"
OUTPUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "Data", "RTB_latest.csv")


def main():
    response = requests.get(CSO_URL, timeout=120)
    response.raise_for_status()
    rtb = pd.read_csv(io.StringIO(response.content.decode("utf-8-sig")), low_memory=False)
    rtb.columns = rtb.columns.str.strip()

    dublin = rtb[rtb["Location"].astype(str).str.contains(r"Dublin\s*\d+W?$", case=False, regex=True)]
    dublin = dublin.dropna(subset=["VALUE"])
    latest_year = dublin["Year"].max()
    latest = dublin[dublin["Year"] == latest_year]

    latest.to_csv(OUTPUT, index=False)
    print(f"Saved {len(latest)} Dublin rents for {latest_year} to {OUTPUT}")


if __name__ == "__main__":
    main()
