"""Where the backend reads its data from: PostgreSQL when DATABASE_URL is set, otherwise the data files.

Each data file the website uses is one table in the database (FILE_TABLES below). The files in the repository
stay the source: they are versioned in Git and refreshed by the weekly jobs. On startup, connect() copies any
file that changed since the last copy into its table (a file's SHA-256 is kept in the data_files table), then
every read comes from the database.

If DATABASE_URL isn't set, or the database can't be reached, everything is read from the files as before, so a
database problem never takes the website down. /health shows which one is in use.

Load or refresh the database by hand (e.g. from a laptop):
    DATABASE_URL=postgresql://USER:PASSWORD@SERVER:5432/findmydublin?sslmode=require python datastore.py
"""
import hashlib
import json
import logging
import os
import sys
from datetime import datetime, timezone

import numpy as np
import pandas as pd

log = logging.getLogger("datastore")

BACKEND = os.path.dirname(os.path.abspath(__file__))

# Data file -> table. Only the files the website reads (recommender.py); old copies in Data/ are left out.
FILE_TABLES = {
    # Data/
    "amenities_osm.csv": "amenities",
    "RTB_latest.csv": "rtb_rents",
    "Dublin_Census_Filled.xlsx": "census",
    "Dublin_Ethnicity_D1_D24.xlsx": "ethnicity",
    "Dublin_D1_D24_All_University_Commutes_clean_updated.csv": "university_commutes",
    "Commute_TUD_Grangegorman.csv": "commutes_tud_grangegorman",
    "Dublin_D1_D24_Walking_Distance_and_Time_to_University.xlsx": "walking_times",
    "commute_otp.csv": "commute_otp",
    "commute_otp_neighbourhoods.csv": "commute_otp_neighbourhoods",
    "letting_agencies.csv": "letting_agencies",
    **{f"{area}.xlsx": f"room_listings_{area.lower()}" for area in
       ["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9", "D10", "D11", "D12", "D13", "D14", "D15", "D16",
        "D17", "D18", "D20", "D22", "D24"]},
    # Backend/data/safety/
    "safety_indicators.csv": "safety_districts",
    "safety_context.csv": "safety_context",
    "safety_neighbourhoods.csv": "safety_neighbourhoods",
    "safety_eds.csv": "safety_eds",
    "district_station_shares.csv": "safety_district_stations",
    "neighbourhoods.csv": "neighbourhood_places",
    "safety_map_areas.geojson": "safety_map_areas",
    "safety_map_districts.geojson": "safety_map_districts",
    # Backend/data/accommodation/
    "student_residences.csv": "student_residences",
    "student_residence_prices.csv": "student_residence_prices",
    "student_residence_rooms.csv": "student_residence_rooms",
}
# How each file is read, the same with or without the database
READ_OPTIONS = {
    "RTB_latest.csv": {"low_memory": False},
    "letting_agencies.csv": {"dtype": str},
}
# Folders the files are in (DATA_FOLDER can be moved with an environment variable, as in recommender.py)
FOLDERS = [
    os.environ.get("DATA_FOLDER", os.path.join(BACKEND, "..", "Data")),
    os.path.join(BACKEND, "data", "safety"),
    os.path.join(BACKEND, "data", "accommodation"),
]
LOCK_ID = 7_310_442  # any fixed number: lets only one worker copy files at a time
# Raise when the way files are copied changes, so every table is copied again
FORMAT = "1"
# Each table keeps the file's row order in this column (a database returns rows in no fixed order)
ROW = "_row"

_engine = None
_tables = set()  # tables that are in the database; empty = reading the files
source = "files"


def _url():
    url = os.environ.get("DATABASE_URL", "").strip()
    # Azure and Heroku style addresses -> the driver SQLAlchemy needs
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg2://" + url[len(prefix):]
    return url


def _table(path):
    return FILE_TABLES.get(os.path.basename(path))


def _sha256(path):
    h = hashlib.sha256(f"format {FORMAT}\n".encode())
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _read_file(path):
    """The file as a table. A GeoJSON file becomes one row per feature (properties and geometry as JSON)."""
    name = os.path.basename(path)
    if name.endswith(".geojson"):
        with open(path) as f:
            features = json.load(f)["features"]
        return pd.DataFrame({"properties": [f["properties"] for f in features],
                             "geometry": [f["geometry"] for f in features]})
    if name.endswith(".xlsx"):
        return pd.read_excel(path, **READ_OPTIONS.get(name, {}))
    return pd.read_csv(path, **READ_OPTIONS.get(name, {}))


def data_files():
    """Every data file the website uses that exists: {file name: path}."""
    found = {}
    for folder in FOLDERS:
        for name in FILE_TABLES:
            path = os.path.join(folder, name)
            if name not in found and os.path.exists(path):
                found[name] = path
    return found


def sync(engine, files):
    """Copy each file whose SHA-256 differs from its last copy into its table. Returns the names copied."""
    from sqlalchemy import text
    from sqlalchemy.dialects.postgresql import JSONB

    copied = []
    with engine.begin() as conn:
        conn.execute(text("SELECT pg_advisory_xact_lock(:id)"), {"id": LOCK_ID})
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS data_files (
                table_name  text PRIMARY KEY,
                source_file text NOT NULL,
                sha256      text NOT NULL,
                row_count   integer NOT NULL,
                loaded_at   timestamptz NOT NULL
            )"""))
        loaded = dict(conn.execute(text("SELECT table_name, sha256 FROM data_files")).all())
        for name, path in files.items():
            table, digest = FILE_TABLES[name], _sha256(path)
            if loaded.get(table) == digest:
                continue
            df = _read_file(path)
            too_long = [c for c in df.columns if len(str(c).encode()) > 63]
            if too_long:  # PostgreSQL would shorten these names and the website wouldn't find them
                raise ValueError(f"{name}: column names longer than 63 bytes: {too_long}")
            json_columns = {c: JSONB for c in ("properties", "geometry")} if name.endswith(".geojson") else None
            df.insert(0, ROW, range(len(df)))
            df.to_sql(table, conn, if_exists="replace", index=False, dtype=json_columns)
            conn.execute(text(f'ALTER TABLE "{table}" ADD PRIMARY KEY ("{ROW}")'))
            conn.execute(text("""
                INSERT INTO data_files (table_name, source_file, sha256, row_count, loaded_at)
                VALUES (:t, :f, :s, :n, :at)
                ON CONFLICT (table_name) DO UPDATE SET source_file = :f, sha256 = :s, row_count = :n, loaded_at = :at"""),
                {"t": table, "f": os.path.relpath(path, os.path.join(BACKEND, "..")), "s": digest, "n": len(df),
                 "at": datetime.now(timezone.utc)})
            copied.append(name)
    return copied


def connect():
    """Use PostgreSQL if DATABASE_URL is set and reachable (copying changed files first); otherwise the files."""
    global _engine, _tables, source
    url = _url()
    if not url:
        return source
    try:
        from sqlalchemy import create_engine, inspect

        engine = create_engine(url, pool_pre_ping=True, connect_args={"connect_timeout": 15})
        files = data_files()
        copied = sync(engine, files)
        if copied:
            log.warning("Copied into PostgreSQL: %s", ", ".join(copied))
        # Only tables whose file is still in the repository: a deleted or renamed file stops being used,
        # exactly as without the database
        in_use = {FILE_TABLES[name] for name in files} & set(inspect(engine).get_table_names())
        _engine, _tables, source = engine, in_use, "postgresql"
    except Exception as e:  # noqa: BLE001 - the website keeps working from the files
        log.error("PostgreSQL not available, reading the data files instead: %s", e)
        _engine, _tables, source = None, set(), "files"
    return source


def _from_db(path):
    return _engine is not None and _table(path) in _tables


def exists(path):
    return _from_db(path) or os.path.exists(path)


def _select(path):
    from sqlalchemy import text

    with _engine.connect() as conn:
        df = pd.read_sql_query(text(f'SELECT * FROM "{_table(path)}" ORDER BY "{ROW}"'), conn).drop(columns=ROW)
    # Empty text cells come back as None; the files give NaN. Keep them the same.
    text_columns = df.columns[df.dtypes == object]
    df[text_columns] = df[text_columns].where(df[text_columns].notna(), np.nan)
    return df


def read_csv(path):
    if _from_db(path):
        return _select(path)
    return pd.read_csv(path, **READ_OPTIONS.get(os.path.basename(path), {}))


def read_excel(path):
    if _from_db(path):
        return _select(path)
    return pd.read_excel(path, **READ_OPTIONS.get(os.path.basename(path), {}))


def read_geojson(path):
    if _from_db(path):
        df = _select(path)
        return {"type": "FeatureCollection",
                "features": [{"type": "Feature", "properties": p, "geometry": g}
                             for p, g in zip(df["properties"], df["geometry"])]}
    with open(path) as f:
        return json.load(f)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    if not _url():
        sys.exit("Set DATABASE_URL first, e.g. postgresql://USER:PASSWORD@SERVER:5432/findmydublin?sslmode=require")
    print(f"Data source: {connect()}")
    if _engine is not None:
        from sqlalchemy import text

        with _engine.connect() as conn:
            for row in conn.execute(text("SELECT table_name, row_count, source_file FROM data_files ORDER BY 1")):
                print(f"  {row.table_name:32s} {row.row_count:>7,} rows  <- {row.source_file}")
