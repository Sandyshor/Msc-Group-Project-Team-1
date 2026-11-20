"""The place-details helpers (no network: OpenStreetMap is not called)."""
import placeinfo


def test_kind_labels():
    assert placeinfo.kind_of({"shop": "hairdresser"})[2] == "Hair salon"
    assert placeinfo.kind_of({"leisure": "park"})[2] == "Park"
    assert placeinfo.kind_of({"amenity": "ice_cream"})[2] == "Ice cream"   # unknown values are made readable
    assert placeinfo.kind_of({"name": "x"}) == (None, None, "")


def test_same_name_matches_small_differences_only():
    assert placeinfo.same_name("St Stephen's Green", "St. Stephen's Green") or placeinfo.same_name("St Stephens Green", "St Stephen's Green")
    assert placeinfo.same_name("Tesco Express", "Tesco")
    assert not placeinfo.same_name("Beckett House", "Samuel Beckett Bridge")


def test_describe_marks_appointment_places_and_keeps_contact_details():
    p = placeinfo.describe({"type": "node", "id": 7, "lat": 53.34, "lon": -6.26,
                            "tags": {"name": "Cut Above", "shop": "hairdresser", "opening_hours": "Mo-Fr 09:00-17:00", "phone": "01 234", "secret": "x"}},
                           53.34, -6.26)
    assert p["appointment"] is True and p["type"] == "Hair salon" and p["distance_m"] == 0
    assert p["tags"] == {"opening_hours": "Mo-Fr 09:00-17:00", "phone": "01 234"}


def test_point_in_park_outline():
    square = {"type": "Polygon", "coordinates": [[[-6.27, 53.33], [-6.25, 53.33], [-6.25, 53.35], [-6.27, 53.35], [-6.27, 53.33]]]}
    assert placeinfo.inside_shape(square, 53.34, -6.26)
    assert not placeinfo.inside_shape(square, 53.36, -6.26)


def test_place_info_rejects_points_outside_dublin():
    from fastapi.testclient import TestClient
    import app
    r = TestClient(app.app).get("/place-info", params={"lat": 51.5, "lng": -0.12})
    assert r.status_code == 422


def test_nearby_photos_must_show_a_building_or_street():
    keep = ["Central_Bar,_Aungier_Street_-_geograph.org.uk_-_683751.jpg", "File:Father_Browns_at_the_Village,_Rathmines.jpg"]
    drop = ["File:2004 Ford Mondeo - Dublin.jpg", "File:Bentley Continental GT.jpg", "File:Basic Income Ireland protest.jpg"]
    ok = lambda t: not placeinfo.VEHICLE.search(t) and not placeinfo.SKIP_FILE.search(t) and ("geograph" in t.lower() or bool(placeinfo.PLACE_WORD.search(t)))
    assert all(ok(t) for t in keep)
    assert not any(ok(t) for t in drop)


def test_photo_lookup_never_fetches_local_addresses():
    assert not placeinfo._public_url("http://127.0.0.1:8000/")
    assert not placeinfo._public_url("http://192.168.1.1/admin")
    assert not placeinfo._public_url("file:///etc/passwd")
