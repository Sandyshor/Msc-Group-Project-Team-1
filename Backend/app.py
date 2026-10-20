"""
Web API for the Dublin area recommender.

Run locally:   uvicorn app:app --reload        (from the Backend folder)
Then open:     http://127.0.0.1:8000/docs      (interactive test page)

If the website has been built (Frontend/dist exists, as in the Azure deployment),
this app also serves it, so the site and the API share one address.
"""
from pathlib import Path
from typing import Dict

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

import recommender

app = FastAPI(title="Crib Crew – Dublin Area Recommender API", version="1.0")

# Let the frontend (on any domain) call this API from the browser.
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

DATA = recommender.load_data()   # loaded once when the server starts


class RecommendRequest(BaseModel):
    university: str = Field(..., examples=["TU Dublin - Grangegorman"])
    budget: float = Field(..., gt=0, examples=[900])
    accommodation: str = Field(..., examples=["private_room"],
                               description="shared_room | private_room | one_bed | two_bed")
    ratings: Dict[str, int] = Field(
        ..., description="1 = Very important, 2 = Important, 3 = Slightly important, 4 = Not important. "
                         "A category (e.g. Healthcare) can instead be rated by its items "
                         "(e.g. Hospitals, Pharmacies) - see factor_items in /options.",
        examples=[{"Rent": 1, "Commute": 2, "Shopping & Groceries": 2, "Restaurants": 3,
                   "Healthcare": 4, "Recreation & Wellness": 3}])


@app.get("/health")
def health():
    return {"status": "ok", "areas": recommender.AREAS}


@app.get("/options")
def options():
    """Everything the frontend needs to build the form."""
    return {
        "universities": DATA["universities"],
        "accommodation": {k: v[0] for k, v in DATA["rent_tables"].items()},
        "factors": [f["name"] for f in recommender.FACTORS],
        # Categories that can optionally be rated per amenity instead of as a whole.
        "factor_items": {f["name"]: [i["name"] for i in f["items"]]
                         for f in recommender.FACTORS if f["kind"] == "group"},
        "ratings": recommender.RATING_LABELS,
    }


@app.post("/recommend")
def recommend(req: RecommendRequest):
    if any(r not in (1, 2, 3, 4) for r in req.ratings.values()):
        raise HTTPException(422, "Each rating must be 1, 2, 3 or 4")
    try:
        return recommender.recommend(DATA, req.university, req.budget, req.accommodation, req.ratings)
    except recommender.RecommendationError as e:
        raise HTTPException(422, str(e))


# Website (Frontend/dist). Registered last so the API routes above take priority.
FRONTEND_DIR = (Path(__file__).resolve().parent.parent / "Frontend" / "dist")

if FRONTEND_DIR.is_dir():
    @app.get("/{path:path}", include_in_schema=False)
    def website(path: str):
        file = (FRONTEND_DIR / path).resolve()
        if path and file.is_file() and file.is_relative_to(FRONTEND_DIR):
            if file.parent.name == "assets":
                # Vite gives these a new hashed name on every build, so they never go stale.
                return FileResponse(file, headers={"Cache-Control": "public, max-age=31536000, immutable"})
            return FileResponse(file, headers={"Cache-Control": "no-cache"})
        # App routes like /results or /districts are handled by React. no-cache makes
        # browsers re-check index.html, so a new deploy shows up on the next visit.
        return FileResponse(FRONTEND_DIR / "index.html", headers={"Cache-Control": "no-cache"})
else:
    app.get("/")(health)
