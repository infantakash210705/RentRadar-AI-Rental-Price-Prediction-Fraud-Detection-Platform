"""Feature engineering shared by training and serving (single source of truth)."""
from __future__ import annotations

import numpy as np
import pandas as pd

FURNISHING = ["unfurnished", "semi-furnished", "furnished"]

# canonical amenity -> accepted spellings (all compared lowercase)
AMENITY_ALIASES = {
    "parking": {"parking", "car parking", "covered parking", "garage"},
    "lift": {"lift", "elevator"},
    "gym": {"gym", "fitness center", "fitness centre"},
    "pool": {"pool", "swimming pool", "swimming-pool"},
    "security": {"security", "24x7 security", "guard", "cctv"},
    "power_backup": {"power backup", "power-backup", "generator", "inverter"},
    "garden": {"garden", "park", "playground"},
    "clubhouse": {"clubhouse", "club house", "community hall"},
    "balcony": {"balcony", "terrace"},
    "ac": {"ac", "air conditioning", "air conditioner", "air-conditioning"},
    "wifi": {"wifi", "wi-fi", "internet", "broadband"},
    "gas_pipeline": {"gas pipeline", "piped gas", "gas"},
}
AMENITY_KEYS = list(AMENITY_ALIASES)
_LOOKUP = {alias: key for key, aliases in AMENITY_ALIASES.items() for alias in aliases}

CATEGORICAL = ["city", "area", "furnishing"]
NUMERIC = ["log_size", "bhk", "bathrooms", "size_per_bhk", "n_amenities"] + [f"am_{k}" for k in AMENITY_KEYS]
FEATURE_COLUMNS = CATEGORICAL + NUMERIC


def norm_text(s: str) -> str:
    return " ".join(str(s).strip().lower().split())


def norm_furnishing(s: str) -> str:
    s = norm_text(s).replace("_", "-")
    if s.startswith("semi"):
        return "semi-furnished"
    if s.startswith("un"):
        return "unfurnished"
    if s.startswith("furn"):
        return "furnished"
    return "unfurnished"


def canonical_amenities(items) -> set[str]:
    return {_LOOKUP[a] for a in (norm_text(x) for x in (items or [])) if a in _LOOKUP}


def build_frame(rows: list[dict]) -> pd.DataFrame:
    """rows: dicts with city, area, size_sqft, bhk, bathrooms, furnishing, amenities."""
    recs = []
    for r in rows:
        am = canonical_amenities(r.get("amenities"))
        size = float(r["size_sqft"])
        bhk = int(r["bhk"])
        rec = {
            "city": norm_text(r["city"]),
            "area": norm_text(r["area"]),
            "furnishing": norm_furnishing(r.get("furnishing", "unfurnished")),
            "log_size": float(np.log(size)),
            "bhk": bhk,
            "bathrooms": int(r.get("bathrooms", 1)),
            "size_per_bhk": size / max(bhk, 1),
            "n_amenities": len(am),
        }
        for k in AMENITY_KEYS:
            rec[f"am_{k}"] = int(k in am)
        recs.append(rec)
    return pd.DataFrame.from_records(recs, columns=FEATURE_COLUMNS)
