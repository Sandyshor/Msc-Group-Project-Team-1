"""Logged-in students: their name, their recent searches and their chats with the assistant, kept in PostgreSQL.

Firebase does the logging in and keeps the passwords; this database never sees a password. The website sends
the student's Firebase ID token with each request, and every request is checked against Google's public keys,
so a student can only ever read or change their own history.

Needs FIREBASE_PROJECT_ID (App Service setting, same value as the website's VITE_FIREBASE_PROJECT_ID) and the
PostgreSQL database (DATABASE_URL, see datastore.py). Without either, these endpoints answer 503 and the website
simply doesn't show history.

Tables (created here; not data files, so datastore.sync never touches them):
    app_users       one row per student: Firebase user id, name, email, first and last login
    search_history  one row per search: the questionnaire answers and the top areas it found
    chat_conversations  one row per conversation with the AI assistant: its title (the first question) and messages,
                    so a student can pick any of their recent chats up again, on any device
                    (replaces the older one-chat-per-student chat_history table, whose rows are moved over once)
    saved_areas     one row per area the student saved from their results ("Save area"), with the figures shown
                    when they saved it, so areas from different searches can be compared side by side

A student can delete their account (DELETE /account): their rows in all four tables are removed.
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
CHAT_KEPT = 40              # messages kept per conversation (the oldest are dropped)
CHATS_KEPT = 10             # conversations kept per student (the oldest are deleted)
MAX_CHAT_MESSAGE = 8_000    # characters per message (the assistant's longest replies are well under this)
SAVED_AREAS_KEPT = 20       # saved areas per student (the oldest are deleted)
RECENT_LOGIN_SECONDS = 300  # deleting an account needs a password typed in the last 5 minutes, not just any token

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
                CREATE TABLE IF NOT EXISTS chat_conversations (
                    id         bigserial PRIMARY KEY,
                    uid        text NOT NULL REFERENCES app_users (uid) ON DELETE CASCADE,
                    title      text NOT NULL,
                    created_at timestamptz NOT NULL,
                    updated_at timestamptz NOT NULL,
                    messages   jsonb NOT NULL
                )"""))
            conn.execute(text("CREATE INDEX IF NOT EXISTS chat_conversations_uid_time ON chat_conversations (uid, updated_at DESC)"))
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS saved_areas (
                    id         bigserial PRIMARY KEY,
                    uid        text NOT NULL REFERENCES app_users (uid) ON DELETE CASCADE,
                    place_key  text NOT NULL,
                    created_at timestamptz NOT NULL,
                    area       jsonb NOT NULL,
                    UNIQUE (uid, place_key)
                )"""))
            # The first version kept one chat per student in chat_history: move those chats over, once
            conn.execute(text("SELECT pg_advisory_xact_lock(20261115)"))  # only one worker moves them
            if conn.execute(text("SELECT to_regclass('chat_history')")).scalar() is not None:
                conn.execute(text("""
                    INSERT INTO chat_conversations (uid, title, created_at, updated_at, messages)
                    SELECT uid, LEFT(COALESCE(messages -> 0 ->> 'content', 'Chat'), 60), updated_at, updated_at, messages
                    FROM chat_history"""))
                conn.execute(text("DROP TABLE chat_history"))
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


class SavedArea(BaseModel):
    """One area from the student's results, with the figures the results page showed for it."""
    area: str = Field(..., max_length=10, description="District or County Dublin area code, e.g. D7")
    neighbourhood: Optional[str] = Field(None, max_length=80, description="e.g. Stoneybatter")
    lat: Optional[float] = Field(None, ge=52.5, le=54.5)
    lon: Optional[float] = Field(None, ge=-7.5, le=-5.5)
    university: str = Field(..., max_length=160)
    accommodation: str = Field(..., max_length=80, description="The room type as the website names it")
    budget: Optional[float] = Field(None, ge=0, le=100_000)
    rent: Optional[float] = Field(None, ge=0, le=100_000)
    travel_mode: str = Field("public_transport", max_length=30)
    commute_minutes: Optional[int] = Field(None, ge=0, le=600)
    walk_faster: bool = False
    safety: Optional[float] = Field(None, ge=0, le=100)
    match_score: Optional[float] = Field(None, ge=0, le=100)
    answers: dict = Field(default_factory=dict, description="The search it came from, to open it again")


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


def _chat_title(messages):
    """The conversation's first question, shortened: what the chat list shows."""
    first = next((m["content"] for m in messages if m["role"] == "user"), "Chat")
    first = " ".join(first.split())
    return first if len(first) <= 60 else first[:59].rstrip() + "…"


def _clean(messages):
    return [m.model_dump() for m in messages if m.content.strip()][-CHAT_KEPT:]


@router.get("/chats")
def list_chats(authorization: Optional[str] = Header(None)):
    """The student's recent conversations, newest first (titles only)."""
    from sqlalchemy import text

    engine = _engine()
    claims = _student(authorization)
    with engine.connect() as conn:
        rows = conn.execute(text("""
            SELECT id, title, updated_at, jsonb_array_length(messages) AS count FROM chat_conversations
            WHERE uid = :uid ORDER BY updated_at DESC, id DESC LIMIT :limit"""),
            {"uid": claims["sub"], "limit": CHATS_KEPT}).mappings()
        return {"chats": [{"id": r["id"], "title": r["title"], "updated_at": r["updated_at"].isoformat(),
                           "messages": r["count"]} for r in rows]}


@router.get("/chats/{chat_id}")
def load_chat(chat_id: int, authorization: Optional[str] = Header(None)):
    from sqlalchemy import text

    engine = _engine()
    claims = _student(authorization)
    with engine.connect() as conn:
        row = conn.execute(text("SELECT id, title, messages FROM chat_conversations WHERE id = :id AND uid = :uid"),
                           {"id": chat_id, "uid": claims["sub"]}).first()
    if row is None:
        raise HTTPException(404, "That chat isn't there any more.")
    return {"id": row.id, "title": row.title, "messages": row.messages}


@router.post("/chats")
def new_chat(body: ChatRequest, authorization: Optional[str] = Header(None)):
    """Save a new conversation; returns its id. Only the student's most recent CHATS_KEPT chats are kept."""
    from sqlalchemy import text

    engine = _engine()
    claims = _student(authorization)
    messages = _clean(body.messages)
    if not messages:
        raise HTTPException(422, "There's nothing to save in that chat.")
    now = datetime.now(timezone.utc)
    with engine.begin() as conn:
        _upsert_user(conn, claims)
        chat_id = conn.execute(text("""
            INSERT INTO chat_conversations (uid, title, created_at, updated_at, messages)
            VALUES (:uid, :title, :now, :now, CAST(:messages AS jsonb)) RETURNING id"""),
            {"uid": claims["sub"], "title": _chat_title(messages), "now": now,
             "messages": json.dumps(messages)}).scalar_one()
        conn.execute(text("""
            DELETE FROM chat_conversations WHERE uid = :uid AND id NOT IN (
                SELECT id FROM chat_conversations WHERE uid = :uid ORDER BY updated_at DESC, id DESC LIMIT :keep)"""),
            {"uid": claims["sub"], "keep": CHATS_KEPT})
    return {"id": chat_id}


@router.put("/chats/{chat_id}")
def save_chat(chat_id: int, body: ChatRequest, authorization: Optional[str] = Header(None)):
    """Replace a conversation's messages (its last CHAT_KEPT, without empty ones)."""
    from sqlalchemy import text

    engine = _engine()
    claims = _student(authorization)
    messages = _clean(body.messages)
    with engine.begin() as conn:
        if not messages:
            conn.execute(text("DELETE FROM chat_conversations WHERE id = :id AND uid = :uid"),
                         {"id": chat_id, "uid": claims["sub"]})
            return {"id": chat_id}
        found = conn.execute(text("""
            UPDATE chat_conversations SET messages = CAST(:messages AS jsonb), title = :title, updated_at = :now
            WHERE id = :id AND uid = :uid RETURNING id"""),
            {"messages": json.dumps(messages), "title": _chat_title(messages), "now": datetime.now(timezone.utc),
             "id": chat_id, "uid": claims["sub"]}).first()
    if found is None:
        raise HTTPException(404, "That chat isn't there any more.")
    return {"id": chat_id}


@router.delete("/chats/{chat_id}")
def delete_chat(chat_id: int, authorization: Optional[str] = Header(None)):
    from sqlalchemy import text

    engine = _engine()
    claims = _student(authorization)
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM chat_conversations WHERE id = :id AND uid = :uid"),
                     {"id": chat_id, "uid": claims["sub"]})
    return {"deleted": chat_id}


@router.delete("/chats")
def delete_all_chats(authorization: Optional[str] = Header(None)):
    from sqlalchemy import text

    engine = _engine()
    claims = _student(authorization)
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM chat_conversations WHERE uid = :uid"), {"uid": claims["sub"]})
    return {"cleared": True}


def _place_key(area):
    """The same place for the same kind of search: saving it again updates it rather than adding a copy."""
    return "|".join([area.area, area.neighbourhood or "", area.university, area.accommodation, area.travel_mode]).lower()


@router.get("/saved-areas")
def saved_areas(authorization: Optional[str] = Header(None)):
    """The areas the student saved, newest first."""
    from sqlalchemy import text

    engine = _engine()
    claims = _student(authorization)
    with engine.connect() as conn:
        rows = conn.execute(text("""
            SELECT id, created_at, area FROM saved_areas WHERE uid = :uid
            ORDER BY created_at DESC, id DESC LIMIT :limit"""), {"uid": claims["sub"], "limit": SAVED_AREAS_KEPT}).mappings()
        return {"areas": [{**r["area"], "id": r["id"], "saved_at": r["created_at"].isoformat()} for r in rows]}


@router.post("/saved-areas")
def save_area(body: SavedArea, authorization: Optional[str] = Header(None)):
    """Save an area from the results. Only the student's SAVED_AREAS_KEPT most recent are kept."""
    from sqlalchemy import text

    engine = _engine()
    claims = _student(authorization)
    area = body.model_dump()
    if len(json.dumps(area["answers"]).encode()) > MAX_ANSWERS_BYTES:
        raise HTTPException(413, "That search is too big to save.")
    with engine.begin() as conn:
        _upsert_user(conn, claims)
        saved_id = conn.execute(text("""
            INSERT INTO saved_areas (uid, place_key, created_at, area) VALUES (:uid, :key, :now, CAST(:area AS jsonb))
            ON CONFLICT (uid, place_key) DO UPDATE SET created_at = EXCLUDED.created_at, area = EXCLUDED.area
            RETURNING id"""),
            {"uid": claims["sub"], "key": _place_key(body), "now": datetime.now(timezone.utc),
             "area": json.dumps(area)}).scalar_one()
        conn.execute(text("""
            DELETE FROM saved_areas WHERE uid = :uid AND id NOT IN (
                SELECT id FROM saved_areas WHERE uid = :uid ORDER BY created_at DESC, id DESC LIMIT :keep)"""),
            {"uid": claims["sub"], "keep": SAVED_AREAS_KEPT})
    return {"id": saved_id}


@router.delete("/saved-areas/{saved_id}")
def remove_saved_area(saved_id: int, authorization: Optional[str] = Header(None)):
    from sqlalchemy import text

    engine = _engine()
    claims = _student(authorization)
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM saved_areas WHERE id = :id AND uid = :uid"), {"id": saved_id, "uid": claims["sub"]})
    return {"deleted": saved_id}


@router.delete("")
def delete_account(authorization: Optional[str] = Header(None)):
    """Delete the student and everything saved for them: their name and email, searches, chats and saved areas.

    The website asks for the password again first, so the token must come from a login in the last
    RECENT_LOGIN_SECONDS: a token left open on a shared computer can't delete the account. The website then
    deletes the login itself from Firebase, which keeps the password.
    """
    from sqlalchemy import text

    engine = _engine()
    claims = _student(authorization)
    if time.time() - float(claims.get("auth_time", 0)) > RECENT_LOGIN_SECONDS:
        raise HTTPException(401, "Please type your password again to delete your account.")
    with engine.begin() as conn:
        # searches and chats would also go with the student (ON DELETE CASCADE); deleted here too to be plain
        for table in ("search_history", "chat_conversations", "saved_areas", "app_users"):
            conn.execute(text(f"DELETE FROM {table} WHERE uid = :uid"), {"uid": claims["sub"]})
    return {"deleted": True}
