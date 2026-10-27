"""Tests for build_safety_context.py: night timetable counting and OSM lighting tags."""
import datetime as dt

import pytest

import build_safety_context as bsc

WED = dt.date(2026, 10, 28)


@pytest.fixture
def gtfs_dir(tmp_path):
    """A tiny feed: a weekday service, a Thursday-only service, and one stop."""
    (tmp_path / "calendar.txt").write_text(
        "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n"
        "WK,1,1,1,1,1,0,0,20261001,20271001\n"
        "THU,0,0,0,1,0,0,0,20261001,20271001\n")
    (tmp_path / "calendar_dates.txt").write_text("service_id,date,exception_type\n")
    (tmp_path / "trips.txt").write_text("trip_id,service_id\nwk_trip,WK\nthu_trip,THU\n")
    (tmp_path / "stop_times.txt").write_text(
        "trip_id,departure_time,stop_id\n"
        "wk_trip,22:59:00,S1\n"      # before the window
        "wk_trip,23:00:00,S1\n"      # Wed night
        "wk_trip,25:30:00,S1\n"      # 01:30 Thu, written on Wednesday's service day
        "wk_trip,28:59:00,S1\n"      # 04:59 Thu
        "wk_trip,29:00:00,S1\n"      # 05:00 Thu - after the window
        "thu_trip,03:15:00,S1\n"     # Thursday's own early trip - counts for Wednesday night
        "thu_trip,23:30:00,S1\n"     # Thursday night - not Wednesday's
        "wk_trip,23:10:00,OTHER\n")  # stop not asked for
    return tmp_path


def test_night_departures_window_spans_midnight(gtfs_dir):
    assert bsc.night_departures(bsc.Gtfs(gtfs_dir), {"S1"}, WED).to_dict() == {"S1": 4}


def test_night_departures_respects_removed_service(gtfs_dir):
    (gtfs_dir / "calendar_dates.txt").write_text("service_id,date,exception_type\nWK,20261028,2\n")
    assert bsc.night_departures(bsc.Gtfs(gtfs_dir), {"S1"}, WED).to_dict() == {"S1": 1}  # only Thursday's 03:15


@pytest.mark.parametrize("tags, expected", [
    ('"lit"=>"yes"', "yes"), ('"surface"=>"asphalt","lit"=>"24/7"', "yes"),
    ('"lit"=>"no"', "no"), ('"surface"=>"asphalt"', "unknown"), (None, "unknown"), (float("nan"), "unknown"),
])
def test_lit_value(tags, expected):
    assert bsc.lit_value(tags) == expected


def test_default_night_is_next_wednesday():
    assert bsc.default_night(dt.date(2026, 10, 26)) == WED          # Monday -> this Wednesday
    assert bsc.default_night(WED) == dt.date(2026, 11, 4)           # Wednesday -> next week
