"""A university added after the original landmark file (e.g. Maynooth University, whose journeys come only from
tools/build_commute_matrix.py --university ...) becomes a normal choice in the recommender.

The real Maynooth journeys need an OpenTripPlanner graph that reaches Kildare, so here they are stand-ins:
the OTP file is read with extra rows for every landmark."""
import pandas as pd
import pytest

import datastore
import recommender

NEW = "Maynooth University"
IMPORTANCE = {name: 5 for name in ["Rent", "Safety", "Commute", "Shopping & Groceries", "Restaurants",
                                   "Healthcare", "Recreation & Wellness"]}


@pytest.fixture(scope="module")
def data():
    real_read = datastore.read_csv
    mp = pytest.MonkeyPatch()

    def read_csv(path, *args, **kwargs):
        frame = real_read(path, *args, **kwargs)
        if str(path).endswith(recommender.OTP_COMMUTE_FILE):
            starts = frame.drop_duplicates(["Area", "Direction", "Landmark"])[["Area", "Direction", "Landmark"]]
            extra = pd.concat([starts.assign(University=NEW, Mode=mode, Minutes=minutes, Distance_km=km,
                                             Transfers=1)
                               for mode, minutes, km in (("public_transport", 70.0, 30.0), ("walk", 400.0, 30.0),
                                                         ("cycle", 110.0, 30.0))], ignore_index=True)
            frame = pd.concat([frame, extra], ignore_index=True)
        return frame

    mp.setattr(datastore, "read_csv", read_csv)
    try:
        yield recommender.load_data()
    finally:
        mp.undo()


def test_new_university_is_offered(data):
    assert NEW in data["universities"]
    assert len(data["universities"]) == 16


def test_new_university_gets_matches_with_its_own_location(data):
    result = recommender.recommend(data, NEW, 1200, "private_room", importance=IMPORTANCE)
    assert result["recommendations"]
    assert result["university_location"] == {"lat": 53.3842, "lon": -6.601}
    top = result["recommendations"][0]
    assert top["commute_minutes"] == pytest.approx(70, abs=1)


def test_existing_universities_are_unchanged(data):
    clean = recommender.load_data()
    for university in clean["universities"]:
        a = clean["commute_points"][clean["commute_points"]["University"] == university]
        b = data["commute_points"][data["commute_points"]["University"] == university]
        assert len(a) == len(b)
