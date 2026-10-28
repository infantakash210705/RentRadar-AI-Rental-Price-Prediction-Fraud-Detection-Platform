"""Dataset loading: real Kaggle CSV if present, otherwise a reproducible synthetic dataset."""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import config
from .features import AMENITY_KEYS

# city -> (base rent per sqft per month in INR, [(area, multiplier), ...])
CITY_PROFILES = {
    "mumbai": (95, [("bandra", 1.9), ("andheri", 1.25), ("powai", 1.35), ("thane", 0.8), ("navi mumbai", 0.7), ("borivali", 0.95), ("worli", 2.2), ("kurla", 0.85)]),
    "delhi": (45, [("saket", 1.5), ("dwarka", 0.85), ("rohini", 0.8), ("vasant kunj", 1.7), ("lajpat nagar", 1.2), ("janakpuri", 0.95), ("noida", 0.75), ("gurgaon", 1.3)]),
    "bengaluru": (38, [("indiranagar", 1.6), ("koramangala", 1.55), ("whitefield", 1.0), ("hsr layout", 1.3), ("electronic city", 0.75), ("jayanagar", 1.2), ("marathahalli", 1.0), ("yelahanka", 0.8)]),
    "hyderabad": (30, [("gachibowli", 1.4), ("hitech city", 1.5), ("madhapur", 1.4), ("kukatpally", 0.9), ("secunderabad", 0.85), ("banjara hills", 1.7), ("miyapur", 0.85), ("uppal", 0.7)]),
    "chennai": (28, [("adyar", 1.5), ("anna nagar", 1.35), ("velachery", 1.15), ("tambaram", 0.75), ("t nagar", 1.45), ("porur", 0.95), ("omr", 1.1), ("guindy", 1.2)]),
    "kolkata": (22, [("salt lake", 1.3), ("new town", 1.1), ("ballygunge", 1.5), ("howrah", 0.7), ("jadavpur", 0.95), ("dum dum", 0.8), ("behala", 0.75), ("park street", 1.6)]),
    "pune": (30, [("koregaon park", 1.7), ("hinjewadi", 1.1), ("baner", 1.3), ("kothrud", 1.2), ("wakad", 1.0), ("hadapsar", 0.95), ("viman nagar", 1.3), ("pimpri", 0.75)]),
    "ahmedabad": (20, [("satellite", 1.4), ("bopal", 1.0), ("navrangpura", 1.3), ("maninagar", 0.8), ("gota", 0.75), ("prahlad nagar", 1.45), ("vastrapur", 1.35), ("chandkheda", 0.7)]),
}
AMENITY_PREMIUM = {  # fractional uplift on rent
    "parking": 0.04, "lift": 0.03, "gym": 0.04, "pool": 0.06, "security": 0.02, "power_backup": 0.02,
    "garden": 0.02, "clubhouse": 0.04, "balcony": 0.015, "ac": 0.05, "wifi": 0.01, "gas_pipeline": 0.01,
}
FURNISH_PREMIUM = {"unfurnished": 0.0, "semi-furnished": 0.10, "furnished": 0.25}


def generate_synthetic(n: int = 30000, seed: int = config.RANDOM_STATE) -> pd.DataFrame:
    """Reproducible, plausible Indian rental market data (NOT real listings)."""
    rng = np.random.default_rng(seed)
    cities = list(CITY_PROFILES)
    rows = []
    for _ in range(n):
        city = cities[rng.integers(len(cities))]
        base, areas = CITY_PROFILES[city]
        area, mult = areas[rng.integers(len(areas))]
        bhk = int(rng.choice([1, 2, 3, 4, 5], p=[0.28, 0.4, 0.22, 0.08, 0.02]))
        size = int(np.clip(rng.normal(280 + 330 * bhk, 90), 200, 6000))
        bathrooms = int(np.clip(round(bhk + rng.integers(-1, 2) * (rng.random() < 0.4)), 1, 6))
        furnishing = str(rng.choice(["unfurnished", "semi-furnished", "furnished"], p=[0.4, 0.4, 0.2]))
        k = int(rng.integers(0, 8))
        am = list(rng.choice(AMENITY_KEYS, size=k, replace=False)) if k else []
        # Real markets have interactions, so premiums are NOT purely additive/multiplicative:
        #  - premium localities command bigger furnishing & amenity premiums
        #  - size effect is non-linear (small flats cost more per sqft, very large ones less)
        #  - amenities matter more for bigger (family) flats; AC matters more in hot cities
        tier = mult ** 0.8
        hot = 1.6 if city in ("chennai", "hyderabad", "ahmedabad", "delhi") else 1.0
        amen = sum(AMENITY_PREMIUM[a] * (hot if a == "ac" else 1.0) for a in am) * (0.7 + 0.15 * bhk)
        uplift = 1 + FURNISH_PREMIUM[furnishing] * tier + amen * tier
        if size < 500:
            size_effect = (size / 1000) ** -0.30
        elif size < 1500:
            size_effect = (size / 1000) ** -0.10
        else:
            size_effect = (1.5) ** -0.10 * (size / 1500) ** -0.25
        luxury = 1.15 if (mult >= 1.5 and bhk >= 3) else 1.0
        rent = size * base * mult * uplift * size_effect * luxury * rng.lognormal(0, 0.10)
        rows.append({"city": city, "area": area, "size_sqft": size, "bhk": bhk, "bathrooms": bathrooms,
                     "furnishing": furnishing, "amenities": am, "rent": int(round(rent / 100) * 100)})
    return pd.DataFrame(rows)


KAGGLE_FURNISH = {"unfurnished": "unfurnished", "semi-furnished": "semi-furnished", "furnished": "furnished"}


def load_kaggle(path) -> pd.DataFrame:
    """Map the Kaggle 'House Rent Prediction Dataset' columns to our schema."""
    raw = pd.read_csv(path)
    need = {"BHK", "Rent", "Size", "Area Locality", "City", "Furnishing Status", "Bathroom"}
    missing = need - set(raw.columns)
    if missing:
        raise ValueError(f"CSV is missing columns: {sorted(missing)}")
    df = pd.DataFrame({
        "city": raw["City"].str.lower().str.strip(),
        "area": raw["Area Locality"].str.lower().str.strip(),
        "size_sqft": raw["Size"].astype(int),
        "bhk": raw["BHK"].astype(int),
        "bathrooms": raw["Bathroom"].astype(int),
        "furnishing": raw["Furnishing Status"].str.lower().str.strip().map(KAGGLE_FURNISH).fillna("unfurnished"),
        "amenities": [[] for _ in range(len(raw))],  # this dataset has no amenity data
        "rent": raw["Rent"].astype(int),
    })
    # Drop obvious data-entry outliers (extreme top 0.5% rents distort training)
    df = df[(df.rent > 0) & (df.rent <= df.rent.quantile(0.995)) & (df.size_sqft >= 100)]
    return df.reset_index(drop=True)


def load_dataset() -> tuple[pd.DataFrame, str]:
    if config.KAGGLE_CSV.exists():
        return load_kaggle(config.KAGGLE_CSV), f"kaggle:{config.KAGGLE_CSV.name}"
    return generate_synthetic(config.SYNTHETIC_ROWS), "synthetic"
