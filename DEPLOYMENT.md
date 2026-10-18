# Deployment

| Part | Folder | Host |
|---|---|---|
| Main site | `Frontend/` | Vercel (already deployed) |
| District Profile | `Frontend/District Profile/` | Vercel (separate project) |
| Recommender API | `Backend/app.py` + `Backend/recommender.py` | Render |

## District Profile (Vercel)

1. Vercel → **Add New → Project** → import this repo again (one repo can back several Vercel projects).
2. **Root Directory**: `Frontend/District Profile`
3. Framework preset: **Vite** (build `npm run build`, output `dist` — the defaults).
4. Deploy. The map boundaries are served from `public/data/dublin_postcode_boundaries.geojson`.

## Recommender API (Render)

`Backend/Recommendation system.py` is the interactive terminal/notebook version (it uses `input()`),
so it can't run on a server. `Backend/recommender.py` is the same logic as importable functions, and
`Backend/app.py` exposes it as a FastAPI web API. Data is read from the repo's `Data/` folder.

1. Render → **New → Blueprint** → pick this repo. It reads `render.yaml` and creates the service.
   (Or **New → Web Service** manually: build `pip install -r requirements.txt`,
   start `cd Backend && gunicorn app:app -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:$PORT`.)
2. When it's live, open `https://<your-service>.onrender.com/docs` to try it.

Endpoints:
- `GET /` – health check
- `GET /options` – universities, accommodation types, factor names and rating labels for the form
- `POST /recommend` – e.g.
  ```json
  {"university": "TU Dublin - Grangegorman", "budget": 900, "accommodation": "private_room",
   "ratings": {"Rent": 1, "Commute": 2, "Shopping & Groceries": 2,
               "Restaurants": 3, "Healthcare": 4, "Recreation & Wellness": 3}}
  ```
  `accommodation` is `shared_room | private_room | one_bed | two_bed`; every factor must be rated
  1 (very important) to 4 (not important), as in `Recommendation system.py`. A category can instead
  be rated by its amenities (e.g. `"Hospitals": 4, "Pharmacies": 1` in place of `"Healthcare"`);
  `GET /options` lists them under `factor_items`.

Note: the free Render plan sleeps after ~15 min idle, so the first request after that takes ~30–60 s.
Commutes use `Data/Dublin_D1_D24_All_University_Commutes_clean_updated.csv` (all universities, same file
as `Recommendation system.py`). Until that file is uploaded, the API falls back to
`Data/Commute_TUD_Grangegorman.csv`, so only TU Dublin Grangegorman is available.

Run locally: `pip install -r requirements.txt && cd Backend && uvicorn app:app --reload`
