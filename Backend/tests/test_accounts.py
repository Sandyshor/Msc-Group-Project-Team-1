"""accounts.py: saved searches for logged-in students.

Tokens are signed here with a test key standing in for Google's, so the real checks run (signature, expiry,
project). The database tests run only with TEST_DATABASE_URL (an empty test database), e.g.
    TEST_DATABASE_URL=postgresql://postgres@localhost:5432/findmydublin_test python -m pytest tests/test_accounts.py
"""
import os
import time

import pytest
import rsa
from fastapi import FastAPI
from fastapi.testclient import TestClient
from google.auth import crypt, jwt

import accounts
import datastore

PROJECT = "find-my-dublin-test"
TEST_DB = os.environ.get("TEST_DATABASE_URL")
_public, _private = rsa.newkeys(1024)
SIGNER = crypt.RSASigner.from_string(_private.save_pkcs1().decode(), key_id="test-key")
OTHER_SIGNER = crypt.RSASigner.from_string(rsa.newkeys(1024)[1].save_pkcs1().decode(), key_id="test-key")


def token(uid="student-1", email="sam@example.com", name=None, signer=SIGNER, project=PROJECT, expires_in=3600):
    now = int(time.time())
    claims = {"iss": f"https://securetoken.google.com/{project}", "aud": project, "sub": uid, "user_id": uid,
              "email": email, "iat": now - 10, "exp": now + expires_in, "auth_time": now - 10}
    if name:
        claims["name"] = name
    return jwt.encode(signer, claims).decode()


def auth(**kw):
    return {"Authorization": f"Bearer {token(**kw)}"}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("FIREBASE_PROJECT_ID", PROJECT)
    monkeypatch.setattr(accounts, "_google_certs", lambda: {"test-key": _public.save_pkcs1().decode()})
    app = FastAPI()
    app.include_router(accounts.router)
    yield TestClient(app)
    datastore._engine = None
    accounts._tables_ready = False


@pytest.fixture
def db(client):
    from sqlalchemy import create_engine, text

    engine = create_engine(TEST_DB)
    with engine.begin() as conn:
        conn.execute(text("DROP TABLE IF EXISTS chat_history"))
        conn.execute(text("DROP TABLE IF EXISTS search_history"))
        conn.execute(text("DROP TABLE IF EXISTS app_users"))
    datastore._engine = engine
    accounts._tables_ready = False
    return client


def test_without_the_database_history_is_unavailable(client):
    datastore._engine = None
    assert client.get("/account/history", headers=auth()).status_code == 503
    assert client.get("/account/chat", headers=auth()).status_code == 503


@pytest.mark.skipif(not TEST_DB, reason="set TEST_DATABASE_URL to run against PostgreSQL")
class TestWithDatabase:
    def test_a_login_is_needed(self, db):
        assert db.get("/account/history").status_code == 401
        assert db.get("/account/history", headers={"Authorization": "Bearer not-a-token"}).status_code == 401

    def test_forged_expired_or_other_project_tokens_are_refused(self, db):
        for bad in (auth(signer=OTHER_SIGNER), auth(expires_in=-3600), auth(project="someone-elses-project")):
            assert db.get("/account/history", headers=bad).status_code == 401

    def test_login_creates_the_student_and_keeps_their_name(self, db):
        first = db.post("/account/login", json={"name": "Sam Student"}, headers=auth()).json()
        assert first == {"name": "Sam Student", "email": "sam@example.com", "history": []}
        # a later login without a name keeps the one saved
        assert db.post("/account/login", json={}, headers=auth()).json()["name"] == "Sam Student"

    def test_searches_are_saved_newest_first_without_duplicates(self, db):
        h = auth()
        db.post("/account/login", json={"name": "Sam"}, headers=h)
        a = {"university": "TU Dublin - Grangegorman", "budget": 900, "accommodation": "private_room"}
        b = {**a, "budget": 1200}
        db.post("/account/history", json={"answers": a, "top_areas": ["D7 · Cabra"]}, headers=h)
        db.post("/account/history", json={"answers": b, "top_areas": ["D9 · Drumcondra"]}, headers=h)
        db.post("/account/history", json={"answers": b, "top_areas": ["D9 · Glasnevin"]}, headers=h)  # same as latest
        history = db.get("/account/history", headers=h).json()["history"]
        assert [s["answers"]["budget"] for s in history] == [1200, 900]
        assert history[0]["top_areas"] == ["D9 · Glasnevin"]
        # the next login returns them too
        assert len(db.post("/account/login", json={}, headers=h).json()["history"]) == 2
        # reopening the older search moves it to the top instead of saving it twice
        db.post("/account/history", json={"answers": a, "top_areas": ["D7 · Cabra"]}, headers=h)
        history = db.get("/account/history", headers=h).json()["history"]
        assert [s["answers"]["budget"] for s in history] == [900, 1200]

    def test_students_only_see_and_delete_their_own_searches(self, db):
        sam, alex = auth(), auth(uid="student-2", email="alex@example.com")
        saved = db.post("/account/history", json={"answers": {"budget": 900}}, headers=sam).json()["id"]
        assert db.get("/account/history", headers=alex).json()["history"] == []
        db.delete(f"/account/history/{saved}", headers=alex)
        assert len(db.get("/account/history", headers=sam).json()["history"]) == 1
        db.delete(f"/account/history/{saved}", headers=sam)
        assert db.get("/account/history", headers=sam).json()["history"] == []

    def test_clear_and_the_limit_on_kept_searches(self, db):
        h = auth()
        for budget in range(accounts.HISTORY_KEPT + 5):
            db.post("/account/history", json={"answers": {"budget": budget}}, headers=h)
        from sqlalchemy import text

        with datastore._engine.connect() as conn:
            assert conn.execute(text("SELECT count(*) FROM search_history")).scalar() == accounts.HISTORY_KEPT
        assert len(db.get("/account/history", headers=h).json()["history"]) == accounts.HISTORY_SHOWN
        db.delete("/account/history", headers=h)
        assert db.get("/account/history", headers=h).json()["history"] == []

    def test_oversized_answers_are_refused(self, db):
        huge = {"notes": "x" * (accounts.MAX_ANSWERS_BYTES + 1)}
        assert db.post("/account/history", json={"answers": huge}, headers=auth()).status_code == 413

    def test_the_chat_is_saved_per_student(self, db):
        chat = [{"role": "user", "content": "Is D8 safe?"}, {"role": "assistant", "content": "Mostly, yes. A 1-bed is €2,200 · see D8."}]
        assert db.get("/account/chat").status_code == 401
        assert db.get("/account/chat", headers=auth()).json() == {"messages": []}
        assert db.put("/account/chat", json={"messages": chat}, headers=auth()).json() == {"saved": 2}
        assert db.get("/account/chat", headers=auth()).json() == {"messages": chat}
        # another student never sees it
        assert db.get("/account/chat", headers=auth(uid="student-2", email="kim@example.com")).json() == {"messages": []}
        # saving again replaces it; empty messages are dropped and only the latest are kept
        long = [{"role": "user" if i % 2 == 0 else "assistant", "content": f"m{i}"} for i in range(50)]
        db.put("/account/chat", json={"messages": long + [{"role": "assistant", "content": "  "}]}, headers=auth())
        saved = db.get("/account/chat", headers=auth()).json()["messages"]
        assert len(saved) == accounts.CHAT_KEPT and saved[-1]["content"] == "m49"
        assert db.delete("/account/chat", headers=auth()).json() == {"cleared": True}
        assert db.get("/account/chat", headers=auth()).json() == {"messages": []}

    def test_a_chat_needs_real_messages(self, db):
        assert db.put("/account/chat", json={"messages": [{"role": "system", "content": "x"}]}, headers=auth()).status_code == 422
        too_long = [{"role": "user", "content": "x" * (accounts.MAX_CHAT_MESSAGE + 1)}]
        assert db.put("/account/chat", json={"messages": too_long}, headers=auth()).status_code == 422
