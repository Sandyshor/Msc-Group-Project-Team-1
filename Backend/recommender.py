"""
Dublin area recommender - importable version of "Recommendation system.py" for the web API.

Same data, factors, scoring and explanations as the notebook/terminal script, but:
  * data is read from the repo's Data/ folder (no hardcoded local path),
  * there are no input() prompts - the student's answers are passed to recommend(),
  * results are returned as JSON-friendly dicts instead of printed.
"""
import json
import os
import re

import numpy as np
import pandas as pd

DATA_FOLDER = os.environ.get(
    "DATA_FOLDER",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "Data"),
)

# Street safety score per district (robbery, public order, Garda distance; 50 = Dublin average), written by
# safety_pipeline.py (refreshed weekly by .github/workflows/refresh-safety-data.yml). Shown on each result; not
# used for ranking.
SAFETY_CSV = os.environ.get(
    "SAFETY_CSV",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "safety", "safety_indicators.csv"),
)
# Other safety factors (street lighting, night public transport), from build_safety_context.py.
# Shown with the safety score as context; they are not part of it.
SAFETY_CONTEXT_CSV = os.path.join(os.path.dirname(SAFETY_CSV), "safety_context.csv")
# Street safety score per named neighbourhood (safety_pipeline.py), on the same Dublin-average scale.
SAFETY_NEIGHBOURHOODS_CSV = os.path.join(os.path.dirname(SAFETY_CSV), "safety_neighbourhoods.csv")
# Safety heat map: ED shapes per district (build_safety_map.py), ED scores (safety_pipeline.py) and where each
# named neighbourhood is (build_neighbourhoods.py).
SAFETY_MAP_GEOJSON = os.path.join(os.path.dirname(SAFETY_CSV), "safety_map_areas.geojson")
SAFETY_MAP_DISTRICTS_GEOJSON = os.path.join(os.path.dirname(SAFETY_CSV), "safety_map_districts.geojson")
SAFETY_EDS_CSV = os.path.join(os.path.dirname(SAFETY_CSV), "safety_eds.csv")
NEIGHBOURHOOD_PLACES_CSV = os.path.join(os.path.dirname(SAFETY_CSV), "neighbourhoods.csv")

# Student residences per district, from OpenStreetMap plus a hand-checked list (build_accommodation.py). Rent listings aren't stored:
# each result links to Daft.ie / Rent.ie searches for its district instead.
RESIDENCES_CSV = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "accommodation",
                              "student_residences.csv")

# Same commute file as "Recommendation system.py" (all universities). Until it's
# uploaded to Data/, fall back to the TU Dublin Grangegorman-only file.
COMMUTE_FILES = ["Dublin_D1_D24_All_University_Commutes_clean_updated.csv", "Commute_TUD_Grangegorman.csv"]
# Commute times calculated with OpenTripPlanner by Backend/tools/build_commute_matrix.py. When the
# file exists it replaces the Journey Planner export and the cycling estimate below.
OTP_COMMUTE_FILE = "commute_otp.csv"
# The same for the safety data's neighbourhoods (build_commute_matrix.py --neighbourhoods). Until it
# exists, a neighbourhood uses the times of the nearest commute point in its district.
NEIGHBOURHOOD_COMMUTE_FILE = "commute_otp_neighbourhoods.csv"

AREA_CODES_ROOMS = ["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9", "D10", "D11", "D12", "D13", "D14",
                    "D15", "D16", "D17", "D18", "D20", "D22", "D24"]
AREA_CODES_AMENITIES = AREA_CODES_ROOMS
AREAS = AREA_CODES_AMENITIES

# Room listings per file, and what "double" means in that file. The D1-D5 files were collected
# separately from the D6-D10 Daft listings: in D1-D5 a double is cheaper than a single in every
# area, so it is a room shared by two people; in the Daft files it is a private room with a double bed.
ROOM_FILES = {
    "D1.xlsx": "shared", "D2.xlsx": "shared", "D3.xlsx": "shared",
    "D4_rent.xlsx": "shared", "D5_rent.xlsx": "shared",
    "D6.xlsx": "private", "D7.xlsx": "private", "D8.xlsx": "private", "D9.xlsx": "private", "D10.xlsx": "private",
    # D11-D24: Daft listings like D6-D10 - a double costs more than a single in nearly every district
    "D11.xlsx": "private", "D12.xlsx": "private", "D13.xlsx": "private", "D14.xlsx": "private",
    "D15.xlsx": "private", "D16.xlsx": "private", "D17.xlsx": "private", "D18.xlsx": "private", "D20.xlsx": "private",
    "D22.xlsx": "private", "D24.xlsx": "private",
}
PRIVATE_ROOM_LABELS = ["single", "single & twin", "single & double"]
# A room rent needs at least this many listings; fewer is too unreliable to compare districts on
MIN_ROOM_LISTINGS = 3
SHARED_ROOM_LABELS = ["twin", "shared", "double & twin", "twin & shared"]

# "group" factors are scored as one category by default (the average of their
# amenities' 0-1 sub-scores). A student can instead rate a category's "items"
# separately; those items then replace the category in the scoring as individual
# factors - same as "Recommendation system.py".
FACTORS = [
    {"name": "Rent",                   "column": "Rent",               "kind": "rent"},
    {"name": "Commute",                "column": "Commute Minutes",    "kind": "commute"},
    {"name": "Shopping & Groceries",   "column": "Shopping & Groceries",
     "kind": "group", "noun": "shopping and grocery options",
     "items": [{"name": "Supermarkets",   "column": "Supermarkets",   "noun": "supermarkets"},
               {"name": "Grocery Shops",  "column": "Groceries",      "noun": "grocery shops"},
               {"name": "Shopping Malls", "column": "Shopping_Malls", "noun": "shopping malls"}]},
    {"name": "Restaurants",            "column": "Restaurants",        "kind": "count", "noun": "restaurants"},
    {"name": "Healthcare",             "column": "Healthcare",
     "kind": "group", "noun": "healthcare amenities",
     "items": [{"name": "Hospitals",  "column": "Hospitals",  "noun": "hospitals"},
               {"name": "Pharmacies", "column": "Pharmacies", "noun": "pharmacies"}]},
    {"name": "Recreation & Wellness",  "column": "Recreation & Wellness",
     "kind": "group", "noun": "recreation and wellness amenities",
     "items": [{"name": "Gyms",  "column": "Gyms",  "noun": "gyms"},
               {"name": "Parks", "column": "Parks", "noun": "parks"}]},
]
for _factor in FACTORS:
    if _factor["kind"] == "group":
        _factor["columns"] = [item["column"] for item in _factor["items"]]
ITEM_FACTORS = [dict(item, kind="count") for f in FACTORS if f["kind"] == "group" for item in f["items"]]
FACTOR_LOOKUP = {f["name"]: f for f in FACTORS + ITEM_FACTORS}
AMENITY_COLUMNS = [item["column"] for item in ITEM_FACTORS] + [f["column"] for f in FACTORS if f["kind"] == "count"]

# How a student can travel. Each key is a minutes column in data["commute_points"].
TRAVEL_MODES = {"public_transport": "by public transport", "walk": "on foot", "cycle": "by bike"}
CYCLING_KMH = 15  # typical city cycling speed, applied to the walking route distance
# Route distance column in data["commute_points"] for each travel mode
MODE_DISTANCE = {"public_transport": "Distance_km", "walk": "Walking km", "cycle": "Cycle km"}

# Scoring scales. Every score is 0-1 and comes from the area's own value, not from its rank among the
# areas being compared, so a score means the same in every search.
AMENITY_RADIUS_KM = 1.0       # everyday amenities counted within ~12 minutes' walk of a place
# ... but hospitals and shopping centres are trips, not walks, so they count from further away
AMENITY_RADIUS_OVERRIDES_KM = {"Hospitals": 3.0, "Shopping_Malls": 2.0}
# How many of each amenity within reach is "enough for daily life" and scores 1. More than that doesn't help:
# a student needs a couple of supermarkets nearby, not twenty, so quieter suburbs aren't marked down for it.
AMENITY_ENOUGH = {"Supermarkets": 2, "Groceries": 3, "Shopping_Malls": 1, "Restaurants": 5,
                  "Hospitals": 1, "Pharmacies": 2, "Gyms": 1, "Parks": 2}
COMMUTE_BEST_MIN = 10         # 10 minutes or less scores 1 ...
COMMUTE_WORST_MIN = 60        # ... falling to 0 at an hour (or at the student's own limit, if lower)
RENT_COMFORT = 0.75           # rent at 75% of the budget or less scores 1 ...
RENT_LIMIT = 1.5              # ... falling to 0 at 150% of the budget
# A commute point this close to a named neighbourhood is the same place, so only the neighbourhood is kept
SAME_PLACE_KM = 0.5
# A long commute is close to a dealbreaker, so the whole match score shrinks from 30 minutes, down to half at
# 90 minutes - many amenities can't make up for it. How strongly depends on how much commute matters to the
# student: fully for "Very important", 2/3 for "Important", 1/3 for "Slightly important".
LONG_COMMUTE_FROM_MIN = 30
LONG_COMMUTE_TO_MIN = 90
LONG_COMMUTE_KEEP = 0.5
# Rent above the budget is the same: the student said that's what they can spend, so the whole match score
# shrinks from the budget down to 40% at 50% over it (fully for "Very important" rent, 2/3 "Important",
# 1/3 otherwise - the budget is still a limit even when cheap rent isn't a priority).
OVER_BUDGET_LIMIT = 1.5
OVER_BUDGET_KEEP = 0.4

RATING_LABELS = {1: "Very important", 2: "Important", 3: "Slightly important", 4: "Not important"}
RATING_TO_WEIGHT = {1: 3, 2: 2, 3: 1, 4: 0}


class RecommendationError(Exception):
    """Raised when the student's input can't produce a recommendation."""


def _clean_columns(df):
    df.columns = df.columns.str.strip()
    return df


def _path(name):
    return os.path.join(DATA_FOLDER, name)


def _none_if_nan(value):
    if value is None:
        return None
    if isinstance(value, (float, np.floating)) and np.isnan(value):
        return None
    if isinstance(value, np.generic):
        return value.item()
    return value


# 1. LOAD DATA (once, at server start)

def _round_or_none(value, digits=0):
    value = _none_if_nan(value)
    return None if value is None else round(float(value), digits) if digits else round(float(value))


def _percent(value):
    value = _none_if_nan(value)
    return None if value is None else round(float(value) * 100)


def load_neighbourhoods(path=SAFETY_NEIGHBOURHOODS_CSV):
    """{area: [neighbourhood safety figures, safest first]}; {} if the file isn't there."""
    if not os.path.exists(path):
        return {}
    nb = pd.read_csv(path).sort_values(["safety_index_0_100", "Neighbourhood"], ascending=[False, True])
    return {
        area: [{"name": row["Neighbourhood"],
                "score": _round_or_none(row["safety_index_0_100"], 1),
                "robbery_per_100k": _round_or_none(row["robbery_per_100k"]),
                "public_order_per_100k": _round_or_none(row["public_order_per_100k"]),
                "garda_nearest_km": _round_or_none(row["garda_nearest_km"], 1)}
               for _, row in group.iterrows()]
        for area, group in nb.groupby("District", sort=False)
    }


def load_safety(path=SAFETY_CSV, context_path=SAFETY_CONTEXT_CSV, neighbourhoods_path=SAFETY_NEIGHBOURHOODS_CSV):
    """{area: safety figures} from safety_indicators.csv (+ context and neighbourhoods if present); {} without the first."""
    if not os.path.exists(path):
        return {}
    neighbourhoods = load_neighbourhoods(neighbourhoods_path)
    safety = pd.read_csv(path)
    if os.path.exists(context_path):
        context = pd.read_csv(context_path)[["District", "lit_share_tagged", "night_transit_coverage"]]
        safety = safety.merge(context, on="District", how="left")
    out = {}
    for _, row in safety.iterrows():
        out[row["District"]] = {
            "index": _round_or_none(row.get("safety_index_0_100"), 1),
            "robbery_per_100k": _round_or_none(row.get("robbery_per_100k")),
            "public_order_per_100k": _round_or_none(row.get("public_order_per_100k")),
            "dublin_robbery_per_100k": _round_or_none(row.get("dublin_robbery_per_100k")),
            "dublin_public_order_per_100k": _round_or_none(row.get("dublin_public_order_per_100k")),
            "crime_period": _none_if_nan(row.get("crime_reference_period")),
            "garda_nearest_km": _round_or_none(row.get("garda_nearest_km"), 1),
            "lit_streets_pct": _percent(row.get("lit_share_tagged")),
            "night_transit_pct": _percent(row.get("night_transit_coverage")),
            "neighbourhoods": neighbourhoods.get(row["District"], []),
        }
    return out


def _bounds(features):
    xs, ys = [], []

    def walk(coords):
        if isinstance(coords[0], (int, float)):
            xs.append(coords[0])
            ys.append(coords[1])
        else:
            for c in coords:
                walk(c)
    for f in features:
        walk(f["geometry"]["coordinates"])
    return [min(xs), min(ys), max(xs), max(ys)]


def load_safety_maps(shapes_path=SAFETY_MAP_GEOJSON, eds_path=SAFETY_EDS_CSV,
                     places_path=NEIGHBOURHOOD_PLACES_CSV, neighbourhoods_path=SAFETY_NEIGHBOURHOODS_CSV,
                     outlines_path=SAFETY_MAP_DISTRICTS_GEOJSON):
    """{area: heat map} - the district's ED areas with their safety scores, its outline (or None), and its named
    neighbourhoods (name, score, lon/lat) for labels. {} if the shapes or ED scores aren't there."""
    if not (os.path.exists(shapes_path) and os.path.exists(eds_path)):
        return {}
    with open(shapes_path) as f:
        shapes = json.load(f)["features"]
    eds = pd.read_csv(eds_path).set_index("ED_GUID")
    places = {}
    if os.path.exists(places_path) and os.path.exists(neighbourhoods_path):
        nb = pd.read_csv(neighbourhoods_path).merge(
            pd.read_csv(places_path)[["District", "Neighbourhood", "lon", "lat"]], on=["District", "Neighbourhood"])
        for area, group in nb.groupby("District"):
            places[area] = [{"name": r["Neighbourhood"], "score": _round_or_none(r["safety_index_0_100"], 1),
                             "lon": r["lon"], "lat": r["lat"]} for _, r in group.iterrows()]
    outlines = {}
    if os.path.exists(outlines_path):
        with open(outlines_path) as f:
            outlines = {o["properties"]["District"]: o["geometry"] for o in json.load(f)["features"]}
    maps = {}
    for f in shapes:
        guid = f["properties"]["ED_GUID"]
        if guid not in eds.index:
            continue
        ed = eds.loc[guid]
        feature = {"type": "Feature", "geometry": f["geometry"], "properties": {
            "ed": f["properties"]["ED"].title(),
            "score": _round_or_none(ed["safety_index_0_100"], 1),
            "robbery_per_100k": _round_or_none(ed["robbery_per_100k"]),
            "public_order_per_100k": _round_or_none(ed["public_order_per_100k"]),
            "garda_nearest_km": _round_or_none(ed["garda_nearest_km"], 1)}}
        maps.setdefault(f["properties"]["District"], []).append(feature)
    return {area: {"areas": {"type": "FeatureCollection", "features": features},
                   "bounds": _bounds(features),
                   "outline": outlines.get(area),
                   "places": places.get(area, [])}
            for area, features in maps.items()}


def load_residences(path=RESIDENCES_CSV):
    """{area: [student residences]} (name, operator, website, address, lon/lat); {} if the file isn't there."""
    if not os.path.exists(path):
        return {}
    res = pd.read_csv(path)
    return {area: [{"name": r["Name"], "operator": _none_if_nan(r["Operator"]), "website": _none_if_nan(r["Website"]),
                    "address": _none_if_nan(r.get("Address")), "lon": _none_if_nan(r["lon"]), "lat": _none_if_nan(r["lat"]),
                    "approximate_position": str(r.get("Position", "")).startswith("street")}
                   for _, r in group.iterrows()]
            for area, group in res.groupby("District")}


def search_links(area, accommodation, budget):
    """Rental searches for the district on Daft.ie and Rent.ie, both filtered to the budget and room type."""
    n = area[1:].lower()  # "D6W" -> "6w"
    budget = int(budget)
    if accommodation in ("shared_room", "private_room"):
        daft = f"https://www.daft.ie/sharing/dublin-{n}-dublin?rentalPrice_to={budget}"
        rent_ie = f"https://www.rent.ie/rooms-to-rent/renting_dublin/dublin-{n}/rent_0-{budget}/"
        what = "Rooms"
    else:
        beds = 1 if accommodation == "one_bed" else 2
        daft = (f"https://www.daft.ie/property-for-rent/dublin-{n}-dublin?rentalPrice_to={budget}"
                f"&numBeds_from={beds}&numBeds_to={beds}")
        rent_ie = f"https://www.rent.ie/houses-to-let/renting_dublin/dublin-{n}/{beds}_beds/rent_0-{budget}/"
        what = f"{beds}-bed homes"
    label = f"{what} in {area} up to €{budget:,}"
    return [{"site": "Daft.ie", "label": label, "url": daft}, {"site": "Rent.ie", "label": label, "url": rent_ie}]


def load_data():
    # Refreshed weekly from OpenStreetMap by refresh_amenities.py
    places = _clean_columns(pd.read_csv(_path("amenities_osm.csv")))
    room_data = pd.concat(
        [_clean_columns(pd.read_excel(_path(file))).rename(columns={"Room Type": "Room type"}).assign(**{"Double Is": meaning})
         for file, meaning in ROOM_FILES.items()],
        ignore_index=True,
    )
    room_data["Room type"] = room_data["Room type"].astype(str).str.strip().str.lower()

    # Refreshed from the CSO (table RIA02) by refresh_rents.py
    rtb = _clean_columns(pd.read_csv(_path("RTB_latest.csv"), low_memory=False))
    census = _clean_columns(pd.read_excel(_path("Dublin_Census_Filled.xlsx")))
    ethnicity = _clean_columns(pd.read_excel(_path("Dublin_Ethnicity_D1_D24.xlsx")))

    commute_file = next(f for f in COMMUTE_FILES if os.path.exists(_path(f)))
    commutes = _clean_columns(pd.read_csv(_path(commute_file))).rename(columns={"District": "Area"})
    # Several landmark rows per area/university pair - average them into one typical commute.
    commute_by_university = (
        commutes.groupby(["Area", "University"], as_index=False)
        .agg(**{"Commute Minutes": ("Travel_Time_Min", "mean"), "Distance_km": ("Distance_km", "mean")})
    )
    commute_by_university["Distance"] = commute_by_university["Distance_km"].round(1).astype(str) + " km"

    walking = _clean_columns(pd.read_excel(_path("Dublin_D1_D24_Walking_Distance_and_Time_to_University.xlsx")))
    walking = walking.rename(columns={
        "District": "Area",
        "Walking_Distance_to_University_km": "Walking km",
        "Walking_Time_to_University_Min": "Walking Minutes",
    })

    # One row per landmark (5 per area) and university, with minutes for every travel mode,
    # so each search can work out the commute for the mode and time limit the student picks.
    commute_points = commutes.merge(walking, on=["Area", "Direction", "Landmark", "University"], how="left")
    commute_points["public_transport"] = commute_points["Travel_Time_Min"]
    commute_points["walk"] = commute_points["Walking Minutes"]
    commute_points["cycle"] = commute_points["Walking km"] / CYCLING_KMH * 60
    commute_points["Cycle km"] = commute_points["Walking km"]
    commute_source = "TFI Journey Planner export (public transport) and walking routes; cycling estimated"

    if os.path.exists(_path(OTP_COMMUTE_FILE)):
        otp = _clean_columns(pd.read_csv(_path(OTP_COMMUTE_FILE)))
        keys = ["Area", "Direction", "Landmark", "University"]
        minutes = otp.pivot_table(index=keys, columns="Mode", values="Minutes")
        km = otp.pivot_table(index=keys, columns="Mode", values="Distance_km")
        commute_points = commute_points.set_index(keys)
        for mode, km_column in MODE_DISTANCE.items():
            if mode in minutes:
                # Where OTP found no route, keep the older figure
                commute_points[mode] = minutes[mode].reindex(commute_points.index).fillna(commute_points[mode])
                commute_points[km_column] = km[mode].reindex(commute_points.index).fillna(commute_points[km_column])
        commute_points = commute_points.reset_index()
        commute_source = (f"OpenTripPlanner (TFI timetables), public transport arriving by "
                          f"{otp['Arrive_By'].iloc[0][-5:]} on a weekday; calculated {otp['Calculated_At'].iloc[0][:10]}")

    # Amenities near where students would live: the average number within AMENITY_RADIUS_KM of each
    # district's 5 points (the same points the commute is measured from)
    landmarks = commute_points.drop_duplicates(["Area", "Landmark"])[["Area", "Origin_Latitude", "Origin_Longitude"]]
    amenities = (_amenity_counts(landmarks, places).assign(Area=landmarks["Area"].to_numpy())
                 .groupby("Area").mean().reset_index())

    # Rent tables
    is_double = room_data["Room type"] == "double"
    is_private = room_data["Room type"].isin(PRIVATE_ROOM_LABELS) | (is_double & (room_data["Double Is"] == "private"))
    is_shared = room_data["Room type"].isin(SHARED_ROOM_LABELS) | (is_double & (room_data["Double Is"] == "shared"))
    shared_room_rent, shared_listings = _room_rent(room_data[is_shared])
    private_room_rent, private_listings = _room_rent(room_data[is_private])

    rtb["Area"] = "D" + rtb["Location"].astype(str).str.extract(
        r"Dublin\s*(\d+W?)", flags=re.IGNORECASE, expand=False
    ).str.upper()
    rtb["VALUE"] = pd.to_numeric(rtb["VALUE"], errors="coerce")
    rtb = rtb[rtb["Property Type"].str.strip() == "Apartment"]  # same property type for every district
    bedrooms = rtb["Number of Bedrooms"].astype(str).str.strip().str.lower()
    one_bed_rent = rtb[bedrooms == "one bed"].groupby("Area")["VALUE"].mean()
    two_bed_rent = rtb[bedrooms == "two bed"].groupby("Area")["VALUE"].mean()

    area_data = (
        census
        .merge(amenities, on="Area", how="left")
        .merge(ethnicity, on="Area", how="left")
    )
    for factor in FACTORS:
        if factor["kind"] == "group":
            area_data[factor["column"]] = area_data[factor["columns"]].sum(axis=1, skipna=False)

    neighbourhood_commute = _load_neighbourhood_commute()
    return {
        "area_data": area_data,
        "census": census,
        "ethnicity": ethnicity,
        "walking": walking,
        "commute_by_university": commute_by_university,
        "commute_points": commute_points,
        "commute_source": commute_source,
        # Dublin-wide "enough" level for each amenity, so amenity scores don't depend on the search
        "amenity_targets": {col: float(AMENITY_ENOUGH[col]) for col in AMENITY_COLUMNS},
        # Parts of each district (neighbourhoods and commute points) that are scored individually
        "parts": _district_parts(commute_points, places, prefer_neighbourhoods=not neighbourhood_commute.empty),
        "neighbourhood_commute": neighbourhood_commute,
        "rent_listings": {"shared_room": shared_listings, "private_room": private_listings},
        "universities": sorted(commute_by_university["University"].unique()),
        "safety": load_safety(),
        "safety_maps": load_safety_maps(),
        "residences": load_residences(),
        "rent_tables": {
            "shared_room": ("Shared Room", shared_room_rent),
            "private_room": ("Private Room", private_room_rent),
            "one_bed": ("One Bedroom Apartment", one_bed_rent),
            "two_bed": ("Two Bedroom Apartment", two_bed_rent),
        },
    }


def _room_rent(rooms):
    """Average room rent per district and its number of listings; districts with too few listings get no rent."""
    stats = rooms.groupby("Area")["Rent"].agg(["mean", "count"])
    reliable = stats[stats["count"] >= MIN_ROOM_LISTINGS]
    return reliable["mean"], reliable["count"].astype(int)


def _km(lat, lon, lats, lons):
    """Straight-line km from one point to each of several."""
    lat, lon = np.radians(lat), np.radians(lon)
    lats, lons = np.radians(np.asarray(lats, dtype=float)), np.radians(np.asarray(lons, dtype=float))
    a = np.sin((lats - lat) / 2) ** 2 + np.cos(lat) * np.cos(lats) * np.sin((lons - lon) / 2) ** 2
    return 6371 * 2 * np.arcsin(np.sqrt(a))


def _amenity_counts(points, places, radius_km=AMENITY_RADIUS_KM):
    """Count of each amenity category within radius_km of each point (same index as `points`)."""
    lat1 = np.radians(points["Origin_Latitude"].to_numpy())[:, None]
    lon1 = np.radians(points["Origin_Longitude"].to_numpy())[:, None]
    lat2 = np.radians(places["latitude"].to_numpy())[None, :]
    lon2 = np.radians(places["longitude"].to_numpy())[None, :]
    a = np.sin((lat2 - lat1) / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin((lon2 - lon1) / 2) ** 2
    km = 6371 * 2 * np.arcsin(np.sqrt(a))  # point x place
    return pd.DataFrame({col: (km[:, (places["category"] == col).to_numpy()] <= _radius(col, radius_km)).sum(axis=1)
                         for col in AMENITY_COLUMNS}, index=points.index)


def _radius(column, default=AMENITY_RADIUS_KM):
    return AMENITY_RADIUS_OVERRIDES_KM.get(column, default)


def _nearby(column, value):
    """'12 within 1 km' for one amenity type; just '12 nearby' for a category that mixes distances."""
    if column in AMENITY_COLUMNS:
        return f"{value:.0f} within {_radius(column):g} km"
    return f"{value:.0f} nearby"


def _same_name(neighbourhood, point):
    """'Phibsborough' is the commute point 'Phibsborough Village', but 'Cabra West' is not the point 'Cabra'."""
    neighbourhood, point = neighbourhood.lower().strip(), point.lower().strip()
    return point == neighbourhood or point.startswith(neighbourhood + " ")


def _district_parts(commute_points, places, prefer_neighbourhoods=False):
    """Named parts of each district a student could live in: the safety data's neighbourhoods plus the commute
    points not within SAME_PLACE_KM of one. Each has the amenities around it, the commute point whose times it
    uses (itself, or a neighbourhood's nearest) and its neighbourhood safety score (display only)."""
    landmarks = (commute_points.drop_duplicates(["Area", "Landmark"])
                 [["Area", "Landmark", "Origin_Latitude", "Origin_Longitude"]]
                 .rename(columns={"Landmark": "Part"}).assign(Kind="landmark").reset_index(drop=True))
    # Two commute points of a district that are one place ('Blanchardstown' and 'Blanchardstown Village', 1 km
    # apart at most) count once
    repeat = [any(_same_name(other["Part"], point["Part"]) and other["Part"] != point["Part"]
                  and _km(point["Origin_Latitude"], point["Origin_Longitude"],
                          [other["Origin_Latitude"]], [other["Origin_Longitude"]])[0] <= 1.0
                  for _, other in landmarks[landmarks["Area"] == point["Area"]].iterrows())
              for _, point in landmarks.iterrows()]
    landmarks = landmarks[~np.array(repeat, dtype=bool)].reset_index(drop=True)
    landmarks["Commute Point"] = landmarks["Part"]
    landmarks["Safety Score"] = np.nan
    columns = ["Area", "Part", "Origin_Latitude", "Origin_Longitude"]
    if os.path.exists(NEIGHBOURHOOD_PLACES_CSV):
        hoods = (pd.read_csv(NEIGHBOURHOOD_PLACES_CSV)
                 .rename(columns={"District": "Area", "Neighbourhood": "Part",
                                  "lat": "Origin_Latitude", "lon": "Origin_Longitude"})[columns]
                 .drop_duplicates(["Area", "Part"]).assign(Kind="neighbourhood").reset_index(drop=True))
    else:
        hoods = pd.DataFrame(columns=columns + ["Kind"])
    safety = pd.read_csv(SAFETY_NEIGHBOURHOODS_CSV) if os.path.exists(SAFETY_NEIGHBOURHOODS_CSV) else None
    scores = {} if safety is None else dict(zip(zip(safety["District"], safety["Neighbourhood"]),
                                                safety["safety_index_0_100"]))
    hoods["Safety Score"] = [scores.get(key, np.nan) for key in zip(hoods["Area"], hoods["Part"])]
    hoods["Commute Point"] = None

    # A neighbourhood and a commute point with the same name are one place. Keep the neighbourhood when it has
    # its own OTP times (prefer_neighbourhoods); otherwise keep the point, whose times are exact.
    duplicate = [any(_same_name(hood["Part"], name) for name in landmarks.loc[landmarks["Area"] == hood["Area"], "Part"])
                 for _, hood in hoods.iterrows()]
    same_as_hood = pd.Series(False, index=landmarks.index)
    for (_, hood), dup in zip(hoods.iterrows(), duplicate):
        if dup:
            same = (landmarks["Area"] == hood["Area"]) & landmarks["Part"].map(lambda name: _same_name(hood["Part"], name))
            landmarks.loc[same, "Safety Score"] = hood["Safety Score"]
            same_as_hood |= same
    if not prefer_neighbourhoods:
        hoods = hoods[~np.array(duplicate, dtype=bool)].reset_index(drop=True)

    keep = []
    for area, points in landmarks.groupby("Area"):
        in_area = hoods[hoods["Area"] == area]
        for i, point in points.iterrows():
            if in_area.empty:
                keep.append(i)
                continue
            km = _km(point["Origin_Latitude"], point["Origin_Longitude"],
                     in_area["Origin_Latitude"], in_area["Origin_Longitude"])
            if pd.isna(point["Safety Score"]):
                landmarks.at[i, "Safety Score"] = in_area["Safety Score"].iloc[km.argmin()]
            if km.min() >= SAME_PLACE_KM:
                keep.append(i)
        for j, hood in in_area.iterrows():
            km = _km(hood["Origin_Latitude"], hood["Origin_Longitude"],
                     points["Origin_Latitude"], points["Origin_Longitude"])
            hoods.at[j, "Commute Point"] = points["Part"].iloc[km.argmin()]

    if prefer_neighbourhoods:
        # dropped only now, so neighbourhoods could still use these points as their nearest commute point
        keep = [i for i in keep if not same_as_hood[i]]
    parts = pd.concat([hoods.dropna(subset=["Commute Point"]), landmarks.loc[keep]], ignore_index=True)
    parts = pd.concat([parts, _amenity_counts(parts, places)], axis=1)
    for factor in FACTORS:
        if factor["kind"] == "group":
            parts[factor["column"]] = parts[factor["columns"]].sum(axis=1)
    return parts


def _load_neighbourhood_commute():
    """OTP times for neighbourhoods, if build_commute_matrix.py --neighbourhoods has been run."""
    columns = ["Area", "Part", "University", "Mode", "Minutes", "Distance_km"]
    if not os.path.exists(_path(NEIGHBOURHOOD_COMMUTE_FILE)):
        return pd.DataFrame(columns=columns)
    return _clean_columns(pd.read_csv(_path(NEIGHBOURHOOD_COMMUTE_FILE))).rename(
        columns={"Neighbourhood": "Part"})[columns]


# 2. SCORING HELPERS

def _scale(series, worst, best):
    """0 at `worst`, 1 at `best`, straight line in between (either direction)."""
    return ((series - worst) / (best - worst)).clip(lower=0, upper=1)


def _euros(amount):
    """Whole euros, rounding halves up like the website does."""
    return f"€{int(abs(amount) + 0.5):,}"


def _factor_columns(factor):
    return factor.get("columns", [factor["column"]])


def _score_column(name):
    factor = FACTOR_LOOKUP[name]
    if factor["kind"] == "rent":
        return "Rent Score"
    if factor["kind"] == "commute":
        return "Commute Score"
    if factor["kind"] == "group":
        return f"{factor['name']} Score"
    return f"{factor['column']} Score"


def _join_words(items):
    if len(items) <= 1:
        return "".join(items)
    return ", ".join(items[:-1]) + " and " + items[-1]


def _compare_word(value, average):
    if abs(value - average) < 1:
        return "about the same as"
    return "more than" if value > average else "less than"


# 3. MAIN ENTRY POINT

def _part_commutes(data, university, mode):
    """Minutes and km from every part of every district to the university by one travel mode.
    Commute points use their own times; neighbourhoods use their own OTP times when they've been
    calculated, otherwise their nearest commute point's (Commute Estimated)."""
    points = data["commute_points"]
    points = points[(points["University"] == university) & points[mode].notna()].copy()
    points["Minutes"] = points[mode]
    distance_column = MODE_DISTANCE[mode]
    parts = data["parts"].merge(
        points[["Area", "Landmark", "Minutes", distance_column]].rename(
            columns={"Landmark": "Commute Point", distance_column: "Distance_km"}),
        on=["Area", "Commute Point"], how="left")
    parts["Commute Estimated"] = parts["Kind"] == "neighbourhood"
    own = data["neighbourhood_commute"]
    own = own[(own["University"] == university) & (own["Mode"] == mode)].set_index(["Area", "Part"])
    if not own.empty:
        key = pd.MultiIndex.from_frame(parts[["Area", "Part"]])
        minutes = own["Minutes"].reindex(key).to_numpy(dtype=float)
        found = ~np.isnan(minutes) & (parts["Kind"] == "neighbourhood").to_numpy()
        parts.loc[found, "Minutes"] = minutes[found]
        parts.loc[found, "Distance_km"] = own["Distance_km"].reindex(key).to_numpy(dtype=float)[found]
        parts.loc[found, "Commute Estimated"] = False
    return parts


def recommend(data, university, budget, accommodation, ratings, top_n=3,
              travel_mode="public_transport", max_commute=None):
    """
    university:    one of data["universities"], e.g. "TU Dublin - Grangegorman"
    budget:        max monthly budget in euro
    accommodation: shared_room | private_room | one_bed | two_bed
    ratings:       {factor name: 1-4} for every factor, as in "Recommendation system.py"
    travel_mode:   public_transport | walk | cycle
    max_commute:   longest commute in minutes the student accepts (None = no limit)
    """
    if university not in data["universities"]:
        raise RecommendationError(
            f"No commute data for '{university}'. Available: {', '.join(data['universities'])}")
    if accommodation not in data["rent_tables"]:
        raise RecommendationError(
            f"Unknown accommodation '{accommodation}'. Use one of: {', '.join(data['rent_tables'])}")
    if travel_mode not in TRAVEL_MODES:
        raise RecommendationError(
            f"Unknown travel mode '{travel_mode}'. Use one of: {', '.join(TRAVEL_MODES)}")
    unknown = [name for name in ratings if name not in FACTOR_LOOKUP]
    if unknown:
        raise RecommendationError(
            f"Unknown factor(s): {', '.join(unknown)}. Use: {', '.join(FACTOR_LOOKUP)}")
    # Every factor needs a rating; a group is rated either as a whole or by all of
    # its items (which then replace it), never both.
    missing = []
    for factor in FACTORS:
        if factor["kind"] != "group":
            if factor["name"] not in ratings:
                missing.append(factor["name"])
            continue
        item_names = [item["name"] for item in factor["items"]]
        rated_items = [name for name in item_names if name in ratings]
        if factor["name"] in ratings and rated_items:
            raise RecommendationError(
                f"Rate {factor['name']} either as a whole or by {', '.join(item_names)} - not both.")
        if factor["name"] in ratings:
            continue
        if rated_items:
            missing.extend(name for name in item_names if name not in ratings)
        else:
            missing.append(factor["name"])
    if missing:
        raise RecommendationError(f"Please rate every factor. Missing: {', '.join(missing)}")

    accommodation_name, selected_rent = data["rent_tables"][accommodation]
    ratings = {name: int(rating) for name, rating in ratings.items()}
    weights = {name: RATING_TO_WEIGHT[r] for name, r in ratings.items()}
    active_factors = [name for name, w in weights.items() if w > 0]
    if not active_factors:
        raise RecommendationError("You rated every factor as 'Not important', so there is nothing to rank on.")

    census, ethnicity, walking = data["census"], data["ethnicity"], data["walking"]
    mode_words = TRAVEL_MODES[travel_mode]

    # Commute for this search: the chosen travel mode, from every part of every area
    parts = _part_commutes(data, university, travel_mode)
    parts["Walk Faster"] = False
    if travel_mode == "public_transport":
        # Nobody waits for a bus to go somewhere they could walk to sooner, so when walking is quicker
        # (often for places near a city-centre campus) the walk is the public transport answer
        walk = _part_commutes(data, university, "walk").set_index(["Area", "Part"])
        key = pd.MultiIndex.from_frame(parts[["Area", "Part"]])
        walk_minutes = walk["Minutes"].reindex(key).to_numpy(dtype=float)
        transit_minutes = parts["Minutes"].to_numpy(dtype=float)
        # also where there's no public transport time (OTP finds no bus or train for very short trips)
        faster = (walk_minutes <= transit_minutes) | (np.isnan(transit_minutes) & ~np.isnan(walk_minutes))
        parts.loc[faster, "Minutes"] = walk_minutes[faster]
        parts.loc[faster, "Distance_km"] = walk["Distance_km"].reindex(key).to_numpy(dtype=float)[faster]
        parts.loc[faster, "Commute Estimated"] = walk["Commute Estimated"].reindex(key).to_numpy(dtype=bool)[faster]
        parts.loc[faster, "Walk Faster"] = True
    parts = parts.dropna(subset=["Minutes"]).rename(columns={"Minutes": "Commute Minutes"})
    parts["Distance"] = parts["Distance_km"].map(lambda km: f"{km:.1f} km" if pd.notna(km) else None)
    parts["Within Limit"] = parts["Commute Minutes"] <= max_commute if max_commute else True
    # District figures (rent, census); amenities and commute come from the parts
    area_data = data["area_data"].drop(columns=[c for c in data["parts"].columns
                                                if c in data["area_data"] and c != "Area"])
    walking = walking[walking["University"] == university]

    # Rent + budget
    area_data["Rent"] = area_data["Area"].map(selected_rent)
    area_data["Budget Difference"] = area_data["Rent"] - budget
    area_data["Budget Status"] = np.select(
        [area_data["Rent"].isna(), area_data["Rent"] <= budget],
        ["Rent data unavailable", "Within budget"],
        default="Above budget",
    )

    # Keep only areas with data for every factor the student cares about
    needed_columns = []
    for name in active_factors:
        needed_columns.extend(_factor_columns(FACTOR_LOOKUP[name]))
    needed_columns = list(dict.fromkeys(needed_columns + ["Rent"]))
    candidates = parts.merge(area_data, on="Area")  # one row per part, with its district's figures
    candidates = candidates[candidates[needed_columns].notna().all(axis=1)].copy()
    if candidates.empty:
        raise RecommendationError("No area has complete data for your accommodation type and chosen factors.")
    if max_commute:
        # Keep only the parts of each district within the student's limit
        candidates = candidates[candidates["Within Limit"]]
        if candidates.empty:
            raise RecommendationError(
                f"No area is within {max_commute} minutes of {university} {mode_words}. "
                "Try a longer commute or another way to travel.")

    # Scores
    # Scores (0-1, from each area's own values - see the scales at the top of this file)
    candidates["Rent Score"] = _scale(candidates["Rent"], worst=RENT_LIMIT * budget, best=RENT_COMFORT * budget)
    if "Commute" in active_factors:
        worst = min(COMMUTE_WORST_MIN, max_commute) if max_commute else COMMUTE_WORST_MIN
        worst = max(worst, COMMUTE_BEST_MIN + 5)
        candidates["Commute Score"] = _scale(candidates["Commute Minutes"], worst=worst, best=COMMUTE_BEST_MIN)
    targets = data["amenity_targets"]
    for factor in FACTORS:
        if factor["kind"] == "count":
            col = factor["column"]
            candidates[f"{col} Score"] = _scale(candidates[col], worst=0, best=targets[col])
        elif factor["kind"] == "group":
            sub_cols = []
            for col in factor["columns"]:
                candidates[f"{col} Score"] = _scale(candidates[col], worst=0, best=targets[col])
                sub_cols.append(f"{col} Score")
            candidates[f"{factor['name']} Score"] = candidates[sub_cols].mean(axis=1)

    total_weight = sum(weights.values())
    for name in active_factors:
        candidates[f"{name} Contribution"] = candidates[_score_column(name)] * weights[name] / total_weight * 100
    candidates["Match Score"] = candidates[[f"{n} Contribution" for n in active_factors]].sum(axis=1)
    if "Commute" in active_factors:
        long_commute = 1 - _scale(candidates["Commute Minutes"], worst=LONG_COMMUTE_TO_MIN, best=LONG_COMMUTE_FROM_MIN)
        strength = weights["Commute"] / max(RATING_TO_WEIGHT.values())
        candidates["Commute Penalty"] = 1 - (1 - LONG_COMMUTE_KEEP) * long_commute * strength
        candidates["Match Score"] *= candidates["Commute Penalty"]
    over_budget = 1 - _scale(candidates["Rent"], worst=OVER_BUDGET_LIMIT * budget, best=budget)
    strength = max(weights.get("Rent", 0), 1) / max(RATING_TO_WEIGHT.values())
    candidates["Budget Penalty"] = 1 - (1 - OVER_BUDGET_KEEP) * over_budget * strength
    candidates["Match Score"] *= candidates["Budget Penalty"]
    # One result per district, shown as its best place for this search: changing the commute limit or the
    # travel mode moves the pick within the district (Blanchardstown -> Clonsilla in D15) rather than
    # filling the top 3 with parts of one district
    candidates = candidates.sort_values("Match Score", ascending=False)
    ranked = candidates.drop_duplicates("Area").reset_index(drop=True)
    ranked["Label"] = ranked["Part"] + " (" + ranked["Area"] + ")"

    averages = ranked[[f["column"] for f in FACTOR_LOOKUP.values() if f["column"] in ranked]].mean()

    # Explanation helpers (closures over this request's state)
    def better_or_worse(name, row):
        factor = FACTOR_LOOKUP[name]
        value, avg = row[factor["column"]], averages[factor["column"]]
        if pd.isna(value) or avg == 0 or abs(value - avg) / abs(avg) < 0.10:
            return 0
        lower_is_better = factor["kind"] in ("rent", "commute")
        better = value < avg if lower_is_better else value > avg
        return 1 if better else -1

    def good_phrase(name, row):
        factor = FACTOR_LOOKUP[name]
        col = factor["column"]
        value = row[col]
        if factor["kind"] == "commute":
            if value == ranked[col].min():
                return f"is the closest to {university} (only {value:.0f} minutes {mode_words})"
            if value <= LONG_COMMUTE_FROM_MIN:
                return f"has a short commute to {university} (about {value:.0f} minutes {mode_words})"
            return f"has a shorter commute to {university} than most areas (about {value:.0f} minutes {mode_words})"
        if factor["kind"] == "rent":
            if value == ranked[col].min():
                return f"is the cheapest area for a {accommodation_name.lower()} (€{value:,.0f} a month)"
            return f"has lower rent than most areas (€{value:,.0f} a month)"
        if value == ranked[col].max():
            return f"has the most {factor['noun']} nearby ({_nearby(col, value)})"
        return f"has more {factor['noun']} nearby than most areas ({_nearby(col, value)})"

    def bad_sentence(name, row):
        factor = FACTOR_LOOKUP[name]
        col = factor["column"]
        value = row[col]
        if factor["kind"] == "commute":
            return f"The commute is longer – about {value:.0f} minutes to {university} {mode_words}."
        if factor["kind"] == "rent":
            return f"The rent is higher than in most areas (€{value:,.0f} a month)."
        if value == ranked[col].min():
            return f"It has the fewest {factor['noun']} nearby of all the areas ({_nearby(col, value)})."
        return f"It has fewer {factor['noun']} nearby than most areas ({_nearby(col, value)})."

    def short_name(name):
        factor = FACTOR_LOOKUP[name]
        if factor["kind"] == "commute":
            return "a shorter commute"
        if factor["kind"] == "rent":
            return "cheaper rent"
        return f"more {factor['noun']}"

    def why_ahead(row_a, row_b, top=2):
        gaps = []
        for name in active_factors:
            gap = row_a[f"{name} Contribution"] - row_b[f"{name} Contribution"]
            if gap > 0.05:
                gaps.append((name, gap))
        gaps.sort(key=lambda x: x[1], reverse=True)
        return [short_name(name) for name, _ in gaps[:top]]

    def explain(position, row):
        lines = []
        n = len(ranked)
        good = [name for name in active_factors if better_or_worse(name, row) == 1]
        good.sort(key=lambda name: ratings[name], reverse=True)
        good = good[:3]
        if good:
            sentence = f"{row['Label']} " + _join_words([good_phrase(name, row) for name in good])
            important = [name for name in good if ratings[name] >= 3]
            if len(important) == len(good):
                sentence += (", which are all things you said matter to you" if len(good) > 1
                             else ", which you said matters to you")
            lines.append(sentence + ".")

        diff = row["Budget Difference"]
        rent = f"The average rent is {_euros(row['Rent'])} a month"
        if abs(diff) < 5:
            lines.append(f"{rent}, about the same as your budget.")
        elif diff < 0:
            lines.append(f"{rent}, which is {_euros(diff)} less than your budget.")
        else:
            lines.append(f"{rent}, which is {_euros(diff)} more than your budget.")

        if n > 1:
            if position < n:
                below = ranked.iloc[position]
                reasons = why_ahead(row, below)
                if reasons:
                    lines.append(f"It ranked higher than {below['Label']} because it has {_join_words(reasons)}.")
            if position > 1:
                above = ranked.iloc[position - 2]
                reasons = why_ahead(above, row)
                if reasons:
                    lines.append(f"It ranked lower than {above['Label']} because {above['Part']} has {_join_words(reasons)}.")

        bad = [name for name in active_factors if ratings[name] >= 3 and better_or_worse(name, row) == -1]
        bad.sort(key=lambda name: ratings[name], reverse=True)
        for i, name in enumerate(bad[:2]):
            sentence = bad_sentence(name, row)
            opener = "One downside is that " if i == 0 else "Another downside is that "
            lines.append(opener + sentence[0].lower() + sentence[1:])

        if row.get("Commute Penalty", 1) < 0.95:
            lines.append(f"Its long commute (about {row['Commute Minutes']:.0f} minutes {mode_words}) "
                         f"lowers its match score by {(1 - row['Commute Penalty']) * 100:.0f}%.")

        if row["Budget Penalty"] < 0.95:
            lines.append(f"Being over your budget lowers its match score by {(1 - row['Budget Penalty']) * 100:.0f}%.")

        if not good and n > 1:
            lines.insert(0, "This area is about average on the things you care about.")
        return lines

    def profile_stats(row):
        """Census figures for the area (for the result page's charts); None where the data is missing."""
        stats = {"lea": _none_if_nan(row.get("LEA"))}
        if pd.notna(row.get("Population")) and row["Population"] > 0:
            # Census figures are for the wider local electoral area (LEA), not just this district
            stats.update({
                "population": int(row["Population"]),
                "students_pct": round(float(row["Students"] / row["Population"] * 100), 1),
                "dublin_students_pct": round(float(census["Students"].sum() / census["Population"].sum() * 100), 1),
                "young_pct": round(float(row["Age_20_29"] / row["Population"] * 100), 1),
                "dublin_young_pct": round(float(census["Age_20_29"].sum() / census["Population"].sum() * 100), 1),
            })
        if pd.notna(row.get("Non_Irish_%")):
            groups = [c for c in ethnicity.columns if c != "Area" and pd.notna(row.get(c))]
            largest = sorted(groups, key=lambda c: row[c], reverse=True)[:2]
            stats["non_irish_pct"] = round(float(row["Non_Irish_%"]), 1)
            stats["largest_groups"] = [{"name": c.replace(" (%)", ""), "pct": round(float(row[c]), 1)}
                                       for c in largest]
        if pd.notna(row.get("Apartments_%")):
            stats["apartments_pct"] = round(float(row["Apartments_%"]), 1)
        return stats

    def area_profile(row):
        stats = profile_stats(row)
        lines = []
        if "population" in stats:
            lines.append(f"About {stats['population']:,.0f} people live in the wider {stats['lea']} area.")
            lines.append(f"{stats['students_pct']:.0f}% of people are students – "
                         f"{_compare_word(stats['students_pct'], stats['dublin_students_pct'])} "
                         f"the Dublin average ({stats['dublin_students_pct']:.0f}%).")
            lines.append(f"{stats['young_pct']:.0f}% of people are aged 20–29 – "
                         f"{_compare_word(stats['young_pct'], stats['dublin_young_pct'])} "
                         f"the Dublin average ({stats['dublin_young_pct']:.0f}%).")
        if "non_irish_pct" in stats:
            group_text = " and ".join(f"{g['name']} ({g['pct']:.1f}%)" for g in stats["largest_groups"])
            lines.append(f"{stats['non_irish_pct']:.0f}% of people are not Irish. The biggest groups are {group_text}.")
        if "apartments_pct" in stats:
            lines.append(f"{stats['apartments_pct']:.0f}% of homes are apartments.")
        return lines

    def breakdown(row):
        """How the place does on each factor the student rated, most important first (for the result page)."""
        items = []
        for name in sorted(active_factors, key=lambda name: (ratings[name], -row[f"{name} Contribution"])):
            factor = FACTOR_LOOKUP[name]
            value = row[factor["column"]]
            if factor["kind"] == "commute":
                shown = f"{value:.0f} min {TRAVEL_MODES['walk'] if row['Walk Faster'] else mode_words}"
            elif factor["kind"] == "rent":
                shown = f"{_euros(value)}/month"
            else:
                shown = _nearby(factor["column"], value)
            items.append({
                "factor": name,
                "rating": ratings[name],
                "score": round(float(row[_score_column(name)]) * 100),  # 0-100: how well it meets the need
                "compared": better_or_worse(name, row),  # 1 better than most areas, 0 about average, -1 worse
                "value": shown,
            })
        return items

    def neighbours(position, row):
        """The places ranked just above and below, and what separates them (for the result page)."""
        result = {}
        if position < len(ranked):
            below = ranked.iloc[position]
            result["ahead_of"] = {"name": below["Part"], "area": below["Area"], "rank": position + 1,
                                  "reasons": why_ahead(row, below)}
        if position > 1:
            above = ranked.iloc[position - 2]
            result["behind"] = {"name": above["Part"], "area": above["Area"], "rank": position - 1,
                                "reasons": why_ahead(above, row)}
        return result

    def walking_info(area):
        area_walks = walking[walking["Area"] == area]
        known = area_walks.dropna(subset=["Walking km"])
        if known.empty:
            return None
        places = []
        for _, walk in area_walks.iterrows():
            places.append({
                "landmark": walk["Landmark"],
                "direction": walk["Direction"],
                "km": _none_if_nan(round(walk["Walking km"], 2)) if pd.notna(walk["Walking km"]) else None,
                "minutes": _none_if_nan(round(walk["Walking Minutes"])) if pd.notna(walk["Walking Minutes"]) else None,
            })
        return {
            "average_km": round(float(known["Walking km"].mean()), 2),
            "average_minutes": round(float(known["Walking Minutes"].mean())),
            "places": places,
        }

    # Budget warning (top picks all above budget)
    warning = None
    top = ranked.head(top_n)
    if (top["Budget Status"] == "Above budget").all():
        affordable = ranked[ranked["Budget Status"] == "Within budget"]
        warning = f"None of the top {len(top)} areas fit your €{budget:,.0f} budget for a {accommodation_name.lower()}."
        if not affordable.empty:
            best = affordable.loc[affordable["Match Score"].idxmax()]
            warning += (f" {best['Label']} does fit your budget (€{best['Rent']:,.0f}/month), but ranked lower "
                        f"overall (match score {best['Match Score']:.1f}%) because of your other preferences.")
        else:
            cheapest = ranked.loc[ranked["Rent"].idxmin()]
            warning += (f" The cheapest compared area is {cheapest['Label']} at €{cheapest['Rent']:,.0f}/month "
                        f"(€{cheapest['Rent'] - budget:,.0f} over budget).")

    def commute_info(area):
        """Quickest part of the district (a pin for the map) and how many of its parts are within the limit."""
        in_area = parts[parts["Area"] == area]
        quickest = in_area.loc[in_area["Commute Minutes"].idxmin()]
        return {
            "fastest_from": quickest["Part"],
            "fastest_minutes": round(float(quickest["Commute Minutes"])),
            "lat": float(quickest["Origin_Latitude"]),
            "lon": float(quickest["Origin_Longitude"]),
            "parts": len(in_area),
            "parts_within_limit": int(in_area["Within Limit"].sum()) if max_commute else None,
        }

    def neighbourhood_info(row):
        """The recommended part of the district, and the district's other good parts."""
        shown = set(zip(top["Area"], top["Part"]))
        others = candidates[(candidates["Area"] == row["Area"])
                            & ~candidates["Part"].map(lambda part: (row["Area"], part) in shown)].head(4)
        return {
            "name": row["Part"],
            "kind": row["Kind"],
            "lat": float(row["Origin_Latitude"]),
            "lon": float(row["Origin_Longitude"]),
            "commute_minutes": round(float(row["Commute Minutes"])),
            # until neighbourhood OTP times exist, a neighbourhood uses its nearest commute point's
            "commute_estimated_from": row["Commute Point"] if row["Commute Estimated"] else None,
            "safety_score": _round_or_none(row["Safety Score"], 1),
            "others": [{"name": other["Part"], "commute_minutes": round(float(other["Commute Minutes"])),
                        "match_score": round(float(other["Match Score"]), 1)} for _, other in others.iterrows()],
        }

    listings = data["rent_listings"].get(accommodation, pd.Series(dtype=int))
    results = []
    for idx, row in top.iterrows():
        position = idx + 1
        results.append({
            "rank": position,
            "area": row["Area"],
            "lea": _none_if_nan(row.get("LEA")),
            "rent": round(float(row["Rent"]), 2),
            # number of room listings behind the rent (None for apartments, which use RTB averages)
            "rent_listings": int(listings[row["Area"]]) if row["Area"] in listings.index else None,
            "budget_status": row["Budget Status"],
            "budget_difference": round(float(row["Budget Difference"]), 2),
            "commute_minutes": None if pd.isna(row["Commute Minutes"]) else round(float(row["Commute Minutes"])),
            # public transport search, but walking is quicker from here (the time and distance are the walk's)
            "walk_faster": bool(row["Walk Faster"]),
            "distance": _none_if_nan(row.get("Distance")),
            "neighbourhood": neighbourhood_info(row),
            "commute": commute_info(row["Area"]),
            "match_score": round(float(row["Match Score"]), 1),
            "walking": walking_info(row["Area"]),
            "safety": data.get("safety", {}).get(row["Area"]),
            "places_to_live": {"residences": data.get("residences", {}).get(row["Area"], []),
                               "search_links": search_links(row["Area"], accommodation, budget)},
            "why": " ".join(explain(position, row)),
            "profile": " ".join(area_profile(row)),
            # the same explanation as numbers, for charts
            "breakdown": breakdown(row),
            "compared_with": neighbours(position, row),
            "commute_penalty_pct": (round((1 - float(row["Commute Penalty"])) * 100)
                                    if row.get("Commute Penalty", 1) < 0.95 else None),
            "budget_penalty_pct": (round((1 - float(row["Budget Penalty"])) * 100)
                                   if row["Budget Penalty"] < 0.95 else None),
            "profile_stats": profile_stats(row),
        })

    return {
        "university": university,
        "accommodation": accommodation_name,
        "budget": budget,
        "travel_mode": travel_mode,
        "max_commute": max_commute,
        "commute_source": data["commute_source"],
        "areas_compared": int(ranked["Area"].nunique()),
        "parts_compared": len(candidates),
        "warning": warning,
        "recommendations": results,
    }
