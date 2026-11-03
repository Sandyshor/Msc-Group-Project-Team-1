"""One chart per postal district: a bar per Garda station area (its relative crime score) with the places and
main streets in that area listed beside it.

Usage (from Backend/): python district_area_charts.py OSM_PBF DISTRICT_BOUNDARIES OUT_DIR
"""
import sys
import textwrap
from pathlib import Path

import geopandas as gpd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages
from matplotlib.patches import Patch
import pandas as pd

import safety_pipeline as sp
from build_station_map import order, read_districts

pbf, boundaries, out = sys.argv[1], sys.argv[2], Path(sys.argv[3])
out.mkdir(parents=True, exist_ok=True)
for old in list(out.glob("*.xlsx")) + list(out.glob("*.png")):
    old.unlink()

TIERS = [("Lower recorded crime", 57, "#2e7d4f"), ("Below-benchmark crime", 50, "#7db887"),
         ("Above-benchmark crime", 40, "#e8825f"), ("Higher recorded crime", 0, "#c0392b")]
INK, MUTED, GRID = "#1f2328", "#5b636b", "#e6e8eb"
plt.rcParams.update({"font.family": ["Arial", "DejaVu Sans"], "font.size": 9, "text.color": INK})
WRAP = 78


def colour(score):
    return next(c for _, cut, c in TIERS if score >= cut)


def pretty(key):
    return key.title().replace("Sundrive", "Sundrive Road").replace("Dun Laoghaire", "Dún Laoghaire")


# Station areas cut to each district
pieces = gpd.overlay(read_districts(boundaries), sp.read_station_areas(), how="intersection")
pieces = pieces[pieces.area > 20000].reset_index(drop=True)
scores = pd.read_csv("data/safety/crime_by_station.csv").set_index("station")["score"]
# A district's part of a station area uses the same score as the district charts (its EDs' average)
part_scores = pd.read_csv("data/safety/district_station_shares.csv").set_index(["District", "Station"])["station_score"]

# Main streets: national, regional and main city roads, placed by their midpoint
roads = gpd.read_file(pbf, layer="lines", columns=["name"],
                      where="name IS NOT NULL AND highway IN ('trunk','primary','secondary')").to_crs(sp.ITM)
roads["geometry"] = roads.geometry.interpolate(0.5, normalized=True)
roads = gpd.sjoin(roads, pieces[["District", "key", "geometry"]], predicate="within")
roads = roads.drop_duplicates(["District", "key", "name"])

# Places: the website's named neighbourhoods, in the piece their point lies in
nb = pd.read_csv("data/safety/safety_neighbourhoods.csv").merge(
    pd.read_csv("data/safety/neighbourhoods.csv")[["District", "Neighbourhood", "lon", "lat"]], on=["District", "Neighbourhood"])
nb = gpd.GeoDataFrame(nb, geometry=gpd.points_from_xy(nb.lon, nb.lat), crs=4326).to_crs(sp.ITM)
nb = gpd.sjoin_nearest(nb[["District", "Label", "check_street", "geometry"]], pieces[["District", "key", "geometry"]], how="left")
nb = nb[nb["District_left"] == nb["District_right"]].rename(columns={"District_left": "District"})


def block(dist, key):
    sel = nb[(nb.District == dist) & (nb.key == key)]
    places = sorted(sel["Label"])
    streets = sorted(roads[(roads.District == dist) & (roads.key == key)]["name"], key=str.lower)
    lines = []
    if places:
        lines += textwrap.wrap("Places: " + ", ".join(places), WRAP)
    if streets:
        lines += textwrap.wrap("Main streets: " + ", ".join(streets), WRAP)
    return lines


def chart(dist):
    keys = pieces[pieces.District == dist].assign(a=lambda x: x.area).sort_values("a", ascending=False)["key"]
    keys = [k for k in keys if k in scores.index]
    rows = [(k, lines) for k in keys if (lines := block(dist, k))]
    heights = [max(0.75, 0.2 + 0.155 * len(lines)) for _, lines in rows]
    fig = plt.figure(figsize=(12, 0.9 + sum(heights)))
    gs = fig.add_gridspec(len(rows), 2, width_ratios=[1, 1.55], height_ratios=heights, hspace=0.35, wspace=0.03,
                          left=0.15, right=0.99, top=1 - 0.55 / fig.get_figheight(), bottom=0.45 / fig.get_figheight())
    for i, (k, lines) in enumerate(rows):
        ax = fig.add_subplot(gs[i, 0])
        v = part_scores.get((dist, k), scores[k])
        ax.barh([0], [v], color=colour(v), height=0.55)
        ax.text(v + 1.2, 0, f"{v:.1f}", va="center", fontsize=9, color=INK)
        ax.axvline(50, color=MUTED, linewidth=0.8, linestyle=(0, (1, 2)))
        ax.set_xlim(0, 80); ax.set_ylim(-0.6, 0.6)
        ax.set_yticks([0], [f"{pretty(k)}"], fontsize=10, fontweight="bold")
        ax.set_xticks([0, 20, 40, 50, 60, 80])
        if i:
            ax.tick_params(axis="x", labeltop=False)
        ax.xaxis.tick_top(); ax.tick_params(length=0, labelsize=7.5, colors=MUTED)
        if i:
            ax.tick_params(axis="x", labeltop=False, labelbottom=False)
        ax.tick_params(axis="y", colors=INK)
        ax.grid(axis="x", color=GRID); ax.set_axisbelow(True)
        for side in ax.spines.values():
            side.set_visible(False)
        tx = fig.add_subplot(gs[i, 1]); tx.axis("off")
        tx.text(0.02, 0.5, "\n".join(lines), va="center", ha="left", fontsize=7.6, color=INK, linespacing=1.35)
    fig.text(0.01, 1 - 0.18 / fig.get_figheight(), dist, fontsize=16, fontweight="bold", va="top")
    fig.legend(handles=[Patch(color=c, label=n) for n, _, c in TIERS], loc="lower center", ncol=4, fontsize=7.5,
               frameon=False, bbox_to_anchor=(0.5, 0))
    return fig


dists = sorted(pieces.District.unique(), key=order)
with PdfPages(out / "D1-D24-areas.pdf") as pdf:
    for dist in dists:
        fig = chart(dist)
        fig.savefig(out / f"{dist}.png", dpi=200)
        pdf.savefig(fig)
        plt.close(fig)
print(f"{len(dists)} districts -> {out}")
