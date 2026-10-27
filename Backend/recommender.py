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

AREA_CODES_ROOMS = ["D1", "D2", "D3", "D6", "D7", "D8", "D9", "D10"]
AREA_CODES_AMENITIES = AREA_CODES_ROOMS + ["D4", "D5", "D11", "D12", "D13", "D14", "D15",
                                           "D16", "D17", "D18", "D20", "D22", "D24"]
AREAS = AREA_CODES_AMENITIES

# Room listings per file, and what "double" means in that file. The D1-D5 files were collected
# separately from the D6-D10 Daft listings: in D1-D5 a double is cheaper than a single in every
# area, so it is a room shared by two people; in the Daft files it is a private room with a double bed.
ROOM_FILES = {
    "D1.xlsx": "shared", "D2.xlsx": "shared", "D3.xlsx": "shared",
    "D4_rent.xlsx": "shared", "D5_rent.xlsx": "shared",
    "D6.xlsx": "private", "D7.xlsx": "private", "D8.xlsx": "private", "D9.xlsx": "private", "D10.xlsx": "private",
}
PRIVATE_ROOM_LABELS = ["single", "single & twin"]
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

# How a student can travel. Each key is a minutes column in data["commute_points"].
TRAVEL_MODES = {"public_transport": "by public transport", "walk": "on foot", "cycle": "by bike"}
CYCLING_KMH = 15  # typical city cycling speed, applied to the walking route distance

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
    amenities = _clean_columns(pd.read_csv(_path("amenity_counts_osm.csv")))
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

    # Rent tables
    is_double = room_data["Room type"] == "double"
    is_private = room_data["Room type"].isin(PRIVATE_ROOM_LABELS) | (is_double & (room_data["Double Is"] == "private"))
    is_shared = room_data["Room type"].isin(SHARED_ROOM_LABELS) | (is_double & (room_data["Double Is"] == "shared"))
    shared_room_rent = room_data[is_shared].groupby("Area")["Rent"].mean()
    private_room_rent = room_data[is_private].groupby("Area")["Rent"].mean()

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

    return {
        "area_data": area_data,
        "census": census,
        "ethnicity": ethnicity,
        "walking": walking,
        "commute_by_university": commute_by_university,
        "commute_points": commute_points,
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


# 2. SCORING HELPERS

def _rank_score(series, ascending):
    n = len(series)
    if n <= 1:
        return pd.Series(1.0, index=series.index)
    ranks = series.rank(method="average", ascending=ascending)
    return (n - ranks) / (n - 1)


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

    # Commute for this search: the chosen travel mode, from each of the 5 parts of every area
    points = data["commute_points"]
    points = points[(points["University"] == university) & points[travel_mode].notna()].copy()
    points["Minutes"] = points[travel_mode]
    points["Within Limit"] = points["Minutes"] <= max_commute if max_commute else True
    distance_column = "Distance_km" if travel_mode == "public_transport" else "Walking km"
    commute = points.groupby("Area").agg(**{
        "Commute Minutes": ("Minutes", "mean"),
        "Parts": ("Minutes", "size"),
        "Parts Within Limit": ("Within Limit", "sum"),
        "Distance_km": (distance_column, "mean"),
    }).reset_index()
    commute["Distance"] = commute["Distance_km"].map(lambda km: f"{km:.1f} km" if pd.notna(km) else None)
    fastest = points.loc[points.groupby("Area")["Minutes"].idxmin()].set_index("Area")
    area_data = data["area_data"].merge(commute, on="Area", how="left")
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
    has_data = area_data[needed_columns].notna().all(axis=1)
    candidates = area_data[has_data].copy()
    if candidates.empty:
        raise RecommendationError("No area has complete data for your accommodation type and chosen factors.")
    if max_commute:
        # Keep an area if at least one part of it is within the student's limit
        candidates = candidates[candidates["Parts Within Limit"] > 0]
        if candidates.empty:
            raise RecommendationError(
                f"No area is within {max_commute} minutes of {university} {mode_words}. "
                "Try a longer commute or another way to travel.")

    # Scores
    candidates["Rent Score"] = (1 - (candidates["Rent"] - budget).clip(lower=0) / (0.5 * budget)).clip(lower=0)
    if "Commute" in active_factors:
        candidates["Commute Score"] = _rank_score(candidates["Commute Minutes"], ascending=True)
    for factor in FACTORS:
        if factor["kind"] == "count":
            candidates[f"{factor['column']} Score"] = _rank_score(candidates[factor["column"]] / candidates["Population"], ascending=False)
        elif factor["kind"] == "group":
            sub_cols = []
            for col in factor["columns"]:
                candidates[f"{col} Score"] = _rank_score(candidates[col] / candidates["Population"], ascending=False)
                sub_cols.append(f"{col} Score")
            candidates[f"{factor['name']} Score"] = candidates[sub_cols].mean(axis=1)

    total_weight = sum(weights.values())
    for name in active_factors:
        candidates[f"{name} Contribution"] = candidates[_score_column(name)] * weights[name] / total_weight * 100
    candidates["Match Score"] = candidates[[f"{n} Contribution" for n in active_factors]].sum(axis=1)
    ranked = candidates.sort_values("Match Score", ascending=False).reset_index(drop=True)

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
            return f"has a short commute to {university} (about {value:.0f} minutes {mode_words})"
        if factor["kind"] == "rent":
            if value == ranked[col].min():
                return f"is the cheapest area for a {accommodation_name.lower()} (€{value:,.0f} a month)"
            return f"has lower rent than most areas (€{value:,.0f} a month)"
        if value == ranked[col].max():
            return f"has the most {factor['noun']} ({value:.0f})"
        return f"has more {factor['noun']} than most areas ({value:.0f})"

    def bad_sentence(name, row):
        factor = FACTOR_LOOKUP[name]
        col = factor["column"]
        value = row[col]
        if factor["kind"] == "commute":
            return f"The commute is longer – about {value:.0f} minutes to {university} {mode_words}."
        if factor["kind"] == "rent":
            return f"The rent is higher than in most areas (€{value:,.0f} a month)."
        if value == ranked[col].min():
            return f"It has the fewest {factor['noun']} of all the areas ({value:.0f})."
        return f"It has fewer {factor['noun']} than most areas ({value:.0f})."

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
            sentence = f"{row['Area']} " + _join_words([good_phrase(name, row) for name in good])
            important = [name for name in good if ratings[name] >= 3]
            if len(important) == len(good):
                sentence += (", which are all things you said matter to you" if len(good) > 1
                             else ", which you said matters to you")
            lines.append(sentence + ".")

        diff = row["Budget Difference"]
        if diff <= 0:
            lines.append(f"The average rent is €{row['Rent']:,.0f} a month, which is €{abs(diff):,.0f} less than your budget.")
        else:
            lines.append(f"The average rent is €{row['Rent']:,.0f} a month, which is €{diff:,.0f} more than your budget.")

        if n > 1:
            if position < n:
                below = ranked.iloc[position]
                reasons = why_ahead(row, below)
                if reasons:
                    lines.append(f"It ranked higher than {below['Area']} because it has {_join_words(reasons)}.")
            if position > 1:
                above = ranked.iloc[position - 2]
                reasons = why_ahead(above, row)
                if reasons:
                    lines.append(f"It ranked lower than {above['Area']} because {above['Area']} has {_join_words(reasons)}.")

        bad = [name for name in active_factors if ratings[name] >= 3 and better_or_worse(name, row) == -1]
        bad.sort(key=lambda name: ratings[name], reverse=True)
        for i, name in enumerate(bad[:2]):
            sentence = bad_sentence(name, row)
            opener = "One downside is that " if i == 0 else "Another downside is that "
            lines.append(opener + sentence[0].lower() + sentence[1:])

        if not good and n > 1:
            lines.insert(0, "This area is about average on the things you care about.")
        return lines

    def area_profile(row):
        lines = []
        if pd.notna(row.get("Population")) and row["Population"] > 0:
            students_pct = row["Students"] / row["Population"] * 100
            young_pct = row["Age_20_29"] / row["Population"] * 100
            dublin_students = census["Students"].sum() / census["Population"].sum() * 100
            dublin_young = census["Age_20_29"].sum() / census["Population"].sum() * 100
            lines.append(f"About {row['Population']:,.0f} people live here.")
            lines.append(f"{students_pct:.0f}% of people are students – "
                         f"{_compare_word(students_pct, dublin_students)} the Dublin average ({dublin_students:.0f}%).")
            lines.append(f"{young_pct:.0f}% of people are aged 20–29 – "
                         f"{_compare_word(young_pct, dublin_young)} the Dublin average ({dublin_young:.0f}%).")
        if pd.notna(row.get("Non_Irish_%")):
            groups = [c for c in ethnicity.columns if c != "Area" and pd.notna(row.get(c))]
            largest = sorted(groups, key=lambda c: row[c], reverse=True)[:2]
            group_text = " and ".join(f"{c.replace(' (%)', '')} ({row[c]:.1f}%)" for c in largest)
            lines.append(f"{row['Non_Irish_%']:.0f}% of people are not Irish. The biggest groups are {group_text}.")
        if pd.notna(row.get("Apartments_%")):
            lines.append(f"{row['Apartments_%']:.0f}% of homes are apartments.")
        return lines

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
            warning += (f" {best['Area']} does fit your budget (€{best['Rent']:,.0f}/month), but ranked lower "
                        f"overall (match score {best['Match Score']:.1f}%) because of your other preferences.")
        else:
            cheapest = ranked.loc[ranked["Rent"].idxmin()]
            warning += (f" The cheapest compared area is {cheapest['Area']} at €{cheapest['Rent']:,.0f}/month "
                        f"(€{cheapest['Rent'] - budget:,.0f} over budget).")

    def commute_info(area, row):
        """Fastest part of the area (a pin for the map) and how much of it is within the limit."""
        if area not in fastest.index:
            return None
        spot = fastest.loc[area]
        return {
            "fastest_from": spot["Landmark"],
            "fastest_minutes": round(float(spot["Minutes"])),
            "lat": float(spot["Origin_Latitude"]),
            "lon": float(spot["Origin_Longitude"]),
            "parts": int(row["Parts"]),
            "parts_within_limit": int(row["Parts Within Limit"]) if max_commute else None,
        }

    results = []
    for idx, row in top.iterrows():
        position = idx + 1
        results.append({
            "rank": position,
            "area": row["Area"],
            "lea": _none_if_nan(row.get("LEA")),
            "rent": round(float(row["Rent"]), 2),
            "budget_status": row["Budget Status"],
            "budget_difference": round(float(row["Budget Difference"]), 2),
            "commute_minutes": None if pd.isna(row["Commute Minutes"]) else round(float(row["Commute Minutes"])),
            "distance": _none_if_nan(row.get("Distance")),
            "commute": commute_info(row["Area"], row),
            "match_score": round(float(row["Match Score"]), 1),
            "walking": walking_info(row["Area"]),
            "safety": data.get("safety", {}).get(row["Area"]),
            "places_to_live": {"residences": data.get("residences", {}).get(row["Area"], []),
                               "search_links": search_links(row["Area"], accommodation, budget)},
            "why": " ".join(explain(position, row)),
            "profile": " ".join(area_profile(row)),
        })

    return {
        "university": university,
        "accommodation": accommodation_name,
        "budget": budget,
        "travel_mode": travel_mode,
        "max_commute": max_commute,
        "areas_compared": len(ranked),
        "warning": warning,
        "recommendations": results,
    }
