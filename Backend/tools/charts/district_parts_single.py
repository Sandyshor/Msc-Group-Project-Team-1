"""One chart per district (PNG and PDF): its Garda station-area parts with share of residents and score, and the
named places in each part beside the bar.

Usage (from Backend/): python district_parts_single.py OUT_DIR
"""
import sys, textwrap
from pathlib import Path
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Patch
from matplotlib.backends.backend_pdf import PdfPages
import pandas as pd
from build_station_map import order

out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
for old in list(out.glob("*.png")) + list(out.glob("*.pdf")):
    old.unlink()
INK, MUTED, GRID = "#1f2328", "#5b636b", "#e6e8eb"
TIERS = [(57, "#2e7d4f"), (50, "#7db887"), (40, "#e8825f"), (0, "#c0392b")]
NAMES = ["Lower recorded crime (57 or higher)", "Below-benchmark crime (50 to below 57)",
         "Above-benchmark crime (40 to below 50)", "Higher recorded crime (below 40)"]
NOTE = ("Each bar is a Garda station area covering part of the district: its relative crime score, and in brackets its share of the "
        "district's residents. The district score is the average of the bars weighted by those shares. 50 (dotted line) = the "
        "recorded-crime rate of Irish towns and cities; higher = less recorded crime. It compares areas; it is not the chance "
        "of becoming a victim.")
FOOT = "Source: CSO recorded crime by Garda station (CJA11), 2023-2025 average; Census 2022."
plt.rcParams.update({"font.family": ["Arial", "DejaVu Sans"], "font.size": 9, "text.color": INK})
colour = lambda v: next(c for cut, c in TIERS if v >= cut)
pretty = lambda k: k.title().replace("Sundrive", "Sundrive Road").replace("Dun Laoghaire", "Dún Laoghaire")

shares = pd.read_csv("data/safety/district_station_shares.csv")
dscore = pd.read_csv("data/safety/safety_indicators.csv").set_index("District")["safety_index_0_100"]
nb = pd.read_csv("data/safety/safety_neighbourhoods.csv")
names = nb.groupby(["District", "Station"])["Label"].apply(lambda x: ", ".join(sorted(x)))

combined = PdfPages(sys.argv[2])
for d in sorted(shares["District"].unique(), key=order):
    p = shares[shares["District"] == d].sort_values("share", ascending=True)
    rows = [(r.Station, r.share, r.station_score, textwrap.wrap(names.get((d, r.Station), ""), 60)) for r in p.itertuples()]
    hs = [max(0.55, 0.19 * len(lines) + 0.2) for *_, lines in rows]
    fig_h = 2.6 + sum(hs)
    fig = plt.figure(figsize=(11, fig_h))
    ax = fig.add_axes([0.2, 1.05 / fig_h, 0.4, sum(hs) / fig_h])
    ys, y = [], 0
    for h in hs:
        ys.append(y + h / 2); y += h
    for (st, sh, sc, lines), yy, h in zip(rows, ys, hs):
        ax.barh(yy, sc, height=min(0.42, h * 0.7), color=colour(sc))
        ax.text(sc + 1, yy, f"{sc:.1f}", va="center", fontsize=9.5)
        if lines:
            ax.text(1.03, yy, "\n".join(lines), va="center", ha="left", fontsize=8.3, color=INK, linespacing=1.35,
                    transform=ax.get_yaxis_transform())
    ax.set_yticks(ys, [f"{pretty(st)} ({sh:.0%})" for st, sh, *_ in rows], fontsize=9.5)
    ax.axvline(50, color=MUTED, linewidth=0.8, linestyle=(0, (1, 2)))
    ax.set_xlim(0, 80); ax.set_ylim(0, y)
    ax.set_xticks([0, 20, 40, 50, 60]); ax.xaxis.tick_top()
    ax.tick_params(length=0, labelsize=8); ax.tick_params(axis="x", colors=MUTED)
    ax.grid(axis="x", color=GRID); ax.set_axisbelow(True)
    for s in ax.spines.values():
        s.set_visible(False)
    ax.text(1.03, 1.0, "Named places in this area", transform=ax.transAxes, fontsize=8, color=MUTED,
            fontweight="bold", va="bottom")
    fig.text(0.02, 1 - 0.15 / fig_h, d, fontsize=18, fontweight="bold", va="top")
    fig.text(0.02, 1 - 0.62 / fig_h, f"District score {dscore[d]:.1f}", fontsize=10.5, va="top")
    fig.text(0.02, 1 - 0.95 / fig_h, textwrap.fill(NOTE, 150), fontsize=7.6, color=MUTED, va="top", linespacing=1.35)
    fig.legend(handles=[Patch(color=c, label=n) for (_, c), n in zip(TIERS, NAMES)], loc="lower center", ncol=4,
               fontsize=7.6, frameon=False, bbox_to_anchor=(0.5, 0.28 / fig_h))
    fig.text(0.02, 0.06 / fig_h, FOOT, fontsize=6.8, color=MUTED)
    fig.savefig(out / f"{d}.png", dpi=200)
    fig.savefig(out / f"{d}.pdf")
    combined.savefig(fig)
    plt.close(fig)
combined.close()
print("done", out)
