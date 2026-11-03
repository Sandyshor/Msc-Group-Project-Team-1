"""District bar graphs: each district's parts (the Garda station areas its residents live in), with each part's
share of residents and score, and the named places in that part beside the bar. The district score is the
share-weighted average of the bars, so it can be checked from the chart.

Usage (from Backend/): python district_parts_pdf.py OUT_PDF
"""
import sys
import textwrap

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages
from matplotlib.patches import Patch
from matplotlib.transforms import offset_copy
import pandas as pd

from build_station_map import order

out = sys.argv[1]
INK, MUTED, GRID = "#1f2328", "#5b636b", "#e6e8eb"
TIERS = [(57, "#2e7d4f"), (50, "#7db887"), (40, "#e8825f"), (0, "#c0392b")]
NAMES = ["Lower recorded crime (57 or higher)", "Below-benchmark crime (50 to below 57)",
         "Above-benchmark crime (40 to below 50)", "Higher recorded crime (below 40)"]
INTRO = ("How to read these charts\n"
         "Crime is published per Garda station area, so each district is shown as the station areas its residents live in.\n"
         "Each bar is one of those areas: its relative crime score, and in brackets its share of the district's residents.\n"
         "The district score is the average of the bars weighted by those shares. Named places in each area are listed beside it.\n"
         "50 (dotted line) = the recorded-crime rate of Irish towns and cities. Higher than 50 = less recorded crime than that\n"
         "benchmark; lower than 50 = more. The score compares areas; it is not the chance of becoming a victim.")
FOOT = "Source: CSO recorded crime by Garda station (CJA11), 2023-2025 average; Census 2022."
WRAP = 52
plt.rcParams.update({"font.family": ["Arial", "DejaVu Sans"], "font.size": 9, "text.color": INK})


def colour(v):
    return next(c for cut, c in TIERS if v >= cut)


def pretty(k):
    return k.title().replace("Sundrive", "Sundrive Road").replace("Dun Laoghaire", "Dún Laoghaire")


shares = pd.read_csv("data/safety/district_station_shares.csv")
dscore = pd.read_csv("data/safety/safety_indicators.csv").set_index("District")["safety_index_0_100"]
nb = pd.read_csv("data/safety/safety_neighbourhoods.csv")
names = nb.groupby(["District", "Station"])["Label"].apply(lambda x: ", ".join(sorted(x)))
dists = sorted(shares["District"].unique(), key=order)


def rows(d):
    p = shares[shares["District"] == d].sort_values("share", ascending=False)
    return [(r.Station, r.share, r.station_score, textwrap.wrap(names.get((d, r.Station), ""), WRAP)) for r in p.itertuples()]


def height(d):
    return sum(max(1.0, 0.55 * len(lines)) for *_, lines in rows(d)) + 1.9


pages, page, used = [], [], 0
for d in dists:
    if page and used + height(d) > (38 if pages else 31):
        pages.append(page); page, used = [], 0
    page.append(d); used += height(d)
pages.append(page)

with PdfPages(out) as pdf:
    for n, page in enumerate(pages):
        first = n == 0
        fig, axes = plt.subplots(len(page), 1, figsize=(8.27, 11.69), gridspec_kw={"height_ratios": [height(d) for d in page]})
        axes = axes if len(page) > 1 else [axes]
        for ax, d in zip(axes, page):
            rs = rows(d)[::-1]
            heights = [max(1.0, 0.55 * len(lines)) for *_, lines in rs]
            ys, y = [], 0
            for h in heights:
                ys.append(y + h / 2); y += h
            for (st, sh, sc, lines), yy, h in zip(rs, ys, heights):
                ax.barh(yy, sc, height=min(0.62, h * 0.62), color=colour(sc))
                ax.text(sc + 1, yy, f"{sc:.1f}", va="center", fontsize=8, color=INK)
                if lines:
                    ax.text(1.02, yy, "\n".join(lines), va="center", ha="left", fontsize=6.8, color=MUTED,
                            linespacing=1.3, transform=ax.get_yaxis_transform())
            ax.set_yticks(ys, [f"{pretty(st)} ({sh:.0%})" for st, sh, *_ in rs], fontsize=8)
            ax.axvline(50, color=MUTED, linewidth=0.8, linestyle=(0, (1, 2)))
            ax.set_xlim(0, 80); ax.set_ylim(0, y)
            ax.set_xticks([0, 20, 40, 50, 60]); ax.xaxis.tick_top()
            ax.tick_params(length=0, labelsize=7); ax.tick_params(axis="x", colors=MUTED)
            ax.grid(axis="x", color=GRID); ax.set_axisbelow(True)
            for s in ax.spines.values():
                s.set_visible(False)
            ax.set_title(d, loc="left", fontsize=11.5, fontweight="bold", pad=24)
            ax.text(0, 1.0, f"District score {dscore[d]:.1f}", fontsize=7.6, color=MUTED, va="bottom",
                    transform=offset_copy(ax.transAxes, fig=fig, y=12, units="points"))
            ax.text(1.02, 1.0, "Named places in this area", fontsize=7, color=MUTED, va="bottom", fontweight="bold",
                    transform=offset_copy(ax.transAxes, fig=fig, y=3, units="points"))
        top = 0.86 if first else 0.975
        if first:
            fig.text(0.04, 0.985, "Relative crime score by district and Garda station area", fontsize=14,
                     fontweight="bold", va="top")
            fig.text(0.04, 0.955, INTRO, fontsize=8, va="top", linespacing=1.45)
        fig.legend(handles=[Patch(color=c, label=nm) for (_, c), nm in zip(TIERS, NAMES)], loc="lower center", ncol=2,
                   fontsize=7.6, frameon=False, bbox_to_anchor=(0.5, 0.016))
        fig.text(0.04, 0.007, FOOT, fontsize=6.2, color=MUTED)
        fig.subplots_adjust(left=0.2, right=0.58, top=top - 0.025, bottom=0.075, hspace=0.75)
        pdf.savefig(fig)
        plt.close(fig)
print(len(pages), "pages")
