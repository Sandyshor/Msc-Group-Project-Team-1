"""The one rent figure for each district and room type, the same one the district profile shows.

The website shows rent in three places: the district profile (and Compare districts), the results page and the
AI assistant. All three use these figures, worked out from the district profile's own data files the same way as
Frontend/District Profile/rents.js:

  for each size, the district's own Daft listings (median) first, then the RTB 2025 average (whole homes), then
  the Daft.ie Rental Report 2026 Q1 average for its part of Dublin.

Search choices on the questionnaire map to the district profile's sizes like this:
  private_room -> single room,  shared_room -> double sharing (per person),  one_bed -> 1 bed,  two_bed -> 2 bed.
"""
import json
from pathlib import Path

FRONTEND = Path(__file__).resolve().parent.parent / "Frontend"
PROFILES_FILE = FRONTEND / "District Profile" / "district-profiles.json"
COUNTY_FILE = FRONTEND / "public" / "data" / "county-dublin-profiles.json"

ROOM_KINDS = ("single", "double", "sharing")
HOME_KINDS = ("studio", "1 bed", "2 bed", "3 bed", "4+ bed")
REPORT_KEY = {"single": "single", "double": "double", "sharing": "sharing", "1 bed": "oneBed", "2 bed": "twoBed"}
# the questionnaire's accommodation choice -> the district profile's size
SEARCH_KIND = {"private_room": "single", "shared_room": "sharing", "one_bed": "1 bed", "two_bed": "2 bed"}
KIND_LABEL = {"single": "single room", "double": "double room (one person)", "sharing": "double sharing (per person)",
              "studio": "studio", "1 bed": "1-bed apartment", "2 bed": "2-bed apartment", "3 bed": "3-bed home",
              "4+ bed": "4+ bed home"}


def _read(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def load_profile_data(profiles_file=PROFILES_FILE, county_file=COUNTY_FILE):
    """The district profile's data, with County Dublin merged in the way the district map merges it."""
    data = _read(profiles_file)
    county = _read(county_file)
    for key in ("profiles", "labels", "rtb", "safety"):
        data[key] = {**data.get(key, {}), **county.get(key, {})}
    data["roomReport"] = county.get("roomReport", data.get("roomReport", {}))
    return data


def rent_for(data, code, kind):
    """{'value', 'source', 'note', 'listings'} for one area and size, or None. Same rule as rents.js."""
    rent = data.get("rent", {}).get(code, {})
    listing = (rent.get("rooms") if kind in ROOM_KINDS else rent.get("homes") or {}) or {}
    listing = listing.get(kind)
    if listing and listing.get("median"):
        n = listing.get("n", 0)
        return {"value": float(listing["median"]), "source": "listings", "listings": n,
                "note": f"median of {n} Daft listing{'s' if n != 1 else ''}"}
    rtb = data.get("rtb", {}).get(code, {}).get("district", {}).get(kind)
    if rtb and kind in HOME_KINDS:
        return {"value": float(rtb), "source": "rtb", "listings": None, "note": "RTB 2025 average"}
    report = data.get("roomReport", {}).get("areas", {}).get(code, {}).get(REPORT_KEY.get(kind, ""))
    if report:
        note = "estimate from the Daft.ie report" if kind == "sharing" else "Daft.ie report 2026 Q1 average"
        return {"value": float(report), "source": "report", "listings": None, "note": note}
    return None


def areas(data):
    """Every area that has a district profile."""
    return sorted(set(data.get("profiles", {})) | set(data.get("rent", {})) | set(data.get("rtb", {})),
                  key=_area_order)


def _area_order(code):
    digits = "".join(ch for ch in code if ch.isdigit())
    return (code[0] != "D", code[0], int(digits or 0), code)


def rent_table(data, search):
    """{area: rent figure} for a questionnaire accommodation choice (private_room, shared_room, one_bed, two_bed)."""
    kind = SEARCH_KIND[search]
    return {code: x for code in areas(data) if (x := rent_for(data, code, kind))}


def assistant_text(data):
    """The rent figures as short lines for the AI assistant's instructions."""
    lines = []
    for code in areas(data):
        name = data.get("profiles", {}).get(code, {}).get("name", "")
        parts = [f"{KIND_LABEL[k]} €{x['value']:,.0f}" for k in ("single", "double", "sharing", "1 bed", "2 bed")
                 if (x := rent_for(data, code, k))]
        if parts:
            lines.append(f"- {code}{f' {name}' if name else ''}: {'; '.join(parts)}")
    return "\n".join(lines)


def places_text(data):
    """Each area's neighbourhoods and the places its district profile shows, as short lines for the AI assistant."""
    lines = []
    for code in areas(data):
        profile = data.get("profiles", {}).get(code, {})
        hoods = ", ".join(a[0] for a in profile.get("areas", [])[:10])
        places = "; ".join(f"{p[0]} ({p[1]}): {p[2].rstrip('.')}" for p in profile.get("places", []) if len(p) >= 3)
        if hoods or places:
            lines.append(f"- {code} {profile.get('name', '')}: neighbourhoods {hoods or 'n/a'}. Places: {places or 'none listed'}.")
    return "\n".join(lines)


# The same bands as the district profile's Safety tab (Frontend/District Profile/mapShared.js SAFETY_BANDS)
SAFETY_BANDS = [(57, "Lower recorded crime", "safer than Irish towns"),
                (50, "Below-benchmark crime", "a little safer than Irish towns"),
                (40, "Above-benchmark crime", "more crime than Irish towns"),
                (0, "Higher recorded crime", "much more crime than Irish towns")]
CRIME_NAMES = [("violent", "violent crime"), ("robbery", "robbery"), ("burglary_theft", "burglary and theft"),
               ("public_order", "public order"), ("damage", "criminal damage")]


def safety_text(data):
    """Each area's safety score, band, recorded crime against Ireland's and its safest and least safe neighbourhoods,
    as shown on its district profile, as short lines for the AI assistant."""
    lines = []
    for code in areas(data):
        s = data.get("safety", {}).get(code)
        if not s or not isinstance(s.get("score"), (int, float)):
            continue
        band, plain = next((b, p) for floor, b, p in SAFETY_BANDS if s["score"] >= floor)
        name = data.get("profiles", {}).get(code, {}).get("name", "")
        rates, ireland = s.get("rates") or {}, s.get("ireland") or {}
        crime = ", ".join(f"{label} {rates[k]:.1f} vs Ireland {ireland[k]:.1f}" for k, label in CRIME_NAMES
                          if rates.get(k) is not None and ireland.get(k) is not None)
        hoods = sorted(s.get("hoods") or [], key=lambda h: -h[1])
        parts = ""
        if len(hoods) > 1 and hoods[0][1] != hoods[-1][1]:
            top = [h for h in hoods if h[1] == hoods[0][1]][:3]
            low = [h for h in hoods if h[1] == hoods[-1][1]][:3]
            parts = (f" Safer parts: {', '.join(h[0] for h in top)} ({top[0][1]:.0f})."
                     f" Less safe parts: {', '.join(h[0] for h in low)} ({low[0][1]:.0f}).")
        extra = []
        if isinstance(s.get("lit"), (int, float)):
            extra.append(f"{s['lit'] * 100:.0f}% of mapped streets lit")
        if s.get("nightStops"):
            extra.append(f"{s['nightStops']} night transport stops")
        lines.append(f"- {code} {name}: safety score {s['score']:.0f}/100, {band} ({plain})."
                     + (f" Crimes per 1,000 people a year ({s.get('period', 'recent years')}): {crime}." if crime else "")
                     + parts + (f" {'; '.join(extra).capitalize()}." if extra else ""))
    return "\n".join(lines)
