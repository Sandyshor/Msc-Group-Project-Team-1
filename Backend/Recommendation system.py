# DUBLIN RESIDENTIAL AREA RECOMMENDATION PROTOTYPE
import os
import re
import textwrap
import numpy as np
import pandas as pd

DATA_FOLDER = r"F:\Msc Dissertation\Colab dataset"
os.chdir(DATA_FOLDER)

# 1. LOAD THE DATA
def clean_columns(df):
    df.columns = df.columns.str.strip()
    return df


# Areas with room-listing data (.xlsx) are a subset of areas with amenity data -
# D4, D5, D11-D13 only have amenity counts so far, no room listings to compute
# Shared/Private Room rent from (they still work for the two apartment types, which
# price from RTB instead).
AREA_CODES_ROOMS = ["D1", "D2", "D3", "D6", "D7", "D8", "D9", "D10"]
AREA_CODES_AMENITIES = AREA_CODES_ROOMS + ["D4", "D5", "D11", "D12", "D13", "D14", "D15", "D16", "D17","D18","D20", "D22","D24"]

amenities = pd.concat(
    [clean_columns(pd.read_csv(f"{a}_Amenities_Counts.csv")) for a in AREA_CODES_AMENITIES],
    ignore_index=True,
)

room_data = pd.concat(
    [clean_columns(pd.read_excel(f"{a}.xlsx")) for a in AREA_CODES_ROOMS],
    ignore_index=True,
)
room_data["Room type"] = room_data["Room type"].astype(str).str.strip().str.lower()

rtb = pd.concat(
    [clean_columns(pd.read_csv(f)) for f in ["RTB_Clean.csv", "RTB_Clean1.csv", "RTB_Clean2.csv", "RTB_Clean3.csv"]],
    ignore_index=True,
)

census = clean_columns(pd.read_excel("Dublin_Census_Filled.xlsx"))
ethnicity = clean_columns(pd.read_excel("Dublin_Ethnicity_D1_D24.xlsx"))

commutes = clean_columns(pd.read_csv("Dublin_D1_D24_All_University_Commutes_clean_updated.csv"))
commutes = commutes.rename(columns={"District": "Area"})

walking = clean_columns(pd.read_excel("Dublin_D1_D24_Walking_Distance_and_Time_to_University.xlsx"))
walking = walking.rename(columns={
    "District": "Area",
    "Walking_Distance_to_University_km": "Walking km",
    "Walking_Time_to_University_Min": "Walking Minutes",
})

print("All datasets loaded successfully.")

# 2. BUILD ONE COMMUTE VALUE PER AREA + UNIVERSITY
# The raw file has several landmark rows per area/university pair; average them into a
# single "typical" commute time and distance for that pair.
commute_by_university = (
    commutes.groupby(["Area", "University"], as_index=False)
    .agg(**{"Commute Minutes": ("Travel_Time_Min", "mean"), "Distance_km": ("Distance_km", "mean")})
)
commute_by_university["Distance"] = commute_by_university["Distance_km"].round(1).astype(str) + " km"

UNIVERSITIES = sorted(commute_by_university["University"].unique())

# 3. RENT TABLES
# Room data: labels vary across areas (D1-D3 only use "single"/"double"; D6-D10 also
# use variants like "twin", "shared", "single & twin"), so match on the full set of
# labels that mean the same thing rather than the exact string "single"/"double".
PRIVATE_ROOM_LABELS = ["single", "single & twin"]
SHARED_ROOM_LABELS = ["double", "twin", "shared", "double & twin", "twin & shared"]

shared_room_rent = room_data[room_data["Room type"].isin(SHARED_ROOM_LABELS)].groupby("Area")["Rent"].mean()
private_room_rent = room_data[room_data["Room type"].isin(PRIVATE_ROOM_LABELS)].groupby("Area")["Rent"].mean()

rtb["Area"] = "D" + rtb["Location"].astype(str).str.extract(
    r"Dublin\s*(\d+W?)", flags=re.IGNORECASE, expand=False
).str.upper()
rtb["VALUE"] = pd.to_numeric(rtb["VALUE"], errors="coerce")
bedrooms = rtb["Number of Bedrooms"].astype(str).str.strip().str.lower()

one_bed_rent = rtb[bedrooms == "one bed"].groupby("Area")["VALUE"].mean()
two_bed_rent = rtb[bedrooms == "two bed"].groupby("Area")["VALUE"].mean()

# 4. COMBINE AREA DATA
# Commute isn't merged in yet - it depends on which university the student picks,
# which happens later in Section 6.

area_data = (
    census
    .merge(amenities, on="Area", how="left")
    .merge(ethnicity, on="Area", how="left")
)

# 5. FACTOR DEFINITIONS
# "group" factors combine several amenities into one student-facing category. By
# default the category is scored as one factor: the average of its amenities'
# normalized (0-1) sub-scores, so no single amenity dominates. The "column" on a
# group is a combined raw count used only for display text (e.g. "has the most
# shopping and grocery options (62)").
# A student can optionally rate a category's "items" separately instead; those
# items then replace the category in the scoring as individual factors.
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
ITEM_FACTORS = [dict(item, kind="count") for f in FACTORS if f["kind"] == "group" for item in f["items"]]
FACTOR_LOOKUP = {f["name"]: f for f in FACTORS + ITEM_FACTORS}

# Build the combined raw-count column for each group factor (NaN propagates if any
# sub-amenity is missing, so the "has complete data" check in Section 8 still works).
for factor in FACTORS:
    if factor["kind"] == "group":
        factor["columns"] = [item["column"] for item in factor["items"]]
        area_data[factor["column"]] = area_data[factor["columns"]].sum(axis=1, skipna=False)

RATING_LABELS = {1: "Very important", 2: "Important", 3: "Slightly important", 4: "Not important"}
RATING_TO_WEIGHT = {1: 3, 2: 2, 3: 1, 4: 0}   # "Not important" contributes nothing

# 6. GET STUDENT INPUT

def ask_choice(prompt, valid):
    while True:
        answer = input(prompt).strip()
        if answer in valid:
            return answer
        print(f"Please enter one of: {', '.join(valid)}")


def ask_positive_number(prompt):
    while True:
        try:
            value = float(input(prompt).strip().replace("€", "").replace(",", ""))
            if value > 0:
                return value
        except ValueError:
            pass
        print("Please enter a positive number, e.g. 900")


print("\n==========================================")
print(" DUBLIN RESIDENTIAL AREA RECOMMENDER")
print("==========================================")

print("\nUniversity:")
for i, uni in enumerate(UNIVERSITIES, start=1):
    print(f"{i} = {uni}")
university_choice = ask_choice(
    f"\nEnter your university (1-{len(UNIVERSITIES)}): ",
    [str(i) for i in range(1, len(UNIVERSITIES) + 1)],
)
university_name = UNIVERSITIES[int(university_choice) - 1]

area_data = area_data.merge(
    commute_by_university.loc[
        commute_by_university["University"] == university_name,
        ["Area", "Commute Minutes", "Distance"],
    ],
    on="Area",
    how="left",
)

budget = ask_positive_number("Enter your maximum monthly accommodation budget (€): ")

ACCOMMODATION = {
    "1": ("Shared Room", shared_room_rent),
    "2": ("Private Room", private_room_rent),
    "3": ("One Bedroom Apartment", one_bed_rent),
    "4": ("Two Bedroom Apartment", two_bed_rent),
}
print("\nAccommodation options:")
for key, (label, _) in ACCOMMODATION.items():
    print(f"{key} = {label}")
accommodation_name, selected_rent = ACCOMMODATION[ask_choice("\nEnter accommodation option (1-4): ", list(ACCOMMODATION))]

print("\nRate the importance of each factor.")
for k, v in RATING_LABELS.items():
    print(f"{k} = {v.capitalize()}")

# Only the factors that end up in the scoring get a rating: a category, or - if the
# student chose to rate its amenities separately - those amenities in its place.
ratings = {}
for factor in FACTORS:
    rating = int(ask_choice(f"{factor['name']}: ", ["1", "2", "3", "4"]))
    if factor["kind"] != "group":
        ratings[factor["name"]] = rating
        continue

    item_names = [item["name"] for item in factor["items"]]
    item_text = ", ".join(item_names[:-1]) + " and " + item_names[-1]
    separately = ask_choice(f"  Set priorities for {item_text} separately? (y/n): ",
                            ["y", "n", "Y", "N"]).lower() == "y"
    if not separately:
        ratings[factor["name"]] = rating
    else:
        for name in item_names:
            ratings[name] = int(ask_choice(f"    {name}: ", ["1", "2", "3", "4"]))

weights = {name: RATING_TO_WEIGHT[r] for name, r in ratings.items()}
active_factors = [name for name, w in weights.items() if w > 0]

if not active_factors:
    raise SystemExit("\nYou rated every factor as 'Not important', so there is nothing to rank on.")

# 7. RENT + BUDGET

area_data["Rent"] = area_data["Area"].map(selected_rent)
area_data["Budget Difference"] = area_data["Rent"] - budget
area_data["Budget Status"] = np.select(
    [area_data["Rent"].isna(), area_data["Rent"] <= budget],
    ["Rent data unavailable", "Within budget"],
    default="Above budget",
)

# 8. KEEP ONLY AREAS WITH DATA FOR EVERY FACTOR THE USER CARES ABOUT


def factor_columns(factor):
    """The underlying data column(s) a factor needs. Group factors need every
    sub-amenity column, not just their combined display column."""
    return factor.get("columns", [factor["column"]])


needed_columns = []
for name in active_factors:
    needed_columns.extend(factor_columns(FACTOR_LOOKUP[name]))
needed_columns = list(dict.fromkeys(needed_columns + ["Rent"]))  # rent always needed

has_data = area_data[needed_columns].notna().all(axis=1)
candidates = area_data[has_data].copy()
excluded = area_data[~has_data].copy()


def missing_reason(row):
    missing = []
    if pd.isna(row["Rent"]):
        missing.append(f"{accommodation_name.lower()} rent")
    amenity_cols = [c for c in needed_columns if c not in ("Rent", "Commute Minutes")]
    if any(pd.isna(row[c]) for c in amenity_cols):
        missing.append("amenity counts")
    if pd.isna(row["Commute Minutes"]):
        missing.append("commute time")
    return " and ".join(missing)


if candidates.empty:
    raise SystemExit("\nNo area has complete data for your accommodation type and chosen factors.")


# 9. SCORES (0-1, higher = better), computed on the candidate set.
def rank_score(series, ascending):
    """Score 0-1 by rank position among candidates rather than by raw value, so a
    factor's influence on the Match Score depends only on its weight - not on how
    close together or spread out the candidate areas happen to be on that factor."""
    n = len(series)
    if n <= 1:
        return pd.Series(1.0, index=series.index)
    ranks = series.rank(method="average", ascending=ascending)  # rank 1 = best
    return (n - ranks) / (n - 1)


# Rent is ranked like everything else (cheapest candidate scores highest), so being
# further under budget keeps mattering instead of every affordable area tying at 1.0.
# The budget figure itself still drives "within/above budget" in the displayed text.
candidates["Rent Score"] = rank_score(candidates["Rent"], ascending=True)
candidates["Commute Score"] = rank_score(candidates["Commute Minutes"], ascending=True)

for factor in FACTORS:
    if factor["kind"] == "count":
        col = factor["column"]
        candidates[f"{col} Score"] = rank_score(candidates[col], ascending=False)
    elif factor["kind"] == "group":
        sub_score_cols = []
        for col in factor["columns"]:
            candidates[f"{col} Score"] = rank_score(candidates[col], ascending=False)
            sub_score_cols.append(f"{col} Score")
        # Category score = average of its sub-amenities' rank-based scores, so no single
        # sub-amenity dominates the category.
        candidates[f"{factor['name']} Score"] = candidates[sub_score_cols].mean(axis=1)


def score_column(name):
    factor = FACTOR_LOOKUP[name]
    if factor["kind"] == "rent":
        return "Rent Score"
    if factor["kind"] == "commute":
        return "Commute Score"
    if factor["kind"] == "group":
        return f"{factor['name']} Score"
    return f"{factor['column']} Score"


total_weight = sum(weights.values())

for name in active_factors:
    candidates[f"{name} Contribution"] = candidates[score_column(name)] * weights[name] / total_weight * 100

candidates["Match Score"] = candidates[[f"{n} Contribution" for n in active_factors]].sum(axis=1)
recommendations = candidates.sort_values("Match Score", ascending=False).reset_index(drop=True)

# 10.  RECOMMENDATION EXPLANATION

def better_or_worse(name, row, averages):

    factor = FACTOR_LOOKUP[name]
    value, avg = row[factor["column"]], averages[factor["column"]]
    if avg == 0 or abs(value - avg) / abs(avg) < 0.10:   # within 10% = similar
        return 0
    lower_is_better = factor["kind"] in ("rent", "commute")
    better = value < avg if lower_is_better else value > avg
    return 1 if better else -1


def good_phrase(name, row, ranked):

    factor = FACTOR_LOOKUP[name]
    value = row[factor["column"]]
    col = factor["column"]
    if factor["kind"] == "commute":
        if value == ranked[col].min():
            return f"is the closest to {university_name} (only {value:.0f} minutes away)"
        return f"has a short commute to {university_name} (about {value:.0f} minutes)"
    if factor["kind"] == "rent":
        if value == ranked[col].min():
            return f"is the cheapest area for a {accommodation_name.lower()} (€{value:,.0f} a month)"
        return f"has lower rent than most areas (€{value:,.0f} a month)"
    if value == ranked[col].max():
        return f"has the most {factor['noun']} ({value:.0f})"
    return f"has more {factor['noun']} than most areas ({value:.0f})"


def bad_sentence(name, row, ranked):

    factor = FACTOR_LOOKUP[name]
    value = row[factor["column"]]
    col = factor["column"]
    if factor["kind"] == "commute":
        return f"The commute is longer – about {value:.0f} minutes to {university_name}."
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


def why_ahead(row_a, row_b, top_n=2):

    gaps = []
    for name in active_factors:
        gap = row_a[f"{name} Contribution"] - row_b[f"{name} Contribution"]
        if gap > 0.05:
            gaps.append((name, gap))
    gaps.sort(key=lambda x: x[1], reverse=True)
    return [short_name(name) for name, _ in gaps[:top_n]]


def join_words(items):
    if len(items) <= 1:
        return "".join(items)
    return ", ".join(items[:-1]) + " and " + items[-1]


def explain(position, row, ranked, averages):
    lines = []
    n = len(ranked)

    # 1. Things this area is good at (only factors the student cares about)
    good = [name for name in active_factors if better_or_worse(name, row, averages) == 1]
    good.sort(key=lambda name: ratings[name], reverse=True)
    good = good[:3]
    if good:
        sentence = f"{row['Area']} " + join_words([good_phrase(name, row, ranked) for name in good])
        important = [name for name in good if ratings[name] >= 3]
        if len(important) == len(good):
            sentence += ", which are all things you said matter to you" if len(good) > 1 else ", which you said matters to you"
        lines.append(sentence + ".")

    # 2. Budget
    diff = row["Budget Difference"]
    if diff <= 0:
        lines.append(f"The average rent is €{row['Rent']:,.0f} a month, which is €{abs(diff):,.0f} less than your budget.")
    else:
        lines.append(f"The average rent is €{row['Rent']:,.0f} a month, which is €{diff:,.0f} more than your budget.")

    # 3. Compared with the areas next to it in the ranking
    if n > 1:
        if position < n:
            below = ranked.iloc[position]
            reasons = why_ahead(row, below)
            if reasons:
                lines.append(f"It ranked higher than {below['Area']} because it has {join_words(reasons)}.")
        if position > 1:
            above = ranked.iloc[position - 2]
            reasons = why_ahead(above, row)
            if reasons:
                lines.append(f"It ranked lower than {above['Area']} because {above['Area']} has {join_words(reasons)}.")

    # 4. Downsides on things the student said are important
    bad = [name for name in active_factors
           if ratings[name] >= 3 and better_or_worse(name, row, averages) == -1]
    bad.sort(key=lambda name: ratings[name], reverse=True)
    for i, name in enumerate(bad[:2]):
        sentence = bad_sentence(name, row, ranked)
        opener = "One downside is that " if i == 0 else "Another downside is that "
        lines.append(opener + sentence[0].lower() + sentence[1:])

    if not good and n > 1:
        lines.insert(0, "This area is about average on the things you care about.")
    return lines


def compare_word(value, average):
    if abs(value - average) < 1:
        return "about the same as"
    return "more than" if value > average else "less than"


def area_profile(row):
    lines = []
    if pd.notna(row.get("Population")) and row["Population"] > 0:
        students_pct = row["Students"] / row["Population"] * 100
        young_pct = row["Age_20_29"] / row["Population"] * 100
        dublin_students = census["Students"].sum() / census["Population"].sum() * 100
        dublin_young = census["Age_20_29"].sum() / census["Population"].sum() * 100
        lines.append(f"About {row['Population']:,.0f} people live here.")
        lines.append(f"{students_pct:.0f}% of people are students – "
                     f"{compare_word(students_pct, dublin_students)} the Dublin average ({dublin_students:.0f}%).")
        lines.append(f"{young_pct:.0f}% of people are aged 20–29 – "
                     f"{compare_word(young_pct, dublin_young)} the Dublin average ({dublin_young:.0f}%).")
    if pd.notna(row.get("Non_Irish_%")):
        groups = [c for c in ethnicity.columns if c != "Area" and pd.notna(row.get(c))]
        largest = sorted(groups, key=lambda c: row[c], reverse=True)[:2]
        group_text = " and ".join(f"{c.replace(' (%)', '')} ({row[c]:.1f}%)" for c in largest)
        lines.append(f"{row['Non_Irish_%']:.0f}% of people are not Irish. The biggest groups are {group_text}.")
    if pd.notna(row.get("Apartments_%")):
        lines.append(f"{row['Apartments_%']:.0f}% of homes are apartments.")
    return lines

def in_notebook():
    """True when running inside Jupyter/Colab, where HTML (and so a clickable
    dropdown) can be displayed."""
    try:
        from IPython import get_ipython
        return get_ipython().__class__.__name__ in ("ZMQInteractiveShell", "Shell")
    except Exception:
        return False


def show_walking_distances(area):
    """Print the average walking distance from the chosen university to the area,
    with the per-landmark distances in a dropdown (notebook) or an on-request list
    (terminal)."""
    area_walks = walking[(walking["Area"] == area) & (walking["University"] == university_name)]
    known = area_walks.dropna(subset=["Walking km"])
    if known.empty:
        print(f"Walking:       no walking data from {area} to {university_name}")
        return

    print(f"Walking:       average {known['Walking km'].mean():.2f} km "
          f"(about {known['Walking Minutes'].mean():.0f} min) from {area} to {university_name}")

    lines = []
    for _, walk in area_walks.iterrows():
        place = f"{walk['Landmark']} ({walk['Direction']}, {area})"
        if pd.notna(walk["Walking km"]):
            lines.append(f"Distance from {place} to {university_name} is {walk['Walking km']:.2f} km "
                         f"(about {walk['Walking Minutes']:.0f} min walk)")
        else:
            lines.append(f"Distance from {place} to {university_name} is not available")

    if in_notebook():
        from html import escape
        from IPython.display import HTML, display
        items = "".join(f"<li>{escape(line)}</li>" for line in lines)
        display(HTML(f"<details><summary>Show walking distance to each place in {area}</summary>"
                     f"<ul>{items}</ul></details>"))
    else:
        answer = input(f"  Show walking distance to each place in {area}? (y/n): ").strip().lower()
        if answer in ("y", "yes"):
            for line in lines:
                print(f"    {line}")


# 11. DISPLAY TOP 3 RECOMMENDATION

column_averages = recommendations[[f["column"] for f in FACTOR_LOOKUP.values() if f["column"] in recommendations]].mean()

print("\n\n==========================================")
print(" TOP 3 RECOMMENDED AREAS")
print("==========================================")
print(f"Compared {len(recommendations)} area(s) for a {accommodation_name.lower()}, budget €{budget:,.0f}.")

# Flag it clearly when the budget doesn't actually fit the top picks, since the
# ranking can still surface areas that are well above budget if Rent wasn't
# weighted heavily (or at all) among the student's chosen factors.
if (recommendations.head(3)["Budget Status"] == "Above budget").all():
    affordable = recommendations[recommendations["Budget Status"] == "Within budget"]
    print(f"\nWARNING: None of the top 3 areas fit your €{budget:,.0f} budget for a {accommodation_name.lower()}.")
    if not affordable.empty:
        best_affordable = affordable.loc[affordable["Match Score"].idxmax()]
        print(f"  {best_affordable['Area']} does fit your budget (€{best_affordable['Rent']:,.0f}/month), "
              f"but ranked lower overall (match score {best_affordable['Match Score']:.1f}%) because of your other preferences.")
    else:
        cheapest = recommendations.loc[recommendations["Rent"].idxmin()]
        over_by = cheapest["Rent"] - budget
        print(f"  No compared area fits this budget for a {accommodation_name.lower()}. "
              f"The cheapest is {cheapest['Area']} at €{cheapest['Rent']:,.0f}/month (€{over_by:,.0f} over budget).")

explanations = {}
for position, row in recommendations.head(3).iterrows():
    position += 1
    print("\n------------------------------------------")
    print(f"#{position} {row['Area']}" + (f" ({row['LEA']})" if pd.notna(row.get("LEA")) else ""))
    print("------------------------------------------")
    print(f"Average rent:  €{row['Rent']:,.2f}  ({row['Budget Status'].lower()})")
    print(f"Commute:       {row['Commute Minutes']:.0f} min, {row['Distance']}")
    print(f"Match score:   {row['Match Score']:.1f}%")

    show_walking_distances(row["Area"])

    why_paragraph = " ".join(explain(position, row, recommendations, column_averages))
    print(f"\nWhy {row['Area']} is #{position}:")
    print(textwrap.fill(why_paragraph, width=90))

    profile = area_profile(row)
    if profile:
        print("\nAbout this area:")
        print(textwrap.fill(" ".join(profile), width=90))

    explanations[row["Area"]] = why_paragraph
