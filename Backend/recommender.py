"""
Dublin area recommender - importable version of "Recommendation system.py" for the web API.

Same data, factors, scoring and explanations as the notebook/terminal script, but:
  * data is read from the repo's Data/ folder (no hardcoded local path),
  * there are no input() prompts - the student's answers are passed to recommend(),
  * results are returned as JSON-friendly dicts instead of printed.
"""
import os
import re

import numpy as np
import pandas as pd

DATA_FOLDER = os.environ.get(
    "DATA_FOLDER",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "Data"),
)

# Only the TU Dublin Grangegorman commute file is in the repo so far, so the API
# recommends for that campus.
UNIVERSITY_NAME = "TU Dublin - Grangegorman"
COMMUTE_FILE = "Commute_TUD_Grangegorman.csv"

AREA_CODES_ROOMS = ["D1", "D2", "D3", "D6", "D7", "D8", "D9", "D10"]
AREA_CODES_AMENITIES = AREA_CODES_ROOMS + ["D4", "D5", "D11", "D12", "D13", "D14", "D15",
                                           "D16", "D17", "D18", "D20", "D22", "D24"]
AREAS = AREA_CODES_AMENITIES

PRIVATE_ROOM_LABELS = ["single", "single & twin"]
SHARED_ROOM_LABELS = ["double", "twin", "shared", "double & twin", "twin & shared"]

FACTORS = [
    {"name": "Rent",                   "column": "Rent",               "kind": "rent"},
    {"name": "Commute",                "column": "Commute Minutes",    "kind": "commute"},
    {"name": "Shopping & Groceries",   "column": "Shopping & Groceries",
     "columns": ["Supermarkets", "Groceries", "Shopping_Malls"],
     "kind": "group", "noun": "shopping and grocery options"},
    {"name": "Restaurants",            "column": "Restaurants",        "kind": "count", "noun": "restaurants"},
    {"name": "Healthcare",             "column": "Healthcare",
     "columns": ["Hospitals", "Pharmacies"],
     "kind": "group", "noun": "healthcare amenities"},
    {"name": "Recreation & Wellness",  "column": "Recreation & Wellness",
     "columns": ["Gyms", "Parks"],
     "kind": "group", "noun": "recreation and wellness amenities"},
]
FACTOR_LOOKUP = {f["name"]: f for f in FACTORS}

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

def load_data():
    amenities = pd.concat(
        [_clean_columns(pd.read_csv(_path(f"{a}_Amenities_Counts.csv"))) for a in AREA_CODES_AMENITIES],
        ignore_index=True,
    )
    room_data = pd.concat(
        [_clean_columns(pd.read_excel(_path(f"{a}.xlsx"))) for a in AREA_CODES_ROOMS],
        ignore_index=True,
    )
    room_data["Room type"] = room_data["Room type"].astype(str).str.strip().str.lower()

    rtb = pd.concat(
        [_clean_columns(pd.read_csv(_path(f)))
         for f in ["RTB_Clean.csv", "RTB_Clean1.csv", "RTB_Clean2.csv", "RTB_Clean3.csv"]],
        ignore_index=True,
    )
    census = _clean_columns(pd.read_excel(_path("Dublin_Census_Filled.xlsx")))
    ethnicity = _clean_columns(pd.read_excel(_path("Dublin_Ethnicity_D1_D24.xlsx")))

    commutes = _clean_columns(pd.read_csv(_path(COMMUTE_FILE))).rename(columns={"District": "Area"})
    commutes = commutes[commutes["University"] == UNIVERSITY_NAME]
    commute = (
        commutes.groupby("Area", as_index=False)
        .agg(**{"Commute Minutes": ("Travel_Time_Min", "mean"), "Distance_km": ("Distance_km", "mean")})
    )
    commute["Distance"] = commute["Distance_km"].round(1).astype(str) + " km"

    walking = _clean_columns(pd.read_excel(_path("Dublin_D1_D24_Walking_Distance_and_Time_to_University.xlsx")))
    walking = walking.rename(columns={
        "District": "Area",
        "Walking_Distance_to_University_km": "Walking km",
        "Walking_Time_to_University_Min": "Walking Minutes",
    })
    walking = walking[walking["University"] == UNIVERSITY_NAME]

    # Rent tables
    shared_room_rent = room_data[room_data["Room type"].isin(SHARED_ROOM_LABELS)].groupby("Area")["Rent"].mean()
    private_room_rent = room_data[room_data["Room type"].isin(PRIVATE_ROOM_LABELS)].groupby("Area")["Rent"].mean()

    rtb["Area"] = "D" + rtb["Location"].astype(str).str.extract(
        r"Dublin\s*(\d+W?)", flags=re.IGNORECASE, expand=False
    ).str.upper()
    rtb["VALUE"] = pd.to_numeric(rtb["VALUE"], errors="coerce")
    bedrooms = rtb["Number of Bedrooms"].astype(str).str.strip().str.lower()
    one_bed_rent = rtb[bedrooms == "one bed"].groupby("Area")["VALUE"].mean()
    two_bed_rent = rtb[bedrooms == "two bed"].groupby("Area")["VALUE"].mean()

    area_data = (
        census
        .merge(amenities, on="Area", how="left")
        .merge(ethnicity, on="Area", how="left")
        .merge(commute[["Area", "Commute Minutes", "Distance"]], on="Area", how="left")
    )
    for factor in FACTORS:
        if factor["kind"] == "group":
            area_data[factor["column"]] = area_data[factor["columns"]].sum(axis=1, skipna=False)

    return {
        "area_data": area_data,
        "census": census,
        "ethnicity": ethnicity,
        "walking": walking,
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

def recommend(data, budget, accommodation, ratings, top_n=3):
    """
    budget:        max monthly budget in euro
    accommodation: shared_room | private_room | one_bed | two_bed
    ratings:       {factor name: 1-4}; factors left out count as "Not important"
    """
    if accommodation not in data["rent_tables"]:
        raise RecommendationError(
            f"Unknown accommodation '{accommodation}'. Use one of: {', '.join(data['rent_tables'])}")
    unknown = [name for name in ratings if name not in FACTOR_LOOKUP]
    if unknown:
        raise RecommendationError(
            f"Unknown factor(s): {', '.join(unknown)}. Use: {', '.join(FACTOR_LOOKUP)}")

    accommodation_name, selected_rent = data["rent_tables"][accommodation]
    ratings = {f["name"]: int(ratings.get(f["name"], 4)) for f in FACTORS}
    weights = {name: RATING_TO_WEIGHT[r] for name, r in ratings.items()}
    active_factors = [name for name, w in weights.items() if w > 0]
    if not active_factors:
        raise RecommendationError("You rated every factor as 'Not important', so there is nothing to rank on.")

    census, ethnicity, walking = data["census"], data["ethnicity"], data["walking"]
    area_data = data["area_data"].copy()

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

    # Scores
    candidates["Rent Score"] = _rank_score(candidates["Rent"], ascending=True)
    if "Commute" in active_factors:
        candidates["Commute Score"] = _rank_score(candidates["Commute Minutes"], ascending=True)
    for factor in FACTORS:
        if factor["kind"] == "count":
            candidates[f"{factor['column']} Score"] = _rank_score(candidates[factor["column"]], ascending=False)
        elif factor["kind"] == "group":
            sub_cols = []
            for col in factor["columns"]:
                candidates[f"{col} Score"] = _rank_score(candidates[col], ascending=False)
                sub_cols.append(f"{col} Score")
            candidates[f"{factor['name']} Score"] = candidates[sub_cols].mean(axis=1)

    total_weight = sum(weights.values())
    for name in active_factors:
        candidates[f"{name} Contribution"] = candidates[_score_column(name)] * weights[name] / total_weight * 100
    candidates["Match Score"] = candidates[[f"{n} Contribution" for n in active_factors]].sum(axis=1)
    ranked = candidates.sort_values("Match Score", ascending=False).reset_index(drop=True)

    averages = ranked[[f["column"] for f in FACTORS if f["column"] in ranked]].mean()

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
                return f"is the closest to {UNIVERSITY_NAME} (only {value:.0f} minutes away)"
            return f"has a short commute to {UNIVERSITY_NAME} (about {value:.0f} minutes)"
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
            return f"The commute is longer – about {value:.0f} minutes to {UNIVERSITY_NAME}."
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
            "match_score": round(float(row["Match Score"]), 1),
            "walking": walking_info(row["Area"]),
            "why": " ".join(explain(position, row)),
            "profile": " ".join(area_profile(row)),
        })

    return {
        "university": UNIVERSITY_NAME,
        "accommodation": accommodation_name,
        "budget": budget,
        "areas_compared": len(ranked),
        "warning": warning,
        "recommendations": results,
    }
