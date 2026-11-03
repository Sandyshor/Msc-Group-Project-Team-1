# Relative crime score

A relative recorded-crime index for Dublin, built from official CSO data. It compares each Garda station
area's recorded crime with the rate across Ireland's towns and cities.

It is one input to the accommodation recommender, shown next to other indicators (street lighting, night public
transport, distance to a Garda station, amenities). It is not combined with them into an overall safety score,
and it does not change the recommendation ranking.

## What a score means

`S = 100 x R / (R + L)`, where R is the Irish town and city benchmark rate and L is the local rate, for each
crime type; the five type scores are then weighted.

- **50** = the same recorded-crime rate as the benchmark.
- **Above 50** = a lower recorded-crime rate than the benchmark.
- **Below 50** = a higher recorded-crime rate than the benchmark.

The score is a comparative index. It is not the probability of becoming a victim of crime, and it is not
proportional to safety: 70 is not "twice as safe" as 35. Rearranged, `L / R = (100 - S) / S`, so for a single
crime type:

| Score | Local rate compared with the benchmark |
|---|---|
| 70 | 0.43 x (less than half) |
| 57 | 0.75 x |
| 50 | 1.00 x (the same) |
| 40 | 1.50 x |
| 35 | 1.86 x |

### Bands

Bands are assigned from the unrounded score:

| Score | Band |
|---|---|
| 57 or higher | Lower recorded crime |
| 50 to below 57 | Below-benchmark crime |
| 40 to below 50 | Above-benchmark crime |
| Below 40 | Higher recorded crime |

## Method

1. **Crime per station.** For every Garda station in Ireland, the yearly average of recorded incidents over
   2023-2025 in five groups (CSO ICCS offence-group codes), weighted as below.
2. **Population: people present on an average day.** `people = (16 x residents + 8 x daytime population) / 24`.
   Residents are counted for the 16 hours they are most likely at home; the daytime population (people working
   or studying in the area) for an 8-hour working day.
3. **Benchmark (R).** For each group, all incidents divided by all people across Ireland's 105 town and city
   stations (15,000+ residents).
4. **Score.** For each group, `100 x R / (R + L)`; the station score is the weighted average of the five.
5. **Postal districts (an estimate).** Garda station areas don't follow postal districts. A district's score is
   the resident-weighted average of the station areas its residents live in.
6. **Neighbourhoods.** Each named place shows the score of the station area it lies in; it is not separately
   measured.

## Why these weights

These are the project's chosen weights, not official CSO weightings.

| Group | Weight | Reason |
|---|---|---|
| Violent crime and assault | 35% | Direct harm, or threat of harm, to a person: the most important factor for personal safety |
| Robbery | 25% | Theft by force or threat, so it combines harm to the person with loss of property |
| Burglary and theft | 20% | Affects belongings and the home; important to residents but not usually a threat to the person |
| Public order | 15% | Affects how safe an area feels, especially at night, but rarely involves injury |
| Criminal damage | 5% | Affects property and the look of an area; the least direct harm to a person |

Violent crime and robbery together take 60% because both involve force against a person. Crime-harm indices
order offences the same way: the Cambridge Crime Harm Index (Sherman, Neyroud and Neyroud, 2016) and the ONS
Crime Severity Score (England and Wales) both weight assault and robbery many times higher than theft or
criminal damage. The sensitivity test below shows that the district ranking does not depend on these exact
weights.

## Areas to check street by street

Garda crime figures cover whole station areas, so they can hide local problems inside one. A named area or Census
ED classed **Disadvantaged, Very Disadvantaged or Extremely Disadvantaged** in the Pobal HP Deprivation Index 2022
(CC BY 4.0) is flagged on the website and charts: "Check the specific street before choosing". Users are asked to
visit the street and its surroundings rather than rely on the station area's rating. In 2022 these categories
cover 241 of Ireland's 3,417 EDs.

The flag does not change the relative crime score: deprivation is not crime, and combining the two would make the
score something it is not. It is a prompt to look closer, used because a station-wide figure can be reassuring in
places where local knowledge and the deprivation data suggest otherwise (for example Cherry Orchard in D10). 20 named areas are flagged, including Cherry Orchard, Le Fanu,
Ballymun, Poppintree, Killinarden, Neilstown and Finglas West; `build_area_deprivation.py` writes the list to
`data/safety/area_deprivation.csv`.

## Limitations

Recorded crime statistics reflect incidents known to and recorded by An Garda Síochána. They do not capture all
criminal activity, unreported incidents, or residents' perceptions of safety. Therefore, the relative crime
score should be considered alongside other indicators, such as lighting, transport accessibility, and
environmental conditions.

Also:

- The CSO records crime by the Garda sub-district where it was recorded and by the date it was reported, not
  necessarily where or when it happened. Its figures are published under reservation.
- District and neighbourhood scores are estimates from station areas, not separate measurements.
- The daytime population is from Census 2016, the latest Workplace Zones release; station boundaries are the
  2013 sub-districts, the newest published.

## Sensitivity test

Every district was re-scored under 12 scenarios: 4 weightings x 3 population bases (Appendix A7). The rank
correlation with the published ranking is 0.94 to 1.00 in every scenario. D14 is first in all 12; D1, D2 and D8
are the bottom three in all 12. Rank 1 = least recorded crime.

| District | Published rank | Best rank | Worst rank | Spread | Stability |
|---|---|---|---|---|---|
| D14 | 1 | 1 | 1 | 0 | Stable |
| D13 | 2 | 2 | 4 | 2 | Stable |
| D16 | 3 | 2 | 3 | 1 | Stable |
| D18 | 4 | 2 | 4 | 2 | Stable |
| D6W | 5 | 5 | 6 | 1 | Stable |
| D3 | 6 | 5 | 7 | 2 | Stable |
| D5 | 7 | 6 | 9 | 3 | Moderate |
| D6 | 8 | 6 | 9 | 3 | Moderate |
| D4 | 9 | 8 | 17 | 9 | Sensitive |
| D15 | 10 | 10 | 10 | 0 | Stable |
| D22 | 11 | 8 | 13 | 5 | Moderate |
| D12 | 12 | 11 | 15 | 4 | Moderate |
| D17 | 13 | 12 | 14 | 2 | Stable |
| D11 | 14 | 11 | 17 | 6 | Sensitive |
| D10 | 15 | 12 | 16 | 4 | Moderate |
| D24 | 16 | 12 | 16 | 4 | Moderate |
| D9 | 17 | 15 | 17 | 2 | Stable |
| D7 | 18 | 18 | 19 | 1 | Stable |
| D20 | 19 | 18 | 19 | 1 | Stable |
| D8 | 20 | 20 | 21 | 1 | Stable |
| D2 | 21 | 20 | 22 | 2 | Stable |
| D1 | 22 | 21 | 22 | 1 | Stable |

Stable = spread of 0-2 places, Moderate = 3-5, Sensitive = 6 or more. Both sensitive districts move with the
population base rather than the weighting. D4 ranks 8th-11th when the daytime population is counted and 15th-17th
on residents only, because many people in its station areas are daytime workers. D11 does the reverse: 11th-13th
on residents only, 13th-17th when the daytime population is counted. The table is generated from
`data/safety/crime_score_sensitivity.csv`.

---

## Appendix: data quality and reproducibility

### A1. Datasets

| Dataset | Publisher, table | Downloaded | Used |
|---|---|---|---|
| Recorded crime incidents by Garda station and type of offence (New Garda Operating Model) | CSO PxStat, **CJA11**: `https://ws.cso.ie/public/api.restful/PxStat.Data.Cube_API.ReadDataset/CJA11/CSV/1.0/en` | 1 November 2026 | Crime counts, 2023-2025 |
| Recorded crime incidents by Garda station (station names and old divisions) | CSO PxStat, CJA07 | 1 November 2026 | Matching station codes to boundary names only |
| Census 2022 Small Area Population Statistics, Electoral Division | CSO, `SAPS_2022_CSOED3270923.csv`, total persons `T1_1AGETT` | October 2026 | Residents |
| Electoral Divisions 2022 boundaries | Tailte Éireann / CSO, national statistical boundaries | October 2026 | Mapping residents to station areas and districts |
| Census 2016 Workplace Zones | CSO, `Workplace_Zones_ITM.shp`, daytime population `T11_T` | October 2026 | Daytime population |
| Garda sub-districts (Nov 2013) | CSO Census 2011 boundary files, `Census2011_Garda_Subdistricts_Nov2013.shp` | October 2026 | Garda station areas (563, all of Ireland) |
| Persons at work, Census 2016 and 2022 | CSO: 2,006,641 and 2,320,297 | - | Scaling daytime population to 2022 |
| Dublin postal districts | `dublin_postcode_boundaries.geojson` | October 2026 | Districts D1-D24 |
| Pobal HP Deprivation Index 2022, Electoral Division | Pobal, `hp-deprivation-index-scores-2022.csv` | 1 November 2026 | "Check the street" flags |

All CSO and Tailte Éireann data are published under CC BY 4.0.

### A2. Years

Calendar years 2023, 2024 and 2025 (the latest three with figures), averaged. The pipeline always uses the latest
three years in the file.

### A3. Crime groups and CSO offence classifications

| Group | Weight | ICCS codes | CSO offence groups |
|---|---|---|---|
| Violent crime and assault | 35% | 03, 04, 05 | Attempts/threats to murder, assaults, harassments; dangerous or negligent acts; kidnapping |
| Robbery | 25% | 06 | Robbery, extortion and hijacking |
| Burglary and theft | 20% | 07, 08 | Burglary; theft (includes theft from the person, which cannot be separated at station level) |
| Public order | 15% | 13 | Public order and other social code offences |
| Criminal damage | 5% | 12 | Damage to property and to the environment |
| Not used | - | 09, 10, 11, 14, 15, 16 | Fraud; controlled drugs; weapons; road and traffic; offences against government and justice (mostly recorded at the courts); other |

CJA11 has no station-level figures for homicide (01) or sexual offences (02).

### A4. Population and scaling

- Residents: Census 2022 total persons per Electoral Division (ED).
- Daytime population: Census 2016 Workplace Zones `T11_T` x (2,320,297 / 2,006,641 = 1.156), the national rise
  in persons at work, because no Census 2022 Workplace Zone figures are published.
- People = (16 x residents + 8 x scaled daytime population) / 24, rounded to whole people.

### A5. Mapping

- Each ED and each Workplace Zone is assigned to the Garda sub-district its centre lies in (the nearest one for
  the few centres just outside, e.g. on the coast). Each sub-district is one Garda station.
- CJA07/CJA11 stations are matched to sub-districts by name within the same Garda division (with a list of Irish
  and English names for Gaeltacht stations) and then by CSO station code: 561 of 564 stations match.
- Each Dublin ED is assigned to the postal district its centre lies in. A district's station-area shares are the
  share of its ED residents in each station area, published in `data/safety/district_station_shares.csv`.
- Named neighbourhoods are OpenStreetMap place points, plus a hand-checked list (`data/safety/extra_places.csv`)
  for well-known areas OSM does not tag as places. Each takes the station area its point lies in. A name in two
  districts is labelled as each district's part, e.g. "Glasnevin (D7 part)".

### A6. Formulae and rounding

- Rate per group: `L = incidents per year / people x 1,000`, stored to 2 decimal places.
- Benchmark per group: `R = sum of incidents / sum of people x 1,000` over the 105 stations with 15,000+ residents.
  2023-2025: violent 10.70, robbery 0.62, burglary and theft 21.73, public order 7.27, criminal damage 5.08.
- Group score: `100 x R / (R + L)`. Station score: weighted sum of group scores, stored to 1 decimal place.
- District score: `sum(share x station score)` over its station areas, using the stored station scores; stored
  to 1 decimal place. Any district can be rebuilt from `district_station_shares.csv` to within 0.05.
- Bands: from the stored score without further rounding (56.8 is Below-benchmark crime, 57.0 is Lower).
- The website and charts show scores to 1 decimal place.

### A7. Sensitivity scenarios

| Weighting | Violent | Robbery | Burglary and theft | Public order | Damage |
|---|---|---|---|---|---|
| Published | 35% | 25% | 20% | 15% | 5% |
| Equal | 20% | 20% | 20% | 20% | 20% |
| Harm to the person | 45% | 30% | 10% | 10% | 5% |
| Property-led | 25% | 15% | 40% | 10% | 10% |

| Population base | Definition |
|---|---|
| Published: people over a day | (16 x residents + 8 x daytime) / 24 |
| Residents only | residents |
| Half and half | (residents + daytime) / 2 |

Each of the 4 x 3 = 12 combinations re-runs the whole calculation, including the benchmark. Output:
`data/safety/crime_score_sensitivity.csv` (scores and rank ranges) and `crime_score_sensitivity_summary.csv`
(rank correlation with the published ranking; whether the top and bottom three are unchanged).

### A8. Missing data and geographical limits

- **Stations not matched to a boundary** (left out of the benchmark): Kilmihil, Carrig na Bhfear, Dublin Airport.
  None of them affects the benchmark materially; Dublin Airport has almost no residents.
- **Dublin stations without their own CSO figures:** O'Connell Street and Stepaside have no sub-district of their
  own in the boundary file and no separate CSO figures; their crime is recorded by the station whose sub-district
  covers them.
- **Prisons:** Ronanstown (Cloverhill and Wheatfield) and Mountjoy station areas contain prisons. Their violent
  rate is capped at the highest other station's in the same division; this changes Ronanstown only.
- **Boundaries:** the Garda sub-districts are from November 2013. Checked against the Garda station list of 28
  August 2025 and the district boundaries revised on 28 November 2019: the 41 Dublin areas still match the
  crime figures.
- **Postal-district boundary file:** Foxrock, Cabinteely, Leopardstown, Darndale, Belcamp and Balgriffin fall
  outside it, so they are not listed as named neighbourhoods. Their residents are still counted in the station
  areas.
- **Years:** residents 2022, daytime population 2016 (scaled), crime 2023-2025.

### A9. Manual overrides

`data/safety/manual_overrides.csv` replaces the calculated scores of D10's 7 EDs and its 3 named areas with the
project team's assessment, based on local knowledge of the area. These values are not produced by the method above;
every other score is. D10's district score and its station-area parts are then averaged from these ED scores in the
usual way, so all levels stay consistent. Removing the file restores the calculated D10 scores.

### A10. Reproduce

```bash
cd Backend
pip install geopandas shapely pandas numpy requests pyproj
python build_national_stations.py data/raw/cso_electoral_divisions_2022.geojson \
    data/raw/SAPS_2022_CSOED3270923.csv data/raw/CJA07.csv data/raw/wpz/Workplace_Zones_ITM.shp \
    data/safety/national_stations.csv
python safety_pipeline.py --force --cso-csv data/raw/CJA11.csv
python tools/crime_score_sensitivity.py data/raw/CJA11.csv
python -m pytest tests
```

The weekly GitHub Action runs `safety_pipeline.py`, which downloads CJA11 itself.
