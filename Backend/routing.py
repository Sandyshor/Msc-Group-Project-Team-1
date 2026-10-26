"""Point-to-point journey planning through the local OpenTripPlanner server.

OTP 2.10 is queried through its GTFS GraphQL API with `planConnection` (the older `plan`
query is deprecated in this version). Results are timetable-based (TFI GTFS + OpenStreetMap),
not live traffic or real-time departures.
"""
import math
import os
import threading
import time
from datetime import datetime, timedelta
from typing import Literal, Optional
from zoneinfo import ZoneInfo

import requests
from fastapi import APIRouter, HTTPException, Query

OTP_URL = os.getenv("OTP_URL", "http://localhost:8080/otp/gtfs/v1")
OTP_TIMEOUT_SECONDS = 30

# Greater Dublin Area (Dublin, Kildare, Meath, Wicklow). Change here to widen or narrow the area.
DUBLIN_BOUNDS = {"min_lat": 52.95, "max_lat": 53.70, "min_lon": -6.95, "max_lon": -5.95}

DUBLIN_TZ = ZoneInfo("Europe/Dublin")
MAX_ITINERARIES = 3
CACHE_TTL_SECONDS = 300
TIME_SLOT_MINUTES = 5
SOURCE_LABEL = "Timetable-based estimate (TFI GTFS)"

TRANSIT_MODES = {"BUS", "TRAM", "RAIL", "SUBWAY", "FERRY"}

# planConnection `modes` input per user-facing mode. OTP 2.10 crashes if `modes` is null,
# so every mode sends an explicit object.
OTP_MODES = {
    "transit": {"transit": {"transit": [{"mode": "BUS"}, {"mode": "TRAM"}, {"mode": "RAIL"}]}},
    "walk": {"directOnly": True, "direct": ["WALK"]},
    "bike": {"directOnly": True, "direct": ["BICYCLE"]},
}

PLAN_QUERY = """
query Route($origin: PlanLabeledLocationInput!, $destination: PlanLabeledLocationInput!,
            $dateTime: PlanDateTimeInput!, $modes: PlanModesInput!, $first: Int!) {
  planConnection(origin: $origin, destination: $destination, dateTime: $dateTime,
                 modes: $modes, first: $first) {
    edges {
      node {
        start
        end
        duration
        numberOfTransfers
        legs {
          mode
          distance
          duration
          headsign
          start { scheduledTime }
          end { scheduledTime }
          from { name }
          to { name }
          route { shortName longName }
          legGeometry { points }
        }
      }
    }
    routingErrors { code description }
  }
}
"""

router = APIRouter()

_cache = {}
_cache_lock = threading.Lock()


def route_error(status, code, message):
    return HTTPException(status_code=status, detail={"code": code, "message": message})


def inside_dublin(lat, lon):
    b = DUBLIN_BOUNDS
    return b["min_lat"] <= lat <= b["max_lat"] and b["min_lon"] <= lon <= b["max_lon"]


def parse_when(when):
    if not when:
        return datetime.now(DUBLIN_TZ)
    try:
        dt = datetime.fromisoformat(when.strip())
    except ValueError:
        raise route_error(422, "INVALID_TIME", "`when` must be an ISO date-time, e.g. 2026-10-28T08:30.")
    return dt.replace(tzinfo=DUBLIN_TZ) if dt.tzinfo is None else dt.astimezone(DUBLIN_TZ)


def time_slot(dt, arrive_by):
    """Snap to a TIME_SLOT_MINUTES boundary so cached answers stay valid for everyone in the slot.

    Departures round up (never suggest leaving before the requested time); arrive-by rounds
    down (never arrive after it).
    """
    dt = dt.replace(second=0, microsecond=0)
    minutes = dt.hour * 60 + dt.minute
    slot = (minutes // TIME_SLOT_MINUTES if arrive_by else math.ceil(minutes / TIME_SLOT_MINUTES)) * TIME_SLOT_MINUTES
    return dt.replace(hour=0, minute=0) + timedelta(minutes=slot)


def local_iso(value):
    if value is None:
        return None
    return datetime.fromisoformat(value).astimezone(DUBLIN_TZ).isoformat(timespec="seconds")


def line_name(route):
    """Route short name ("16", "Green", "DART"). Irish Rail uses "rail" as the short name, so use the long name there."""
    if not route:
        return None
    short = (route.get("shortName") or "").strip()
    if short and short.lower() != "rail":
        return short
    return (route.get("longName") or "").strip() or short or None


def to_km(metres):
    return round(metres / 1000, 2)


def format_leg(leg):
    return {
        "mode": leg["mode"],
        "line": line_name(leg.get("route")) if leg["mode"] in TRANSIT_MODES else None,
        "headsign": leg.get("headsign"),
        "from": leg["from"]["name"],
        "to": leg["to"]["name"],
        "departure": local_iso((leg.get("start") or {}).get("scheduledTime")),
        "arrival": local_iso((leg.get("end") or {}).get("scheduledTime")),
        "minutes": round(leg["duration"] / 60, 1),
        "distance_km": to_km(leg["distance"]),
        "geometry": (leg.get("legGeometry") or {}).get("points"),
    }


def format_itinerary(node):
    legs = node["legs"]
    return {
        "total_minutes": round(node["duration"] / 60, 1),
        # Sum of every leg, not OTP's walkDistance (which only counts walking).
        "total_distance_km": to_km(sum(leg["distance"] for leg in legs)),
        "walking_km": to_km(sum(leg["distance"] for leg in legs if leg["mode"] == "WALK")),
        "transfers": node["numberOfTransfers"],
        "departure": local_iso(node["start"]),
        "arrival": local_iso(node["end"]),
        "walk_only": all(leg["mode"] == "WALK" for leg in legs),
        "legs": [format_leg(leg) for leg in legs],
    }


def call_otp(variables):
    try:
        response = requests.post(OTP_URL, json={"query": PLAN_QUERY, "variables": variables},
                                 timeout=OTP_TIMEOUT_SECONDS)
        response.raise_for_status()
        payload = response.json()
    except (requests.RequestException, ValueError) as exc:
        raise route_error(503, "OTP_UNAVAILABLE",
                          "The journey planner (OpenTripPlanner) is not reachable. Please try again shortly.") from exc
    if payload.get("errors") or not (payload.get("data") or {}).get("planConnection"):
        message = "; ".join(e.get("message", "") for e in payload.get("errors") or []) or "empty response"
        raise route_error(502, "OTP_ERROR", f"The journey planner returned an error: {message}")
    return payload["data"]["planConnection"]


def plan_route(from_lat, from_lon, to_lat, to_lon, mode, when, arrive_by):
    for name, lat, lon in (("Start", from_lat, from_lon), ("End", to_lat, to_lon)):
        if not inside_dublin(lat, lon):
            raise route_error(422, "OUTSIDE_DUBLIN",
                              f"{name} point ({lat:.4f}, {lon:.4f}) is outside the Greater Dublin area.")

    slot = time_slot(parse_when(when), arrive_by)
    key = (round(from_lat, 4), round(from_lon, 4), round(to_lat, 4), round(to_lon, 4),
           mode, arrive_by, slot.isoformat())
    now = time.monotonic()
    with _cache_lock:
        hit = _cache.get(key)
        if hit and hit[0] > now:
            return {**hit[1], "cached": True}

    point = lambda lat, lon, label: {"label": label, "location": {"coordinate": {"latitude": lat, "longitude": lon}}}  # noqa: E731
    result = call_otp({
        "origin": point(key[0], key[1], "Start"),
        "destination": point(key[2], key[3], "Destination"),
        "dateTime": {"latestArrival" if arrive_by else "earliestDeparture": slot.isoformat()},
        "modes": OTP_MODES[mode],
        "first": MAX_ITINERARIES,
    })

    itineraries = [format_itinerary(edge["node"]) for edge in result.get("edges") or []]
    if not itineraries:
        reasons = result.get("routingErrors") or []
        message = "; ".join(r["description"] for r in reasons if r.get("description")) or \
            "No route was found between these points at that time."
        raise route_error(404, "NO_ROUTE", message)

    # Best first: earliest arrival when leaving at a time, latest departure when arriving by a time.
    if arrive_by:
        itineraries.sort(key=lambda i: i["departure"], reverse=True)
    else:
        itineraries.sort(key=lambda i: (i["arrival"], i["total_minutes"]))

    body = {
        "query": {"from": [key[0], key[1]], "to": [key[2], key[3]], "mode": mode,
                  "when": slot.isoformat(timespec="seconds"), "arrive_by": arrive_by},
        "source": SOURCE_LABEL,
        "calculated_at": datetime.now(DUBLIN_TZ).isoformat(timespec="seconds"),
        "itineraries": itineraries[:MAX_ITINERARIES],
    }
    with _cache_lock:
        for k in [k for k, (expires, _) in _cache.items() if expires <= now]:
            del _cache[k]
        _cache[key] = (now + CACHE_TTL_SECONDS, body)
    return {**body, "cached": False}


@router.get("/route")
def route(
    from_lat: float,
    from_lon: float,
    to_lat: float,
    to_lon: float,
    mode: Literal["transit", "walk", "bike"] = "transit",
    when: Optional[str] = Query(None, description="ISO date-time; defaults to now (Europe/Dublin)"),
    arrive_by: bool = False,
):
    return plan_route(from_lat, from_lon, to_lat, to_lon, mode, when, arrive_by)
