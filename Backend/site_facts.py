"""What the website shows, as short reference lines for the AI assistant (chat.py), so it answers from the site's own
figures instead of guessing: commute times to each college, each area's people, amenities and Luas stops, the
student residences, the colleges and the Things to know checklist. (Rent, places and safety: district_rent.py.)

Every function returns "" if its file is missing, so the assistant still starts without it.
"""
import csv
import json
import re
import statistics
from collections import defaultdict
from pathlib import Path

import district_rent

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "Data"
FRONTEND = ROOT / "Frontend"

# The colleges as the questionnaire names them -> the short names used in the commute lines
COLLEGE_SHORT = {
    "University College Dublin - Belfield": "UCD",
    "Trinity College Dublin": "Trinity",
    "Dublin City University - Glasnevin": "DCU Glasnevin",
    "DCU - St Patrick's Campus": "DCU St Patrick's",
    "TU Dublin - Grangegorman": "TU Grangegorman",
    "TU Dublin - Aungier Street": "TU Aungier St",
    "TU Dublin - Bolton Street": "TU Bolton St",
    "TU Dublin - Blanchardstown": "TU Blanchardstown",
    "TU Dublin - Tallaght": "TU Tallaght",
    "Royal College of Surgeons Ireland": "RCSI",
    "National College of Ireland - IFSC": "NCI",
    "National College of Art and Design": "NCAD",
    "Griffith College Dublin": "Griffith",
    "Dublin Business School": "DBS",
    "IADT - Dun Laoghaire": "IADT",
    "Maynooth University": "Maynooth",
}
AMENITY_NAMES = [("supermarket", "supermarkets"), ("grocery", "convenience and grocery shops"), ("restaurant", "restaurants"),
                 ("cafe", "cafés"), ("gym", "gyms"), ("park", "parks"), ("pharmacy", "pharmacies"),
                 ("hospital", "hospitals")]


def _read_json(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _name(data, code):
    return data.get("profiles", {}).get(code, {}).get("name", "")


def commute_text(data, rec_data=None):
    """Public transport minutes from each area to each college: the middle and range over all the places in the area
    the results page scores, and the quickest one. With the recommender's data (rec_data, as app.py loads it) these
    are exactly the results page's figures, worked out by the recommender itself, including its rule that a walk is
    used when it's quicker. Without it (tests, or before the data loads) they come from the timetable files."""
    door = defaultdict(lambda: defaultdict(dict))   # area -> college -> place -> minutes the results page shows
    walking = defaultdict(lambda: defaultdict(list))  # area -> college -> walking minutes
    cycling = defaultdict(lambda: defaultdict(list))  # area -> college -> cycling minutes
    if rec_data is not None:
        import recommender

        for college in COLLEGE_SHORT:
            if college not in rec_data.get("universities", []):
                continue
            pt = recommender._part_commutes(rec_data, college, "public_transport").set_index(["Area", "Part"])["Minutes"]
            walk = recommender._part_commutes(rec_data, college, "walk").set_index(["Area", "Part"])["Minutes"]
            bike = recommender._part_commutes(rec_data, college, "cycle").set_index(["Area", "Part"])["Minutes"]
            for (area, part), m in bike.items():
                if m == m:
                    cycling[area][college].append(float(m))
            for (area, part) in pt.index.union(walk.index):
                options = [float(m) for m in (pt.get((area, part)), walk.get((area, part)))
                           if m is not None and m == m]  # m == m: not NaN
                if options:
                    door[area][college][part] = min(options)
                w = walk.get((area, part))
                if w is not None and w == w:
                    walking[area][college].append(float(w))
    else:
        sources = [("commute_otp.csv", "Landmark"), ("commute_otp_county.csv", "Landmark"),
                   ("commute_otp_neighbourhoods.csv", "Neighbourhood")]
        raw = defaultdict(lambda: defaultdict(lambda: defaultdict(dict)))
        for name, place_column in sources:
            try:
                with open(DATA / name, encoding="utf-8") as f:
                    for row in csv.DictReader(f):
                        try:
                            raw[row["Area"]][row["University"]][row[place_column]][row["Mode"]] = float(row["Minutes"])
                        except (KeyError, ValueError):
                            continue
            except OSError:
                continue
        for area, colleges in raw.items():
            for college, places in colleges.items():
                for place, modes in places.items():
                    options = [m for m in (modes.get("public_transport"), modes.get("walk")) if m is not None]
                    if options:
                        door[area][college][place] = min(options)
                    if modes.get("walk") is not None:
                        walking[area][college].append(modes["walk"])
                    if modes.get("cycle") is not None:
                        cycling[area][college].append(modes["cycle"])
    lines = []
    for code in district_rent.areas(data):
        if code not in door:
            continue
        bus, walk, bike = [], [], []
        for college, short in COLLEGE_SHORT.items():
            places = door[code].get(college, {})
            if places:
                values = sorted(places.values())
                quickest = min(places, key=places.get)
                bus.append(f"{short} {statistics.median(values):.0f} ({values[0]:.0f}-{values[-1]:.0f}, quickest from {quickest})")
            rides = cycling[code].get(college, [])
            if rides:
                bike.append(f"{short} {statistics.median(rides):.0f}")
            walks = walking[code].get(college, [])
            if walks and statistics.median(walks) <= 30:
                walk.append(f"{short} {statistics.median(walks):.0f}")
        if bus:
            lines.append(f"- {code} {_name(data, code)}: " + ", ".join(bus)
                         + (f". Walkable: {', '.join(walk)} min." if walk else ".")
                         + (f" By bike (typical): {', '.join(bike)} min." if bike else ""))
    return "\n".join(lines)


# The chain buttons on the district profile's Amenities tab, in the same groups (shopChains.js CHAIN_GROUPS)
CHAIN_GROUPS = [
    ("supermarkets", [("tesco", "Tesco"), ("lidl", "Lidl"), ("aldi", "Aldi"), ("dunnes", "Dunnes Stores"),
                      ("supervalu", "SuperValu"), ("ms", "M&S Food")]),
    ("convenience shops", [("spar", "Spar"), ("centra", "Centra"), ("mace", "Mace"), ("londis", "Londis"),
                           ("costcutter", "Costcutter"), ("daybreak", "Daybreak"), ("circlek", "Circle K")]),
    ("international food", [("polonez", "Polonez (Polish)"), ("asian", "Asian markets")]),
]


def chain_counts():
    """{area: {chain: shops}} from the map's chain shop file, counting one shop where OpenStreetMap maps the same
    chain twice within about 40 m (as amenityData.js does), so the numbers match the Amenities tab."""
    found = _read_json(FRONTEND / "public" / "data" / "dublin-chain-shops.json") or {}
    kept = []
    for shop in found.get("shops", []):
        if not any(k["chain"] == shop["chain"] and abs(k["lat"] - shop["lat"]) < 0.0004 and abs(k["lng"] - shop["lng"]) < 0.0006
                   for k in kept):
            kept.append(shop)
    counts = defaultdict(lambda: defaultdict(int))
    for shop in kept:
        counts[shop["district"]][shop["chain"]] += 1
    return counts


def area_facts_text(data):
    """Each area's people (Census 2022), the amenities and shop chains the district profile counts, and its Luas
    stops."""
    census = dict(data.get("census", {}))
    county = _read_json(FRONTEND / "public" / "data" / "county-dublin-profiles.json") or {}
    census.update(county.get("census", {}))
    counts = (_read_json(FRONTEND / "public" / "data" / "dublin-amenity-counts.json") or {}).get("counts", {})
    chains = chain_counts()
    # Census figures are for local electoral areas, and some cover more than one district (e.g. D10, D12 and D20)
    sharing = defaultdict(list)
    for code, c in census.items():
        if c.get("LEA"):
            sharing[c["LEA"]].append(code)
    luas = defaultdict(list)
    for stop in data.get("stops", []):
        if stop.get("d"):
            luas[stop["d"]].append(f"{stop['name']} ({stop.get('line', '')})")
    lines = []
    for code in district_rent.areas(data):
        bits = []
        c = census.get(code) or {}
        if c.get("Population"):
            pop = float(c["Population"])
            people = f"population {pop:,.0f}"
            if c.get("Age_20_29"):
                people += f", {float(c['Age_20_29']) / pop * 100:.0f}% aged 20-29"
            if c.get("Students"):
                people += f", {float(c['Students']) / pop * 100:.0f}% students"
            if c.get("Non_Irish_%") is not None:
                people += f", {c['Non_Irish_%']}% born outside Ireland"
            if c.get("Apartments_%") is not None:
                people += f", {c['Apartments_%']}% of homes are apartments"
            if c.get("Internet_Access_%") is not None:
                people += f", {c['Internet_Access_%']}% have internet at home"
            others = [d for d in sharing.get(c.get("LEA"), []) if d != code]
            if others:
                people += f" (Census figures for the whole {c['LEA']} electoral area, which it shares with {', '.join(others)})"
            bits.append(people)
        n = counts.get(code) or {}
        if n:
            bits.append("amenities: " + ", ".join(f"{n[k]} {label}" for k, label in AMENITY_NAMES if n.get(k) is not None))
        here = chains.get(code, {})
        groups = []
        for group, names in CHAIN_GROUPS:
            listed = [f"{label} {here[key]}" for key, label in names if here.get(key)]
            groups.append(f"{group}: {', '.join(listed) if listed else 'none'}")
        bits.append("shop chains (" + "; ".join(groups) + ")")
        if luas.get(code):
            bits.append("Luas stops: " + ", ".join(luas[code]))
        if bits:
            lines.append(f"- {code} {_name(data, code)}: " + "; ".join(bits) + ".")
    return "\n".join(lines)


def residences_text():
    """The purpose-built student residences on the map, by area, with their published starting prices."""
    found = _read_json(FRONTEND / "public" / "data" / "student-residences.json") or {}
    by_area = defaultdict(list)
    for r in found.get("residences", []):
        price = ""
        if r.get("from"):
            price = f", from €{r['from']:,}" + (f" to €{r['to']:,}" if r.get("to") else "") + " a month"
        rooms = f", {r['rooms']}" if r.get("rooms") else ""
        operator = f" ({r['operator']})" if r.get("operator") else ""
        where = f", {r['address']}" if r.get("address") else ""
        site = f", {r['website']}" if r.get("website") else ""
        by_area[r.get("district") or "?"].append(f"{r['name']}{operator}{where}{price}{rooms}{site}")
    order = {code: i for i, code in enumerate(district_rent.areas(district_rent.load_profile_data()))}
    return "\n".join(f"- {area}: " + "; ".join(items) for area, items in sorted(by_area.items(), key=lambda kv: order.get(kv[0], 99)))


def _js_objects(source, array_name):
    """The objects of a simple JS array of string fields in a page file ([{name: '...', location: "..."}, ...]), as
    dicts of their string fields. Only quoted strings are read; anything else is skipped."""
    try:
        start = source.index(f"const {array_name} = [")
    except ValueError:
        return []
    block = source[start:source.index("\n]", start)]
    objects = []
    for chunk in re.split(r"\n  \{", block)[1:]:
        fields = {m.group(1): m.group(3).replace("\\'", "'") for m in
                  re.finditer(r"\b(\w+): (['\"])((?:\\.|(?!\2).)*)\2", chunk)}
        if fields.get("name"):
            objects.append(fields)
    return objects


def _city_guide():
    try:
        return (FRONTEND / "pages" / "CityGuide.jsx").read_text(encoding="utf-8")
    except OSError:
        return ""


def colleges_text():
    """The colleges on the Universities page: where each is and its website."""
    return "\n".join(f"- {c['name']}: {c.get('location', '')}" + (f", {c['url']}" if c.get("url") else "")
                     for c in _js_objects(_city_guide(), "universities"))


def attractions_text():
    """The Famous attractions page: each place, what it is, where, and its website."""
    return "\n".join(f"- {a['name']} ({a.get('category', '').lower()}), {a.get('location', '')}: {a.get('detail', '')}"
                     + (f" {a['url']}" if a.get("url") else "") for a in _js_objects(_city_guide(), "attractions"))


def letting_agents_text():
    """The letting agents on the results page, with the areas they cover and their PSRA licence."""
    try:
        with open(DATA / "letting_agencies.csv", encoding="utf-8") as f:
            rows = list(csv.DictReader(f))
    except OSError:
        return ""
    return "\n".join(f"- {r['Name']} ({r.get('Areas', '').strip()}): {r.get('Address', '').strip()}, {r.get('Website', '').strip()}"
                     + (f", PSRA licence {r['PSRA_Licence'].strip().zfill(6)}" if r.get("PSRA_Licence", "").strip() else "")
                     for r in rows if r.get("Name"))


def faq_text():
    """The questions and answers in the home page FAQ, as plain text."""
    try:
        source = (FRONTEND / "pages" / "HomeFaq.jsx").read_text(encoding="utf-8")
    except OSError:
        return ""
    lines = []
    for q, a in re.findall(r"q: '((?:\\'|[^'])*)',\s*a: <>(.*?)</>,?\s*\n\s*\}", source, re.S):
        answer = re.sub(r"<[^>]+>", "", a)  # links keep their words
        lines.append(f"- {q.replace(chr(92) + chr(39), chr(39))} {' '.join(answer.split())}")
    return "\n".join(lines)


def luas_text(data):
    """How often the Luas lines run (the district profile's journey information)."""
    lines = data.get("lines") or {}
    out = []
    for line, info in lines.items():
        every = info.get("interval")
        peak = info.get("peak")
        if every:
            out.append(f"{line.title()} line about every {every} minutes" + (f" ({peak} at peak times)" if peak else ""))
    return "; ".join(out)


def things_to_know_text():
    """The Things to know arrival checklist: each step, why it matters, how to do it and the official link."""
    found = _read_json(FRONTEND / "pages" / "things-to-know.json") or {}
    lines = []
    for phase in found.get("phases", []):
        lines.append(f"{phase['title']}:")
        for item in phase.get("items", []):
            how = " ".join(item.get("how", []))
            link = item.get("link") or []
            lines.append(f"- {item['title']}: {item.get('why', '')} {how}" + (f" Official: {link[1]}" if len(link) > 1 else ""))
    return "\n".join(lines)
