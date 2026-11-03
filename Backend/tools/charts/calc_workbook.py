"""Build the crime-score calculation workbook: every score as a live Excel formula from the raw CSO CJA11 counts.

Usage (from Backend/): python calc_workbook.py CJA11_CSV OUT_XLSX
"""
import sys
import pandas as pd
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter as L

import safety_pipeline as sp

cja, out = sys.argv[1], sys.argv[2]
CATS = sp.CFG["categories"]; W = sp.CFG["category_weights"]; G = list(CATS)
GNAME = {"violent": "Violent and assault", "robbery": "Robbery", "burglary_theft": "Burglary and theft",
         "public_order": "Public order", "damage": "Criminal damage"}
BOLD = Font(bold=True); HEAD = PatternFill("solid", fgColor="DCE9EC"); NOTE = Font(italic=True, color="5B636B")
INPUT = PatternFill("solid", fgColor="FFF8E1"); KEY = PatternFill("solid", fgColor="E3F1E6"); FLAG = PatternFill("solid", fgColor="F9E0D9")


def header(ws, row, names):
    for i, n in enumerate(names, 1):
        c = ws.cell(row, i, n); c.font = BOLD; c.fill = HEAD; c.alignment = Alignment(wrap_text=True, vertical="top")


# ---- data
raw = pd.read_csv(cja, encoding="utf-8-sig")
raw = raw[raw["Year"].isin([2023, 2024, 2025])].copy()
raw["code"] = raw["Garda Station"].map(sp.cso_station_code)
raw["group_code"] = raw["Type of Offence"].map(sp.offence_code)
used_codes = sorted({c for cs in CATS.values() for c in cs})
raw = raw[raw["group_code"].isin(used_codes)]
nat = pd.read_csv(sp.CFG["national_stations_csv"], dtype={"code": str}).dropna(subset=["residents"])
pts = pd.read_csv(sp.CFG["ed_points_csv"])
dub_res = pts.groupby("Station")["Population"].sum()
nat["is_dublin"] = nat["label"].str.contains("D.M.R.", regex=False)
nat.loc[nat.is_dublin, "residents"] = nat.loc[nat.is_dublin, "station"].map(dub_res)
nat = nat.dropna(subset=["residents"])
stations = nat[(nat.residents >= sp.CFG["min_reference_residents"]) | nat.is_dublin].copy()
stations["reference"] = stations.residents >= sp.CFG["min_reference_residents"]
stations = stations.sort_values(["is_dublin", "label"], ascending=[False, True]).reset_index(drop=True)
raw = raw[raw["code"].isin(stations["code"])]

wb = Workbook()

# ---- README
ws = wb.active; ws.title = "README"
lines = [
    ("Relative crime score: calculation workbook", BOLD),
    ("Every number on the other sheets is a live formula from the raw CSO counts on sheet 'CJA11 raw'.", None),
    ("", None),
    ("Steps", BOLD),
    ("1. 'CJA11 raw': CSO table CJA11 (recorded crime incidents by Garda station), 2023-2025, the offence groups used.", None),
    ("2. 'Stations': yearly average incidents per group (SUMIFS / 3), people = (16 x residents + 8 x daytime x 1.156) / 24,", None),
    ("   rate per 1,000 people, group score = 100 x R / (R + L), station score = weighted sum of group scores.", None),
    ("3. 'Benchmark': R for each group = sum of incidents / sum of people over the 105 stations with 15,000+ residents", None),
    ("   (a pooled rate over all people in those town and city station areas - not an average or median of station rates).", None),
    ("4. 'Districts': each district = share-weighted average of the station areas its residents live in.", None),
    ("5. 'Interpretation': what a score means as a crime rate.", None),
    ("", None),
    ("Weights (project's choice, not CSO): " + ", ".join(f"{GNAME[g]} {W[g]:.0%}" for g in G), None),
    ("Daytime population: Census 2016 Workplace Zones, scaled to 2022 by persons at work 2,320,297 / 2,006,641 = 1.156.", None),
    ("Ronanstown: its violent rate is capped at the highest other station in D.M.R. Western Division (Cloverhill and", None),
    ("Wheatfield prisons are in its area). This is the only adjustment inside the CSO-based calculation.", None),
    ("", None),
    ("D10: the published D10 score (25.1) is NOT calculated from CJA11. It is a manual override by the project team.", Font(bold=True, color="A12D1F")),
    ("The calculated D10 score is on sheet 'Districts'; both are shown there.", Font(color="A12D1F")),
    ("", None),
    ("Rounding: the website rounds station scores to 1 decimal before averaging districts, so published district", NOTE),
    ("scores can differ from this workbook by up to 0.1 (for example D14: 65.0 here, 65.1 published).", NOTE),
]
for i, (t, f) in enumerate(lines, 1):
    c = ws.cell(i, 1, t)
    if f: c.font = f
ws.column_dimensions["A"].width = 120

# ---- CJA11 raw
raw_ws = wb.create_sheet("CJA11 raw")
header(raw_ws, 1, ["Station code", "Garda station (CSO label)", "Year", "Offence group code", "Offence group", "Incidents"])
for r in raw[["code", "Garda Station", "Year", "group_code", "Type of Offence", "VALUE"]].itertuples(index=False):
    raw_ws.append([r[0], r[1], int(r[2]), r[3], r[4], r[5]])
n_raw = raw_ws.max_row
for col, w in zip("ABCDEF", (12, 55, 7, 10, 60, 10)):
    raw_ws.column_dimensions[col].width = w
raw_ws.freeze_panes = "A2"

# ---- Stations
s_ws = wb.create_sheet("Stations")
cols = ["Station code", "Station", "Dublin?", "In benchmark (15,000+ residents)?", "Residents (Census 2022)",
        "Daytime population (Census 2016)", "People present over a day"]
cols += [f"{GNAME[g]}: incidents a year" for g in G]
cols += [f"{GNAME[g]}: per 1,000 people" for g in G]
cols += [f"{GNAME[g]}: score" for g in G]
cols += ["Station score"]
header(s_ws, 1, cols)
s_ws.row_dimensions[1].height = 60
first, last = 2, 1 + len(stations)
C_INC = 8; C_RATE = C_INC + 5; C_SC = C_RATE + 5; C_ST = C_SC + 5
for i, r in stations.iterrows():
    row = first + i
    s_ws.cell(row, 1, r.code); s_ws.cell(row, 2, r.station.title() if r.is_dublin else r.label.split(",")[0].split(" ", 1)[-1])
    s_ws.cell(row, 3, "Yes" if r.is_dublin else "No"); s_ws.cell(row, 4, "Yes" if r.reference else "No")
    s_ws.cell(row, 5, int(r.residents)).fill = INPUT
    s_ws.cell(row, 6, int(r.daytime) if pd.notna(r.daytime) else None).fill = INPUT
    s_ws.cell(row, 7, f"=ROUND((16*E{row}+8*IF(F{row}=\"\",E{row}*2006641/2320297,F{row})*2320297/2006641)/24,0)")
    for k, g in enumerate(G):
        codes = CATS[g]
        sumifs = "+".join(f"SUMIFS('CJA11 raw'!$F$2:$F${n_raw},'CJA11 raw'!$A$2:$A${n_raw},$A{row},'CJA11 raw'!$D$2:$D${n_raw},\"{c}\")" for c in codes)
        s_ws.cell(row, C_INC + k, f"=({sumifs})/3")
        rate = f"{L(C_INC + k)}{row}/$G{row}*1000"
        if g == "violent" and r.is_dublin and r.station == "ronanstown":
            others = [first + j for j, o in stations.iterrows() if o.is_dublin and o.division == r.division and o.station != "ronanstown"]
            cap = ",".join(f"{L(C_RATE)}{o}" for o in others)
            s_ws.cell(row, C_RATE + k, f"=MIN({rate},MAX({cap}))").fill = FLAG
        else:
            s_ws.cell(row, C_RATE + k, f"={rate}")
        s_ws.cell(row, C_SC + k, f"=100*Benchmark!$B${3 + k}/(Benchmark!$B${3 + k}+{L(C_RATE + k)}{row})")
    s_ws.cell(row, C_ST, "=" + "+".join(f"{W[g]}*{L(C_SC + k)}{row}" for k, g in enumerate(G))).fill = KEY
for c in range(1, C_ST + 1):
    s_ws.column_dimensions[L(c)].width = 13
s_ws.column_dimensions["B"].width = 22
s_ws.freeze_panes = "C2"
s_ws.cell(last + 2, 1, "Ronanstown's violent rate (shaded) is capped at the highest other station in its division (prisons).").font = NOTE
st_row = {r.station: first + i for i, r in stations.iterrows() if r.is_dublin}

# ---- Benchmark
b = wb.create_sheet("Benchmark")
b.cell(1, 1, "Benchmark rate R: pooled over the 105 town and city stations (15,000+ residents)").font = BOLD
header(b, 2, ["Crime group", "R: incidents per 1,000 people a year", "Incidents a year (benchmark stations)",
              "People (benchmark stations)", "Weight"])
for k, g in enumerate(G):
    row = 3 + k
    b.cell(row, 1, GNAME[g])
    # incidents = rate x people, so Ronanstown's capped violent rate is used here too
    b.cell(row, 3, f"=SUMPRODUCT((Stations!$D${first}:$D${last}=\"Yes\")*Stations!{L(C_RATE + k)}{first}:{L(C_RATE + k)}{last}"
                   f"*Stations!$G${first}:$G${last})/1000")
    b.cell(row, 4, f"=SUMIFS(Stations!$G${first}:$G${last},Stations!$D${first}:$D${last},\"Yes\")")
    b.cell(row, 2, f"=C{row}/D{row}*1000").fill = KEY
    b.cell(row, 5, W[g])
b.cell(9, 1, "Number of benchmark stations"); b.cell(9, 2, f"=COUNTIF(Stations!$D${first}:$D${last},\"Yes\")")
for col, w in zip("ABCDE", (24, 20, 22, 20, 10)):
    b.column_dimensions[col].width = w

# ---- Districts
d_ws = wb.create_sheet("Districts")
shares = pd.read_csv("data/safety/district_station_shares.csv")
pub = pd.read_csv("data/safety/safety_indicators.csv").set_index("District")["safety_index_0_100"]
header(d_ws, 1, ["District", "Garda station area", "Residents of the district in this area (Census 2022)",
                 "Share of district residents", "Station score (from 'Stations')", "Share x score"])
row = 2; dist_rows = {}
for d in sorted(shares.District.unique(), key=lambda x: (int(x[1:].rstrip("W")), x)):
    part = shares[shares.District == d].sort_values("share", ascending=False)
    start = row
    for p in part.itertuples():
        d_ws.cell(row, 1, d); d_ws.cell(row, 2, p.Station.title())
        d_ws.cell(row, 3, int(p.residents)).fill = INPUT
        row += 1
    end = row - 1
    for r_ in range(start, end + 1):
        d_ws.cell(r_, 4, f"=C{r_}/SUM($C${start}:$C${end})")
        d_ws.cell(r_, 5, f"=Stations!${L(C_ST)}${st_row[d_ws.cell(r_, 2).value.lower()]}")
        d_ws.cell(r_, 6, f"=D{r_}*E{r_}")
    dist_rows[d] = (start, end)
    row += 0
# summary table
d_ws.cell(1, 8, "District").font = BOLD
header(d_ws, 1, [None] * 0)
for i, n in enumerate(["District", "Calculated from CJA11", "Published on the website", "Note"], 8):
    c = d_ws.cell(1, i, n); c.font = BOLD; c.fill = HEAD
for i, (d, (a, z)) in enumerate(dist_rows.items(), 2):
    d_ws.cell(i, 8, d)
    d_ws.cell(i, 9, f"=SUM(F{a}:F{z})").fill = KEY
    d_ws.cell(i, 10, float(pub[d]))
    if d == "D10":
        for c in (8, 9, 10, 11):
            d_ws.cell(i, c).fill = FLAG
        d_ws.cell(i, 11, "Manual override by the project team (not from CJA11)")
for col, w in zip("ABCDEFGHIJK", (8, 18, 18, 12, 14, 12, 3, 9, 14, 14, 48)):
    d_ws.column_dimensions[col].width = w
d_ws.freeze_panes = "A2"

# ---- Interpretation
it = wb.create_sheet("Interpretation")
it.cell(1, 1, "What a score means").font = BOLD
it.cell(2, 1, "For one crime group: S = 100 x R / (R + L), so L / R = (100 - S) / S.")
header(it, 4, ["Score S", "Local rate as a multiple of the benchmark (L / R)", "Example: violent crime per 1,000 people"])
for i, s_ in enumerate([75, 65, 60, 57, 50, 45, 40, 35, 25], 5):
    it.cell(i, 1, s_); it.cell(i, 2, f"=(100-A{i})/A{i}"); it.cell(i, 3, f"=B{i}*Benchmark!$B$3")
it.cell(15, 1, "The station score is a weighted average of the five group scores, so one station score does not map to one rate;"
         " see each group's rate on sheet 'Stations'.").font = NOTE
it.cell(16, 1, "50 = the benchmark rate; it is not a probability of becoming a victim, and 70 is not twice as safe as 35.").font = NOTE
it.column_dimensions["A"].width = 12; it.column_dimensions["B"].width = 34; it.column_dimensions["C"].width = 34

wb.save(out)
print("saved", out, "stations", len(stations), "benchmark", int(stations.reference.sum()), "raw rows", n_raw - 1)
