"""Horizontal bar charts of the Dublin safety scores, as PNG and PDF files.

Usage (from Backend/): python tools/charts/bar_charts.py data/safety OUT_DIR
"""
import re
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages
from matplotlib.patches import Patch
from matplotlib.lines import Line2D
import pandas as pd

data_dir, out = Path(sys.argv[1]), Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
(out / "by-district").mkdir(exist_ok=True)

TIERS = [("Lower recorded crime", 57, "#2e7d4f"), ("Below-benchmark crime", 50, "#7db887"),
         ("Above-benchmark crime", 40, "#e8825f"), ("Higher recorded crime", 0, "#c0392b")]
LEGEND = ["Lower recorded crime (57 or higher)", "Below-benchmark crime (50 to below 57)",
          "Above-benchmark crime (40 to below 50)", "Higher recorded crime (below 40)"]
COLOR = {name: c for name, _, c in TIERS}
INK, MUTED, GRID = "#1f2328", "#5b636b", "#e6e8eb"
SOURCE = ("Source: CSO CJA11 recorded crime by Garda station (2023-2025 average). People = average present over a day: "
          "16 h residents (Census 2022) + 8 h daytime population (Census 2016, scaled to 2022).\nScore = 100 x Irish town rate / (Irish town rate + local rate), weighted by crime type: violent 35%, robbery 25%, "
          "burglary and theft 20%, public order 15%, criminal damage 5%.")
plt.rcParams.update({"font.family": ["Arial", "DejaVu Sans"], "font.size": 9, "text.color": INK,
                     "axes.edgecolor": GRID, "axes.labelcolor": MUTED, "xtick.color": MUTED, "ytick.color": INK})


def tier(score):
    """Band from the unrounded score, as in safety_pipeline.tier."""
    return next(name for name, cut, _ in TIERS if score >= cut)


def order(d):
    m = re.match(r"D(\d+)(W?)", d)
    return (int(m.group(1)), m.group(2))


def tier_legend(extra=None):
    return [Patch(color=c, label=label) for (_, _, c), label in zip(TIERS, LEGEND)] + (extra or [])


def style_axis(ax):
    ax.set_xlim(0, 80)
    ax.set_xticks([0, 20, 40, 50, 60, 80])
    ax.axvline(50, color=MUTED, linewidth=0.9, linestyle=(0, (1, 2)), zorder=1)
    ax.xaxis.tick_top()
    ax.grid(axis="x", color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)
    for side in ("left", "right", "bottom", "top"):
        ax.spines[side].set_visible(False)
    ax.tick_params(axis="y", length=0)
    ax.tick_params(axis="x", length=0, labelsize=8)


districts = pd.read_csv(data_dir / "safety_indicators.csv")
places = pd.read_csv(data_dir / "safety_neighbourhoods.csv")
dscore = districts.set_index("District")["safety_index_0_100"]

# 1. District scores, safest first, old score as a tick.
d = districts.sort_values("safety_index_0_100")
fig, ax = plt.subplots(figsize=(8.3, 7.2))
y = range(len(d))
ax.barh(y, d["safety_index_0_100"], color=[COLOR[tier(s)] for s in d["safety_index_0_100"]], height=0.68)
for i, s in enumerate(d["safety_index_0_100"]):
    ax.text(s + 1.5, i, f"{s:.1f}", va="center", fontsize=8.5, color=INK)
ax.set_yticks(list(y), d["District"], fontweight="bold")
style_axis(ax)
fig.text(0.015, 0.975, "Relative crime score by Dublin postal district", fontsize=14, fontweight="bold", va="top")
fig.text(0.015, 0.94, "50 = the recorded-crime rate of Irish towns and cities (dotted line). Higher = less crime. District scores are estimates from Garda station areas.",
         fontsize=8.5, color=MUTED, va="top")
ax.legend(handles=tier_legend(),
          loc="lower right", fontsize=8, frameon=True, framealpha=0.95, edgecolor="none")
fig.text(0.01, 0.01, SOURCE, fontsize=6.5, color=MUTED)
fig.tight_layout(rect=(0, 0.045, 1, 0.91))
for ext in ("png", "pdf"):
    fig.savefig(out / f"1-district-scores.{ext}", dpi=200)
plt.close(fig)


# 2. Each district as the Garda station areas its residents live in. The district score is
#    sum(share x station score), so it can be checked from the chart; neighbourhoods are listed under their area.
shares = pd.read_csv(data_dir / "district_station_shares.csv")
nb_by_area = places.groupby(["District", "Station"])["Label"].apply(lambda x: ", ".join(sorted(x)))


def pretty(station):
    return station.title().replace("Sundrive", "Sundrive Road").replace("Dun Laoghaire", "Dún Laoghaire")


def district_chart(dist, ax):
    p = shares[shares["District"] == dist].sort_values("share", ascending=True).reset_index(drop=True)
    yy = range(len(p))
    ax.barh(yy, p["station_score"], color=[COLOR[tier(v)] for v in p["station_score"]], height=0.62)
    ds = dscore[dist]
    ax.axvline(ds, color=INK, linewidth=1.4, linestyle=(0, (4, 2)))
    for i, r in p.iterrows():
        names = nb_by_area.get((dist, r["Station"]), "")
        ax.text(r["station_score"] + 1, i + 0.05, f"{r['station_score']:.1f}", va="center", fontsize=8, color=INK)
        if names:
            ax.text(r["station_score"] + 6, i + 0.05, names, va="center", fontsize=6.5, color=MUTED, wrap=True)
    ax.set_yticks(list(yy), [f"{pretty(st)} ({sh:.0%})" for st, sh in zip(p["Station"], p["share"])])
    ax.set_ylim(-0.6, len(p) - 0.4)
    style_axis(ax)
    calc = " + ".join(f"{sh:.0%} x {sc:.1f}" for sh, sc in zip(p["share"][::-1], p["station_score"][::-1]))
    ax.set_title(f"{dist}  ·  {ds:.1f} ({tier(ds)})", loc="left", fontsize=11, fontweight="bold", pad=26)
    ax.set_title(f"= {calc}" if len(p) <= 4 else f"= weighted average of {len(p)} station areas",
                 loc="right", fontsize=7.5, color=MUTED, pad=26)
    return len(p)


EXPLAIN = ("Bars: the Garda station areas the district's residents live in (% of residents) and each area's score. "
           "Grey text: named places in that area.\nDashed line: the district score = share-weighted average of the bars.")
dists = sorted(shares["District"].unique(), key=order)
for old_png in (out / "by-district").glob("*.png"):
    old_png.unlink()
for dist in dists:
    n = (shares["District"] == dist).sum()
    fig, ax = plt.subplots(figsize=(9, 1.9 + 0.42 * n))
    district_chart(dist, ax)
    ax.legend(handles=tier_legend([Line2D([], [], color=INK, linestyle=(0, (4, 2)), label="District score")]),
              loc="upper center", bbox_to_anchor=(0.5, -0.03), ncol=3, fontsize=7, frameon=False)
    fig.text(0.01, 0.005, EXPLAIN, fontsize=6.5, color=MUTED)
    fig.tight_layout(rect=(0, 0.06, 1, 1))
    fig.savefig(out / "by-district" / f"district-{dist}.png", dpi=200, bbox_inches="tight")
    plt.close(fig)

with PdfPages(out / "2-districts-by-garda-station-area.pdf") as pdf:
    page, rows, pages = [], 0, []
    for dist in dists:
        n = (shares["District"] == dist).sum()
        if page and rows + n + 3.5 > 40:
            pages.append(page); page, rows = [], 0
        page.append(dist); rows += n + 3.5
    pages.append(page)
    for k, page in enumerate(pages, 1):
        sizes = [(shares["District"] == dist).sum() + 2.6 for dist in page]
        fig, axes = plt.subplots(len(page), 1, figsize=(8.27, 11.69), gridspec_kw={"height_ratios": sizes})
        axes = axes if len(page) > 1 else [axes]
        for ax, dist in zip(axes, page):
            district_chart(dist, ax)
        fig.suptitle("Relative crime score: each district by Garda station area\n" + EXPLAIN.replace("\n", " "),
                     x=0.02, ha="left", fontsize=9, fontweight="bold", va="top", y=0.995, wrap=True)
        fig.legend(handles=tier_legend([Line2D([], [], color=INK, linestyle=(0, (4, 2)), label="District score")]),
                   loc="lower center", ncol=5, fontsize=7, frameon=False, bbox_to_anchor=(0.5, 0.025))
        fig.text(0.02, 0.005, SOURCE + f"   Page {k} of {len(pages)}", fontsize=5.5, color=MUTED)
        fig.tight_layout(rect=(0, 0.05, 1, 0.955))
        pdf.savefig(fig)
        plt.close(fig)

# 3. Garda station areas: the level the crime data is published at.
st = pd.read_csv(data_dir / "crime_by_station.csv").sort_values("score")
st = st[st["station"] != "dublin airport"]
names = st["station"].str.title().str.replace("Sundrive", "Sundrive Road").str.replace("Dun Laoghaire", "Dún Laoghaire")
fig, ax = plt.subplots(figsize=(8.3, 10.5))
yy = range(len(st))
ax.barh(yy, st["score"], color=[COLOR[tier(v)] for v in st["score"]], height=0.68)
for i, v in enumerate(st["score"]):
    ax.text(v + 1, i, f"{v:.1f}", va="center", fontsize=8, color=INK)
ax.set_yticks(list(yy), names)
ax.set_ylim(-0.6, len(st) - 0.4)
style_axis(ax)
fig.text(0.015, 0.98, "Relative crime score by Garda station area, Dublin", fontsize=14, fontweight="bold", va="top")
fig.text(0.015, 0.955, "The level the CSO publishes crime at. 50 = the Irish town and city rate (dotted line). Higher = less crime.",
         fontsize=8.5, color=MUTED, va="top")
ax.legend(handles=tier_legend(), loc="lower right", fontsize=8, frameon=True, framealpha=0.95, edgecolor="none")
fig.text(0.01, 0.008, SOURCE, fontsize=6, color=MUTED)
fig.tight_layout(rect=(0, 0.035, 1, 0.935))
for ext in ("png", "pdf"):
    fig.savefig(out / f"3-garda-station-areas.{ext}", dpi=200)
plt.close(fig)

# 4. Sensitivity: each district's rank under 12 combinations of weights and population base.
sens = pd.read_csv(data_dir / "crime_score_sensitivity.csv", index_col=0).sort_values("rank_published", ascending=False)
summary = pd.read_csv(data_dir / "crime_score_sensitivity_summary.csv")
fig, ax = plt.subplots(figsize=(8.3, 7.4))
yy = range(len(sens))
ax.hlines(list(yy), sens["rank_best"], sens["rank_worst"], color="#9aa5b1", linewidth=5, capstyle="round")
ax.scatter(sens["rank_published"], yy, color=INK, s=28, zorder=3)
ax.set_yticks(list(yy), sens.index, fontweight="bold")
ax.set_xlim(0.5, 22.5); ax.set_xticks(range(1, 23, 3)); ax.invert_xaxis()
ax.xaxis.tick_top(); ax.grid(axis="x", color=GRID); ax.set_axisbelow(True)
for side in ("left", "right", "bottom", "top"):
    ax.spines[side].set_visible(False)
ax.tick_params(length=0)
lo, hi = summary["rank_correlation_with_published"].min(), summary["rank_correlation_with_published"].max()
fig.text(0.015, 0.98, "How stable is the district ranking?", fontsize=14, fontweight="bold", va="top")
fig.text(0.015, 0.948, f"Rank under the published method (dot) and the range across 12 alternatives (bar): 4 weightings x 3 population bases.\n"
         f"Rank correlation with the published ranking: {lo:.2f} to {hi:.2f}. Rank 1 = least recorded crime.",
         fontsize=8.5, color=MUTED, va="top")
fig.text(0.01, 0.008, "Weightings: published 35/25/20/15/5, equal 20 each, harm to the person 45/30/10/10/5, property-led 25/15/40/10/10 "
         "(violent/robbery/burglary and theft/public order/damage).\nPopulation: people over a day (16 h/8 h), residents only, half residents half daytime.",
         fontsize=6.5, color=MUTED)
fig.tight_layout(rect=(0, 0.045, 1, 0.9))
for ext in ("png", "pdf"):
    fig.savefig(out / f"4-ranking-stability.{ext}", dpi=200)
plt.close(fig)

# 5. Exact rank ranges across the 12 scenarios, as a table.
tab = sens[["rank_published", "rank_best", "rank_worst"]].sort_values("rank_published").copy()
tab["spread"] = tab["rank_worst"] - tab["rank_best"]
tab["stability"] = tab["spread"].map(lambda v: "Stable (0-2 places)" if v <= 2 else "Moderate (3-5)" if v <= 5 else "Sensitive (6+)")
tab.rename_axis("District").reset_index().rename(columns={
    "rank_published": "Published rank", "rank_best": "Best rank", "rank_worst": "Worst rank",
    "spread": "Spread (places)", "stability": "Stability"}).to_csv(out / "5-rank-ranges.csv", index=False)
fig, ax = plt.subplots(figsize=(8.3, 7.3))
ax.axis("off")
cells = [[d, int(r.rank_published), int(r.rank_best), int(r.rank_worst), int(r.spread), r.stability] for d, r in tab.iterrows()]
t = ax.table(cellText=cells, colLabels=["District", "Published rank", "Best rank", "Worst rank", "Spread", "Stability"],
             loc="upper center", cellLoc="center", colLoc="center", bbox=(0.02, 0.06, 0.96, 0.84))
t.auto_set_font_size(False); t.set_fontsize(9); t.scale(1, 1.38)
for (row, col), cell in t.get_celld().items():
    cell.set_edgecolor(GRID)
    if row == 0:
        cell.set_text_props(weight="bold", color=INK); cell.set_facecolor("#f3f4f6")
    elif col == 5:
        v = cells[row - 1][4]
        cell.set_facecolor("#e3f1e6" if v <= 2 else "#fdf1dc" if v <= 5 else "#f9e0d9")
fig.text(0.04, 0.975, "District rank under 12 scenarios", fontsize=14, fontweight="bold", va="top")
fig.text(0.04, 0.948, "Rank 1 = least recorded crime. Best and worst rank across 4 weightings x 3 population bases "
         "(see 4-ranking-stability).", fontsize=8.5, color=MUTED, va="top")
fig.text(0.04, 0.02, "Weightings: published 35/25/20/15/5, equal 20 each, harm to the person 45/30/10/10/5, property-led 25/15/40/10/10 "
         "(violent/robbery/burglary and theft/public order/damage).\nPopulation: people over a day (16 h residents/8 h daytime), "
         "residents only, half residents half daytime.", fontsize=6.5, color=MUTED)
for ext in ("png", "pdf"):
    fig.savefig(out / f"5-rank-ranges.{ext}", dpi=200)
plt.close(fig)

print(f"{len(dists)} districts, {len(places)} neighbourhoods, {len(pages)} PDF pages -> {out}")
