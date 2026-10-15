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
- `GET /options` – accommodation types, factor names and rating labels for the form
- `POST /recommend` – e.g.
  ```json
  {"budget": 900, "accommodation": "private_room",
   "ratings": {"Rent": 1, "Commute": 2, "Shopping & Groceries": 2,
               "Restaurants": 3, "Healthcare": 4, "Recreation & Wellness": 3}}
  ```
  `accommodation` is `shared_room | private_room | one_bed | two_bed`; ratings are 1 (very important) to
  4 (not important); factors left out count as 4.

Note: the free Render plan sleeps after ~15 min idle, so the first request after that takes ~30–60 s.
Only the TU Dublin Grangegorman commute file is in `Data/`, so commutes are to that campus.

Run locally: `pip install -r requirements.txt && cd Backend && uvicorn app:app --reload`
