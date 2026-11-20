"""GET /place-info - details about a place clicked on the district map, like the side panel in Google Maps.

The website's own data has names and locations but no opening hours. OpenStreetMap has them for many places, with
the phone number, website, booking link, cuisine, wheelchair access and more. This endpoint asks OpenStreetMap
(the Overpass API) about one spot and answers with:

  place   the place that was clicked: the named shop, salon, café, park... at that spot (matched by name when the
          map pin had one), or else the park, campus or other area the spot is inside
  inside  the park, campus, shopping centre... the spot is in (when that isn't the place itself)
  nearby  other named places close by (up to 8), nearest first

Clicks are answered from a snapshot of OpenStreetMap kept with the backend (data/dublin_places.json.gz, built by
build_places_snapshot.py), so they don't wait for OpenStreetMap's public servers. Outside the snapshot's area the
Overpass API is asked, with OpenStreetMap's Nominatim service (at most once a second, as its usage policy asks) as
the backup when every Overpass server is busy. Answers are cached and each visitor gets a limited number of new lookups.

GET /place-photo finds a photo or logo for the place, and GET /place-hours reads the opening hours from the place's
own website when OpenStreetMap has none (schema.org data, or hours written as text under an "Opening hours" heading).
"""
import csv
import gzip
import html
import json
from concurrent.futures import ThreadPoolExecutor
import ipaddress
import math
import os
import re
import socket
from urllib.parse import quote, urljoin, urlparse
import threading
import time
from collections import OrderedDict, defaultdict, deque
from typing import Optional

import requests
from fastapi import APIRouter, HTTPException, Query, Request

router = APIRouter()

OVERPASS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]
NOMINATIM = "https://nominatim.openstreetmap.org"
OVERPASS_BUDGET_S = 4      # Overpass gets this long (asked at the same time as Nominatim); the slower answer is dropped
_nominatim_lock = threading.Lock()
_nominatim_last = [0.0]
# Overpass asks every client to say who it is
HEADERS = {"User-Agent": "FindYourDublin/1.0 (MSc student project; https://github.com/Sandyshor/Msc-Group-Project-Team-1)"}
CACHE_SIZE = 4000
CACHE_S = 24 * 3600
RATE_LIMIT = 60            # new (uncached) lookups per visitor ...
RATE_WINDOW_S = 10 * 60    # ... per 10 minutes

_cache: "OrderedDict[str, tuple[float, dict]]" = OrderedDict()
_hits = defaultdict(deque)

# The OpenStreetMap keys that say what a place is, most specific first
KIND_KEYS = ["shop", "amenity", "craft", "healthcare", "leisure", "tourism", "office", "historic", "sport", "club", "building"]
# Plain names for common values; anything else is turned from "ice_cream" into "Ice cream"
LABELS = {
    "hairdresser": "Hair salon", "beauty": "Beauty salon", "barber": "Barber", "cosmetics": "Cosmetics shop", "massage": "Massage",
    "tattoo": "Tattoo studio", "nails": "Nail salon", "supermarket": "Supermarket", "convenience": "Convenience shop",
    "restaurant": "Restaurant", "fast_food": "Fast food", "cafe": "Café", "pub": "Pub", "bar": "Bar", "nightclub": "Nightclub",
    "pharmacy": "Pharmacy", "chemist": "Pharmacy", "doctors": "Doctor's surgery (GP)", "dentist": "Dentist", "clinic": "Clinic",
    "hospital": "Hospital", "optician": "Optician", "physiotherapist": "Physiotherapist", "fitness_centre": "Gym", "sports_centre": "Sports centre",
    "swimming_pool": "Swimming pool", "park": "Park", "garden": "Garden", "playground": "Playground", "nature_reserve": "Nature reserve",
    "pitch": "Sports pitch", "stadium": "Stadium", "library": "Library", "bank": "Bank", "atm": "Cash machine (ATM)", "post_office": "Post office",
    "place_of_worship": "Place of worship", "university": "University", "college": "College", "school": "School", "kindergarten": "Childcare",
    "cinema": "Cinema", "theatre": "Theatre", "arts_centre": "Arts centre", "museum": "Museum", "gallery": "Art gallery", "attraction": "Attraction",
    "hotel": "Hotel", "hostel": "Hostel", "guest_house": "Guest house", "laundry": "Launderette", "dry_cleaning": "Dry cleaner",
    "mobile_phone": "Phone shop", "clothes": "Clothes shop", "shoes": "Shoe shop", "books": "Bookshop", "bakery": "Bakery", "butcher": "Butcher",
    "alcohol": "Off-licence", "hardware": "Hardware shop", "department_store": "Department store", "mall": "Shopping centre",
    "car_wash": "Car wash", "fuel": "Petrol station", "charging_station": "EV charging", "bicycle": "Bike shop", "bicycle_rental": "Bike hire",
    "police": "Garda station", "fire_station": "Fire station", "townhall": "Town hall", "community_centre": "Community centre",
    "veterinary": "Vet", "dog_park": "Dog park", "marketplace": "Market", "ice_cream": "Ice cream", "coworking": "Coworking space",
    "estate_agent": "Estate agent", "travel_agency": "Travel agent", "car_repair": "Car repair", "yes": "",
}
# Places people book an appointment at (hair, beauty, health...)
APPOINTMENT = {"hairdresser", "beauty", "barber", "nails", "massage", "tattoo", "doctors", "dentist", "clinic", "optician",
               "physiotherapist", "veterinary", "car_repair", "estate_agent"}
# The tags passed on to the panel (contact details, hours and what the place offers)
KEEP = ["opening_hours", "phone", "contact:phone", "mobile", "contact:mobile", "website", "contact:website", "url", "email", "contact:email",
        "booking", "reservation", "website:booking", "contact:instagram", "contact:facebook", "cuisine", "diet:vegetarian", "diet:vegan",
        "diet:halal", "wheelchair", "takeaway", "delivery", "outdoor_seating", "internet_access", "fee", "brand", "operator", "description",
        "addr:housenumber", "addr:street", "addr:city", "addr:postcode", "level", "wikipedia", "wikidata", "check_date:opening_hours",
        "opening_hours:kitchen", "happy_hours", "dog", "toilets", "drive_through", "unisex", "male", "female", "beauty", "hairdresser",
        "payment:cash", "payment:cards", "payment:contactless", "student", "smoking", "capacity", "access", "lit", "surface",
        "image", "wikimedia_commons", "brand:wikidata", "operator:wikidata"]


def _rate_limited(ip):
    now = time.time()
    hits = _hits[ip]
    while hits and now - hits[0] > RATE_WINDOW_S:
        hits.popleft()
    if len(hits) >= RATE_LIMIT:
        return True
    hits.append(now)
    return False


def metres(lat1, lng1, lat2, lng2):
    dy = (lat2 - lat1) * 110540
    dx = (lng2 - lng1) * 111320 * math.cos(math.radians(lat1))
    return math.hypot(dx, dy)


def kind_of(tags):
    """('shop', 'hairdresser', 'Hair salon') for a place's tags, or (None, None, '')."""
    for key in KIND_KEYS:
        value = tags.get(key)
        if value and value not in ("no",):
            value = value.split(";")[0].strip()
            label = LABELS.get(value)
            if label is None:
                label = value.replace("_", " ").capitalize()
            if key == "building" and not label:
                label = "Building"
            return key, value, label
    return None, None, ""


def norm(text):
    return re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).strip()


def same_name(a, b):
    a, b = norm(a), norm(b)
    if not a or not b:
        return False
    return a == b or (len(b) > 3 and a.startswith(b)) or (len(a) > 3 and b.startswith(a)) or (len(a) > 6 and a in b) or (len(b) > 6 and b in a)


# Words in a name that say what a place is, used when OpenStreetMap's shop type contradicts the name
NAME_TYPES = [
    (r"pizz", "restaurant", "Pizza takeaway"), (r"kebab|chipper|\bchips?\b|burger|chicken|takeaway|take away", "fast_food", "Fast food"),
    (r"\bcaf[eé]\b|coffee|espresso", "cafe", "Café"), (r"pharmacy|chemist", "pharmacy", "Pharmacy"), (r"barber", "barber", "Barber"),
    (r"\bsalon\b|hair|beauty|nails?\b", "hairdresser", "Hair salon"), (r"\bgym\b|fitness|crossfit|pilates|yoga", "fitness_centre", "Gym"),
    (r"restaurant|bistro|kitchen|grill|sushi|thai|indian|noodle|ramen", "restaurant", "Restaurant"),
]


def describe(element, lat, lng):
    tags = element.get("tags", {})
    key, value, label = kind_of(tags)
    if value in ("supermarket", "convenience", "yes", "general") and not chain_logo(tags.get("name", ""), tags.get("brand", "")):
        for pattern, v, l in NAME_TYPES:
            if re.search(pattern, (tags.get("name") or "").lower()):
                value, label = v, l
                break
    at = element.get("center") or {"lat": element.get("lat"), "lon": element.get("lon")}
    out = {
        "name": tags.get("name:en") or tags.get("name"),
        "type": label,
        "key": key,
        "value": value,
        "appointment": value in APPOINTMENT,
        "osm": f"https://www.openstreetmap.org/{element.get('type', 'node')}/{element.get('id')}",
        "tags": {k: tags[k] for k in KEEP if k in tags},
    }
    if at.get("lat") is not None:
        out["lat"], out["lng"] = at["lat"], at["lon"]
        out["distance_m"] = round(metres(lat, lng, at["lat"], at["lon"]))
    return out


# Big parks that aren't in amenities_osm.csv's park list (that list has each park's middle point)
BIG_PARKS = [("Phoenix Park", 53.3559, -6.3298), ("St Anne's Park", 53.3737, -6.1785), ("Marlay Park", 53.2741, -6.2700),
             ("Bushy Park", 53.3075, -6.2953), ("National Botanic Gardens", 53.3727, -6.2700), ("Iveagh Gardens", 53.3354, -6.2620),
             ("Merrion Square Park", 53.3394, -6.2490), ("Fairview Park", 53.3640, -6.2380), ("Tymon Park", 53.3020, -6.3400),
             ("Corkagh Park", 53.3210, -6.4100), ("Bushy Park", 53.3075, -6.2953), ("Griffith Park", 53.3700, -6.2600)]
_parks = []


def parks():
    """(name, lat, lng) of every named park: the site's amenity list plus the big parks above."""
    if not _parks:
        folder = os.environ.get("DATA_FOLDER", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "Data"))
        try:
            with open(os.path.join(folder, "amenities_osm.csv"), newline="", encoding="utf-8") as f:
                for row in csv.DictReader(f):
                    if row.get("category") == "Parks" and (row.get("name") or "").strip():
                        _parks.append((row["name"].strip(), float(row["latitude"]), float(row["longitude"])))
        except (OSError, ValueError, KeyError):
            pass
        _parks.extend(BIG_PARKS)
    return _parks


def inside_shape(geometry, lat, lng):
    def in_ring(ring):
        inside = False
        j = len(ring) - 1
        for i in range(len(ring)):
            xi, yi = ring[i]
            xj, yj = ring[j]
            if (yi > lat) != (yj > lat) and lng < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-12) + xi:
                inside = not inside
            j = i
        return inside
    polygons = [geometry["coordinates"]] if geometry.get("type") == "Polygon" else geometry.get("coordinates", []) if geometry.get("type") == "MultiPolygon" else []
    return any(in_ring(poly[0]) and not any(in_ring(hole) for hole in poly[1:]) for poly in polygons)


def park_at(lat, lng):
    """The park a spot is inside: the nearest named parks' outlines (from Nominatim) are checked, closest first."""
    seen = set()
    nearest = []
    big = {norm(n) for n, _, _ in BIG_PARKS}
    for name, plat, plng in sorted(parks(), key=lambda p: metres(lat, lng, p[1], p[2])):
        far = metres(lat, lng, plat, plng)
        if far > 2500 or len(nearest) >= 2:
            break
        if far > 700 and norm(name) not in big:  # a small park's middle point would be close to any spot inside it
            continue
        if norm(name) not in seen:
            seen.add(norm(name))
            nearest.append((name, plat, plng))
    for name, plat, plng in nearest:
        for item in park_outlines(name, plat, plng):
            if inside_shape(item.get("geojson") or {}, lat, lng):
                return from_nominatim(item, lat, lng)
    return None


_outlines = {}  # park name -> its Nominatim answers with outlines (parks don't move: kept for the server's life)


def park_in_memory(lat, lng):
    """The park a spot is in, from outlines already fetched (no network at all)."""
    for items in list(_outlines.values()):
        for item in items:
            if inside_shape(item.get("geojson") or {}, lat, lng):
                return from_nominatim(item, lat, lng)
    return None


def park_outlines(name, plat, plng):
    key = norm(name)
    if key not in _outlines:
        d = 0.03
        found = ask_nominatim("search", {"q": name, "viewbox": f"{plng - d},{plat + d},{plng + d},{plat - d}", "bounded": 1, "limit": 3,
                                         "polygon_geojson": 1, "polygon_threshold": 0.00005, "addressdetails": 1})
        _outlines[key] = [i for i in found if i.get("category") in ("leisure", "tourism", "landuse") and i.get("geojson")]
    return _outlines[key]


# ---------------------------------------------------------------- a photo for the place
# In this order: the photo linked in OpenStreetMap (image / wikimedia_commons), the Wikidata item's photo, and the
# preview picture the place's own website shows when it's shared (og:image). Only public web addresses are fetched.
def _public_url(url):
    try:
        u = urlparse(url)
        if u.scheme not in ("http", "https") or not u.hostname:
            return False
        for info in socket.getaddrinfo(u.hostname, None):
            ip = ipaddress.ip_address(info[4][0])
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
                return False
        return True
    except (ValueError, OSError):
        return False


def _commons_file(name):
    name = re.sub(r"^(File|Image):", "", name.strip(), flags=re.I)
    return f"https://commons.wikimedia.org/wiki/Special:FilePath/{quote(name.replace(' ', '_'))}?width=640" if name else None


def _wikidata_photo(qid, prop="P18"):
    """The Commons file of a Wikidata item's image (P18) or logo (P154)."""
    try:
        r = requests.get("https://www.wikidata.org/w/api.php", params={"action": "wbgetclaims", "entity": qid, "property": prop, "format": "json"},
                         headers=HEADERS, timeout=5)
        claims = r.json().get("claims", {}).get(prop, [])
        return _commons_file(claims[0]["mainsnak"]["datavalue"]["value"]) if claims else None
    except (requests.RequestException, ValueError, KeyError, IndexError):
        return None


MAPILLARY_TOKEN = os.environ.get("MAPILLARY_TOKEN", "")


# Mapillary's photo search (graph.mapillary.com/images?bbox=) answers with no photos at the moment, so the photo
# points are read from its map tiles instead (the "image" layer of the mly1_public vector tiles, zoom 14), and the
# nearest flat (not 360°) photo's picture is then asked for by its id. Tiles are kept in memory once read.
_mly_tiles: "OrderedDict[tuple, list]" = OrderedDict()


def _varint(buf, i):
    shift = result = 0
    while True:
        b = buf[i]
        i += 1
        result |= (b & 0x7F) << shift
        if not b & 0x80:
            return result, i
        shift += 7


def _fields(buf):
    """(field number, wire type, value) for each field of a protobuf message."""
    i = 0
    while i < len(buf):
        key, i = _varint(buf, i)
        num, wire = key >> 3, key & 7
        if wire == 0:
            val, i = _varint(buf, i)
        elif wire == 2:
            size, i = _varint(buf, i)
            val, i = buf[i:i + size], i + size
        elif wire == 1:
            val, i = buf[i:i + 8], i + 8
        elif wire == 5:
            val, i = buf[i:i + 4], i + 4
        else:
            return
        yield num, wire, val


def _packed(buf):
    i, out = 0, []
    while i < len(buf):
        v, i = _varint(buf, i)
        out.append(v)
    return out


def _mly_points(z, x, y):
    """[(lat, lng, image id, is_pano)] in one Mapillary tile."""
    key = (z, x, y)
    if key in _mly_tiles:
        _mly_tiles.move_to_end(key)
        return _mly_tiles[key]
    r = requests.get(f"https://tiles.mapillary.com/maps/vtp/mly1_public/2/{z}/{x}/{y}", params={"access_token": MAPILLARY_TOKEN}, timeout=10)
    points = []
    if r.status_code == 200:
        for num, _, layer in _fields(r.content):
            if num != 3:
                continue
            parts = list(_fields(layer))
            if next((v.decode() for n, _, v in parts if n == 1), "") != "image":
                continue
            extent = next((v for n, _, v in parts if n == 5), 4096)
            keys = [v.decode() for n, _, v in parts if n == 3]
            values = []
            for n, _, v in parts:
                if n == 4:
                    val = None
                    for vn, vw, vv in _fields(v):
                        val = vv.decode() if vw == 2 else (vv != 0 if vn == 7 else vv)
                    values.append(val)
            for n, _, feature in parts:
                if n != 2:
                    continue
                props, geom = {}, []
                for fn, _, fv in _fields(feature):
                    if fn == 2:
                        t = _packed(fv)
                        props = {keys[t[k]]: values[t[k + 1]] for k in range(0, len(t) - 1, 2)}
                    elif fn == 4:
                        geom = _packed(fv)
                if len(geom) < 3 or not props.get("id"):
                    continue
                zig = lambda v: (v >> 1) ^ -(v & 1)
                px, py = zig(geom[1]) / extent, zig(geom[2]) / extent
                n_tiles = 2 ** z
                lng_p = (x + px) / n_tiles * 360 - 180
                lat_p = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + py) / n_tiles))))
                points.append((lat_p, lng_p, props["id"], bool(props.get("is_pano")), props.get("compass_angle")))
    _mly_tiles[key] = points
    while len(_mly_tiles) > 40:
        _mly_tiles.popitem(last=False)
    return points


_mly_refused_until = [0.0]


def _bearing(lat1, lng1, lat2, lng2):
    """Compass direction (degrees) from point 1 to point 2."""
    y = math.sin(math.radians(lng2 - lng1)) * math.cos(math.radians(lat2))
    x = math.cos(math.radians(lat1)) * math.sin(math.radians(lat2)) - math.sin(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.cos(math.radians(lng2 - lng1))
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def _mapillary_photo(lat, lng):
    """A street-level photo from Mapillary (free, needs MAPILLARY_TOKEN) taken within 30 m of the place by a camera
    pointing at it (like Street View), so it shows the place and not just the street."""
    if not MAPILLARY_TOKEN or time.time() < _mly_refused_until[0]:
        return None
    try:
        z = 14
        n = 2 ** z
        x = int((lng + 180) / 360 * n)
        y = int((1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n)
        facing = []
        for p in _mly_points(z, x, y):
            dist = metres(lat, lng, p[0], p[1])
            if p[3] or p[4] is None or not 4 <= dist <= 30:
                continue
            off = abs((_bearing(p[0], p[1], lat, lng) - float(p[4]) + 180) % 360 - 180)
            if off <= 30:
                facing.append((dist + off, p))
        for _, (_, _, image_id, _, _) in sorted(facing)[:3]:
            r = requests.get(f"https://graph.mapillary.com/{image_id}", params={"access_token": MAPILLARY_TOKEN, "fields": "thumb_1024_url"}, timeout=6)
            if r.status_code in (400, 401, 403) and "permission" in r.text:
                # the key can't read photos (its app needs the Read permission): stop asking for a while
                _mly_refused_until[0] = time.time() + 6 * 3600
                return None
            url = r.json().get("thumb_1024_url") if r.status_code == 200 else None
            if url:
                return {"url": url, "source": "Mapillary", "page": f"https://www.mapillary.com/app/?pKey={image_id}", "nearby": True, "street": True}
    except (requests.RequestException, ValueError, KeyError, IndexError):
        return None
    return None


SKIP_FILE = re.compile(r"map|plan|diagram|logo|coat of arms|flag|\.svg|\.pdf|\.tif|chart|locator|route|protest|march|rally|parade|"
                       r"festival|concert|portrait|demonstration|campaign|vigil|selfie|interview|conference|meeting|income|strike", re.I)


VEHICLE = re.compile(r"\b(car|cars|van|bus|buses|lorry|truck|taxi|tram|vehicle|motor|registration|reg|ford|toyota|bmw|mercedes|volkswagen|vw|audi|"
                     r"bentley|nissan|honda|opel|vauxhall|renault|peugeot|volvo|skoda|kia|hyundai|mazda|fiat|citroen|jaguar|porsche|ferrari|"
                     r"tesla|lexus|mini|subaru|suzuki|mitsubishi|land rover|range rover|alfa|saab|dacia|seat|chevrolet)\b", re.I)
PLACE_WORD = re.compile(r"street|road|avenue|lane|square|quay|place|terrace|row|hill|green|park|church|chapel|house|hall|bridge|station|"
                        r"shop|store|pub|bar|caf[eé]|restaurant|hotel|college|school|building|library|market|centre|theatre|cinema|gym|"
                        r"pharmacy|salon|bakery|corner|junction|village|parade|mall|gallery|museum|garden|canal|harbour", re.I)


def _names_place(title, name):
    """True if a photo's title names the place (all of the name's main words appear in it)."""
    words = [w for w in norm(re.sub(r"\b(the|of|and|ltd|limited|dublin|shop|store)\b", " ", (name or "").lower())).split() if len(w) > 2]
    # "Elizabeth O'Farrell Park" -> elizabeth, farrell: generic words can be left out when two specific words remain
    specific = [w for w in words if w not in ("park", "parks", "garden", "gardens", "square", "green", "playground", "grounds")]
    if len(specific) >= 2:
        words = specific
    t = norm(title)
    return bool(words) and all(re.search(rf"\b{re.escape(w)}", t) for w in words)


def _commons_nearby(lat, lng, radius=60, name=""):
    """A photo of the place from Wikimedia Commons: taken within the radius and with the place's name in its title."""
    if not name:
        return None
    try:
        r = requests.get("https://commons.wikimedia.org/w/api.php", params={
            "action": "query", "format": "json", "generator": "geosearch", "ggscoord": f"{lat}|{lng}", "ggsradius": radius,
            "ggsnamespace": 6, "ggslimit": 15, "prop": "imageinfo|coordinates", "iiprop": "url|mime", "iiurlwidth": 800}, headers=HEADERS, timeout=6)
        pages = list(r.json().get("query", {}).get("pages", {}).values())
        photos = []
        for pg in pages:
            info = (pg.get("imageinfo") or [{}])[0]
            co = (pg.get("coordinates") or [{}])[0]
            if info.get("mime") not in ("image/jpeg", "image/webp") or SKIP_FILE.search(pg.get("title", "")):
                continue
            # only photos of buildings and streets: Geograph's collection, or a title naming a street or building (people
            # also upload geotagged photos of their cars and events, which say nothing about the place)
            title = pg.get("title", "")
            if VEHICLE.search(title) or not _names_place(title, name):
                continue
            # the location search already kept it within the radius; some files don't send their own coordinates back
            dist = metres(lat, lng, co["lat"], co["lon"]) if "lat" in co else radius
            score = dist + (0 if "geograph" in title.lower() else 35)
            photos.append((score, info.get("thumburl") or info.get("url"), info.get("descriptionurl")))
        if not photos:
            return None
        _, url, page = min(photos)
        return {"url": url, "source": "Wikimedia Commons", "page": page}
    except (requests.RequestException, ValueError, KeyError):
        return None


META_IMAGE = re.compile(r'<meta[^>]+(?:property|name)=["\'](?:og:image(?::secure_url)?|twitter:image(?::src)?)["\'][^>]*>', re.I)
CONTENT = re.compile(r'content=["\']([^"\']+)["\']', re.I)


_pages: "OrderedDict[str, tuple[float, Optional[tuple[str, str]]]]" = OrderedDict()


def _fetch_page(url):
    """(final url, html) of a website's page, following at most 3 redirects to public addresses; kept for a day, and
    downloaded once even when the photo and the opening hours ask for it at the same time."""
    hit = _pages.get(url)
    if hit and time.time() - hit[0] < CACHE_S:
        return hit[1]
    with _pages_lock:
        job = _downloading.get(url)
        if job is None:
            job = _downloading[url] = _page_pool.submit(_download_page, url)
    try:
        return job.result(timeout=15)
    except Exception:  # noqa: BLE001 - no page
        return None
    finally:
        with _pages_lock:
            if _downloading.get(url) is job and job.done():
                del _downloading[url]


_pages_lock = threading.Lock()
_downloading = {}
_page_pool = ThreadPoolExecutor(max_workers=8)


def _download_page(url):
    start, page = url, None
    for _ in range(4):
        if not _public_url(url):
            break
        try:
            r = requests.get(url, headers={**HEADERS, "Accept": "text/html"}, timeout=3, allow_redirects=False, stream=True)
            if r.is_redirect or r.status_code in (301, 302, 303, 307, 308):
                url = urljoin(url, r.headers.get("Location", ""))
                r.close()
                continue
            if r.status_code == 200 and "html" in r.headers.get("Content-Type", ""):
                page = (url, r.raw.read(600_000, decode_content=True).decode(r.encoding or "utf-8", "ignore"))
            r.close()
        except (requests.RequestException, OSError, ValueError):
            pass
        break
    _pages[start] = (time.time(), page)
    while len(_pages) > 500:
        _pages.popitem(last=False)
    return page


def _website_photo(url):
    """The og:image (or twitter:image) of a website's page, else its first photo, else its logo: (url, is_logo)."""
    got = _fetch_page(url)
    if not got:
        return None
    url, page = got
    for tag in META_IMAGE.findall(page):
        m = CONTENT.search(tag)
        if m:
            image = urljoin(url, html.unescape(m.group(1)).strip())
            if image.startswith("https://") or image.startswith("http://"):
                return image, False
    # no preview picture: the first real photo on the page, else the site's app icon (shown as a logo)
    for src in re.findall(r'<img[^>]+src=["\']([^"\']+\.(?:jpe?g|webp)(?:\?[^"\']*)?)["\']', page, re.I):
        if not re.search(r"icon|logo|sprite|pixel|avatar|badge|flag|payment|placeholder", src, re.I):
            return urljoin(url, html.unescape(src)), False
    # the site's logo image (alt, class or file name says "logo"), its sharpest version from srcset. Small app
    # icons (apple-touch-icon) aren't used: blown up to fill the panel they're blurry and hard to read.
    for tag in re.findall(r"<img\b[^>]*>", page, re.I):
        if not re.search(r"logo", tag, re.I) or re.search(r"google.?play|app.?store|payment|visa|mastercard|facebook|instagram|twitter|tripadvisor", tag, re.I):
            continue
        srcset = re.search(r'srcset=["\']([^"\']+)["\']', tag, re.I)
        src = srcset.group(1).split(",")[-1].strip().split(" ")[0] if srcset else (re.search(r'\ssrc=["\']([^"\']+)["\']', tag, re.I) or [None, None])[1]
        if src and not src.startswith("data:"):
            return urljoin(url, html.unescape(src)), True
    return None


# ---------------------------------------------------------------- opening hours from the place's own website
# Only 1 in 6 places in OpenStreetMap has its opening hours. Many websites state theirs for search engines in
# schema.org data (JSON-LD "openingHoursSpecification" / "openingHours", or microdata itemprop="openingHours"):
# read from there, and only when the page describes one place (a chain's page listing many shops is skipped).
LD_JSON = re.compile(r'<script[^>]+application/ld\+json[^>]*>(.*?)</script>', re.I | re.S)
ITEMPROP_HOURS = re.compile(r'<[^>]+itemprop=["\']openingHours["\'][^>]*>', re.I)
DAY_CODES = {"monday": "Mo", "tuesday": "Tu", "wednesday": "We", "thursday": "Th", "friday": "Fr", "saturday": "Sa", "sunday": "Su",
             "mo": "Mo", "tu": "Tu", "we": "We", "th": "Th", "fr": "Fr", "sa": "Sa", "su": "Su"}
ORDER = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]
OSM_RULE = re.compile(r"^(?:(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)(?:,(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)*"
                      r"(?: (?:\d{2}:\d{2}-\d{2}:\d{2}(?:,\d{2}:\d{2}-\d{2}:\d{2})*|off))?$")


def _ld_items(obj, depth=0):
    if depth > 6:
        return
    if isinstance(obj, list):
        for x in obj:
            yield from _ld_items(x, depth + 1)
    elif isinstance(obj, dict):
        yield obj
        for k in ("@graph", "location", "department", "subOrganization", "mainEntity", "about"):
            if k in obj:
                yield from _ld_items(obj[k], depth + 1)


def _hhmm(t):
    m = re.match(r"^T?(\d{1,2}):(\d{2})", str(t or "").strip())
    return f"{int(m.group(1)):02d}:{m.group(2)}" if m and int(m.group(1)) <= 24 else None


def _group_days(days):
    """{'Mo': '09:00-17:00', ...} -> 'Mo-Fr 09:00-17:00; Sa 10:00-16:00' (days not listed are closed)."""
    rules, i = [], 0
    while i < 7:
        if ORDER[i] not in days:
            i += 1
            continue
        j = i
        while j + 1 < 7 and days.get(ORDER[j + 1]) == days[ORDER[i]]:
            j += 1
        span = ORDER[i] if i == j else f"{ORDER[i]}-{ORDER[j]}" if j > i + 1 else f"{ORDER[i]},{ORDER[j]}"
        rules.append(f"{span} {days[ORDER[i]]}")
        i = j + 1
    text = "; ".join(rules)
    return "24/7" if text == "Mo-Su 00:00-24:00" else text


def _hours_of(item):
    """An OpenStreetMap-style opening_hours text from one schema.org item, or None."""
    days = {}
    spec = item.get("openingHoursSpecification")
    for s in spec if isinstance(spec, list) else [spec] if isinstance(spec, dict) else []:
        if not isinstance(s, dict) or s.get("validFrom") or s.get("validThrough"):
            continue  # a holiday's special hours
        opens, closes = _hhmm(s.get("opens")), _hhmm(s.get("closes"))
        names = s.get("dayOfWeek")
        for d in names if isinstance(names, list) else [names]:
            code = DAY_CODES.get(str(d or "").rstrip("/").split("/")[-1].strip().lower())
            if not code:
                continue
            if not opens or not closes or opens == closes == "00:00" and s.get("closes") is None:
                continue
            if closes in ("23:59", "00:00") and opens == "00:00":
                closes = "24:00"
            days[code] = f"{days[code]},{opens}-{closes}" if code in days and opens not in days[code] else f"{opens}-{closes}"
    if days:
        return _group_days(days)
    oh = item.get("openingHours")
    rules = [oh] if isinstance(oh, str) else [x for x in oh if isinstance(x, str)] if isinstance(oh, list) else []
    return _clean_rules(rules)


def _clean_rules(rules):
    """schema.org openingHours texts ('Mo-Fr 09:00-17:30', 'Sa 10:00-16:00') as one opening_hours text, if valid."""
    out = []
    for rule in rules:
        for part in re.split(r"[;\n]", rule):
            part = re.sub(r"\s+", " ", part.strip())
            part = re.sub(r"(\d{1,2}):(\d{2})", lambda m: f"{int(m.group(1)):02d}:{m.group(2)}", part)
            part = re.sub(r"\b(Mo|Tu|We|Th|Fr|Sa|Su)\s*-\s*(Mo|Tu|We|Th|Fr|Sa|Su)\b", r"\1-\2", part)
            part = re.sub(r"(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})", r"\1-\2", part)
            if not part:
                continue
            if not OSM_RULE.match(part):
                return None  # something this can't read for sure: better no hours than wrong ones
            out.append(part)
    return "; ".join(out) or None


# Hours written as text on the page ("Monday - Friday: 9am - 6pm", "Sat 10:00–16:00", "Sunday Closed"): read only
# near a heading that says hours or opening, only when every day mentioned has one clear time, and only for a
# place's own website (not a chain's, whose page may show another branch's hours).
_DAY = r"(?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:s|nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)"
_TIME = r"(?:\d{1,2}(?:[:.h]\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?|noon|midday|midnight)"
TEXT_RULE = re.compile(
    rf"\b(?P<first>{_DAY})\b\.?(?:\s*(?:-|–|—|to|until|thru|through)\s*(?P<last>{_DAY})\b\.?)?(?P<more>(?:\s*(?:,|&|and|/)\s*{_DAY}\b\.?)*)"
    rf"\s*[:\-–]?\s*(?:(?P<closed>closed)|(?P<opens>{_TIME})\s*(?:-|–|—|to|until|till)\s*(?P<closes>{_TIME})"
    rf"(?P<also>(?:\s*(?:,|&|and|/)\s*{_TIME}\s*(?:-|–|—|to|until|till)\s*{_TIME})*))", re.I)
TIME_RANGE = re.compile(rf"({_TIME})\s*(?:-|–|—|to|until|till)\s*({_TIME})", re.I)
HOURS_HEADING = re.compile(r"opening hours|opening times|hours of business|business hours|our hours|\bhours\b|open(?:ing)?\b|times", re.I)


def _day_code(word):
    return {"mon": "Mo", "tue": "Tu", "wed": "We", "thu": "Th", "fri": "Fr", "sat": "Sa", "sun": "Su"}[word.lower()[:3]]


def _to_24(t, other=None):
    t = t.lower().replace(".", ":").replace("a:m:", "am").replace("p:m:", "pm").replace(" ", "")
    if t in ("noon", "midday"):
        return 12, 0
    if t == "midnight":
        return 24, 0
    m = re.match(r"^(\d{1,2})(?:[:h](\d{2}))?(am|pm)?$", t)
    if not m:
        return None
    h, mins, half = int(m.group(1)), int(m.group(2) or 0), m.group(3)
    if half is None and m.group(2) is None:
        return None  # "9 - 5": am or pm isn't certain
    if half == "pm" and h < 12:
        h += 12
    if half == "am" and h == 12:
        h = 0
    return (h, mins) if h <= 24 and mins < 60 else None


def text_hours(page):
    """An opening_hours text read from a page's visible text, or None when it isn't certain."""
    text = re.sub(r"(?is)<(script|style|noscript|svg)[^>]*>.*?</\1>", " ", page)
    text = re.sub(r"(?i)<br\s*/?>|</(p|div|li|tr|h\d|dt|dd)>", "\n", text)
    text = html.unescape(re.sub(r"<[^>]+>", " ", text)).replace("\xa0", " ")
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    best = None
    for heading in HOURS_HEADING.finditer(text):
        window = text[heading.end():heading.end() + 600]
        days, last_end, ok = {}, None, True
        for m in TEXT_RULE.finditer(window):
            if last_end is not None and m.start() - last_end > 40:
                break  # the hours block ended
            if last_end is None and m.start() > 120:
                break  # not right under the heading
            last_end = m.end()
            first, last, more, closed, opens, closes = (m.group(k) for k in ("first", "last", "more", "closed", "opens", "closes"))
            span = [ORDER.index(_day_code(first))]
            if last:
                i, end = span[0], ORDER.index(_day_code(last))
                span = []
                while True:
                    span.append(i)
                    if i == end or len(span) > 7:
                        break
                    i = (i + 1) % 7
            for extra in re.findall(rf"\b{_DAY}\b", more or "", re.I):
                span.append(ORDER.index(_day_code(extra)))
            if closed:
                value = "off"
            else:
                ranges = []
                for a_text, b_text in [(opens, closes)] + TIME_RANGE.findall(m.group("also") or ""):
                    a, b = _to_24(a_text), _to_24(b_text)
                    if not a or not b:
                        ok = False
                        break
                    if not re.search(r"[ap]\.?m", f"{a_text}{b_text}", re.I) and a[0] < 12 and b < a and b[0] + 12 > a[0]:
                        b = (b[0] + 12, b[1])  # "10:00 - 5:30": a shop closing at half five, not overnight
                    if b == (12, 0) and a[0] > 12 and re.search(r"12\s*p", b_text, re.I):
                        b = (24, 0)  # "4PM-12PM" means midnight
                    ranges.append("00:00-24:00" if a == (0, 0) and b == (24, 0) else f"{a[0] % 24:02d}:{a[1]:02d}-{b[0] if b[0] == 24 else b[0] % 24:02d}:{b[1]:02d}")
                if not ok:
                    break
                value = ",".join(ranges)
            for d in span:
                if ORDER[d] in days and days[ORDER[d]] != value:
                    ok = False  # two different times for one day (another branch, summer hours...): not certain
                days[ORDER[d]] = value
        if not ok:
            return None
        open_days = {k: v for k, v in days.items() if v != "off"}
        if len(days) >= 3 and open_days:
            found = _group_days(open_days) + "".join(f"; {d} off" for d in ORDER if days.get(d) == "off")
            if best and best != found:
                return None  # the page shows two different weeks
            best = found
    return best


def website_hours(url, chain=False):
    """{'opening_hours', 'source', 'page'} read from a place's own website, or None. A chain's website (chain=True)
    is only read for schema.org data, not for hours written as text."""
    got = _fetch_page(url if url.startswith("http") else f"https://{url}")
    if not got:
        return None
    final, page = got
    found = set()
    for block in LD_JSON.findall(page):
        try:
            data = json.loads(block.strip())
        except ValueError:
            try:
                data = json.loads(html.unescape(block).strip())
            except ValueError:
                continue
        for item in _ld_items(data):
            h = _hours_of(item)
            if h:
                found.add(h)
    if not found:
        rules = [CONTENT.search(t).group(1) for t in ITEMPROP_HOURS.findall(page) if CONTENT.search(t)]
        h = _clean_rules(rules) if rules else None
        if h:
            found.add(h)
    if not found and not chain:
        h = text_hours(page)
        if h:
            found.add(h)
    if len(found) != 1:
        return None  # none, or a page listing several places' hours
    return {"opening_hours": found.pop(), "source": (urlparse(final).hostname or "").replace("www.", ""), "page": final}


# Logos of the main chains in Dublin, each checked by eye on Wikimedia Commons (the file shows the brand's current
# logo as used in Ireland). Matched on the start of the place's name, or its OpenStreetMap brand.
CHAIN_LOGOS = [
    (r"tesco", "Tesco logo.png", "Tesco"), (r"lidl", "Lidl-Logo.svg", "Lidl"), (r"aldi", "Aldi Süd 2017 logo.svg", "Aldi"),
    (r"dunnes", "Logo of Dunnes Stores.svg", "Dunnes Stores"), (r"super ?valu", "SuperValuLogo.svg", "SuperValu"),
    (r"m s\b|marks (and )?spencer", "M&S logo.svg", "M&S"), (r"eurospar", "Eurospar-logo.svg", "Eurospar"), (r"spar\b", "Spar-logo.svg", "Spar"),
    (r"centra", "Centra logo.svg", "Centra"), (r"mace\b", "MACENIlogo.JPG", "Mace"), (r"londis", "Londis logo.svg", "Londis"),
    (r"costcutter", "Costcutter.png", "Costcutter"), (r"circle ?k\b", "Circle K logo 2015.svg", "Circle K"), (r"applegreen", "Applegreen Logo.png", "Applegreen"),
    (r"iceland\b", "Iceland (supermarket) logo.svg", "Iceland"), (r"mc ?donald", "McDonald's with slogan 2020.svg", "McDonald's"),
    (r"burger king", "Burger King 2020.svg", "Burger King"), (r"subway\b", "Subway 2016 logo.svg", "Subway"), (r"kfc\b|kentucky fried", "Kfc textlogo.svg", "KFC"),
    (r"supermac", "Supermac's.PNG", "Supermac's"), (r"starbucks", "Starbucks coffee wordmark.png", "Starbucks"), (r"costa( coffee)?$|costa coffee", "Costa Coffee Logo white on red.png", "Costa Coffee"),
    (r"insomnia", "New-logo Insomnia coffee.svg", "Insomnia"), (r"domino", "Domino's 2025.svg", "Domino's"), (r"four star pizza|4 star pizza", "4starlogo.png", "Four Star Pizza"),
    (r"papa john", "Papa John's Logo 2019.svg", "Papa John's"), (r"pizza hut", "Pizza Hut classic logo.svg", "Pizza Hut"), (r"penneys|primark", "Primark Stores Logo.svg", "Penneys"),
    (r"bank of ireland", "Bank of Ireland Logo 2020.svg", "Bank of Ireland"), (r"aib\b|allied irish", "AIB BANK Logo.svg", "AIB"),
    (r"permanent ?tsb|ptsb", "Permanent tsb.png", "PTSB"), (r"an post\b", "An Post logo.svg", "An Post"), (r"nando", "Nando's wordmark.svg", "Nando's"),
    (r"five guys", "Five Guys logo.svg", "Five Guys"), (r"pret\b|pret a manger", "PretAManger logo.svg", "Pret"), (r"specsavers", "Specsavers logo.svg", "Specsavers"),
    (r"vodafone", "Vodafone logo 2017.svg", "Vodafone"), (r"smyths", "Smyths Logo.svg", "Smyths"), (r"dealz", "Dealz Logo 2023.png", "Dealz"),
    (r"tk ?maxx", "TK Maxx Logo.svg", "TK Maxx"), (r"h m$|h m (store|clothing|fashion)", "H&M-Logo.svg", "H&M"), (r"tim hortons", "Tim Hortons Logo.svg", "Tim Hortons"),
    (r"wagamama", "Wagamama-Logo.svg", "Wagamama"), (r"maxol", "Maxol Logo.jpg", "Maxol"), (r"texaco", "Texaco logo.svg", "Texaco"),
    (r"decathlon", "Decathlon - logo (France, 2024).svg", "Decathlon"), (r"eason", "Eason.png", "Eason"), (r"freshii", "Freshii logo.svg", "Freshii"),
]


def chain_logo(name, brand=""):
    for text in (brand, name):
        t = norm(text)  # "M&S Food" -> "m s food", "McDonald's" -> "mcdonald s"
        for pattern, file, label in CHAIN_LOGOS:
            if t and re.match(pattern, t, re.I):
                return {"url": _commons_file(file).replace("width=640", "width=480"), "logo": True, "source": label,
                        "page": f"https://commons.wikimedia.org/wiki/File:{quote(file.replace(' ', '_'))}", "chain": True}
    return None


def _commons_by_name(name, lat=None, lng=None):
    """A photo of a park, landmark or campus found by its name on Wikimedia Commons (with "Dublin" in the search,
    and the place's name in the file's title)."""
    try:
        r = requests.get("https://commons.wikimedia.org/w/api.php", params={
            "action": "query", "format": "json", "generator": "search", "gsrsearch": f'"{name}" Dublin filetype:bitmap', "gsrnamespace": 6,
            "gsrlimit": 8, "prop": "imageinfo", "iiprop": "url|mime", "iiurlwidth": 800}, headers=HEADERS, timeout=6)
        pages = sorted(r.json().get("query", {}).get("pages", {}).values(), key=lambda p: p.get("index", 99))
        for pg in pages:
            title = pg.get("title", "")
            info = (pg.get("imageinfo") or [{}])[0]
            if info.get("mime") in ("image/jpeg", "image/webp") and _names_place(title, name) and not SKIP_FILE.search(title) and not VEHICLE.search(title):
                return {"url": info.get("thumburl") or info.get("url"), "source": "Wikimedia Commons", "page": info.get("descriptionurl")}
    except (requests.RequestException, ValueError, KeyError):
        pass
    return None


PHOTO_BUDGET_S = 3  # the photo sources that need the network get this long together


def photo_for(place, lat=None, lng=None, landmark=False):
    """{'url', 'source', 'page', 'logo'?, 'nearby'?} for a place's photo, or None. In this order: its brand's logo
    (the main chains), the photo linked in OpenStreetMap, its Wikidata photo, its website's photo, its brand's logo
    on Wikidata, its website's logo, then (named places only) a photo of it on Wikimedia Commons or a street-level
    photo (Mapillary, if a key is set). Every source that needs the network is asked at the same time, with a time
    limit, and the first one in this order that found a photo wins."""
    tags = (place or {}).get("tags", {})
    if place and place.get("lat") is not None:
        lat, lng = place["lat"], place["lng"]
    chain = chain_logo((place or {}).get("name") or "", tags.get("brand", ""))
    if chain:
        return chain  # a chain's own logo beats its website's promotional banner
    image = tags.get("image", "")
    if image.startswith("File:") or "commons.wikimedia.org" in image:
        return {"url": _commons_file(image.split("/wiki/")[-1]), "source": "Wikimedia Commons", "page": image if image.startswith("http") else None}
    if image.startswith("https://") and re.search(r"\.(jpe?g|png|webp)(\?|$)", image, re.I):
        return {"url": image, "source": urlparse(image).hostname, "page": image}
    if tags.get("wikimedia_commons", "").startswith("File:"):
        return {"url": _commons_file(tags["wikimedia_commons"]), "source": "Wikimedia Commons", "page": None}

    name = (place or {}).get("name") or ""
    site = tags.get("website") or tags.get("contact:website") or tags.get("url")
    site = (site if site.startswith("http") else f"https://{site}") if site else None
    jobs = []
    if tags.get("wikidata"):
        jobs.append(("wikidata", tags["wikidata"], _pool.submit(_wikidata_photo, tags["wikidata"])))
    if site:
        jobs.append(("site", site, _pool.submit(_website_photo, site)))
    for key in ("brand:wikidata", "operator:wikidata"):  # chains: Tesco, Spar, Starbucks, Flyefit...
        if tags.get(key):
            qid = tags[key].split(";")[0].strip()
            jobs.append(("brand", qid, _pool.submit(_wikidata_photo, qid, "P154")))
    if lat is not None and name:  # a spot with no named place: a nearby photo would be of something else
        jobs.append(("found", None, _pool.submit(_commons_nearby, lat, lng, 120, name)))
        if landmark:
            jobs.append(("found", None, _pool.submit(_commons_by_name, name, lat, lng)))
        jobs.append(("found", None, _pool.submit(_mapillary_photo, lat, lng)))
    deadline = time.time() + PHOTO_BUDGET_S
    site_logo = None
    for kind, ref, job in jobs:
        if kind == "found" and site_logo:
            return site_logo  # the place's own logo beats a photo found by searching
        try:
            found = job.result(timeout=max(0.05, deadline - time.time()))
        except Exception:  # noqa: BLE001 - too slow or failed: try the next one
            continue
        if not found:
            continue
        if kind == "wikidata":
            return {"url": found, "source": "Wikimedia Commons", "page": f"https://www.wikidata.org/wiki/{ref}"}
        if kind == "site":
            host = urlparse(ref).hostname.replace("www.", "")
            if not found[1]:
                return {"url": found[0], "source": host, "page": ref, "website": True}
            site_logo = {"url": found[0], "logo": True, "source": host, "page": ref, "website": True}
            continue
        if kind == "brand":
            return {"url": found, "logo": True, "source": tags.get("brand") or "Wikimedia Commons", "page": f"https://www.wikidata.org/wiki/{ref}"}
        return found
    return site_logo


class Busy(Exception):
    pass


_overpass_down_until = [0.0]


def _check_overpass():
    """When the backend starts: if Overpass is busy, skip it from the first click (instead of the first click waiting)."""
    try:
        r = requests.post(OVERPASS[0], data={"data": "[out:json][timeout:3];node(1);out ids;"}, headers=HEADERS, timeout=4)
        if r.status_code != 200:
            _overpass_down_until[0] = time.time() + 600
    except requests.RequestException:
        _overpass_down_until[0] = time.time() + 600


def ask_overpass(query):
    # every server busy a moment ago: don't make people wait for them again for two minutes
    if time.time() < _overpass_down_until[0]:
        raise Busy("Overpass was busy a moment ago")
    start = time.time()
    last = None
    for url in OVERPASS:
        left = OVERPASS_BUDGET_S - (time.time() - start)
        if left < 1:
            break
        try:
            r = requests.post(url, data={"data": query}, headers=HEADERS, timeout=min(3, left))
            if r.status_code == 200:
                return r.json().get("elements", [])
            last = f"{url} answered {r.status_code}"
        except (requests.RequestException, ValueError) as e:
            last = f"{url}: {type(e).__name__}"
    _overpass_down_until[0] = time.time() + 600
    raise Busy(last)


def ask_nominatim(path, params):
    with _nominatim_lock:  # one request a second for the whole server
        wait = 1.1 - (time.time() - _nominatim_last[0])
        if wait > 0:
            time.sleep(wait)
        _nominatim_last[0] = time.time()
    r = requests.get(f"{NOMINATIM}/{path}", params={"format": "jsonv2", "extratags": 1, "accept-language": "en", **params},
                     headers=HEADERS, timeout=8)
    r.raise_for_status()
    return r.json()


def from_nominatim(item, lat, lng):
    """A Nominatim answer in the same shape as an Overpass element."""
    tags = dict(item.get("extratags") or {})
    tags[item.get("category") or "amenity"] = item.get("type") or "yes"
    if item.get("name"):
        tags["name"] = item["name"]
    a = item.get("address") or {}
    for src, dst in (("house_number", "addr:housenumber"), ("road", "addr:street"), ("postcode", "addr:postcode")):
        if a.get(src) and dst not in tags:
            tags[dst] = a[src]
    element = {"type": item.get("osm_type", "node"), "id": item.get("osm_id"), "lat": float(item["lat"]), "lon": float(item["lon"]), "tags": tags}
    return describe(element, lat, lng)


def lookup_nominatim(lat, lng, name):
    place = None
    if name:
        d = 0.012
        found = ask_nominatim("search", {"q": name, "viewbox": f"{lng - d},{lat + d},{lng + d},{lat - d}", "bounded": 1, "limit": 6, "addressdetails": 1})
        options = [from_nominatim(x, lat, lng) for x in found if same_name(x.get("name"), name)]
        place = min(options, key=lambda p: p.get("distance_m", 9999)) if options else None
    else:
        item = ask_nominatim("reverse", {"lat": f"{lat:.6f}", "lon": f"{lng:.6f}", "zoom": 18, "addressdetails": 1})
        if item and item.get("name") and item.get("category") in ("shop", "amenity", "craft", "healthcare", "leisure", "tourism", "office", "historic", "club"):
            candidate = from_nominatim(item, lat, lng)
            if candidate.get("distance_m", 999) <= 60:
                place = candidate
        inside = None
        # only a path, monument or green space can be inside a park: a house or a street isn't (one lookup, not three)
        cat, typ = (item or {}).get("category"), (item or {}).get("type")
        maybe_park = cat in ("leisure", "natural", "landuse", "tourism", "historic", "amenity") or (
            cat == "highway" and typ in ("footway", "path", "pedestrian", "track", "cycleway", "steps", "bridleway", "service"))
        if place is None and maybe_park:
            place = park_at(lat, lng)  # nothing right here: the park the spot is in, if any
        elif place is None:
            place = park_in_memory(lat, lng)  # a road through a park (Chesterfield Avenue): outlines already known, no lookup
        elif place.get("key") == "leisure" and place.get("value") in ("playground", "pitch", "garden", "fountain", "sports_centre", "dog_park"):
            inside = park_at(lat, lng)  # a playground or pitch: which park it's in
        return {"place": place, "inside": inside, "nearby": [], "source": "nominatim"}
    return {"place": place, "inside": None, "nearby": [], "source": "nominatim"}


_pool = ThreadPoolExecutor(max_workers=32)


# ---------------------------------------------------------------- the OpenStreetMap snapshot (instant answers)
# data/dublin_places.json.gz (built by build_places_snapshot.py): every named place in Dublin with its tags, and the
# outlines of parks, campuses and other areas. Clicks inside the snapshot's box are answered from memory, so they
# don't wait for Overpass (often busy) or Nominatim (one request a second for the whole site).
SNAPSHOT = os.environ.get("PLACES_SNAPSHOT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "dublin_places.json.gz"))
SNAPSHOT_BOX = (53.15, -6.55, 53.51, -6.03)  # the extract's south, west, north, east
CELL = 0.002  # grid cell (about 220 m north-south, 130 m east-west)
_local = {}
_local_lock = threading.Lock()


def local_data():
    """{'grid': {(row, col): [element]}, 'areas': [(box, element, geometry)], 'date'}, read once; {} without a snapshot."""
    if "grid" in _local:
        return _local
    with _local_lock:
        if "grid" in _local:
            return _local
        grid, areas, date = defaultdict(list), [], ""
        try:
            with gzip.open(SNAPSHOT, "rt", encoding="utf-8") as f:
                data = json.load(f)
            date = data.get("date", "")
            for plat, plng, ref, tags in data.get("places", []):
                kind, oid = ref.split("/")
                grid[(int(plat // CELL), int(plng // CELL))].append({"type": kind, "id": oid, "lat": plat, "lon": plng, "tags": tags})
            for ref, tags, rings in data.get("areas", []):
                kind, oid = ref.split("/")
                xs = [x for r in rings for x, _ in r]
                ys = [y for r in rings for _, y in r]
                element = {"type": kind, "id": oid, "lat": sum(ys) / len(ys), "lon": sum(xs) / len(xs), "tags": tags}
                areas.append(((min(ys), min(xs), max(ys), max(xs)), element, {"type": "MultiPolygon", "coordinates": [[r] for r in rings]}))
        except (OSError, ValueError, KeyError, ZeroDivisionError):
            grid, areas = None, []
        _local.update(grid=grid, areas=areas, date=date)
    return _local


def in_snapshot(lat, lng):
    s, w, n, e = SNAPSHOT_BOX
    return s + 0.005 < lat < n - 0.005 and w + 0.005 < lng < e - 0.005 and bool(local_data().get("grid"))


def lookup_local(lat, lng, name, radius):
    """The same answer as lookup_overpass, from the snapshot."""
    data = local_data()
    grid = data["grid"]
    # a named pin may be a few hundred metres from the shop's own point: its name is looked for wider than the radius
    reach = max(radius, 800 if name else radius)
    rows, cols = int(reach / 110540 / CELL) + 1, int(reach / (111320 * math.cos(math.radians(lat))) / CELL) + 1
    r0, c0 = int(lat // CELL), int(lng // CELL)
    near = []
    for r in range(r0 - rows, r0 + rows + 1):
        for c in range(c0 - cols, c0 + cols + 1):
            for e in grid.get((r, c), ()):
                d = metres(lat, lng, e["lat"], e["lon"])
                if d <= reach:
                    near.append((d, e))
    near.sort(key=lambda x: x[0])
    places = [describe(e, lat, lng) for d, e in near if d <= radius]
    places = [p for p in places if p["name"]]
    # the areas the spot is inside, smallest first (a playground inside a park inside a campus)
    inside = [(box, e) for box, e, shape in data["areas"] if box[0] <= lat <= box[2] and box[1] <= lng <= box[3] and inside_shape(shape, lat, lng)]
    inside.sort(key=lambda x: (x[0][2] - x[0][0]) * (x[0][3] - x[0][1]))
    inside = [describe(e, lat, lng) for _, e in inside]

    place = None
    if name:
        place = next((describe(e, lat, lng) for d, e in near if same_name(e["tags"].get("name:en") or e["tags"].get("name"), name)), None) \
            or next((a for a in inside if same_name(a["name"], name)), None)
    elif places and places[0].get("distance_m", 999) <= 25:
        place = places[0]  # a click right on a shop or café
    if place is None and not name and inside:
        place = inside[0]  # a click inside a park or campus
    area = next((a for a in inside if not place or a["name"] != place["name"]), None)
    nearby = [p for p in places if not place or p["name"] != place["name"]][:8]
    return {"place": place, "inside": area, "nearby": nearby, "source": "osm-snapshot", "date": data.get("date", "")}


def lookup(lat, lng, name, radius):
    """From the snapshot when the spot is inside it. Elsewhere Overpass (the place, the area it's in and what's
    nearby) and Nominatim (the place only) are asked at the same time: Overpass's fuller answer is used if it comes
    within OVERPASS_BUDGET_S, otherwise Nominatim's."""
    if in_snapshot(lat, lng):
        return lookup_local(lat, lng, name, radius)
    backup = _pool.submit(lookup_nominatim, lat, lng, name)
    try:
        return lookup_overpass(lat, lng, name, radius)
    except Busy:
        try:
            return backup.result(timeout=15)
        except Exception as e:  # noqa: BLE001 - any failure of the backup means no details right now
            raise HTTPException(503, f"OpenStreetMap details are not available right now ({type(e).__name__}).")


def lookup_overpass(lat, lng, name, radius):
    # named places around the spot, and the areas (parks, campuses, shopping centres...) the spot is inside
    query = f"""[out:json][timeout:15];
nwr(around:{radius},{lat:.6f},{lng:.6f})[name][~"^(shop|amenity|craft|healthcare|leisure|tourism|office|historic|sport|club)$"~"."];
out tags center 80;
is_in({lat:.6f},{lng:.6f})->.a;
area.a[name][~"^(leisure|amenity|tourism|landuse|shop|historic|building)$"~"^(park|garden|nature_reserve|university|college|hospital|school|mall|retail|attraction|museum|zoo|stadium|sports_centre|cemetery|castle|yes|recreation_ground|pitch|common)$"];
out tags;"""
    elements = ask_overpass(query)  # raises Busy: lookup() then uses Nominatim's answer
    points = [e for e in elements if e.get("type") != "area"]
    areas = [e for e in elements if e.get("type") == "area"]
    places = sorted((describe(e, lat, lng) for e in points), key=lambda p: p.get("distance_m", 9999))
    places = [p for p in places if p["name"]]
    # the smallest area first (a playground inside a park inside a campus): Overpass lists bigger ones first, roughly
    inside = [describe(a, lat, lng) for a in reversed(areas) if a.get("tags", {}).get("name")]
    inside = [a for a in inside if a["key"] and a["type"] != "Building" or a["tags"].get("opening_hours")]

    place = None
    if name:
        place = next((p for p in places if same_name(p["name"], name)), None) or next((a for a in inside if same_name(a["name"], name)), None)
    elif places and places[0].get("distance_m", 999) <= 25:
        place = places[0]  # a click right on a shop or café
    if place is None and not name and inside:
        place = inside[0]  # a click inside a park or campus
    area = next((a for a in inside if not place or a["name"] != place["name"]), None)
    nearby = [p for p in places if not place or p["name"] != place["name"]][:8]
    return {"place": place, "inside": area, "nearby": nearby, "source": "overpass"}


if not os.environ.get("PYTEST_CURRENT_TEST") and "pytest" not in os.environ.get("_", ""):
    threading.Thread(target=local_data, daemon=True).start()  # read the snapshot before the first click
    threading.Thread(target=_check_overpass, daemon=True).start()


@router.get("/place-info")
def place_info(
    request: Request,
    lat: float = Query(..., ge=53.0, le=53.8, description="Latitude (County Dublin and around)"),
    lng: float = Query(..., ge=-6.8, le=-5.8, description="Longitude"),
    name: Optional[str] = Query(None, max_length=120, description="The name on the map pin, if there was one"),
):
    clean = (name or "").strip()
    if re.match(r"^(near |dropped pin)", clean, re.I):
        clean = ""
    key = f"{lat:.5f},{lng:.5f},{norm(clean)}"
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < CACHE_S:
        return hit[1]
    if _rate_limited(request.client.host if request.client else "?"):
        raise HTTPException(429, "Too many place lookups for now. Please try again in a few minutes.")
    # a named pin may sit a little away from the shop's own point (or the middle of a big park): search wider
    result = lookup(lat, lng, clean, 120 if clean else 60)

    _cache[key] = (time.time(), result)
    _cache.move_to_end(key)
    while len(_cache) > CACHE_SIZE:
        _cache.popitem(last=False)
    return result


_photo_cache: "OrderedDict[str, tuple[float, dict]]" = OrderedDict()


@router.get("/place-photo")
def place_photo(
    request: Request,
    lat: float = Query(..., ge=53.0, le=53.8),
    lng: float = Query(..., ge=-6.8, le=-5.8),
    name: str = Query(..., min_length=1, max_length=120, description="The place's name"),
    landmark: bool = Query(False, description="A park, landmark or campus: its photo may also be found by name"),
    brand: Optional[str] = Query(None, max_length=80),
    website: Optional[str] = Query(None, max_length=300),
    wikidata: Optional[str] = Query(None, pattern=r"^Q\d+$"),
    brand_wikidata: Optional[str] = Query(None, pattern=r"^Q\d+(;Q\d+)*$"),
    image: Optional[str] = Query(None, max_length=300),
    wikimedia_commons: Optional[str] = Query(None, max_length=300),
):
    """A photo (or logo) for a place in the side panel: asked for separately so the opening hours don't wait for it.
    The tags come from /place-info's answer (website, Wikidata, brand...), so nothing is looked up twice."""
    tags = {k: v for k, v in {"brand": brand, "website": website, "wikidata": wikidata, "brand:wikidata": brand_wikidata,
                              "image": image, "wikimedia_commons": wikimedia_commons}.items() if v}
    key = f"{lat:.5f},{lng:.5f},{norm(name)},{landmark},{sorted(tags.items())}"
    hit = _photo_cache.get(key)
    if hit and time.time() - hit[0] < CACHE_S:
        return hit[1]
    if _rate_limited(request.client.host if request.client else "?"):
        raise HTTPException(429, "Too many place lookups for now. Please try again in a few minutes.")
    result = {"photo": photo_for({"name": name, "tags": tags, "lat": lat, "lng": lng}, lat, lng, landmark)}
    _photo_cache[key] = (time.time(), result)
    while len(_photo_cache) > CACHE_SIZE:
        _photo_cache.popitem(last=False)
    return result


_hours_cache: "OrderedDict[str, tuple[float, dict]]" = OrderedDict()


@router.get("/place-hours")
def place_hours(
    request: Request,
    website: str = Query(..., min_length=4, max_length=300, description="The place's own website (from /place-info)"),
    name: str = Query("", max_length=120),
    chain: bool = Query(False, description="A chain's shop: its website is only read for schema.org data"),
):
    """Opening hours read from a place's own website, for places OpenStreetMap has none for:
    {'hours': {'opening_hours', 'source', 'page'} or None}."""
    chain = chain or bool(chain_logo(name))
    key = f"{website.strip().lower()},{chain}"
    hit = _hours_cache.get(key)
    if hit and time.time() - hit[0] < CACHE_S:
        return hit[1]
    if _rate_limited(request.client.host if request.client else "?"):
        raise HTTPException(429, "Too many place lookups for now. Please try again in a few minutes.")
    result = {"hours": website_hours(website.strip(), chain)}
    _hours_cache[key] = (time.time(), result)
    while len(_hours_cache) > CACHE_SIZE:
        _hours_cache.popitem(last=False)
    return result
