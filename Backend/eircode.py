"""GET /eircode/{code} - the exact place of any Eircode, for the district map's search box.

Eircodes are a licensed address database, so OpenStreetMap only knows some of them. Google's Geocoding API has
all of them: this endpoint asks it, keeping the key here on the server (GOOGLE_MAPS_API_KEY; the browser never
sees it). Without a key it answers 503 and the website falls back to OpenStreetMap, then to the Eircode's area.

Answers are cached in memory (an Eircode doesn't move), and each visitor gets a limited number of new lookups.
"""
import os
import re
import time
from collections import OrderedDict, defaultdict, deque

import requests
from fastapi import APIRouter, HTTPException, Request

router = APIRouter()

GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"
# A routing key (A, C-F, H, K, N, P, R, T, V-Y and two digits, or D6W) and a four-character identifier
EIRCODE = re.compile(r"^\s*([AC-FHKNPRTV-Y]\d{2}|D6W)\s*([0-9AC-FHKNPRTV-Y]{4})\s*$", re.IGNORECASE)
CACHE_SIZE = 5000
RATE_LIMIT = 30            # new (uncached) lookups per visitor ...
RATE_WINDOW_S = 10 * 60    # ... per 10 minutes

_cache: "OrderedDict[str, dict | None]" = OrderedDict()
_hits = defaultdict(deque)


def parse_eircode(text: str):
    """'d07ed7r' -> 'D07 ED7R'; None if the text isn't an Eircode."""
    m = EIRCODE.match(text or "")
    return f"{m.group(1)} {m.group(2)}".upper() if m else None


def _remember(code, place):
    _cache[code] = place
    _cache.move_to_end(code)
    while len(_cache) > CACHE_SIZE:
        _cache.popitem(last=False)


def _too_many(visitor: str) -> bool:
    now = time.time()
    hits = _hits[visitor]
    while hits and now - hits[0] > RATE_WINDOW_S:
        hits.popleft()
    if len(hits) >= RATE_LIMIT:
        return True
    hits.append(now)
    return False


def _place_from(result: dict, code: str):
    """Name, address line and location from one Geocoding result, or None if it isn't this exact Eircode."""
    parts = {t: c for c in result.get("address_components", []) for t in c.get("types", [])}
    postcode = parts.get("postal_code", {}).get("long_name", "")
    if postcode.replace(" ", "").upper() != code.replace(" ", ""):
        return None  # only the routing area matched, not the address
    name = next((parts[t]["long_name"] for t in ("establishment", "point_of_interest", "premise", "subpremise")
                 if t in parts), None)
    street = " ".join(p for p in (parts.get("street_number", {}).get("long_name"),
                                  parts.get("route", {}).get("long_name")) if p)
    area = next((parts[t]["long_name"] for t in ("neighborhood", "sublocality", "sublocality_level_1", "postal_town",
                                                   "locality") if t in parts), None)
    location = result["geometry"]["location"]
    return {
        "eircode": code,
        "name": name,
        "street": street or None,
        "area": area,
        "address": result.get("formatted_address"),
        "lat": round(location["lat"], 6),
        "lng": round(location["lng"], 6),
    }


@router.get("/eircode/{text}")
def eircode(text: str, request: Request):
    code = parse_eircode(text)
    if not code:
        raise HTTPException(400, "That isn't an Eircode (for example D07 ED7R).")
    if code in _cache:
        place = _cache[code]
        if place is None:
            raise HTTPException(404, "No place found for this Eircode.")
        return place

    key = os.getenv("GOOGLE_MAPS_API_KEY")
    if not key:
        raise HTTPException(503, "Eircode lookup isn't set up on this server.")
    forwarded = request.headers.get("x-forwarded-for", "")
    visitor = forwarded.split(",")[0].strip() or (request.client.host if request.client else "unknown")
    if _too_many(visitor):
        raise HTTPException(429, "Too many Eircode searches. Please try again in a few minutes.")

    try:
        response = requests.get(GEOCODE_URL, params={"address": code, "components": "country:IE", "region": "ie",
                                                     "key": key}, timeout=8)
        body = response.json()
    except (requests.RequestException, ValueError):
        raise HTTPException(502, "The Eircode lookup didn't answer. Please try again.")
    status = body.get("status")
    if status not in ("OK", "ZERO_RESULTS"):
        # REQUEST_DENIED, OVER_QUERY_LIMIT...: not the visitor's fault, and not something to cache
        raise HTTPException(503, "Eircode lookup is unavailable right now.")

    place = next((p for p in (_place_from(r, code) for r in body.get("results", [])) if p), None)
    _remember(code, place)
    if place is None:
        raise HTTPException(404, "No place found for this Eircode.")
    return place
