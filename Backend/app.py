from pathlib import Path
from typing import Dict, List
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
import recommender
import translator

app = FastAPI(title="Crib Crew – Dublin Area Recommender API", version="1.0")

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

DATA = recommender.load_data() 


class RecommendRequest(BaseModel):
    university: str = Field(..., examples=["TU Dublin - Grangegorman"])
    language: str = Field("en", examples=["es"], description="Language code, e.g. en, es, hi, zh-Hans, pt")
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
        "factor_items": {f["name"]: [i["name"] for i in f["items"]]
                         for f in recommender.FACTORS if f["kind"] == "group"},
        "ratings": recommender.RATING_LABELS,
    }


@app.post("/recommend")
def recommend(req: RecommendRequest):
    if any(r not in (1, 2, 3, 4) for r in req.ratings.values()):
        raise HTTPException(422, "Each rating must be 1, 2, 3 or 4")
    try:
        result = recommender.recommend(DATA, req.university, req.budget, req.accommodation, req.ratings)
    except recommender.RecommendationError as e:
        raise HTTPException(422, str(e))

    if req.language != "en":
        recs = result["recommendations"]
        texts = [r["why"] for r in recs] + [r["profile"] for r in recs]
        if result.get("warning"):
            texts.append(result["warning"])
        try:
            done = translator.translate(texts, req.language)
        except Exception:
            return result
        for i, r in enumerate(recs):
            r["why"] = done[i]
            r["profile"] = done[len(recs) + i]
        if result.get("warning"):
            result["warning"] = done[-1]
    return result


FRONTEND_DIR = (Path(__file__).resolve().parent.parent / "Frontend" / "dist")

if FRONTEND_DIR.is_dir():
    @app.get("/{path:path}", include_in_schema=False)
    def website(path: str):
        file = (FRONTEND_DIR / path).resolve()
        if path and file.is_file() and file.is_relative_to(FRONTEND_DIR):
            if file.parent.name == "assets":
                return FileResponse(file, headers={"Cache-Control": "public, max-age=31536000, immutable"})
            return FileResponse(file, headers={"Cache-Control": "no-cache"})
        # App routes like /results or /districts are handled by React. no-cache makes
        # browsers re-check index.html, so a new deploy shows up on the next visit.
        return FileResponse(FRONTEND_DIR / "index.html", headers={"Cache-Control": "no-cache"})
else:
    app.get("/")(health)
