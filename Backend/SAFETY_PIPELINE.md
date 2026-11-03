# Find Your Dublin: relative crime score pipeline

The code, data and charts for the relative crime score. The full method, data sources and reproducibility
appendix are in `Backend/CRIME_SCORE.md`. The folders match the project repository, so files can be copied
straight into it.

## What is in here

| Path | What it does |
|---|---|
| `Backend/safety_pipeline.py` | The main calculation: crime groups, people present over a day, Irish benchmark, scores, bands, districts, neighbourhoods, heat-map areas. Run weekly by GitHub Actions. |
| `Backend/build_national_stations.py` | One-off: residents and daytime population of every Garda station area in Ireland (for the benchmark). |
| `Backend/build_station_map.py` | One-off: every Dublin Census area (ED) with its residents, Garda station area and postal district. |
| `Backend/build_neighbourhoods.py` | One-off: the named places (OpenStreetMap plus `data/safety/extra_places.csv`). |
| `Backend/build_area_deprivation.py` | One-off: Pobal deprivation category per area, used only for the "check the specific street" note. |
| `Backend/build_safety_map.py`, `build_safety_context.py` | One-off: heat-map shapes; street lighting and night transport (shown beside the score). |
| `Backend/tools/crime_score_sensitivity.py` | The 12-scenario sensitivity test. |
| `Backend/tools/charts/` | The scripts that made the PDFs, PNGs and the calculation spreadsheet (list below). |
| `Backend/recommender.py`, `Backend/app.py` | The backend that serves the scores to the website. |
| `Backend/tests/` | Tests for the pipeline and what the website shows. |
| `Backend/data/safety/` | All published outputs and the small inputs the weekly run needs. |
| `Frontend/pages/` | The website's results page and safety heat map. |
| `.github/workflows/refresh-safety-data.yml` | The weekly automatic refresh. |

Key data files in `Backend/data/safety/`:

- `crime_by_station.csv`: each Dublin station's people, crimes a year, rates per 1,000 people and score
- `safety_indicators.csv`: district scores and bands
- `district_station_shares.csv`: each district's station areas, their share of residents and score
- `safety_neighbourhoods.csv`, `safety_eds.csv`: named places and Census areas
- `national_stations.csv`: people in every Garda station area in Ireland
- `manual_overrides.csv`: the D10 values set by the project team (see `CRIME_SCORE.md`, Appendix A9)
- `crime_score_sensitivity*.csv`: sensitivity results

## Run

From `Backend/`, with Python 3.11+:

```bash
pip install geopandas shapely pandas numpy requests pyproj openpyxl matplotlib pytest

# Scores (downloads CSO CJA11 itself; --cso-csv uses a saved copy instead)
python safety_pipeline.py --force

# Sensitivity test
python tools/crime_score_sensitivity.py CJA11.csv

# Tests
python -m pytest tests/test_safety_pipeline.py
```

`tests/test_safety_display.py` also needs the recommender's data folder (`Data/` in the repository).

The one-off builders need large raw files (Census ED boundaries and SAPS, Garda sub-district boundaries,
Census 2016 Workplace Zones, the Dublin OpenStreetMap extract, Pobal index). Their commands and sources are in
`CRIME_SCORE.md`, Appendix A1 and A10. Their outputs are already in `data/safety/`, so the weekly run does not
need them.

## Charts and spreadsheet

Run from `Backend/` with `PYTHONPATH=.` so the scripts can find `safety_pipeline.py`:

| Script | Makes |
|---|---|
| `tools/charts/district_parts_single.py OUT_DIR OUT_PDF` | One chart per district (PNG and PDF), with named places, and all of them in one PDF |
| `tools/charts/district_bars_text.py OUT_PDF` | The bar graphs only, with a short "how to read" guide |
| `tools/charts/place_bars.py OUT_PDF` | One bar per named place, grouped by station area |
| `tools/charts/district_parts_pdf.py OUT_PDF` | Compact version: several districts per page, with named places |
| `tools/charts/bar_charts.py data/safety OUT_DIR` | District scores, districts by station area, station scores, ranking stability, rank table |
| `tools/charts/district_area_charts.py OSM_PBF DISTRICT_BOUNDARIES OUT_DIR` | Per-district charts with places and main streets |
| `tools/charts/calc_workbook.py CJA11_CSV OUT_XLSX` | The calculation spreadsheet: every score as an Excel formula from the raw CSO counts |

Example:

```bash
PYTHONPATH=. python tools/charts/district_bars_text.py ../Dublin-district-bar-graphs-simple.pdf
```
