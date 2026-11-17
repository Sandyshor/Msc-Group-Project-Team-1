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


def commute_text(data):
    """Typical public transport minutes from each area to each college (the middle of the area's starting points,
    weekday morning, from the same timetable data as the results page), plus colleges within a 30-minute walk."""
    times = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))  # area -> college -> mode -> [minutes]
    for name in ("commute_otp.csv", "commute_otp_county.csv"):
        try:
            with open(DATA / name, encoding="utf-8") as f:
                for row in csv.DictReader(f):
                    try:
                        times[row["Area"]][row["University"]][row["Mode"]].append(float(row["Minutes"]))
                    except (KeyError, ValueError):
                        continue
        except OSError:
            continue
    lines = []
    for code in district_rent.areas(data):
        if code not in times:
            continue
        bus, walk = [], []
        for college, short in COLLEGE_SHORT.items():
            modes = times[code].get(college, {})
            if modes.get("public_transport"):
                pt = sorted(modes["public_transport"])
                bus.append(f"{short} {statistics.median(pt):.0f} ({pt[0]:.0f}-{pt[-1]:.0f})")
            if modes.get("walk") and statistics.median(modes["walk"]) <= 30:
                walk.append(f"{short} {statistics.median(modes['walk']):.0f}")
        if bus:
            lines.append(f"- {code} {_name(data, code)}: " + ", ".join(bus)
                         + (f". Walkable: {', '.join(walk)} min." if walk else "."))
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
        by_area[r.get("district") or "?"].append(f"{r['name']}{operator}{price}{rooms}")
    order = {code: i for i, code in enumerate(district_rent.areas(district_rent.load_profile_data()))}
    return "\n".join(f"- {area}: " + "; ".join(items) for area, items in sorted(by_area.items(), key=lambda kv: order.get(kv[0], 99)))


def colleges_text():
    """The colleges on the Universities page and where they are."""
    try:
        source = (FRONTEND / "District Profile" / "cityPlaces.js").read_text(encoding="utf-8")
        block = source[source.index("export const universities"):]
        block = block[:block.index("];")]
    except (OSError, ValueError):
        return ""
    return "\n".join(f"- {name}: {where}" for name, where in re.findall(r"name: '([^']+)', location: '([^']+)'", block))


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
