"""Maynooth University was added after the original landmark file: its journeys come only from the OTP files
(tools/build_commute_matrix.py --university "Maynooth University", planned on the Greater Dublin graph). It must be
a normal choice in the recommender, with its own campus location, and leave the other universities as they were."""
import pandas as pd
import pytest

import recommender

NEW = "Maynooth University"
IMPORTANCE = {name: 5 for name in ["Rent", "Safety", "Commute", "Shopping & Groceries", "Restaurants",
                                   "Healthcare", "Recreation & Wellness"]}


@pytest.fixture(scope="module")
def data():
    return recommender.load_data()


def test_new_university_is_offered(data):
    assert NEW in data["universities"]
    assert len(data["universities"]) == 16


def test_every_landmark_has_a_public_transport_time(data):
    otp = pd.read_csv(recommender._path(recommender.OTP_COMMUTE_FILE))
    landmarks = otp[["Area", "Direction", "Landmark"]].drop_duplicates()
    maynooth = otp[(otp["University"] == NEW) & (otp["Mode"] == "public_transport")]
    assert len(maynooth) == len(landmarks)
    assert maynooth["Minutes"].between(20, 180).all()


def test_new_university_gets_matches_with_its_own_location(data):
    result = recommender.recommend(data, NEW, 1200, "private_room", importance=IMPORTANCE)
    assert result["recommendations"]
    assert result["university_location"] == {"lat": 53.3842, "lon": -6.601}
    for rec in result["recommendations"]:
        assert 20 <= rec["commute_minutes"] <= 180


def test_other_universities_keep_their_journeys(data):
    points = data["commute_points"]
    counts = points[points["University"] != NEW].groupby("University").size()
    assert counts.nunique() == 1  # every original university still has the same set of start points
