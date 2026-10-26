"""
Re-collects amenities for every Dublin postal district from OpenStreetMap, using
the same district boundaries as the map, so every district is counted the same way.

One request downloads all of Dublin; each place is then put into its district here,
which is much faster and kinder to the free Overpass servers than one request per district.

Run from the repo root:  python Backend/refresh_amenities.py
Writes Data/amenities_osm.csv (one row per place) and Data/amenity_counts_osm.csv.
"""
import json
import os
import re
import time

import numpy as np
import pandas as pd
import requests
import shapely
from pyproj import Transformer
from shapely.geometry import shape

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
BOUNDARIES = os.path.join(ROOT, "Frontend", "public", "data", "dublin_postcode_boundaries.geojson")
DATA_FOLDER = os.path.join(ROOT, "Data")

# Main Overpass server first, then public mirrors if it is busy or refuses the request
OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]
RETRY_ROUNDS = 4  # how many times to go through all servers before giving up
# Overpass asks every client to say who it is; anonymous requests get "406 Not Acceptable"
HEADERS = {
    "User-Agent": "FindYourDublin/1.0 (MSc student project; https://github.com/Sandyshor/Msc-Group-Project-Team-1)",
    "Accept": "application/json",
}

# OSM tag -> column used by recommender.py
CATEGORIES = {
    ("shop", "supermarket"): "Supermarkets",
    ("shop", "convenience"): "Groceries",
    ("shop", "greengrocer"): "Groceries",
    ("shop", "mall"): "Shopping_Malls",
    ("amenity", "restaurant"): "Restaurants",
    ("amenity", "cafe"): "Cafes",
    ("amenity", "pharmacy"): "Pharmacies",
    ("amenity", "hospital"): "Hospitals",
    ("leisure", "fitness_centre"): "Gyms",
    ("leisure", "park"): "Parks",
}
ASIAN_CUISINES = {"asian", "chinese", "indian", "japanese", "korean", "thai", "vietnamese",
                  "sushi", "malaysian", "nepalese", "pakistani", "indonesian", "filipino"}
COLUMNS = ["Supermarkets", "Groceries", "Restaurants", "Asian_Restaurants", "Cafes",
           "Gyms", "Parks", "Pharmacies", "Hospitals", "Shopping_Malls"]

itm_to_wgs84 = Transformer.from_crs("EPSG:2157", "EPSG:4326", always_xy=True)


def to_wgs84(geometry):
    """Irish Transverse Mercator (the boundary file) -> longitude/latitude (what OSM uses)."""
    return shapely.transform(geometry, lambda xy: np.column_stack(itm_to_wgs84.transform(xy[:, 0], xy[:, 1])))


def district_polygons():
    with open(BOUNDARIES, encoding="utf-8") as f:
        features = json.load(f)["features"]
    districts = []
    for feature in features:
        match = re.match(r"^Dublin\s*(\d{1,2}W?)$", feature["properties"]["postcodes"].strip(), re.IGNORECASE)
        if match:
            districts.append(("D" + match.group(1).upper(), to_wgs84(shape(feature["geometry"]))))
    return districts


def run_query(query):
    """Send a query to Overpass; free servers are often busy (504), so retry with waits."""
    for attempt in range(1, RETRY_ROUNDS + 1):
        for url in OVERPASS_URLS:
            try:
                response = requests.post(url, data={"data": query}, headers=HEADERS, timeout=360)
                response.raise_for_status()
                return response.json()["elements"]
            except (requests.RequestException, ValueError) as error:
                print(f"   {url} failed ({error}), trying the next server")
                time.sleep(10)
        if attempt < RETRY_ROUNDS:
            print(f"   all servers busy - waiting {60 * attempt} s before round {attempt + 1}")
            time.sleep(60 * attempt)
    raise RuntimeError(f"No Overpass server answered after {RETRY_ROUNDS} rounds - run the script again later")


def fetch_places(bounds):
    """Every amenity we score inside the bounding box (west, south, east, north)."""
    west, south, east, north = bounds
    bbox = f"{south:.5f},{west:.5f},{north:.5f},{east:.5f}"
    query = f"""
    [out:json][timeout:300];
    (
      nwr["shop"~"^(supermarket|convenience|greengrocer|mall)$"]({bbox});
      nwr["amenity"~"^(restaurant|cafe|pharmacy|hospital)$"]({bbox});
      nwr["leisure"~"^(fitness_centre|park)$"]({bbox});
    );
    out center tags;
    """
    rows = []
    for element in run_query(query):
        tags = element.get("tags", {})
        category = next((column for (key, value), column in CATEGORIES.items() if tags.get(key) == value), None)
        lat = element.get("lat", element.get("center", {}).get("lat"))
        lon = element.get("lon", element.get("center", {}).get("lon"))
        if category is None or lat is None:
            continue
        cuisine = tags.get("cuisine", "")
        rows.append({"name": tags.get("name", ""), "category": category,
                     "cuisine": cuisine, "latitude": lat, "longitude": lon})
        if category == "Restaurants" and set(cuisine.lower().split(";")) & ASIAN_CUISINES:
            rows.append({**rows[-1], "category": "Asian_Restaurants"})
    return pd.DataFrame(rows, columns=["name", "category", "cuisine", "latitude", "longitude"])


def main():
    districts = district_polygons()
    dublin = shapely.union_all([polygon for _, polygon in districts])
    print(f"Downloading amenities for {len(districts)} districts in one request...")
    places = fetch_places(dublin.bounds)

    # Put each place into the district whose boundary contains it
    places.insert(0, "Area", None)
    for area, polygon in districts:
        inside = shapely.contains_xy(polygon, places["longitude"].to_numpy(), places["latitude"].to_numpy())
        places.loc[inside & places["Area"].isna(), "Area"] = area
    places = places.dropna(subset=["Area"]).sort_values(["Area", "category", "name"])

    places.to_csv(os.path.join(DATA_FOLDER, "amenities_osm.csv"), index=False)
    counts = places.pivot_table(index="Area", columns="category", values="name", aggfunc="count", fill_value=0)
    counts = counts.reindex(index=[area for area, _ in districts], columns=COLUMNS, fill_value=0)
    counts.rename_axis("Area").reset_index().to_csv(os.path.join(DATA_FOLDER, "amenity_counts_osm.csv"), index=False)

    unique_places = places[places["category"] != "Asian_Restaurants"]  # those rows repeat a restaurant
    for area, total in unique_places.groupby("Area").size().items():
        print(f"{area}: {total} places")
    print(f"Saved {len(unique_places)} places for {unique_places['Area'].nunique()} districts")


if __name__ == "__main__":
    main()
