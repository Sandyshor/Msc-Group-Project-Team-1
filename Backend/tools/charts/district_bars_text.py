"""Bar graphs only, with a short guide: each district's Garda station-area parts (share of residents, score)."""
import sys
import matplotlib; matplotlib.use("Agg")
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
         "The district score is the average of the bars weighted by those shares.\n"
         "50 (dotted line) = the recorded-crime rate of Irish towns and cities. Higher than 50 = less recorded crime than that\n"
         "benchmark; lower than 50 = more. The score compares areas; it is not the chance of becoming a victim. It counts crime\n"
         "recorded by the Gardaí, so check it alongside other things such as lighting, transport and visiting the area yourself.")
FOOT = "Source: CSO recorded crime by Garda station (CJA11), 2023-2025 average; Census 2022."
plt.rcParams.update({"font.family": ["Arial", "DejaVu Sans"], "font.size": 9, "text.color": INK})
colour = lambda v: next(c for cut, c in TIERS if v >= cut)
pretty = lambda k: k.title().replace("Sundrive", "Sundrive Road").replace("Dun Laoghaire", "Dún Laoghaire")

shares = pd.read_csv("data/safety/district_station_shares.csv")
dscore = pd.read_csv("data/safety/safety_indicators.csv").set_index("District")["safety_index_0_100"]
dists = sorted(shares["District"].unique(), key=order)
H = lambda d: (shares["District"] == d).sum() + 1.9

pages, page, used = [], [], 0
for d in dists:
    if page and used + H(d) > (24 if not pages else 31):
        pages.append(page); page, used = [], 0
    page.append(d); used += H(d)
pages.append(page)

with PdfPages(out) as pdf:
    for n, page in enumerate(pages):
        first = n == 0
        fig, axes = plt.subplots(len(page), 1, figsize=(8.27, 11.69), gridspec_kw={"height_ratios": [H(d) for d in page]})
        axes = axes if len(page) > 1 else [axes]
        for ax, d in zip(axes, page):
            p = shares[shares["District"] == d].sort_values("share", ascending=True)
            vals = list(p.station_score)
            ax.barh(range(len(p)), vals, height=0.62, color=[colour(v) for v in vals])
            for i, v in enumerate(vals):
                ax.text(v + 1, i, f"{v:.1f}", va="center", fontsize=8.5)
            ax.set_yticks(range(len(p)), [f"{pretty(s)} ({sh:.0%})" for s, sh in zip(p.Station, p.share)], fontsize=9)
            ax.axvline(50, color=MUTED, linewidth=0.8, linestyle=(0, (1, 2)))
            ax.set_xlim(0, 80); ax.set_ylim(-0.6, len(p) - 0.4)
            ax.set_xticks([0, 20, 40, 50, 60, 80]); ax.xaxis.tick_top()
            ax.tick_params(length=0, labelsize=7.5); ax.tick_params(axis="x", colors=MUTED)
            ax.grid(axis="x", color=GRID); ax.set_axisbelow(True)
            for s in ax.spines.values():
                s.set_visible(False)
            ax.set_title(d, loc="left", fontsize=12, fontweight="bold", pad=26)
            ax.text(0, 1.0, f"District score {dscore[d]:.1f}", fontsize=8, color=MUTED, va="bottom",
                    transform=offset_copy(ax.transAxes, fig=fig, y=13, units="points"))
        top = 0.82 if first else 0.97
        if first:
            fig.text(0.04, 0.985, "Relative crime score by Dublin postal district", fontsize=15, fontweight="bold", va="top")
            fig.text(0.04, 0.95, INTRO, fontsize=8.5, va="top", linespacing=1.5)
        fig.legend(handles=[Patch(color=c, label=nm) for (_, c), nm in zip(TIERS, NAMES)], loc="lower center", ncol=2,
                   fontsize=7.8, frameon=False, bbox_to_anchor=(0.5, 0.018))
        fig.text(0.04, 0.008, FOOT, fontsize=6.3, color=MUTED)
        fig.tight_layout(h_pad=1.6, rect=(0, 0.06, 1, top))
        pdf.savefig(fig); plt.close(fig)
print(len(pages), "pages")
