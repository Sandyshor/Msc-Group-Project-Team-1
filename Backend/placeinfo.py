"""GET /place-info - details about a place clicked on the district map, like the side panel in Google Maps.

The website's own data has names and locations but no opening hours. OpenStreetMap has them for many places, with
the phone number, website, booking link, cuisine, wheelchair access and more. This endpoint asks OpenStreetMap
(the Overpass API) about one spot and answers with:

  place   the place that was clicked: the named shop, salon, café, park... at that spot (matched by name when the
          map pin had one), or else the park, campus or other area the spot is inside
  inside  the park, campus, shopping centre... the spot is in (when that isn't the place itself)
  nearby  other named places close by (up to 8), nearest first

Answers are cached (opening hours don't change by the minute), each visitor gets a limited number of new lookups,
and other public Overpass servers are tried if the first one is busy. When every Overpass server is busy (it
happens at peak times), OpenStreetMap's Nominatim service is asked instead: it has the same details for the place
itself (not the nearby list), and is used at most once a second, as its usage policy asks.
"""
import csv
import html
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
OVERPASS_BUDGET_S = 9      # give up on Overpass after this long and ask Nominatim
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
        d = 0.03
        found = ask_nominatim("search", {"q": name, "viewbox": f"{plng - d},{plat + d},{plng + d},{plat - d}", "bounded": 1, "limit": 3,
                                         "polygon_geojson": 1, "polygon_threshold": 0.00005, "addressdetails": 1})
        for item in found:
            shape = item.get("geojson") or {}
            if item.get("category") in ("leisure", "tourism", "landuse") and inside_shape(shape, lat, lng):
                return from_nominatim(item, lat, lng)
    return None


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
                _mly_refused_until[0] = time.time() + 600
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
            if info.get("mime") not in ("image/jpeg", "image/webp") or SKIP_FILE.search(pg.get("title", "")) or "lat" not in co:
                continue
            # only photos of buildings and streets: Geograph's collection, or a title naming a street or building (people
            # also upload geotagged photos of their cars and events, which say nothing about the place)
            title = pg.get("title", "")
            if VEHICLE.search(title) or not _names_place(title, name):
                continue
            score = metres(lat, lng, co["lat"], co["lon"]) + (0 if "geograph" in title.lower() else 35)
            photos.append((score, info.get("thumburl") or info.get("url"), info.get("descriptionurl")))
        if not photos:
            return None
        _, url, page = min(photos)
        return {"url": url, "source": "Wikimedia Commons", "page": page}
    except (requests.RequestException, ValueError, KeyError):
        return None


META_IMAGE = re.compile(r'<meta[^>]+(?:property|name)=["\'](?:og:image(?::secure_url)?|twitter:image(?::src)?)["\'][^>]*>', re.I)
CONTENT = re.compile(r'content=["\']([^"\']+)["\']', re.I)


def _website_photo(url):
    """The og:image (or twitter:image) of a website's page, following at most 3 redirects to public addresses."""
    for _ in range(4):
        if not _public_url(url):
            return None
        try:
            r = requests.get(url, headers={**HEADERS, "Accept": "text/html"}, timeout=5, allow_redirects=False, stream=True)
            if r.is_redirect or r.status_code in (301, 302, 303, 307, 308):
                url = urljoin(url, r.headers.get("Location", ""))
                r.close()
                continue
            if r.status_code != 200 or "html" not in r.headers.get("Content-Type", ""):
                return None
            page = r.raw.read(400_000, decode_content=True).decode(r.encoding or "utf-8", "ignore")
            r.close()
        except (requests.RequestException, OSError, ValueError):
            return None
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
    return None


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


def photo_for(place, lat=None, lng=None):
    """{'url', 'source', 'page', 'logo'?, 'nearby'?} for a place's photo, or None. In this order: the place's own
    photo (OpenStreetMap, Wikidata, its website's photo), its brand's logo (chains), its website's logo, then a
    street-level photo at the spot (Mapillary, if a key is set) or a photo taken there (Wikimedia Commons)."""
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
    if tags.get("wikidata"):
        url = _wikidata_photo(tags["wikidata"])
        if url:
            return {"url": url, "source": "Wikimedia Commons", "page": f"https://www.wikidata.org/wiki/{tags['wikidata']}"}
    site = tags.get("website") or tags.get("contact:website") or tags.get("url")
    site_logo = None
    if site:
        site = site if site.startswith("http") else f"https://{site}"
        found = _website_photo(site)
        if found and not found[1]:
            return {"url": found[0], "source": urlparse(site).hostname.replace("www.", ""), "page": site, "website": True}
        if found:
            site_logo = {"url": found[0], "logo": True, "source": urlparse(site).hostname.replace("www.", ""), "page": site, "website": True}
    for key in ("brand:wikidata", "operator:wikidata"):  # chains: Tesco, Spar, Starbucks, Flyefit...
        if tags.get(key):
            qid = tags[key].split(";")[0].strip()
            url = _wikidata_photo(qid, "P154")
            if url:
                return {"url": url, "logo": True, "source": tags.get("brand") or "Wikimedia Commons", "page": f"https://www.wikidata.org/wiki/{qid}"}
    if site_logo:
        return site_logo
    if lat is None:
        return None
    name = (place or {}).get("name") or ""
    if not name:
        return None  # a spot with no named place: a nearby photo would be of something else
    return _commons_nearby(lat, lng, 120, name) or _mapillary_photo(lat, lng)


class Busy(Exception):
    pass


_overpass_down_until = [0.0]


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
            r = requests.post(url, data={"data": query}, headers=HEADERS, timeout=min(6, left))
            if r.status_code == 200:
                return r.json().get("elements", [])
            last = f"{url} answered {r.status_code}"
        except (requests.RequestException, ValueError) as e:
            last = f"{url}: {type(e).__name__}"
    _overpass_down_until[0] = time.time() + 120
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
        if place is None:
            place = park_at(lat, lng)  # nothing right here: the park the spot is in, if any
        elif place.get("key") == "leisure" and place.get("value") in ("playground", "pitch", "garden", "fountain", "sports_centre", "dog_park"):
            inside = park_at(lat, lng)  # a playground or pitch: which park it's in
        return {"place": place, "inside": inside, "nearby": [], "source": "nominatim"}
    return {"place": place, "inside": None, "nearby": [], "source": "nominatim"}


def lookup(lat, lng, name, radius):
    # named places around the spot, and the areas (parks, campuses, shopping centres...) the spot is inside
    query = f"""[out:json][timeout:15];
nwr(around:{radius},{lat:.6f},{lng:.6f})[name][~"^(shop|amenity|craft|healthcare|leisure|tourism|office|historic|sport|club)$"~"."];
out tags center 80;
is_in({lat:.6f},{lng:.6f})->.a;
area.a[name][~"^(leisure|amenity|tourism|landuse|shop|historic|building)$"~"^(park|garden|nature_reserve|university|college|hospital|school|mall|retail|attraction|museum|zoo|stadium|sports_centre|cemetery|castle|yes|recreation_ground|pitch|common)$"];
out tags;"""
    try:
        elements = ask_overpass(query)
    except Busy:
        try:
            return lookup_nominatim(lat, lng, name)
        except (requests.RequestException, ValueError, KeyError) as e:
            raise HTTPException(503, f"OpenStreetMap details are not available right now ({type(e).__name__}).")
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
    if result.get("place"):
        result["place"]["photo"] = photo_for(result["place"], lat, lng)
    elif clean:
        result["photo"] = photo_for({"name": clean, "tags": {}}, lat, lng)

    _cache[key] = (time.time(), result)
    _cache.move_to_end(key)
    while len(_cache) > CACHE_SIZE:
        _cache.popitem(last=False)
    return result
