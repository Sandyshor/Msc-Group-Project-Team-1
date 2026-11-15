"""Tests for GET /eircode/{code}. Google's Geocoding API is mocked; no key or network is needed."""
import pytest
from fastapi.testclient import TestClient

import eircode
from app import app

client = TestClient(app)


class FakeResponse:
    def __init__(self, body):
        self.body = body

    def json(self):
        return self.body


def result(postcode, lat=53.3584, lng=-6.2783, **parts):
    components = [{"long_name": postcode, "types": ["postal_code"]}]
    components += [{"long_name": v, "types": [k]} for k, v in parts.items()]
    return {"address_components": components, "formatted_address": f"Somewhere, Dublin, {postcode}, Ireland",
            "geometry": {"location": {"lat": lat, "lng": lng}}}


@pytest.fixture(autouse=True)
def fresh(monkeypatch):
    eircode._cache.clear()
    eircode._hits.clear()
    monkeypatch.setenv("GOOGLE_MAPS_API_KEY", "test-key")


def mock_google(monkeypatch, body):
    calls = []

    def fake_get(url, params, timeout):
        calls.append(params)
        return FakeResponse(body)

    monkeypatch.setattr(eircode.requests, "get", fake_get)
    return calls


@pytest.mark.parametrize("typed, code", [("d07ed7r", "D07 ED7R"), (" D01 E6C1 ", "D01 E6C1"), ("d6wxy12", "D6W XY12"),
                                         ("k78 x2y3", "K78 X2Y3")])
def test_parse_eircode(typed, code):
    assert eircode.parse_eircode(typed) == code


@pytest.mark.parametrize("typed", ["D07", "D08 A1B2", "Temple Bar", "B12 ACDE", "D07 ED7RX"])
def test_parse_rejects_non_eircodes(typed):
    assert eircode.parse_eircode(typed) is None


def test_exact_place(monkeypatch):
    calls = mock_google(monkeypatch, {"status": "OK", "results": [
        result("D07 ED7R", premise="Highfield Park Student Residences", route="Grangegorman Lower",
               neighborhood="Grangegorman")]})
    r = client.get("/eircode/d07ed7r")
    assert r.status_code == 200
    assert r.json() == {"eircode": "D07 ED7R", "name": "Highfield Park Student Residences",
                        "street": "Grangegorman Lower", "area": "Grangegorman",
                        "address": "Somewhere, Dublin, D07 ED7R, Ireland", "lat": 53.3584, "lng": -6.2783}
    assert calls[0]["address"] == "D07 ED7R" and calls[0]["components"] == "country:IE"


def test_only_the_area_matched_is_not_found(monkeypatch):
    # Google answering with just the routing area (postal code "D07") is not this address
    mock_google(monkeypatch, {"status": "OK", "results": [result("D07")]})
    assert client.get("/eircode/D07ACDE").status_code == 404


def test_answers_are_cached(monkeypatch):
    calls = mock_google(monkeypatch, {"status": "OK", "results": [result("D01 E6C1", street_number="5", route="Main St")]})
    assert client.get("/eircode/D01E6C1").json()["street"] == "5 Main St"
    assert client.get("/eircode/d01 e6c1").status_code == 200
    assert len(calls) == 1


def test_not_an_eircode():
    assert client.get("/eircode/hello").status_code == 400


def test_without_a_key_the_site_falls_back(monkeypatch):
    monkeypatch.delenv("GOOGLE_MAPS_API_KEY")
    assert client.get("/eircode/D07ED7R").status_code == 503


def test_google_refusing_is_not_cached(monkeypatch):
    mock_google(monkeypatch, {"status": "REQUEST_DENIED", "results": []})
    assert client.get("/eircode/D07ED7R").status_code == 503
    assert "D07 ED7R" not in eircode._cache


def test_rate_limit(monkeypatch):
    mock_google(monkeypatch, {"status": "ZERO_RESULTS", "results": []})
    monkeypatch.setattr(eircode, "RATE_LIMIT", 2)
    codes = ["D01AAAA", "D01AAAC", "D01AAAD"]
    assert [client.get(f"/eircode/{c}").status_code for c in codes] == [404, 404, 429]
