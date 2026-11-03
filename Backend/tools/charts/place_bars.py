"""One bar per named place, grouped by district and by the Garda station area each place is in."""
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
         "Each bar is a named place and its relative crime score. Places are grouped under the Garda station area they are in;\n"
         "the heading gives that area's score and its share of the district's residents. Crime is published per station area,\n"
         "so places in the same area share its score. The district score is the average of the area scores weighted by those shares.\n"
         "50 (dotted line) = the recorded-crime rate of Irish towns and cities. Higher than 50 = less recorded crime than that\n"
         "benchmark; lower than 50 = more. The score compares areas; it is not the chance of becoming a victim. It counts crime\n"
         "recorded by the Gardaí, so check it alongside other things such as lighting, transport and visiting the area yourself.")
FOOT = "Source: CSO recorded crime by Garda station (CJA11), 2023-2025 average; Census 2022; place names from OpenStreetMap."
plt.rcParams.update({"font.family": ["Arial", "DejaVu Sans"], "font.size": 9, "text.color": INK})
colour = lambda v: next(c for cut, c in TIERS if v >= cut)
pretty = lambda k: k.title().replace("Sundrive", "Sundrive Road").replace("Dun Laoghaire", "Dún Laoghaire")

shares = pd.read_csv("data/safety/district_station_shares.csv")
dscore = pd.read_csv("data/safety/safety_indicators.csv").set_index("District")["safety_index_0_100"]
nb = pd.read_csv("data/safety/safety_neighbourhoods.csv")
dists = sorted(shares["District"].unique(), key=order)


def rows(d):
    """[(kind, label, score)] top to bottom: a heading per station area, then its places."""
    r = []
    for s in shares[shares["District"] == d].sort_values("share", ascending=False).itertuples():
        r.append(("head", f"{pretty(s.Station)} area  ·  {s.share:.0%} of residents  ·  score {s.station_score:.1f}", None))
        pl = nb[(nb.District == d) & (nb.Station == s.Station)].sort_values("Label")
        if pl.empty:
            r.append(("bar", pretty(s.Station), s.station_score))
        r += [("bar", p.Label, p.safety_index_0_100) for p in pl.itertuples()]
    return r


H = lambda d: len(rows(d)) * 0.62 + 1.9
pages, page, used = [], [], 0
for d in dists:
    if page and used + H(d) > (27 if not pages else 34):
        pages.append(page); page, used = [], 0
    page.append(d); used += H(d)
pages.append(page)

with PdfPages(out) as pdf:
    for n, page in enumerate(pages):
        first = n == 0
        fig, axes = plt.subplots(len(page), 1, figsize=(8.27, 11.69), gridspec_kw={"height_ratios": [H(d) for d in page]})
        axes = axes if len(page) > 1 else [axes]
        for ax, d in zip(axes, page):
            rs = rows(d)[::-1]
            ticks, labels = [], []
            for i, (kind, label, v) in enumerate(rs):
                if kind == "head":
                    ax.text(0, i, label, va="center", ha="left", fontsize=7.6, fontweight="bold", color=MUTED,
                            transform=ax.get_yaxis_transform())
                else:
                    ax.barh(i, v, height=0.62, color=colour(v))
                    ax.text(v + 1, i, f"{v:.1f}", va="center", fontsize=7.6)
                    ticks.append(i); labels.append(label)
            ax.set_yticks(ticks, labels, fontsize=7.6)
            ax.axvline(50, color=MUTED, linewidth=0.8, linestyle=(0, (1, 2)))
            ax.set_xlim(0, 80); ax.set_ylim(-0.6, len(rs) - 0.4)
            ax.set_xticks([0, 20, 40, 50, 60, 80]); ax.xaxis.tick_top()
            ax.tick_params(length=0, labelsize=7); ax.tick_params(axis="x", colors=MUTED)
            ax.grid(axis="x", color=GRID); ax.set_axisbelow(True)
            for s in ax.spines.values():
                s.set_visible(False)
            ax.set_title(d, loc="left", fontsize=12, fontweight="bold", pad=26)
            ax.text(0, 1.0, f"District score {dscore[d]:.1f}", fontsize=8, color=MUTED, va="bottom",
                    transform=offset_copy(ax.transAxes, fig=fig, y=13, units="points"))
        top = 0.82 if first else 0.975
        if first:
            fig.text(0.04, 0.985, "Relative crime score by place, district by district", fontsize=15, fontweight="bold", va="top")
            fig.text(0.04, 0.95, INTRO, fontsize=8.2, va="top", linespacing=1.5)
        fig.legend(handles=[Patch(color=c, label=nm) for (_, c), nm in zip(TIERS, NAMES)], loc="lower center", ncol=2,
                   fontsize=7.6, frameon=False, bbox_to_anchor=(0.5, 0.016))
        fig.text(0.04, 0.007, FOOT, fontsize=6.2, color=MUTED)
        fig.tight_layout(h_pad=1.4, rect=(0, 0.055, 1, top))
        pdf.savefig(fig); plt.close(fig)
print(len(pages), "pages")
