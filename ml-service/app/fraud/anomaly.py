"""Isolation Forest over (price, size, rooms, price-per-sqft, price relative to city median)."""
from __future__ import annotations

import json
from functools import lru_cache

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest

from .. import config


def feature_row(city: str, rent: float, size: float, bhk: int, bathrooms: int, stats: dict) -> list[float]:
    ppsf = rent / size
    med = stats["city"].get((city or "").strip().lower(), stats["global"])["median"]
    return [np.log(rent), np.log(size), bhk, bathrooms, np.log(ppsf), np.log(ppsf / med)]


def train_anomaly(df: pd.DataFrame, stats: dict) -> dict:
    X = np.array([feature_row(r.city, r.rent, r.size_sqft, r.bhk, r.bathrooms, stats) for r in df.itertuples()])
    model = IsolationForest(n_estimators=200, contamination=0.01, random_state=config.RANDOM_STATE, n_jobs=2).fit(X)
    joblib.dump(model, config.MODEL_DIR / "fraud_iforest.joblib")
    return {"train_rows": int(len(X)), "contamination": 0.01}


@lru_cache(maxsize=4)
def _load(path_str: str, mtime: float):
    return joblib.load(path_str)


def _model():
    p = config.MODEL_DIR / "fraud_iforest.joblib"
    return _load(str(p), p.stat().st_mtime) if p.exists() else None


@lru_cache(maxsize=4)
def _stats(path_str: str, mtime: float):
    return json.loads(open(path_str).read())


def market_stats() -> dict | None:
    p = config.MARKET_STATS_PATH
    return _stats(str(p), p.stat().st_mtime) if p.exists() else None


def score_listing(L: dict) -> dict | None:
    model, stats = _model(), market_stats()
    if model is None or stats is None:
        return None
    x = np.array([feature_row(L["city"], L["rent"], L["size_sqft"], L["bhk"], L.get("bathrooms", 1), stats)])
    s = float(model.decision_function(x)[0])  # negative => anomalous
    outlier = bool(model.predict(x)[0] == -1)
    return {"is_outlier": outlier, "score": round(s, 4), "weight": float(np.clip(0.25 + (-s) * 1.5, 0.25, 0.5))}


def local_market(L: dict) -> dict | None:
    stats = market_stats()
    if not stats:
        return None
    city = (L.get("city") or "").strip().lower()
    area = (L.get("area") or "").strip().lower()
    return stats["area"].get(f"{city}|{area}") or stats["city"].get(city) or stats["global"]
