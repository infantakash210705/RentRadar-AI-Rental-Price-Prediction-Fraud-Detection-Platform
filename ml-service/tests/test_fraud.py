import io

import numpy as np
import pytest
from PIL import Image, ImageDraw

from app.fraud import images as imgmod
from app.fraud.scorer import assess


# ---------- helpers ----------
def make_image(seed: int, size=(640, 480)) -> Image.Image:
    """Structured pseudo-photo: gradient background + random rectangles/circles."""
    rng = np.random.default_rng(seed)
    w, h = size
    base = np.zeros((h, w, 3), dtype=np.uint8)
    for c in range(3):
        base[..., c] = np.linspace(rng.integers(0, 120), rng.integers(130, 255), w, dtype=np.uint8)[None, :]
    img = Image.fromarray(base)
    d = ImageDraw.Draw(img)
    for _ in range(14):
        x, y = int(rng.integers(0, w - 80)), int(rng.integers(0, h - 80))
        col = tuple(int(v) for v in rng.integers(0, 255, 3))
        (d.rectangle if rng.random() < 0.5 else d.ellipse)([x, y, x + int(rng.integers(30, 200)), y + int(rng.integers(30, 200))], fill=col)
    return img


def to_bytes(img: Image.Image, fmt="PNG", **kw) -> bytes:
    b = io.BytesIO()
    img.save(b, fmt, **kw)
    return b.getvalue()


LISTING = dict(id="L1", owner_id="owner-a", title="Spacious 2BHK in Indiranagar", description="Well maintained flat with parking and lift near the metro station.",
               city="Bengaluru", area="Indiranagar", size_sqft=1000, bhk=2, bathrooms=2, furnishing="semi-furnished", rent=70000,
               amenities=["parking"], latitude=12.9784, longitude=77.6408, phashes=["0" * 16], embeddings=[], image_count=1)


def L(**o):
    return {**LISTING, **o}


def types(res):
    return {f["type"] for f in res["flags"]}


def flag(res, t):
    return next(f for f in res["flags"] if f["type"] == t)


# ---------- images ----------
class TestImages:
    def test_resize_and_recompress_stay_close_but_different_image_is_far(self):
        a = make_image(1)
        h = imgmod.analyze(to_bytes(a))["phash"]
        resized = imgmod.analyze(to_bytes(a.resize((320, 240))))["phash"]
        jpeg = imgmod.analyze(to_bytes(a, "JPEG", quality=60))["phash"]
        other = imgmod.analyze(to_bytes(make_image(2)))["phash"]
        assert imgmod.hamming(h, resized) <= 6
        assert imgmod.hamming(h, jpeg) <= 6
        assert imgmod.hamming(h, other) > 10

    def test_embedding_shape_and_cosine(self):
        a = imgmod.analyze(to_bytes(make_image(1)))
        a2 = imgmod.analyze(to_bytes(make_image(1).resize((300, 200))))
        b = imgmod.analyze(to_bytes(make_image(3)))
        assert len(a["embedding"]) == 24 + 64 and len(a["phash"]) == 16
        assert imgmod.cosine(a["embedding"], a2["embedding"]) > 0.97
        assert imgmod.cosine(a["embedding"], a["embedding"]) == pytest.approx(1.0, abs=1e-3)
        assert imgmod.cosine(a["embedding"], b["embedding"]) < imgmod.cosine(a["embedding"], a2["embedding"])

    def test_garbage_bytes_rejected(self):
        with pytest.raises(imgmod.BadImage):
            imgmod.analyze(b"definitely not an image")

    def test_endpoint(self, client):
        r = client.post("/images/analyze", files={"file": ("a.png", to_bytes(make_image(5)), "image/png")})
        assert r.status_code == 200 and r.json()["width"] == 640
        bad = client.post("/images/analyze", files={"file": ("a.png", b"nope", "image/png")})
        assert bad.status_code == 400


# ---------- price ----------
class TestPrice:
    def predicted(self, client, l=LISTING):
        r = client.post("/predict", json={k: l[k] for k in ("city", "area", "size_sqft", "bhk", "bathrooms", "furnishing", "amenities")})
        return r.json()["predicted_rent"]

    def test_fair_price_is_low_risk(self, client):
        p = self.predicted(client)
        res = assess(L(rent=int(p)), p, [])
        assert res["risk_score"] < 40 and "price_too_low" not in types(res)

    def test_far_below_market_flagged_high(self, client):
        p = self.predicted(client)
        res = assess(L(rent=int(p * 0.2)), p, [])
        assert flag(res, "price_too_low")["severity"] == "high"
        assert res["risk_score"] >= 40 and res["category_scores"]["price"] >= 55

    def test_far_above_market_flagged(self, client):
        p = self.predicted(client)
        res = assess(L(rent=int(p * 3)), p, [])
        assert flag(res, "price_too_high")["severity"] == "medium"

    def test_isolation_forest_catches_absurd_combo_without_prediction(self):
        res = assess(L(rent=800, size_sqft=3000, bhk=1, bathrooms=1), None, [])
        assert "statistical_outlier" in types(res) or "price_too_low" in types(res)
        assert res["risk_score"] >= 25

    def test_typical_listing_not_marked_outlier(self):
        assert "statistical_outlier" not in types(assess(L(rent=70000), None, []))


# ---------- text ----------
class TestText:
    def test_scam_language(self):
        res = assess(L(description="Owner is abroad, send advance payment before visit via western union. URGENT!"), 70000, [])
        f = flag(res, "scam_language")
        assert f["weight"] >= 0.5 and f["severity"] == "high"

    def test_contact_details_low_flag(self):
        res = assess(L(description="Great flat. Call me on +91 98765 43210 or whatsapp for details."), 70000, [])
        assert flag(res, "off_platform_contact")["severity"] == "low"

    def test_clean_text_no_text_flags(self):
        res = assess(L(), 70000, [])
        assert not {"scam_language", "off_platform_contact", "duplicate_text"} & types(res)

    def test_copied_listing_from_other_owner_is_high(self):
        cand = [dict(id="X", owner_id="owner-b", title=LISTING["title"], description=LISTING["description"], phashes=[], embeddings=[])]
        f = flag(assess(L(), 70000, cand), "duplicate_text")
        assert f["severity"] == "high" and f["related_listing_id"] == "X" and f["similarity"] > 0.9

    def test_repost_by_same_owner_is_medium(self):
        cand = [dict(id="X", owner_id="owner-a", title=LISTING["title"], description=LISTING["description"], phashes=[], embeddings=[])]
        assert flag(assess(L(), 70000, cand), "duplicate_text")["severity"] == "medium"

    def test_unrelated_listing_not_flagged(self):
        cand = [dict(id="X", owner_id="owner-b", title="Commercial shop for rent", description="Ground floor retail space on main road with high footfall.", phashes=[], embeddings=[])]
        assert "duplicate_text" not in types(assess(L(), 70000, cand))


# ---------- duplicate images ----------
class TestDuplicateImages:
    def fp(self, img):
        a = imgmod.analyze(to_bytes(img))
        return a["phash"], a["embedding"]

    def test_stolen_photo_resized_and_recompressed_is_caught(self):
        orig = make_image(10)
        h0, e0 = self.fp(orig)
        stolen = Image.open(io.BytesIO(to_bytes(orig.resize((400, 300)), "JPEG", quality=70)))
        h1, e1 = self.fp(stolen)
        cand = [dict(id="X", owner_id="owner-b", title="t", description="d", phashes=[h0], embeddings=[e0])]
        f = flag(assess(L(phashes=[h1], embeddings=[e1]), 70000, cand), "duplicate_image")
        assert f["severity"] == "high" and f["related_listing_id"] == "X"

    def test_same_owner_reuse_is_medium(self):
        h, e = self.fp(make_image(11))
        cand = [dict(id="X", owner_id="owner-a", title="t", description="d", phashes=[h], embeddings=[e])]
        assert flag(assess(L(phashes=[h], embeddings=[e]), 70000, cand), "duplicate_image")["severity"] == "medium"

    def test_different_photos_not_flagged(self):
        h0, e0 = self.fp(make_image(20)); h1, e1 = self.fp(make_image(21))
        cand = [dict(id="X", owner_id="owner-b", title="t", description="d", phashes=[h0], embeddings=[e0])]
        assert "duplicate_image" not in types(assess(L(phashes=[h1], embeddings=[e1]), 70000, cand))

    def test_no_photos_is_only_a_low_flag(self):
        res = assess(L(phashes=[], image_count=0), 70000, [])
        assert flag(res, "no_photos")["severity"] == "low" and res["risk_score"] < 40


# ---------- inconsistent data ----------
class TestConsistency:
    def test_size_bhk_mismatch(self):
        assert "size_bhk_mismatch" in types(assess(L(bhk=4, size_sqft=300, title="4 BHK flat"), 70000, []))
        assert "size_bhk_mismatch" in types(assess(L(bhk=1, size_sqft=5000, title="Flat for rent"), 70000, []))

    def test_title_bhk_contradicts_field(self):
        assert "text_field_mismatch" in types(assess(L(title="Lovely 3BHK apartment", bhk=2), 70000, []))
        assert "text_field_mismatch" not in types(assess(L(title="Lovely 2 BHK apartment", bhk=2), 70000, []))

    def test_location_pin_far_from_city(self):
        f = flag(assess(L(latitude=19.07, longitude=72.87), 70000, []), "location_mismatch")  # Mumbai pin, city says Bengaluru
        assert f["distance_km"] > 800
        assert "location_mismatch" not in types(assess(L(), 70000, []))

    def test_too_many_bathrooms(self):
        assert "bathroom_mismatch" in types(assess(L(bhk=1, bathrooms=6), 70000, []))


# ---------- scoring + API ----------
class TestScoring:
    def test_noisy_or_math(self):
        # two independent ~0.30 signals => 1-(0.7*0.7)=51
        res = assess(L(bhk=4, size_sqft=300, title="3BHK flat"), 70000, [])
        w = [f["weight"] for f in res["flags"] if f["type"] in ("size_bhk_mismatch", "text_field_mismatch")]
        assert res["risk_score"] >= round((1 - np.prod([1 - x for x in w])) * 100) - 1

    def test_scammy_listing_scores_very_high(self):
        p = 70000
        res = assess(L(rent=9000, description="Owner abroad. Send advance payment before visit. URGENT", phashes=[], image_count=0), p, [])
        assert res["risk_score"] >= 80 and res["flags"][0]["weight"] >= res["flags"][-1]["weight"]

    @pytest.mark.parametrize("kw", [{}, {"rent": 1}, {"rent": 10**7}, {"title": "", "description": ""}])
    def test_score_always_bounded(self, kw):
        assert 0 <= assess(L(**kw), 70000, [])["risk_score"] <= 100

    def test_endpoint_contract(self, client):
        body = {"listing": {k: v for k, v in LISTING.items() if k != "embeddings"}, "predicted_rent": 70000, "candidates": []}
        r = client.post("/fraud/check", json=body)
        assert r.status_code == 200
        j = r.json()
        assert set(j) >= {"risk_score", "flags", "model_version", "category_scores"}
        assert all({"type", "severity", "detail"} <= set(f) for f in j["flags"])

    def test_endpoint_accepts_backend_style_payload_with_nulls(self, client):
        body = {"listing": {**LISTING, "latitude": None, "longitude": None, "owner_id": "u"}, "predicted_rent": None,
                "candidates": [{"id": "c1", "owner_id": "u2", "title": "x", "description": "y", "rent": 1, "size_sqft": 1, "phashes": [], "embeddings": []}]}
        assert client.post("/fraud/check", json=body).status_code == 200

    def test_endpoint_rejects_invalid(self, client):
        assert client.post("/fraud/check", json={"listing": {"city": "x"}}).status_code == 422
