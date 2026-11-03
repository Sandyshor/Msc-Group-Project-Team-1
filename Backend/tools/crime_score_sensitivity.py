#!/usr/bin/env python3
"""Sensitivity test for the relative crime score: do the district rankings hold under other reasonable choices?

Re-scores every district under each combination of crime-type weights and population denominator, and writes
  data/safety/crime_score_sensitivity.csv  - each district's score under every scenario, plus its rank range
  data/safety/crime_score_sensitivity_summary.csv - each scenario's rank correlation with the published method

Usage (from Backend/): python tools/crime_score_sensitivity.py CJA11_CSV
"""
import logging
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import safety_pipeline as sp  # noqa: E402

WEIGHTS = {
    "published (35/25/20/15/5)": {"violent": .35, "robbery": .25, "burglary_theft": .20, "public_order": .15, "damage": .05},
    "equal (20 each)": {"violent": .20, "robbery": .20, "burglary_theft": .20, "public_order": .20, "damage": .20},
    "harm to the person (45/30/10/10/5)": {"violent": .45, "robbery": .30, "burglary_theft": .10, "public_order": .10, "damage": .05},
    "property-led (25/15/40/10/10)": {"violent": .25, "robbery": .15, "burglary_theft": .40, "public_order": .10, "damage": .10},
}
DENOMINATORS = {
    "people over a day (16 h home, 8 h day)": (16, 8),
    "residents only": (24, 0),
    "half residents, half daytime": (12, 12),
}


def district_scores(df, national, points, weights, hours):
    cfg = {"category_weights": weights, "home_hours": hours[0], "day_hours": hours[1]}
    old = {k: sp.CFG[k] for k in cfg}
    sp.CFG.update(cfg)
    try:
        stations, _, _ = sp.station_scores(df, national, points)
    finally:
        sp.CFG.update(old)
    s = stations[stations["label"].str.contains("D.M.R.", regex=False)].set_index("station")["score"]
    d = points.dropna(subset=["District"]).assign(score=lambda x: x["Station"].map(s))
    return d.groupby("District").apply(lambda x: np.average(x["score"], weights=x["Population"]), include_groups=False)


def main(cja_csv):
    logging.disable(logging.INFO)
    df = pd.read_csv(cja_csv, low_memory=False)
    national = pd.read_csv(sp.CFG["national_stations_csv"], dtype={"code": str})
    points = sp.load_ed_points()
    scores = pd.DataFrame({f"{w} | {d}": district_scores(df, national, points, WEIGHTS[w], DENOMINATORS[d])
                           for w in WEIGHTS for d in DENOMINATORS})
    main_col = scores.columns[0]
    ranks = scores.rank(ascending=False)
    out = scores.round(1)
    out["rank_published"] = ranks[main_col].astype(int)
    out["rank_best"] = ranks.min(axis=1).astype(int)
    out["rank_worst"] = ranks.max(axis=1).astype(int)
    out = out.sort_values("rank_published")
    out.to_csv(Path(sp.CFG["out_dir"]) / "crime_score_sensitivity.csv")
    summary = pd.DataFrame({
        "scenario": scores.columns,
        "rank_correlation_with_published": [round(ranks[main_col].corr(ranks[c]), 3) for c in scores.columns],
        "same_top_3": [set(ranks[c].nsmallest(3).index) == set(ranks[main_col].nsmallest(3).index) for c in scores.columns],
        "same_bottom_3": [set(ranks[c].nlargest(3).index) == set(ranks[main_col].nlargest(3).index) for c in scores.columns],
    })
    summary.to_csv(Path(sp.CFG["out_dir"]) / "crime_score_sensitivity_summary.csv", index=False)
    print(summary.to_string(index=False))
    print(out[["rank_published", "rank_best", "rank_worst"]].to_string())


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
