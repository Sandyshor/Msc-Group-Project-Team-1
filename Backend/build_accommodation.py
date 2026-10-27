#!/usr/bin/env python3
"""Build student_residences.csv: purpose-built student residences in each postal district.

Two sources:
  * OpenStreetMap - every residence it tags as student housing (below), and
  * student_residences_curated.csv (next to OUT_CSV) - residences checked by hand against the operators' own
    sites (Yugo, Aparto, Canvas, Destiny Student...), universities and Amber Student, each with its source.
    A curated row wins over the OSM row with the same name (or "Also known as" name): its operator, website,
    address and district (from the Eircode) are used, OSM's position is kept. Curated rows OSM doesn't have
    are placed by geocoding their address once with OpenStreetMap Nominatim; the result is saved back into
    the curated file (lon/lat columns), so later runs don't geocode again.

Picks up buildings and points OSM tags as student housing (building=dormitory, or any tag mentioning
"student"/"dormitory"), keeps the ones that lie in D1-D24, and cleans them up:
  * leaves out non-housing features that carry a "student" tag (cinemas, sports centres...),
  * merges the several OSM objects one residence often has ("Kavanagh Court" and "Kavanagh Court - Uninest
    Student Accommodation", "Glenomena Student Residences House 1-3" and "House 4-5"...),
  * fills in the operator from the name or website when OSM doesn't give one.

The Results card lists them (with their website) and pins them on the safety map. Rent listings themselves
are not stored: the card links to Daft.ie / Rent.ie searches for the district instead.

Each residence also gets the Census ED it lies in (from safety_map_areas.geojson, build_safety_map.py), so the
card can show that area's street safety score.

Websites are checked once while building. Only residences with their own working website are listed: a residence
whose link is missing or certainly dead is left out.

Re-run when the OSM extract changes.

Usage
  python build_accommodation.py OSM_PBF DISTRICT_BOUNDARIES_GEOJSON OUT_CSV
"""
import re
import sys
from pathlib import Path

import time

import geopandas as gpd
import pandas as pd
import requests

import safety_pipeline as sp
from build_station_map import order, read_districts

WHERE = "building = 'dormitory' OR other_tags LIKE '%student%' OR other_tags LIKE '%dormitory%'"
# OSM objects tagged as student housing that aren't: name -> why.
NOT_STUDENT = {"Liberties House": "co-living development for adults, not student housing (libertieshouse.com)"}
NOT_HOUSING = re.compile(r"cinema|sport|fitness|student centre|students' union|library|bar\b", re.I)

# Operator brand -> words that identify it in a name or website.
OPERATORS = {
    "Yugo": ["yugo", "uninest"],   # Uninest's Dublin residences now trade as Yugo
    "Aparto": ["aparto"], "Destiny Student": ["destiny"], "Canvas": ["canvas-world"],
    "Liv Student": ["livstudent", "liv student"], "Trinity College Dublin": ["tcd.ie"],
    "University College Dublin": ["ucd.ie", "ucd "], "Libra Living": ["libraliving"],
}


def tag(other_tags, key):
    m = re.search(rf'"{key}"=>"([^"]*)"', other_tags or "")
    return m.group(1) if m else None


def base_name(name):
    """The residence's own name: drop brand suffixes/prefixes and building or house numbers."""
    n = re.sub(r"\s+-\s+.*(student|accommodation|residences?).*$", "", name, flags=re.I)   # "X - Uninest Student ..."
    n = re.sub(r"^destiny student\s+-\s+", "", n, flags=re.I)                              # "Destiny Student - X"
    n = re.sub(r"\s+-\s+house\s+\d+$", "", n, flags=re.I)                                  # "Bangor - House 1"
    n = re.sub(r"\s+(house|block)\s+[A-Z]?\d[\w-]*$", "", n, flags=re.I)                    # "... House 1-3", "Block D1-5"
    n = re.sub(r"\s+[A-Z]$", "", n)                                                       # "Postgraduate Residences A"
    return n.strip()


def operator_of(names, websites, operators):
    """OSM's operator tag first, then brand words in the names, then in the websites."""
    for text in (operators, names, websites):
        text = " ".join(text).lower()
        for brand, words in OPERATORS.items():
            if any(w in text for w in words):
                return brand
    return operators[0] if operators else None


def best_website(websites, operator):
    """Prefer the website on the operator's own domain (OSM sometimes has another brand's link on a copy)."""
    if not websites:
        return None
    for word in OPERATORS.get(operator, []):   # the operator's current domain first ("yugo" before "uninest")
        for w in websites:
            if word in w.lower():
                return w
    return websites[0]


def link_is_dead(url):
    """True only when the page is certainly gone (404/410, or the domain doesn't exist). Sites that block
    scripts, time out or refuse the connection are kept - they usually work in a browser."""
    try:
        r = requests.get(url, timeout=20, headers={"User-Agent": "Mozilla/5.0"}, allow_redirects=True)
        return r.status_code in (404, 410)
    except requests.exceptions.ConnectionError as e:
        return "NameResolutionError" in str(e) or "Failed to resolve" in str(e)
    except requests.RequestException:
        return False


NOMINATIM = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "FindYourDublin-student-project/1.0 (build_accommodation.py)"


def key(name):
    """Name for matching OSM and curated rows: lower case, no brand prefix, letters and digits only."""
    n = re.sub(r"^(yugo|canvas|aparto|destiny student)\s+", "", str(name).strip(), flags=re.I)
    return re.sub(r"[^a-z0-9]", "", n.lower())


def geocode(address):
    """(lon, lat, precision) of an address in Dublin from Nominatim (max 1 request a second), or None.
    precision is "address" for a building/house number match, "street (approximate)" when only the street matched."""
    time.sleep(1.1)
    r = requests.get(NOMINATIM, params={"q": f"{address}, Ireland", "format": "json", "limit": 1,
                                        "countrycodes": "ie"}, headers={"User-Agent": USER_AGENT}, timeout=30)
    hits = r.json() if r.ok else []
    if not hits:
        return None
    h = hits[0]
    precision = "street (approximate)" if h.get("class") == "highway" else "address"
    return round(float(h["lon"]), 6), round(float(h["lat"]), 6), precision


def merge_curated(osm_rows, curated_path):
    """OSM rows + curated rows (curated wins on the same name); fills in and saves curated positions."""
    cur = pd.read_csv(curated_path)
    for col in ("lon", "lat", "Position"):
        if col not in cur:
            cur[col] = None
    names = {}
    for i, r in cur.iterrows():
        for n in [r["Name"], *str(r["Also known as"] if pd.notna(r["Also known as"]) else "").split(";")]:
            if n.strip():
                names[key(n)] = i
    rows = []
    for r in osm_rows:
        i = names.get(key(r["Name"]))
        if i is None:
            rows.append({**r, "Address": None, "Source": "OpenStreetMap", "Position": "OpenStreetMap"})
        elif pd.isna(cur.at[i, "lon"]):
            cur.at[i, "lon"], cur.at[i, "lat"] = r["lon"], r["lat"]     # OSM knows where it is
            cur.at[i, "Position"] = "OpenStreetMap"
    for i, r in cur.iterrows():
        if pd.isna(r["lon"]):
            # Full address first, then without its leading parts ("Rope Walk, 20 Stoneybatter" -> "20 Stoneybatter").
            parts = [p.strip() for p in str(r["Address"]).split(",")]
            found = None
            for start in range(len(parts) - 1):
                found = geocode(", ".join(parts[start:]))
                if found:
                    break
            if not found:
                print(f"  could not place {r['Name']} ({r['Address']}) - listed without a map pin")
                continue
            cur.at[i, "lon"], cur.at[i, "lat"], cur.at[i, "Position"] = found
    cur.to_csv(curated_path, index=False)
    for _, r in cur.iterrows():
        rows.append({"District": r["District"], "Name": r["Name"], "Operator": r["Operator"], "Website": r["Website"],
                     "Address": r["Address"], "lon": r["lon"], "lat": r["lat"], "Source": r["Source"],
                     "Position": r["Position"]})
    return rows


def main(pbf, boundary_path, out_csv):
    frames = []
    for layer in ("points", "multipolygons"):
        cols = ["name", "other_tags"] + (["building"] if layer == "multipolygons" else [])
        where = WHERE if layer == "multipolygons" else WHERE.replace("building = 'dormitory' OR ", "")
        frames.append(gpd.read_file(pbf, layer=layer, columns=cols, where=where))
    osm = pd.concat(frames, ignore_index=True)
    osm = osm[osm["name"].notna() & ~osm["name"].str.contains(NOT_HOUSING, na=False) & ~osm["name"].isin(NOT_STUDENT)].to_crs(sp.ITM)
    osm["geometry"] = osm.geometry.representative_point()
    osm = gpd.sjoin(osm, read_districts(boundary_path), predicate="within").drop(columns="index_right")
    osm["Name"] = osm["name"].map(base_name)
    # "Highfield Park Student Residences" is the same place as "Highfield Park" when both are in the district.
    short = osm["Name"].str.replace(r"\s+student\s+residences?$", "", regex=True, flags=re.I)
    known = set(zip(osm["District"], osm["Name"]))
    osm["Name"] = [s if (d, s) in known else n for d, n, s in zip(osm["District"], osm["Name"], short)]
    osm["website"] = osm["other_tags"].map(lambda t: tag(t, "website") or tag(t, "contact:website"))
    osm["operator"] = osm["other_tags"].map(lambda t: tag(t, "operator"))

    # Campus residences: the university whose OSM campus they sit inside runs them.
    campus = gpd.read_file(pbf, layer="multipolygons", columns=["name", "other_tags"],
                           where="amenity = 'university' AND name IS NOT NULL").to_crs(sp.ITM)
    campus = campus.assign(campus_name=campus["name"], campus_web=campus["other_tags"].map(lambda t: tag(t, "website")))
    osm = gpd.sjoin(osm, campus[["campus_name", "campus_web", "geometry"]], predicate="within", how="left")
    osm = osm.drop(columns="index_right").drop_duplicates(subset=["name", "District", "Name", "geometry"])

    rows = []
    for (district, name), g in osm.groupby(["District", "Name"]):
        websites = g["website"].dropna().unique().tolist()
        operators = g["operator"].dropna().unique().tolist() or g["campus_name"].dropna().unique().tolist()
        operator = operator_of(g["name"].tolist(), websites, operators)
        if not websites:
            websites = g["campus_web"].dropna().unique().tolist()
        centre = gpd.GeoSeries([g.geometry.union_all().centroid], crs=sp.ITM).to_crs(4326).iloc[0]
        rows.append({"District": district, "Name": name, "Operator": operator,
                     "Website": best_website(websites, operator), "lon": round(centre.x, 6), "lat": round(centre.y, 6)})
    rows = merge_curated(rows, Path(out_csv).with_name("student_residences_curated.csv"))
    out = pd.DataFrame(rows)
    out = gpd.GeoDataFrame(out, geometry=gpd.points_from_xy(out["lon"], out["lat"]), crs=4326)
    # The safety heat map area (Census ED) each residence is in, so the card can show that area's safety score.
    areas = gpd.read_file(Path(sp.CFG["out_dir"]) / "safety_map_areas.geojson")[["ED_GUID", "geometry"]]
    out = gpd.sjoin(out, areas.to_crs(out.crs), predicate="within", how="left").drop(columns="index_right")
    out = out.drop_duplicates(subset=["District", "Name"])
    out = pd.DataFrame(out.drop(columns=["geometry"]))
    dead = out["Website"].notna() & out["Website"].map(lambda u: isinstance(u, str) and link_is_dead(u))
    for name, url in zip(out.loc[dead, "Name"], out.loc[dead, "Website"]):
        print(f"  dropped dead link for {name}: {url}")
    out.loc[dead, "Website"] = None
    # Only residences with their own working website are listed.
    for name in out.loc[out["Website"].isna(), "Name"]:
        print(f"  left out {name}: no website")
    out = out[out["Website"].notna()]
    out = out.sort_values(["District", "Name"], key=lambda s: s.map(order) if s.name == "District" else s)
    out.to_csv(out_csv, index=False)
    print(f"{len(out)} student residences in {out['District'].nunique()} districts -> {out_csv}")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    main(*sys.argv[1:4])
