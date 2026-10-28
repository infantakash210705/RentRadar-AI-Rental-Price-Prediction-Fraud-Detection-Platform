"""Rule-based + statistical signals. Each returns zero or more flags:
   {type, severity, weight (0-1 probability-like), detail, ...}"""
from __future__ import annotations

import re

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer

from .geo import CITY_CENTROIDS, haversine_km
from . import images as img

SEV = {"high": "high", "medium": "medium", "low": "low"}


def flag(type_, severity, weight, detail, **extra):
    return {"type": type_, "severity": severity, "weight": round(weight, 3), "detail": detail, **extra}


# ---------------- price anomalies ----------------
def price_flags(L: dict, predicted: float | None, iforest_result: dict | None, market: dict | None) -> list[dict]:
    out, rent = [], float(L["rent"])
    if predicted:
        r = rent / predicted
        if r < 0.5:
            out.append(flag("price_too_low", "high", 0.55, f"Rent is {r:.0%} of the AI fair price (₹{predicted:,.0f}); 'too good to be true'", ratio=round(r, 2)))
        elif r < 0.7:
            out.append(flag("price_too_low", "medium", 0.25, f"Rent is {r:.0%} of the AI fair price (₹{predicted:,.0f})", ratio=round(r, 2)))
        elif r > 2.5:
            out.append(flag("price_too_high", "medium", 0.30, f"Rent is {r:.1f}x the AI fair price (₹{predicted:,.0f}); possibly misleading", ratio=round(r, 2)))
        elif r > 1.8:
            out.append(flag("price_too_high", "low", 0.12, f"Rent is {r:.1f}x the AI fair price (₹{predicted:,.0f})", ratio=round(r, 2)))
    elif market:  # no model prediction: fall back to rent/sqft distribution
        ppsf = rent / L["size_sqft"]
        if ppsf < market["p05"] * 0.6:
            out.append(flag("price_too_low", "medium", 0.30, f"₹{ppsf:.0f}/sqft is far below the local 5th percentile (₹{market['p05']:.0f})"))
        elif ppsf > market["p95"] * 1.6:
            out.append(flag("price_too_high", "medium", 0.25, f"₹{ppsf:.0f}/sqft is far above the local 95th percentile (₹{market['p95']:.0f})"))
    if iforest_result and iforest_result["is_outlier"]:
        out.append(flag("statistical_outlier", "medium", iforest_result["weight"],
                        "Isolation Forest marks this combination of price/size/rooms as unusual", anomaly_score=iforest_result["score"]))
    return out


# ---------------- text ----------------
SCAM_PATTERNS = [
    (r"\b(advance|token|booking)\s+(payment|amount|money)\b.{0,40}\b(before|without)\s+(visit|seeing|viewing)", "asks for money before a visit"),
    (r"\b(western union|moneygram|gift\s*card|crypto|bitcoin)\b", "mentions untraceable payment method"),
    (r"\b(out of (the )?(country|town|india)|abroad|overseas)\b.{0,60}\b(keys?|owner|landlord)\b", "owner claims to be abroad"),
    (r"\b(urgent|hurry|last chance|limited time|act fast)\b", "pressure / urgency language"),
    (r"\b(100%|guaranteed)\b.{0,20}\b(genuine|safe|no scam)\b", "over-assuring language"),
]
CONTACT_RE = re.compile(r"(\+?\d[\d\s-]{9,}\d)|([\w.+-]+@[\w-]+\.[\w.]+)|\b(whatsapp|telegram|call me)\b", re.I)


def text_flags(L: dict) -> list[dict]:
    out = []
    title, desc = L.get("title", ""), L.get("description", "") or ""
    blob = f"{title}. {desc}"
    hits = [msg for pat, msg in SCAM_PATTERNS if re.search(pat, blob, re.I)]
    if hits:
        w = min(0.2 + 0.15 * len(hits), 0.6)
        out.append(flag("scam_language", "high" if w >= 0.5 else "medium", w, "Suspicious wording: " + "; ".join(hits)))
    if CONTACT_RE.search(blob):
        out.append(flag("off_platform_contact", "low", 0.15, "Listing text contains phone/email/chat contact details (common in scams)"))
    letters = [c for c in title if c.isalpha()]
    if len(letters) >= 8 and sum(c.isupper() for c in letters) / len(letters) > 0.8 or title.count("!") >= 3:
        out.append(flag("shouting_title", "low", 0.08, "Title is mostly capitals / excessive exclamation marks"))
    if len(desc.strip()) < 20:
        out.append(flag("thin_description", "low", 0.06, "Description is missing or very short"))
    return out


def duplicate_text_flags(L: dict, candidates: list[dict]) -> list[dict]:
    docs = [c for c in candidates if (c.get("title") or c.get("description"))]
    if not docs:
        return []
    mine = f"{L.get('title','')} {L.get('description','')}"
    corpus = [mine] + [f"{c.get('title','')} {c.get('description','')}" for c in docs]
    try:
        tfidf = TfidfVectorizer(ngram_range=(1, 2), stop_words="english", min_df=1).fit_transform(corpus)
    except ValueError:  # empty vocabulary
        return []
    sims = (tfidf[0] @ tfidf[1:].T).toarray().ravel()
    out, order = [], np.argsort(-sims)
    for i in order[:3]:
        s, c = float(sims[i]), docs[int(i)]
        if s < 0.75:
            break
        same_owner = c.get("owner_id") == L.get("owner_id")
        if s >= 0.9:
            sev, w = ("medium", 0.30) if same_owner else ("high", 0.60)
        else:
            sev, w = ("low", 0.12) if same_owner else ("medium", 0.30)
        out.append(flag("duplicate_text", sev, w,
                        f"{s:.0%} text similarity with another listing" + (" by the same owner (repost)" if same_owner else " by a different owner (possible copied listing)"),
                        related_listing_id=c["id"], similarity=round(s, 3)))
        break  # one flag per type; strongest match only
    return out


# ---------------- images ----------------
PHASH_NEAR = 6      # of 64 bits
EMB_SIMILAR = 0.995


def duplicate_image_flags(L: dict, candidates: list[dict]) -> list[dict]:
    mine_h = [h for h in (L.get("phashes") or []) if h]
    mine_e = L.get("embeddings") or []
    best = None
    for c in candidates:
        c_h = [h for h in (c.get("phashes") or []) if h]
        c_e = c.get("embeddings") or []
        for h in mine_h:
            for h2 in c_h:
                d = img.hamming(h, h2)
                if d <= PHASH_NEAR and (best is None or d < best[0]):
                    best = (d, c, "phash")
        if best is None or best[2] != "phash":
            for e in mine_e:
                for e2 in c_e:
                    if img.cosine(e, e2) >= EMB_SIMILAR:
                        best = (0, c, "embedding")
    if not best:
        return []
    d, c, how = best
    same_owner = c.get("owner_id") == L.get("owner_id")
    sev, w = ("medium", 0.30) if same_owner else ("high", 0.65)
    return [flag("duplicate_image", sev, w,
                 "Photo matches one in another listing" + (" by the same owner" if same_owner else " by a different owner (stolen photos?)") + f" [{how}, distance {d}]",
                 related_listing_id=c["id"])]


def no_image_flags(L: dict) -> list[dict]:
    if not (L.get("phashes") or L.get("image_count")):
        return [flag("no_photos", "low", 0.10, "Listing has no photos")]
    return []


# ---------------- inconsistent data ----------------
BHK_RE = re.compile(r"\b(\d{1,2})\s*-?\s*bhk\b", re.I)


def consistency_flags(L: dict) -> list[dict]:
    out = []
    size, bhk, bath = L["size_sqft"], L["bhk"], L.get("bathrooms", 1)
    per = size / max(bhk, 1)
    if per < 150:
        out.append(flag("size_bhk_mismatch", "medium", 0.35, f"{bhk} BHK in only {size} sqft ({per:.0f} sqft/bedroom) is implausible"))
    elif per > 2500:
        out.append(flag("size_bhk_mismatch", "medium", 0.25, f"{size} sqft for just {bhk} BHK is unusually large"))
    if bath > bhk + 2:
        out.append(flag("bathroom_mismatch", "low", 0.15, f"{bath} bathrooms for {bhk} BHK is unusual"))
    m = BHK_RE.search(f"{L.get('title','')} {L.get('description','')}")
    if m and int(m.group(1)) != bhk:
        out.append(flag("text_field_mismatch", "medium", 0.30, f"Text says {m.group(1)} BHK but the BHK field is {bhk}"))
    city = (L.get("city") or "").strip().lower()
    lat, lng = L.get("latitude"), L.get("longitude")
    if city in CITY_CENTROIDS and lat is not None and lng is not None:
        d = haversine_km(lat, lng, *CITY_CENTROIDS[city])
        if d > 80:
            out.append(flag("location_mismatch", "medium", 0.35, f"Map pin is {d:.0f} km from {L['city'].title()}'s centre", distance_km=round(d)))
    return out
