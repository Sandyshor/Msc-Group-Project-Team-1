"""Logged-in students: their name, their recent searches and their chat with the assistant, kept in PostgreSQL.

Firebase does the logging in and keeps the passwords; this database never sees a password. The website sends
the student's Firebase ID token with each request, and every request is checked against Google's public keys,
so a student can only ever read or change their own history.

Needs FIREBASE_PROJECT_ID (App Service setting, same value as the website's VITE_FIREBASE_PROJECT_ID) and the
PostgreSQL database (DATABASE_URL, see datastore.py). Without either, these endpoints answer 503 and the website
simply doesn't show history.

Tables (created here; not data files, so datastore.sync never touches them):
    app_users       one row per student: Firebase user id, name, email, first and last login
    search_history  one row per search: the questionnaire answers and the top areas it found
    chat_history    one row per student: their latest conversation with the AI assistant (so it's there next time,
                    on any device); deleted when they start a new chat
"""
import json
import os
import threading
import time
from datetime import datetime, timezone
from typing import List, Literal, Optional

import requests
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

import datastore

router = APIRouter(prefix="/account", tags=["account"])

# Google's public keys that sign Firebase ID tokens
CERTS_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com"
HISTORY_KEPT = 20          # older searches are deleted
HISTORY_SHOWN = 10
MAX_ANSWERS_BYTES = 10_000  # a questionnaire is about 1 KB; anything far bigger isn't one
CHAT_KEPT = 40              # messages of the latest conversation kept (the oldest are dropped)
MAX_CHAT_MESSAGE = 8_000    # characters per message (the assistant's longest replies are well under this)

_certs = {"keys": None, "until": 0.0}
_certs_lock = threading.Lock()
_tables_ready = False


def _project_id():
    return os.environ.get("FIREBASE_PROJECT_ID", "").strip()


def _google_certs():
    """Google's signing certificates, kept for the time Google says they're valid (default 1 hour)."""
    with _certs_lock:
        if _certs["keys"] is None or time.time() >= _certs["until"]:
            response = requests.get(CERTS_URL, timeout=10)
            response.raise_for_status()
            max_age = 3600
            for part in response.headers.get("Cache-Control", "").split(","):
                if part.strip().startswith("max-age="):
                    max_age = int(part.strip()[8:])
            _certs["keys"], _certs["until"] = response.json(), time.time() + max_age
        return _certs["keys"]


def verify_token(token):
    """The token's claims if it's a valid Firebase ID token for this project; raises ValueError otherwise."""
    from google.auth import jwt

    project = _project_id()
    claims = jwt.decode(token, certs=_google_certs(), audience=project)  # checks signature, expiry, audience
    if claims.get("iss") != f"https://securetoken.google.com/{project}" or not claims.get("sub"):
        raise ValueError("not a Firebase ID token for this project")
    return claims


def _engine():
    """The database, with the two tables in place; 503 if accounts aren't set up."""
    global _tables_ready
    engine = datastore.engine()
    if engine is None or not _project_id():
        raise HTTPException(503, "Saved searches aren't available right now.")
    if not _tables_ready:
        from sqlalchemy import text

        with engine.begin() as conn:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS app_users (
                    uid           text PRIMARY KEY,
                    email         text,
                    name          text,
                    created_at    timestamptz NOT NULL,
                    last_login_at timestamptz NOT NULL
                )"""))
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS search_history (
                    id         bigserial PRIMARY KEY,
                    uid        text NOT NULL REFERENCES app_users (uid) ON DELETE CASCADE,
                    created_at timestamptz NOT NULL,
                    answers    jsonb NOT NULL,
                    top_areas  jsonb NOT NULL
                )"""))
            conn.execute(text("CREATE INDEX IF NOT EXISTS search_history_uid_time ON search_history (uid, created_at DESC)"))
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS chat_history (
                    uid        text PRIMARY KEY REFERENCES app_users (uid) ON DELETE CASCADE,
                    updated_at timestamptz NOT NULL,
                    messages   jsonb NOT NULL
                )"""))
        _tables_ready = True
    return engine


def _student(authorization):
    """Claims of the logged-in student from the 'Authorization: Bearer <Firebase ID token>' header."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Please log in.")
    try:
        return verify_token(authorization[7:].strip())
    except requests.RequestException:
        raise HTTPException(503, "Couldn't check your login right now. Please try again.")
    except Exception:
        raise HTTPException(401, "Your login has expired. Please log in again.")


def _upsert_user(conn, claims, name=None, login=False):
    from sqlalchemy import text

    now = datetime.now(timezone.utc)
    conn.execute(text("""
        INSERT INTO app_users (uid, email, name, created_at, last_login_at) VALUES (:uid, :email, :name, :now, :now)
        ON CONFLICT (uid) DO UPDATE SET
            email = EXCLUDED.email,
            name = COALESCE(EXCLUDED.name, app_users.name),
            last_login_at = CASE WHEN :login THEN EXCLUDED.last_login_at ELSE app_users.last_login_at END"""),
        {"uid": claims["sub"], "email": claims.get("email"), "name": name or claims.get("name"), "now": now,
         "login": login})


def _history(conn, uid, limit=HISTORY_SHOWN):
    from sqlalchemy import text

    rows = conn.execute(text("""
        SELECT id, created_at, answers, top_areas FROM search_history
        WHERE uid = :uid ORDER BY created_at DESC, id DESC LIMIT :limit"""), {"uid": uid, "limit": limit}).mappings()
    return [{"id": r["id"], "created_at": r["created_at"].isoformat(), "answers": r["answers"],
             "top_areas": r["top_areas"]} for r in rows]


class LoginRequest(BaseModel):
    name: Optional[str] = Field(None, max_length=80, description="Name typed at sign up (the token may not have it yet)")


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., max_length=MAX_CHAT_MESSAGE)


class ChatRequest(BaseModel):
    messages: List[ChatMessage] = Field(..., max_length=200)


class SearchRequest(BaseModel):
    answers: dict = Field(..., description="The questionnaire answers, as the website keeps them")
    top_areas: List[str] = Field(default_factory=list, max_length=3, description="e.g. ['D7 · Stoneybatter', ...]")


@router.post("/login")
def login(body: LoginRequest = LoginRequest(), authorization: Optional[str] = Header(None)):
    """Record the login (creates the student on their first one); returns their name and recent searches."""
    engine = _engine()
    claims = _student(authorization)
    name = (body.name or "").strip() or None
    with engine.begin() as conn:
        _upsert_user(conn, claims, name, login=True)
        from sqlalchemy import text

        saved = conn.execute(text("SELECT name, email FROM app_users WHERE uid = :uid"), {"uid": claims["sub"]}).one()
        return {"name": saved.name, "email": saved.email, "history": _history(conn, claims["sub"])}


@router.get("/history")
def history(authorization: Optional[str] = Header(None)):
    engine = _engine()
    claims = _student(authorization)
    with engine.connect() as conn:
        return {"history": _history(conn, claims["sub"])}


@router.post("/history")
def save_search(body: SearchRequest, authorization: Optional[str] = Header(None)):
    """Save a search. Answers already in the history just move that search to the top (no duplicates), e.g. when
    a student reopens an older search."""
    from sqlalchemy import text

    engine = _engine()
    claims = _student(authorization)
    answers = json.dumps(body.answers, sort_keys=True)
    if len(answers.encode()) > MAX_ANSWERS_BYTES:
        raise HTTPException(413, "That search is too big to save.")
    top = json.dumps([str(a)[:80] for a in body.top_areas[:3]])
    now = datetime.now(timezone.utc)
    with engine.begin() as conn:
        _upsert_user(conn, claims)
        same = conn.execute(text("""
            SELECT id FROM search_history WHERE uid = :uid AND answers = CAST(:answers AS jsonb)
            ORDER BY created_at DESC LIMIT 1"""), {"uid": claims["sub"], "answers": answers}).first()
        if same is not None:
            conn.execute(text("UPDATE search_history SET created_at = :now, top_areas = CAST(:top AS jsonb) WHERE id = :id"),
                         {"now": now, "top": top, "id": same.id})
            saved_id = same.id
        else:
            saved_id = conn.execute(text("""
                INSERT INTO search_history (uid, created_at, answers, top_areas)
                VALUES (:uid, :now, CAST(:answers AS jsonb), CAST(:top AS jsonb)) RETURNING id"""),
                {"uid": claims["sub"], "now": now, "answers": answers, "top": top}).scalar_one()
        # keep only the most recent searches
        conn.execute(text("""
            DELETE FROM search_history WHERE uid = :uid AND id NOT IN (
                SELECT id FROM search_history WHERE uid = :uid ORDER BY created_at DESC, id DESC LIMIT :keep)"""),
            {"uid": claims["sub"], "keep": HISTORY_KEPT})
    return {"id": saved_id}


@router.delete("/history/{search_id}")
def delete_search(search_id: int, authorization: Optional[str] = Header(None)):
    from sqlalchemy import text

    engine = _engine()
    claims = _student(authorization)
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM search_history WHERE id = :id AND uid = :uid"), {"id": search_id, "uid": claims["sub"]})
    return {"deleted": search_id}


@router.delete("/history")
def clear_history(authorization: Optional[str] = Header(None)):
    from sqlalchemy import text

    engine = _engine()
    claims = _student(authorization)
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM search_history WHERE uid = :uid"), {"uid": claims["sub"]})
    return {"cleared": True}


@router.get("/chat")
def load_chat(authorization: Optional[str] = Header(None)):
    """The student's saved conversation with the assistant (empty if there isn't one)."""
    from sqlalchemy import text

    engine = _engine()
    claims = _student(authorization)
    with engine.connect() as conn:
        row = conn.execute(text("SELECT messages FROM chat_history WHERE uid = :uid"), {"uid": claims["sub"]}).first()
    return {"messages": row.messages if row else []}


@router.put("/chat")
def save_chat(body: ChatRequest, authorization: Optional[str] = Header(None)):
    """Replace the saved conversation with this one (its last CHAT_KEPT messages, without empty ones)."""
    from sqlalchemy import text

    engine = _engine()
    claims = _student(authorization)
    messages = [m.model_dump() for m in body.messages if m.content.strip()][-CHAT_KEPT:]
    with engine.begin() as conn:
        _upsert_user(conn, claims)
        if not messages:
            conn.execute(text("DELETE FROM chat_history WHERE uid = :uid"), {"uid": claims["sub"]})
        else:
            conn.execute(text("""
                INSERT INTO chat_history (uid, updated_at, messages) VALUES (:uid, :now, CAST(:messages AS jsonb))
                ON CONFLICT (uid) DO UPDATE SET updated_at = EXCLUDED.updated_at, messages = EXCLUDED.messages"""),
                {"uid": claims["sub"], "now": datetime.now(timezone.utc), "messages": json.dumps(messages)})
    return {"saved": len(messages)}


@router.delete("/chat")
def clear_chat(authorization: Optional[str] = Header(None)):
    from sqlalchemy import text

    engine = _engine()
    claims = _student(authorization)
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM chat_history WHERE uid = :uid"), {"uid": claims["sub"]})
    return {"cleared": True}
