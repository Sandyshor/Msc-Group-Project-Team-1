"""Builds Backend/data/dublin_places.json.gz, the OpenStreetMap snapshot the district map's place panel answers from.

Every named shop, café, salon, gym, park... in Dublin with its opening hours, contact details and other tags (the
ones placeinfo.KEEP lists), and the outlines of parks, campuses, hospitals and other areas, so a click on the map is
answered at once without asking OpenStreetMap's busy public servers.

Run it now and then to pick up new shops and changed opening hours (needs `pip install osmium`, not in the site's
requirements because only this script uses it):

    curl -o /tmp/Dublin.osm.pbf https://download.bbbike.org/osm/bbbike/Dublin/Dublin.osm.pbf
    python build_places_snapshot.py /tmp/Dublin.osm.pbf data/dublin_places.json.gz . 2026-11-14

The extract (BBBike, updated weekly) covers -6.55..-6.03 E, 53.15..53.51 N: clicks outside it (Skerries, Balbriggan)
are still answered by OpenStreetMap's servers. Data © OpenStreetMap contributors, ODbL.
"""
import gzip, json, sys
import osmium
sys.path.insert(0, sys.argv[3])
from placeinfo import KEEP, KIND_KEYS

KINDS = [k for k in KIND_KEYS if k != "building"]
AREA = {"leisure": {"park", "garden", "nature_reserve", "common", "recreation_ground", "pitch", "stadium", "sports_centre", "golf_course", "playground"},
        "amenity": {"university", "college", "hospital", "school"}, "shop": {"mall"},
        "tourism": {"attraction", "zoo", "museum", "theme_park"}, "landuse": {"cemetery", "recreation_ground"}, "historic": {"castle"}}
FIELDS = set(KEEP) | set(KINDS) | {"name", "name:en", "landuse"}

def wanted(tags):
    return tags.get("name") and any(tags.get(k) for k in KINDS)

def area_kind(tags):
    return tags.get("name") and any(tags.get(k) in v for k, v in AREA.items())

def simplify(ring, tol=0.00004):
    # Douglas-Peucker, enough to tell inside from outside within a few metres
    if len(ring) < 5:
        return ring
    keep = [False] * len(ring); keep[0] = keep[-1] = True
    stack = [(0, len(ring) - 1)]
    while stack:
        a, b = stack.pop()
        (x1, y1), (x2, y2) = ring[a], ring[b]
        best, idx = 0, None
        for i in range(a + 1, b):
            x, y = ring[i]
            dx, dy = x2 - x1, y2 - y1
            d = abs(dy * x - dx * y + x2 * y1 - y2 * x1) / ((dx * dx + dy * dy) ** .5 or 1e-12) if (dx or dy) else ((x - x1) ** 2 + (y - y1) ** 2) ** .5
            if d > best:
                best, idx = d, i
        if idx is not None and best > tol:
            keep[idx] = True; stack += [(a, idx), (idx, b)]
    return [p for p, k in zip(ring, keep) if k]

class H(osmium.SimpleHandler):
    def __init__(self):
        super().__init__(); self.places = []; self.areas = []; self.seen = set()
    def add(self, kind, oid, lat, lng, tags):
        t = {k: v for k, v in tags.items() if k in FIELDS}
        self.places.append([round(lat, 6), round(lng, 6), f"{kind}/{oid}", t])
    def node(self, n):
        tags = dict(n.tags)
        if wanted(tags) and n.location.valid():
            self.add("node", n.id, n.location.lat, n.location.lon, tags)
    def area(self, a):
        tags = dict(a.tags)
        isplace, isarea = wanted(tags), area_kind(tags)
        if not (isplace or isarea):
            return
        kind = "way" if a.from_way() else "relation"
        oid = a.orig_id()
        rings = []
        try:
            for outer in a.outer_rings():
                rings.append([(round(p.lon, 6), round(p.lat, 6)) for p in outer if p.location.valid()])
        except Exception:
            return
        rings = [r for r in rings if len(r) >= 3]
        if not rings:
            return
        pts = [p for r in rings for p in r]
        lng = sum(p[0] for p in pts) / len(pts); lat = sum(p[1] for p in pts) / len(pts)
        if isplace:
            self.add(kind, oid, lat, lng, tags)
        if isarea:
            t = {k: v for k, v in tags.items() if k in FIELDS}
            self.areas.append([f"{kind}/{oid}", t, [[[round(x, 5), round(y, 5)] for x, y in simplify(r)] for r in rings]])

h = H()
h.apply_file(sys.argv[1], locations=True)
date = sys.argv[4] if len(sys.argv) > 4 else ""
with gzip.open(sys.argv[2], "wt", encoding="utf-8") as f:
    json.dump({"date": date, "places": h.places, "areas": h.areas}, f, separators=(",", ":"), ensure_ascii=False)
withhours = sum(1 for p in h.places if "opening_hours" in p[3])
print(len(h.places), "places,", withhours, "with opening hours,", len(h.areas), "areas")
