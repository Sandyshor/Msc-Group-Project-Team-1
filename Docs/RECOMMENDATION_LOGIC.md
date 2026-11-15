# How the recommendation is calculated

This explains the scoring in `Backend/recommender.py`, what was changed on 15 November 2026 after the user
evaluation, and the evidence and references behind each choice.

## The problem found in the evaluation

Testers said the recommended areas "didn't feel right": places far from the chosen university appeared even
when the commute was given a high priority, and the closest area was often not first.

Measured on 80 searches (16 universities, private and shared rooms, five budgets), with commute, rent and safety
all rated 10:

- In 43 of 80 searches the first result was more than 10 minutes further than the nearest affordable area.
- In all 43, the cause was the **safety** score. No other factor was responsible.
- Moving a slider from 5 to 10 hardly changed the top 3, so the sliders were not doing their job.
- 47 of 254 places had no journey time of their own and used a neighbouring place's time unchanged, even when
  that neighbour was up to 2 km nearer the campus. Navan Road, for example, was shown as an 18-minute walk from
  TU Dublin Grangegorman, which is 2.8 km away in a straight line.

## The model

For each place, every factor the student rated gets a score from 0 to 1, and the match score is their weighted
average, out of 100:

```
match = 100 x sum(weight_i x score_i) / sum(weight_i)          weight_i = (slider_i / 10)^2
```

This is the additive multi-attribute value model (Keeney and Raiffa, 1976). Two reductions are then applied:
for a commute over 30 minutes (down to half at 90 minutes) and for rent over the budget (down to 40% at 50%
over). Both grow with how highly the student rated commute and rent. One place per postal district is shown.

### Factor scores

| Factor | Scores 1 | Scores 0 | Basis |
|---|---|---|---|
| Commute | 10 minutes or less | 60 minutes or more | People do not want a zero commute: the ideal is about 16 minutes (Redmond and Mokhtarian, 2001). About an hour of travel a day, 30 minutes each way, is the long-observed tolerance (Marchetti, 1994), which is where the long-commute reduction starts. |
| Rent | 75% of the budget or less | 150% of the budget | The budget is the student's own limit |
| Safety | Index of 80 | Index of 20 | See change 2 |
| Amenities | "Enough for daily life" within walking distance (e.g. 2 supermarkets) | None | More than enough does not help |

## What changed, and why

### 1. Weights: the slider value squared

Before, a weight was the slider value itself, so a factor at 10 counted only twice one at 5. In the benchmark,
that was too weak to change the top 3. Now a 10 counts four times a 5.

Weights taken straight from importance ratings are known to be too even, and steeper weights derived from the
order of importance predict people's choices better (Stillwell, Seaver and Edwards, 1981; Edwards and Barron,
1994). Squaring the rating is the same idea as their rank-exponent weights, applied to the slider value. The
power was chosen by benchmark: 2 respects the top priority without producing far-away results, and 3 produced
some (3 searches of 480).

### 2. Safety: scored either side of the national benchmark

The safety index is `100 x R / (R + L)`: 50 means the recorded-crime rate of Ireland's towns and cities
(`Backend/CRIME_SCORE.md`). It was scored from 30 (0) to 60 (1), a range fitted to Dublin's own lowest and
highest districts. That made the areas around the city-centre campuses score close to 0, so at equal sliders
the gap between Dublin's least and most safe district counted as much as 50 minutes of commute each way.

It is now scored from 20 (four times the benchmark rate) to 80 (a quarter of it), the same distance either
side of 50. Fitting a scale to the lowest and highest values in the data (min-max) and scoring against a fixed
reference value are both standard, and the choice changes how much a factor counts in practice (Nardo et al.,
2008). A factor's real influence is its weight times the range of its scores, so the range has to be chosen
deliberately (von Winterfeldt and Edwards, 1986; Edwards and Barron, 1994).

### 3. Estimated commute times: adjusted for distance

A neighbourhood without its own OpenTripPlanner time still uses its nearest commute point's time, but the time
is now adjusted for how much nearer or further from the university the neighbourhood is:

```
minutes = point's minutes + (neighbourhood km - point km, straight line) / speed x 60
speed: walk 3.7 km/h, cycle 12 km/h, public transport 20 km/h
```

The speeds were fitted on the 4,765 neighbourhood journeys that do have their own time: each was estimated
from its nearest commute point as if it had none, and compared with the real time.

| Mode | Journeys | Average error before | Average error after |
|---|---|---|---|
| Walk | 1,391 | 12.5 min | 3.7 min |
| Cycle | 1,687 | 5.3 min | 2.4 min |
| Public transport | 1,687 | 6.4 min | 5.8 min |

Public transport improves least, because the time depends on the route, not only the distance. The proper fix
is to run `build_commute_matrix.py --neighbourhoods` on the OpenTripPlanner server for the 47 places.

## Results: before and after

Same 80 searches for each row.

| Sliders | Measure | Before | After |
|---|---|---|---|
| Commute 10, others 5 | First result within 10 min of the shortest affordable commute | 61% | 99% |
| Commute 10, others 5 | Average commute of the top 3 | 22.0 min | 17.1 min |
| Commute 10, rent 8, safety 8 | First result within 10 min of the shortest affordable commute | 51% | 75% |
| Commute 10, rent 8, safety 8 | Average commute of the top 3 | 24.3 min | 19.4 min |
| Commute, rent, safety all 10 | First result within 10 min of the shortest affordable commute | 46% | 59% |
| Rent 10, others 5 | Districts cheaper than the top 3 (lower is better) | 47% | 44% |
| Safety 10, others 5 | Districts safer than the top 3 (lower is better) | 47% | 43% |
| All six profiles | Searches with a far-away area in the top 3 | 0 | 0 |

Students who put rent or safety first also get results that are slightly better on rent or safety than before.

The trade-off: the places nearest most campuses have more recorded crime than the suburbs, so results that
follow the commute more closely are less safe on average. With commute at 10 and the others at 5, the share
of districts safer than the top 3 rose from 61% to 73%. A student who wants the opposite raises the safety slider.

Two ideas were tested and rejected because they did not improve these measures: combining the factor scores
with a weighted geometric mean, and a power of 3 for the weights.

## Limits

- There is no ground truth for the "right" area. These measures check that the results follow the student's
  stated priorities, which is the perceived-accuracy sense used in recommender evaluation (Pu, Chen and Hu, 2011).
- When commute, rent and safety are all rated the same, safety still decides 33 of 80 first places (before: 43).
  That is the student's stated preference, but it should be re-checked with users.
- The top 3 are three different postal districts. For a campus whose surroundings are one district (DCU in D9),
  the second and third results are necessarily further away.
- Rent is a district average, so two places in one district have the same rent.

## References

- Edwards, W. and Barron, F.H. (1994) 'SMARTS and SMARTER: Improved simple methods for multiattribute utility
  measurement', *Organizational Behavior and Human Decision Processes*, 60(3), pp. 306-325.
- Keeney, R.L. and Raiffa, H. (1976) *Decisions with Multiple Objectives: Preferences and Value Tradeoffs*.
  New York: Wiley.
- Marchetti, C. (1994) 'Anthropological invariants in travel behavior', *Technological Forecasting and Social
  Change*, 47(1), pp. 75-88.
- Nardo, M., Saisana, M., Saltelli, A., Tarantola, S., Hoffmann, A. and Giovannini, E. (2008) *Handbook on
  Constructing Composite Indicators: Methodology and User Guide*. Paris: OECD Publishing.
- Pu, P., Chen, L. and Hu, R. (2011) 'A user-centric evaluation framework for recommender systems',
  *Proceedings of the Fifth ACM Conference on Recommender Systems*, pp. 157-164.
- Redmond, L.S. and Mokhtarian, P.L. (2001) 'The positive utility of the commute: modeling ideal commute time
  and relative desired commute amount', *Transportation*, 28(2), pp. 179-205.
- Stillwell, W.G., Seaver, D.A. and Edwards, W. (1981) 'A comparison of weight approximation techniques in
  multiattribute utility decision making', *Organizational Behavior and Human Performance*, 28(1), pp. 62-77.
- von Winterfeldt, D. and Edwards, W. (1986) *Decision Analysis and Behavioral Research*. Cambridge: Cambridge
  University Press.
