"""Tests for GET /route. OTP is mocked except in the live test, which runs only if OTP is up."""
from datetime import date, timedelta

import pytest
import requests
from fastapi.testclient import TestClient

import routing
from app import app

client = TestClient(app)

SPIRE = {"from_lat": 53.3498, "from_lon": -6.2603}
BROADSTONE = {"to_lat": 53.3547, "to_lon": -6.2807}
PARAMS = {**SPIRE, **BROADSTONE}


def leg(mode, metres, seconds, frm="Start", to="Destination", short=None, long=None, start="2026-10-28T08:30:00Z", end="2026-10-28T08:40:00Z"):
    return {
        "mode": mode, "distance": metres, "duration": seconds, "headsign": "Broombridge" if mode != "WALK" else None,
        "start": {"scheduledTime": start}, "end": {"scheduledTime": end},
        "from": {"name": frm}, "to": {"name": to},
        "route": {"shortName": short, "longName": long} if mode != "WALK" else None,
        "legGeometry": {"points": "_p~iF~ps|U_ulLnnqC"},
    }


def itinerary(legs, start="2026-10-28T08:30:00Z", end="2026-10-28T08:50:00Z", transfers=0):
    return {"node": {"start": start, "end": end, "duration": sum(l["duration"] for l in legs),
                     "numberOfTransfers": transfers, "legs": legs}}


TRAM_TRIP = itinerary([
    leg("WALK", 200, 180, to="O'Connell Upr."),
    leg("TRAM", 3000, 600, frm="O'Connell Upr.", to="Broadstone", short="Green", long="Brides Glen - Broombridge"),
    leg("WALK", 300, 240, frm="Broadstone"),
])
WALK_TRIP = itinerary([leg("WALK", 1740, 1420)], end="2026-10-28T08:53:40Z")


def otp_payload(*edges, errors=()):
    return {"data": {"planConnection": {"edges": list(edges), "routingErrors": list(errors)}}}


class FakeResponse:
    def __init__(self, payload, status=200):
        self.payload, self.status_code = payload, status

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"{self.status_code}")

    def json(self):
        return self.payload


@pytest.fixture(autouse=True)
def clear_cache():
    routing._cache.clear()
    yield
    routing._cache.clear()


@pytest.fixture
def otp(monkeypatch):
    """Replace the HTTP call to OTP; `otp.payload` is returned and every request body is recorded."""
    class Fake:
        payload = otp_payload(TRAM_TRIP)
        error = None
        calls = []

        def post(self, url, json, timeout):
            self.calls.append(json["variables"])
            if self.error:
                raise self.error
            return FakeResponse(self.payload)

    fake = Fake()
    fake.calls = []
    monkeypatch.setattr(routing.requests, "post", fake.post)
    return fake


def test_returns_itinerary_with_distance_summed_over_all_legs(otp):
    r = client.get("/route", params={**PARAMS, "when": "2026-10-28T08:30"})
    assert r.status_code == 200
    body = r.json()
    assert body["source"] == "Timetable-based estimate (TFI GTFS)"
    assert body["calculated_at"] and body["cached"] is False
    it = body["itineraries"][0]
    assert it["total_minutes"] == 17.0
    assert it["total_distance_km"] == 3.5
    assert it["walking_km"] == 0.5
    assert it["transfers"] == 0
    assert it["walk_only"] is False
    assert it["departure"] == "2026-10-28T08:30:00+00:00"
    tram = it["legs"][1]
    assert tram == {"mode": "TRAM", "line": "Green", "headsign": "Broombridge", "from": "O'Connell Upr.",
                    "to": "Broadstone", "departure": "2026-10-28T08:30:00+00:00",
                    "arrival": "2026-10-28T08:40:00+00:00", "minutes": 10.0, "distance_km": 3.0,
                    "geometry": "_p~iF~ps|U_ulLnnqC"}
    assert it["legs"][0]["line"] is None


def test_walk_only_itinerary_is_kept_and_flagged(otp):
    otp.payload = otp_payload(TRAM_TRIP, WALK_TRIP)
    its = client.get("/route", params=PARAMS).json()["itineraries"]
    assert [i["walk_only"] for i in its] == [False, True]


def test_itineraries_sorted_by_arrival_when_departing(otp):
    late = itinerary(TRAM_TRIP["node"]["legs"], start="2026-10-28T08:35:00Z", end="2026-10-28T09:05:00Z")
    otp.payload = otp_payload(late, WALK_TRIP, TRAM_TRIP)
    arrivals = [i["arrival"] for i in client.get("/route", params=PARAMS).json()["itineraries"]]
    assert arrivals == sorted(arrivals)


def test_itineraries_sorted_by_latest_departure_when_arriving_by(otp):
    early = itinerary(TRAM_TRIP["node"]["legs"], start="2026-10-28T08:10:00Z", end="2026-10-28T08:30:00Z")
    otp.payload = otp_payload(early, TRAM_TRIP)
    deps = [i["departure"] for i in client.get("/route", params={**PARAMS, "arrive_by": "true"}).json()["itineraries"]]
    assert deps == sorted(deps, reverse=True)


def test_irish_rail_line_uses_long_name(otp):
    otp.payload = otp_payload(itinerary([leg("RAIL", 5000, 600, short="rail", long="DART")]))
    assert client.get("/route", params=PARAMS).json()["itineraries"][0]["legs"][0]["line"] == "DART"


@pytest.mark.parametrize("mode, expected", [
    ("transit", {"transit": {"transit": [{"mode": "BUS"}, {"mode": "TRAM"}, {"mode": "RAIL"}]}}),
    ("walk", {"directOnly": True, "direct": ["WALK"]}),
    ("bike", {"directOnly": True, "direct": ["BICYCLE"]}),
])
def test_mode_is_sent_to_otp(otp, mode, expected):
    assert client.get("/route", params={**PARAMS, "mode": mode}).status_code == 200
    assert otp.calls[0]["modes"] == expected
    assert otp.calls[0]["first"] == 3


def test_transit_is_the_default_mode(otp):
    client.get("/route", params=PARAMS)
    assert "transit" in otp.calls[0]["modes"]


def test_departure_time_rounds_up_to_five_minute_slot(otp):
    client.get("/route", params={**PARAMS, "when": "2026-10-28T08:31"})
    assert otp.calls[0]["dateTime"] == {"earliestDeparture": "2026-10-28T08:35:00+00:00"}


def test_arrive_by_uses_latest_arrival_rounded_down(otp):
    client.get("/route", params={**PARAMS, "when": "2026-10-28T09:04", "arrive_by": "true"})
    assert otp.calls[0]["dateTime"] == {"latestArrival": "2026-10-28T09:00:00+00:00"}


def test_naive_time_is_dublin_local_time(otp):
    client.get("/route", params={**PARAMS, "when": "2026-07-01T08:30"})
    assert otp.calls[0]["dateTime"] == {"earliestDeparture": "2026-07-01T08:30:00+01:00"}


def test_when_defaults_to_now(otp):
    assert client.get("/route", params=PARAMS).status_code == 200
    assert "earliestDeparture" in otp.calls[0]["dateTime"]


def test_invalid_time_is_rejected(otp):
    r = client.get("/route", params={**PARAMS, "when": "tomorrow morning"})
    assert r.status_code == 422 and r.json()["detail"]["code"] == "INVALID_TIME"
    assert otp.calls == []


def test_invalid_mode_is_rejected(otp):
    assert client.get("/route", params={**PARAMS, "mode": "car"}).status_code == 422
    assert otp.calls == []


@pytest.mark.parametrize("override, which", [
    ({"from_lat": 51.8985, "from_lon": -8.4756}, "Start"),  # Cork
    ({"to_lat": 53.40, "to_lon": -5.90}, "End"),            # Irish Sea, east of the box
])
def test_point_outside_greater_dublin_is_rejected(otp, override, which):
    r = client.get("/route", params={**PARAMS, **override})
    assert r.status_code == 422
    detail = r.json()["detail"]
    assert detail["code"] == "OUTSIDE_DUBLIN" and detail["message"].startswith(which)
    assert otp.calls == []


def test_no_route_returns_404_with_otp_reason(otp):
    otp.payload = otp_payload(errors=[{"code": "WALKING_BETTER_THAN_TRANSIT",
                                       "description": "Origin is within a trivial distance of the destination."}])
    r = client.get("/route", params=PARAMS)
    assert r.status_code == 404
    assert r.json()["detail"] == {"code": "NO_ROUTE", "message": "Origin is within a trivial distance of the destination."}


def test_otp_down_returns_503(otp):
    otp.error = requests.ConnectionError("refused")
    r = client.get("/route", params=PARAMS)
    assert r.status_code == 503 and r.json()["detail"]["code"] == "OTP_UNAVAILABLE"


def test_otp_graphql_error_returns_502(otp):
    otp.payload = {"errors": [{"message": "boom"}], "data": {"planConnection": None}}
    r = client.get("/route", params=PARAMS)
    assert r.status_code == 502 and r.json()["detail"]["code"] == "OTP_ERROR"


def test_same_slot_and_rounded_coordinates_hit_the_cache(otp):
    first = client.get("/route", params={**PARAMS, "when": "2026-10-28T08:31"}).json()
    nudged = {**PARAMS, "from_lat": PARAMS["from_lat"] + 0.00002, "when": "2026-10-28T08:34"}
    second = client.get("/route", params=nudged).json()
    assert len(otp.calls) == 1
    assert second["cached"] is True and first["cached"] is False
    assert second["itineraries"] == first["itineraries"]
    assert second["calculated_at"] == first["calculated_at"]


@pytest.mark.parametrize("change", [{"mode": "walk"}, {"when": "2026-10-28T08:36"}, {"arrive_by": "true"},
                                    {"to_lat": 53.3548}])
def test_cache_is_keyed_by_mode_time_slot_and_coordinates(otp, change):
    base = {**PARAMS, "when": "2026-10-28T08:31"}
    client.get("/route", params=base)
    client.get("/route", params={**base, **change})
    assert len(otp.calls) == 2


def test_cache_expires_after_five_minutes(otp, monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(routing.time, "monotonic", lambda: now[0])
    client.get("/route", params={**PARAMS, "when": "2026-10-28T08:30"})
    now[0] += 299
    client.get("/route", params={**PARAMS, "when": "2026-10-28T08:30"})
    assert len(otp.calls) == 1
    now[0] += 2
    client.get("/route", params={**PARAMS, "when": "2026-10-28T08:30"})
    assert len(otp.calls) == 2


def test_errors_are_not_cached(otp):
    otp.error = requests.ConnectionError("refused")
    client.get("/route", params=PARAMS)
    otp.error = None
    assert client.get("/route", params=PARAMS).status_code == 200
    assert len(otp.calls) == 2


def otp_is_up():
    try:
        return requests.post(routing.OTP_URL, json={"query": "{__typename}"}, timeout=3).ok
    except requests.RequestException:
        return False


@pytest.mark.skipif(not otp_is_up(), reason=f"OTP not reachable at {routing.OTP_URL}")
def test_live_route_from_spire_to_broadstone():
    day = date.today() + timedelta(days=1)
    while day.weekday() >= 5:
        day += timedelta(days=1)
    r = client.get("/route", params={**PARAMS, "when": f"{day}T08:30"})
    assert r.status_code == 200, r.text
    its = r.json()["itineraries"]
    assert 1 <= len(its) <= 3
    for it in its:
        assert it["total_distance_km"] >= it["walking_km"] > 0
        assert 5 < it["total_minutes"] < 60
        assert all(l["geometry"] for l in it["legs"])
    assert any(not it["walk_only"] for it in its)
