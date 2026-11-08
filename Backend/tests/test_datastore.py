"""datastore.py: the website reads the same data from PostgreSQL as from the files.

The database tests run only when TEST_DATABASE_URL points at an empty test database, e.g.
    TEST_DATABASE_URL=postgresql://postgres@localhost:5432/findmydublin_test python -m pytest tests/test_datastore.py
"""
import json
import os
import re

import pandas as pd
import pytest

import datastore

TEST_DB = os.environ.get("TEST_DATABASE_URL")


@pytest.fixture(autouse=True)
def back_to_the_files():
    """Each test starts and ends reading the files, so other tests' temporary files aren't replaced by tables."""
    yield
    datastore._engine, datastore._tables, datastore.source = None, set(), "files"


def test_table_names_are_unique_and_valid_postgresql_names():
    tables = list(datastore.FILE_TABLES.values())
    assert len(tables) == len(set(tables))
    assert all(re.fullmatch(r"[a-z][a-z0-9_]{0,62}", t) for t in tables)


def test_every_file_the_website_reads_is_found():
    found = datastore.data_files()
    # the Grangegorman-only commute file is just a fallback for the all-university one
    assert set(datastore.FILE_TABLES) - set(found) <= {"Commute_TUD_Grangegorman.csv"}


def test_without_a_database_the_files_are_read(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    assert datastore.connect() == "files"
    path = datastore.data_files()["safety_indicators.csv"]
    pd.testing.assert_frame_equal(datastore.read_csv(path), pd.read_csv(path))


def test_an_unreachable_database_falls_back_to_the_files(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://nobody:wrong@127.0.0.1:1/none")
    assert datastore.connect() == "files"


@pytest.mark.skipif(not TEST_DB, reason="set TEST_DATABASE_URL to run against PostgreSQL")
def test_postgresql_returns_exactly_what_the_files_hold(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", TEST_DB)
    assert datastore.connect() == "postgresql"
    for name, path in datastore.data_files().items():
        if name.endswith(".geojson"):
            with open(path) as f:
                assert datastore.read_geojson(path)["features"] == json.load(f)["features"], name
        else:
            pd.testing.assert_frame_equal(datastore._select(path), datastore._read_file(path), obj=name)
    # a second start copies nothing
    assert datastore.sync(datastore._engine, datastore.data_files()) == []
