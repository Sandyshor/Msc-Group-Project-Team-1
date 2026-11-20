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


def test_nearby_photos_must_name_the_place():
    assert placeinfo._names_place("File:Bewley's Coffee House, Grafton Street - geograph.org.uk.jpg", "Bewley's")
    assert placeinfo._names_place("File:Central Bar, Aungier Street.jpg", "The Central Bar")
    assert not placeinfo._names_place("File:Richmond Road, Dublin - rain.jpg", "Richmond Road Express Shop")
    assert not placeinfo._names_place("File:Basic Income Ireland.jpg", "Ali's Turkish Barber")
    assert placeinfo._commons_nearby(53.34, -6.26, name="") is None  # no name: no nearby photo at all


def test_camera_direction():
    assert round(placeinfo._bearing(53.34, -6.26, 53.35, -6.26)) == 0     # north
    assert round(placeinfo._bearing(53.34, -6.26, 53.34, -6.25)) == 90    # east


def test_photo_lookup_never_fetches_local_addresses():
    assert not placeinfo._public_url("http://127.0.0.1:8000/")
    assert not placeinfo._public_url("http://192.168.1.1/admin")
    assert not placeinfo._public_url("file:///etc/passwd")


def test_main_chains_get_their_logo_and_lookalikes_dont():
    for name, brand in [("Tesco Express", "Tesco"), ("SuperValu Ranelagh", "SuperValu"), ("Super Valu", "SuperValu"), ("Spar", "Spar"),
                        ("Eurospar", "Eurospar"), ("M&S Foodhall", "M&S"), ("Marks & Spencer", "M&S"), ("McDonald's", "McDonald's"),
                        ("Centra", "Centra"), ("Lidl", "Lidl"), ("Aldi", "Aldi"), ("Dunnes Stores", "Dunnes Stores"), ("Costa", "Costa Coffee")]:
        assert placeinfo.chain_logo(name)["source"] == brand, name
    for name in ["Spartan Gym", "Costa Rica Bar", "Hm Kebab", "Maceys Cafe", "Pretty Nails", "Max Pizza"]:
        assert placeinfo.chain_logo(name) is None, name


def test_wrong_shop_type_is_corrected_from_the_name():
    max_pizza = placeinfo.describe({"type": "node", "id": 1, "lat": 53.35, "lon": -6.23, "tags": {"name": "Max Pizza", "shop": "supermarket"}}, 53.35, -6.23)
    assert max_pizza["type"] == "Pizza takeaway"
    spar = placeinfo.describe({"type": "node", "id": 2, "lat": 53.35, "lon": -6.23, "tags": {"name": "Spar", "shop": "convenience"}}, 53.35, -6.23)
    assert spar["type"] == "Convenience shop"
