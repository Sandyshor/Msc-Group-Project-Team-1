"""
Web API for the Dublin area recommender.

Run locally:   uvicorn app:app --reload        (from the Backend folder)
Then open:     http://127.0.0.1:8000/docs      (interactive test page)
"""
from typing import Dict

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
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
        ..., description="1 = Very important, 2 = Important, 3 = Slightly important, 4 = Not important",
        examples=[{"Rent": 1, "Commute": 2, "Shopping & Groceries": 2, "Restaurants": 3,
                   "Healthcare": 4, "Recreation & Wellness": 3}])


@app.get("/")
def health():
    return {"status": "ok", "areas": recommender.AREAS}


@app.get("/options")
def options():
    """Everything the frontend needs to build the form."""
    return {
        "universities": DATA["universities"],
        "accommodation": {k: v[0] for k, v in DATA["rent_tables"].items()},
        "factors": [f["name"] for f in recommender.FACTORS],
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
