"""Combine independent signals into one 0-100 risk score using noisy-OR:
   risk = 1 - prod(1 - w_i). Two medium signals (0.3 each) => 51; one high (0.6) => 60."""
from __future__ import annotations

from . import anomaly, rules

CATEGORY = {
    "price_too_low": "price", "price_too_high": "price", "statistical_outlier": "price",
    "duplicate_text": "text", "scam_language": "text", "off_platform_contact": "text",
    "shouting_title": "text", "thin_description": "text",
    "duplicate_image": "image", "no_photos": "image",
    "size_bhk_mismatch": "consistency", "bathroom_mismatch": "consistency",
    "text_field_mismatch": "consistency", "location_mismatch": "consistency",
}


def assess(listing: dict, predicted_rent: float | None, candidates: list[dict], version: str = "fraud-v1") -> dict:
    flags: list[dict] = []
    flags += rules.price_flags(listing, predicted_rent, anomaly.score_listing(listing), anomaly.local_market(listing))
    flags += rules.text_flags(listing)
    flags += rules.duplicate_text_flags(listing, candidates)
    flags += rules.duplicate_image_flags(listing, candidates)
    flags += rules.no_image_flags(listing)
    flags += rules.consistency_flags(listing)

    best: dict[str, dict] = {}  # one flag per type, keep the strongest
    for f in flags:
        f["category"] = CATEGORY.get(f["type"], "other")
        if f["type"] not in best or f["weight"] > best[f["type"]]["weight"]:
            best[f["type"]] = f
    final = sorted(best.values(), key=lambda f: -f["weight"])

    keep = 1.0
    cat_keep: dict[str, float] = {}
    for f in final:
        keep *= 1 - f["weight"]
        cat_keep[f["category"]] = cat_keep.get(f["category"], 1.0) * (1 - f["weight"])
    return {
        "risk_score": int(round((1 - keep) * 100)),
        "flags": final,
        "category_scores": {c: int(round((1 - k) * 100)) for c, k in cat_keep.items()},
        "model_version": version,
    }
