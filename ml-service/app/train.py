"""Train rent models, compare them on a held-out set, persist the best + metrics + market stats.

Usage:  python -m app.train            (uses Kaggle CSV if present, else synthetic data)
"""
from __future__ import annotations

import json
import time
from datetime import datetime, timezone

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestRegressor
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import cross_val_predict, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from xgboost import XGBRegressor

from . import config
from .data import load_dataset
from .features import CATEGORICAL, NUMERIC, build_frame
from .fraud.anomaly import train_anomaly


def make_pipeline(model) -> Pipeline:
    pre = ColumnTransformer([
        ("cat", OneHotEncoder(handle_unknown="infrequent_if_exist", min_frequency=5), CATEGORICAL),
        ("num", StandardScaler(), NUMERIC),
    ])
    return Pipeline([("pre", pre), ("model", model)])


def candidates() -> dict:
    return {
        "linear_ridge": Ridge(alpha=1.0),
        "random_forest": RandomForestRegressor(n_estimators=200, min_samples_leaf=2, n_jobs=-1, random_state=config.RANDOM_STATE),
        "xgboost": XGBRegressor(n_estimators=500, max_depth=6, learning_rate=0.06, subsample=0.9,
                                colsample_bytree=0.9, tree_method="hist", n_jobs=2, random_state=config.RANDOM_STATE),
    }


def score(y_true_rupees: np.ndarray, y_pred_rupees: np.ndarray) -> dict:
    ape = np.abs(y_pred_rupees - y_true_rupees) / y_true_rupees
    return {
        "mae": float(mean_absolute_error(y_true_rupees, y_pred_rupees)),
        "rmse": float(np.sqrt(mean_squared_error(y_true_rupees, y_pred_rupees))),
        "r2": float(r2_score(y_true_rupees, y_pred_rupees)),
        "mape_pct": float(ape.mean() * 100),
        "within_15pct": float((ape <= 0.15).mean() * 100),
    }


def market_stats(df: pd.DataFrame) -> dict:
    """Rent-per-sqft distribution per city and per city/area; used by the fraud service."""
    d = df.assign(ppsf=df.rent / df.size_sqft)

    def summ(g):
        return {"n": int(len(g)), "median": float(g.ppsf.median()), "p05": float(g.ppsf.quantile(0.05)),
                "p95": float(g.ppsf.quantile(0.95)), "q1": float(g.ppsf.quantile(0.25)), "q3": float(g.ppsf.quantile(0.75))}

    stats = {"city": {c: summ(g) for c, g in d.groupby("city")}, "area": {}, "global": summ(d)}
    for (c, a), g in d.groupby(["city", "area"]):
        if len(g) >= 15:
            stats["area"][f"{c}|{a}"] = summ(g)
    return stats


def train() -> dict:
    t0 = time.time()
    df, source = load_dataset()
    X = build_frame(df.to_dict("records"))
    y = np.log1p(df["rent"].to_numpy(dtype=float))
    X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.2, random_state=config.RANDOM_STATE)

    results, fitted = {}, {}
    for name, model in candidates().items():
        pipe = make_pipeline(model).fit(X_tr, y_tr)
        results[name] = score(np.expm1(y_te), np.expm1(pipe.predict(X_te)))
        fitted[name] = pipe
    best = min(results, key=lambda n: results[n]["mae"])

    # Honest prediction intervals: out-of-fold residuals (log space) of the winning model on training data
    oof = cross_val_predict(make_pipeline(candidates()[best]), X_tr, y_tr, cv=5)
    resid = y_tr - oof
    interval = {"lo": float(np.quantile(resid, 0.10)), "hi": float(np.quantile(resid, 0.90))}

    final = make_pipeline(candidates()[best]).fit(X, y)  # refit on all data for production
    version = f"rent-{best}-{datetime.now(timezone.utc):%Y%m%d%H%M}"
    config.MODEL_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump({"pipeline": final, "interval": interval, "version": version,
                 "known_cities": sorted(df.city.unique()), "known_areas": sorted(df.area.unique())}, config.MODEL_PATH)

    metrics = {
        "version": version, "best_model": best, "dataset": source, "rows": int(len(df)),
        "train_rows": int(len(X_tr)), "test_rows": int(len(X_te)),
        "test_metrics": results[best], "model_comparison": results,
        "interval_log_residual_p10_p90": interval,
        "trained_at": datetime.now(timezone.utc).isoformat(), "train_seconds": round(time.time() - t0, 1),
        "note": ("Trained on SYNTHETIC data: scores reflect the generator, not the real market. "
                 "Add House_Rent_Dataset.csv to ml-service/data and retrain for real-world accuracy.")
                if source == "synthetic" else "Trained on real data.",
    }
    config.METRICS_PATH.write_text(json.dumps(metrics, indent=2))
    stats = market_stats(df)
    config.MARKET_STATS_PATH.write_text(json.dumps(stats))
    metrics["anomaly_model"] = train_anomaly(df, stats)
    config.METRICS_PATH.write_text(json.dumps(metrics, indent=2))
    return metrics


if __name__ == "__main__":
    m = train()
    print(json.dumps({k: m[k] for k in ("version", "dataset", "rows", "best_model", "test_metrics")}, indent=2))
    for n, r in m["model_comparison"].items():
        print(f"  {n:14s} MAE={r['mae']:.0f}  RMSE={r['rmse']:.0f}  R2={r['r2']:.3f}  within15%={r['within_15pct']:.1f}")
