import pytest

BASE = {"city": "Bengaluru", "area": "Indiranagar", "size_sqft": 1000, "bhk": 2, "bathrooms": 2,
        "furnishing": "semi-furnished", "amenities": ["parking", "lift"]}


def pred(client, **over):
    r = client.post("/predict", json={**BASE, **over})
    assert r.status_code == 200, r.text
    return r.json()


def test_health(client):
    r = client.get("/health").json()
    assert r["status"] == "ok" and r["model_version"].startswith("rent-")


def test_predict_shape_and_ordering(client):
    p = pred(client)
    assert p["low"] <= p["predicted_rent"] <= p["high"]
    assert p["predicted_rent"] > 0 and p["confidence"] == "high"
    assert p["model_version"].startswith("rent-")


def test_bigger_flat_costs_more(client):
    assert pred(client, size_sqft=1800, bhk=3)["predicted_rent"] > pred(client, size_sqft=600, bhk=1)["predicted_rent"]


def test_furnished_costs_more_than_unfurnished(client):
    assert pred(client, furnishing="furnished")["predicted_rent"] > pred(client, furnishing="unfurnished")["predicted_rent"]


def test_premium_area_costs_more_than_cheap_area(client):
    assert pred(client, area="Indiranagar")["predicted_rent"] > pred(client, area="Electronic City")["predicted_rent"]


def test_expensive_city_costs_more(client):
    assert pred(client, city="Mumbai", area="Andheri")["predicted_rent"] > pred(client, city="Kolkata", area="Howrah")["predicted_rent"]


def test_amenities_raise_rent(client):
    rich = pred(client, amenities=["pool", "gym", "clubhouse", "parking", "ac", "lift"])["predicted_rent"]
    assert rich > pred(client, amenities=[])["predicted_rent"]


def test_case_and_whitespace_insensitive(client):
    assert pred(client, city="  BENGALURU ", area="indiranagar")["predicted_rent"] == pred(client)["predicted_rent"]


def test_unknown_city_still_predicts_with_low_confidence(client):
    p = pred(client, city="Atlantis", area="Nowhere")
    assert p["confidence"] == "low" and p["known_city"] is False and p["predicted_rent"] > 0


def test_unknown_area_known_city_is_medium_confidence(client):
    assert pred(client, area="Some New Layout")["confidence"] == "medium"


@pytest.mark.parametrize("bad", [
    {"size_sqft": 0}, {"size_sqft": -10}, {"bhk": 0}, {"bhk": 50}, {"furnishing": "luxury"},
    {"city": ""}, {"size_sqft": "big"},
])
def test_validation_rejects_bad_input(client, bad):
    assert client.post("/predict", json={**BASE, **bad}).status_code == 422


def test_missing_field_rejected(client):
    b = dict(BASE); del b["city"]
    assert client.post("/predict", json=b).status_code == 422


def test_metrics_endpoint(client):
    m = client.get("/metrics").json()
    assert m["best_model"] in m["model_comparison"] and "r2" in m["test_metrics"]


def test_deterministic(client):
    assert pred(client) == pred(client)
