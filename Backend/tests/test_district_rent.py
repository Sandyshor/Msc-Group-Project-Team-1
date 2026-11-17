"""One rent everywhere: the results page and the AI assistant use the district profile's figure for each area."""
import pytest

import chat
import district_rent
import recommender

IMPORTANCE = {"Rent": 10, "Commute": 7, "Shopping & Groceries": 7, "Restaurants": 7, "Healthcare": 7,
              "Recreation & Wellness": 7}

FAKE = {
    "rent": {"D8": {"rooms": {"double": {"n": 2, "median": 866}},
                    "homes": {"1 bed": {"n": 13, "median": 2200}}}},
    "rtb": {"D8": {"district": {"all": 1893, "1 bed": 1572, "2 bed": 2004}},
            "D11": {"district": {"all": 1700}}},
    "roomReport": {"areas": {"D8": {"single": 786, "double": 903, "sharing": 630, "oneBed": 1962, "twoBed": 2444},
                             "D11": {"single": 764, "double": 893, "sharing": 620, "oneBed": 1962, "twoBed": 2444}}},
}


@pytest.fixture(scope="module")
def data():
    return recommender.load_data()


@pytest.fixture(scope="module")
def profile():
    return district_rent.load_profile_data()


def value(code, kind):
    found = district_rent.rent_for(FAKE, code, kind)
    return found and (found["value"], found["source"])


def test_the_district_profile_rule():
    assert value("D8", "double") == (866, "listings")      # the district's own listings first
    assert value("D8", "1 bed") == (2200, "listings")
    assert value("D8", "2 bed") == (2004, "rtb")           # then the RTB average for whole homes
    assert value("D8", "single") == (786, "report")        # then the Daft.ie report
    assert value("D8", "sharing") == (630, "report")
    assert value("D11", "1 bed") == (1962, "report")       # RTB has no 1-bed figure here
    assert value("D11", "3 bed") is None
    assert district_rent.rent_for(FAKE, "D8", "1 bed")["note"] == "median of 13 Daft listings"


def test_search_choices_use_the_matching_profile_size():
    assert district_rent.SEARCH_KIND == {"private_room": "single", "shared_room": "sharing",
                                         "one_bed": "1 bed", "two_bed": "2 bed"}


@pytest.mark.parametrize("search", sorted(district_rent.SEARCH_KIND))
def test_the_recommender_uses_the_district_profile_rent(data, profile, search):
    table = data["rent_tables"][search][1]
    expected = district_rent.rent_table(profile, search)
    compared = set(data["area_data"]["Area"]) & set(expected)
    assert compared, "no areas to compare"
    for area in compared:
        assert table[area] == expected[area]["value"], area


@pytest.mark.parametrize("search, budget", [("private_room", 900), ("shared_room", 700), ("one_bed", 2000),
                                            ("two_bed", 2500)])
def test_every_result_shows_its_district_profile_rent(data, profile, search, budget):
    out = recommender.recommend(data, "TU Dublin - Grangegorman", budget, search, importance=IMPORTANCE, top_n=50)
    expected = district_rent.rent_table(profile, search)
    assert out["recommendations"]
    for rec in out["recommendations"]:
        assert rec["rent"] == round(expected[rec["area"]]["value"], 2)
        assert rec["rent_is_for"] == "district"
        assert rec["rent_source"] == expected[rec["area"]]["note"]
        assert rec["budget_difference"] == round(rec["rent"] - budget, 2)


def test_the_assistant_has_the_same_rents(profile):
    d8 = district_rent.rent_for(profile, "D8", "1 bed")["value"]
    assert "<site_rents>" in chat.SYSTEM_PROMPT
    assert f"- D8 The Liberties & Kilmainham: " in chat.SYSTEM_PROMPT
    assert f"1-bed apartment €{d8:,.0f}" in chat.SYSTEM_PROMPT


def test_a_university_residence_is_only_for_its_own_students(data):
    """A UCD student isn't matched with Trinity Hall, and doesn't see Trinity's halls under places to live."""
    importance = {**IMPORTANCE, "Safety": 7}
    out = recommender.recommend(data, "University College Dublin - Belfield", 1000, "student_shared",
                                importance=importance, top_n=50)
    for rec in out["recommendations"]:
        operators = {x.get("operator") for x in rec["places_to_live"]["residences"]}
        assert "Trinity College Dublin" not in operators
    trinity = recommender.recommend(data, "Trinity College Dublin", 1000, "student_accommodation",
                                    importance=importance, top_n=50)
    seen = {x.get("operator") for rec in trinity["recommendations"] for x in rec["places_to_live"]["residences"]}
    assert "University College Dublin" not in seen
    assert recommender.open_to({"operator": "Yugo"}, "University College Dublin - Belfield")
    assert not recommender.open_to({"operator": "Trinity College Dublin"}, "University College Dublin - Belfield")


def test_the_assistant_answers_every_question():
    prompt = chat.SYSTEM_PROMPT
    assert "Answer any question the student asks" in prompt
    assert "off-topic" not in prompt and "your ONLY job" not in prompt


def test_the_assistant_answers_with_the_sites_places():
    prompt = chat.SYSTEM_PROMPT
    assert "<site_places>" in prompt and "Trinity College (university)" in prompt
    assert "never reply with only" in prompt  # it answers instead of just pointing to a page


def test_the_assistant_has_the_sites_safety_figures(profile):
    prompt = chat.SYSTEM_PROMPT
    d1 = profile["safety"]["D1"]["score"]
    assert "<site_safety>" in prompt and f"- D1 City Centre North: safety score {d1:.0f}/100" in prompt
    assert "- A96 " in district_rent.safety_text(profile)  # County Dublin areas too


def test_the_assistant_has_all_the_sites_data():
    import re

    import site_facts

    prompt = chat.SYSTEM_PROMPT
    for block in ("site_rents", "site_places", "site_safety", "site_commute", "site_areas", "site_residences",
                  "site_colleges", "site_checklist"):
        inside = re.search(rf"<{block}>\n(.*?)\n</{block}>", prompt, re.S)
        assert inside and len(inside.group(1)) > 500, block  # each block is there and has real content
    profile = district_rent.load_profile_data()
    assert len(site_facts.commute_text(profile).splitlines()) == 34  # every area, Dublin and County Dublin
    assert "UCD " in site_facts.commute_text(profile)
    assert "Beckett House (Aparto)" in prompt and "Book your IRP appointment" in prompt
    assert "Before saying you don't have something, check every block" in prompt


def test_amenity_groups_say_what_is_near_and_how_far():
    shops = recommender.FACTOR_LOOKUP["Shopping & Groceries"]
    row = {"Supermarkets": 1, "Groceries": 20, "Shopping_Malls": 2}
    assert recommender._group_detail(shops, row) == (
        "1 supermarket and 20 convenience and grocery shops within 1 km, 2 shopping centres within 2 km")
    health = recommender.FACTOR_LOOKUP["Healthcare"]
    assert recommender._group_detail(health, {"Hospitals": 1, "Pharmacies": 1}) == "1 pharmacy within 1 km, 1 hospital within 3 km"


def test_the_assistant_knows_each_areas_shop_chains():
    import site_facts

    counts = site_facts.chain_counts()
    facts = site_facts.area_facts_text(district_rent.load_profile_data())
    d1 = next(line for line in facts.splitlines() if line.startswith("- D1 "))
    assert f"Tesco {counts['D1']['tesco']}" in d1 and "convenience shops:" in d1
    d10 = next(line for line in facts.splitlines() if line.startswith("- D10 "))
    assert "shares with D12, D20" in d10  # census figures cover the whole electoral area


def test_the_assistant_agrees_with_the_website_everywhere(data, profile):
    """Every figure the assistant is given matches what the site shows, for every area."""
    import json
    import re

    import site_facts

    prompt = chat.SYSTEM_PROMPT
    # safety: every area's score
    for code, s in profile["safety"].items():
        if isinstance(s.get("score"), (int, float)):
            assert f"- {code} " in prompt and f"safety score {s['score']:.0f}/100" in prompt, code
    # amenities: the district profile's tiles
    counts = json.loads((site_facts.FRONTEND / "public" / "data" / "dublin-amenity-counts.json").read_text())["counts"]
    facts = {line.split(" ")[1]: line for line in site_facts.area_facts_text(profile).splitlines()}
    for code, n in counts.items():
        assert f"{n['supermarket']} supermarkets" in facts[code] and f"{n['restaurant']} restaurants" in facts[code], code
    # commute: every result the results page can show lies inside the assistant's range for that area and college
    chat.use_recommender_data(data)  # as app.py does once the data has loaded
    block = re.search(r"<site_commute>\n(.*?)\n</site_commute>", chat.SYSTEM_PROMPT, re.S).group(1)
    assert block == site_facts.commute_text(profile, data)
    commute = {line.split(" ")[1]: line for line in block.splitlines()}
    importance = {**IMPORTANCE, "Commute": 7}
    for college, short in site_facts.COLLEGE_SHORT.items():
        if college not in data["universities"]:
            continue
        out = recommender.recommend(data, college, 3000, "one_bed", importance=importance, top_n=60)
        for rec in out["recommendations"]:
            m = re.search(rf"{re.escape(short)} \d+ \((\d+)-(\d+),", commute[rec["area"]])
            assert m, (college, rec["area"])
            low, high = int(m.group(1)), int(m.group(2))
            places = [rec["neighbourhood"]] + rec["neighbourhood"]["others"]
            for place in places:
                assert low - 1 <= place["commute_minutes"] <= high + 1, (college, rec["area"], place["name"], low, high)
