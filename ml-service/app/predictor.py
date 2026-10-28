from __future__ import annotations

import json
import threading

import joblib
import numpy as np

from . import config
from .features import build_frame, norm_text


class Predictor:
    def __init__(self):
        self._lock = threading.Lock()
        self.bundle = None
        self.metrics: dict = {}

    @property
    def ready(self) -> bool:
        return self.bundle is not None

    def load(self, train_if_missing: bool = True):
        with self._lock:
            if not config.MODEL_PATH.exists():
                if not train_if_missing:
                    raise FileNotFoundError(config.MODEL_PATH)
                from .train import train  # lazy: heavy imports
                train()
            self.bundle = joblib.load(config.MODEL_PATH)
            self.bundle["_cities"] = set(self.bundle["known_cities"])
            self.bundle["_areas"] = set(self.bundle["known_areas"])
            if config.METRICS_PATH.exists():
                self.metrics = json.loads(config.METRICS_PATH.read_text())

    def predict(self, row: dict) -> dict:
        b = self.bundle
        X = build_frame([row])
        log_pred = float(b["pipeline"].predict(X)[0])
        pred = float(np.expm1(log_pred))
        lo = float(np.expm1(log_pred + b["interval"]["lo"]))
        hi = float(np.expm1(log_pred + b["interval"]["hi"]))
        known_city = norm_text(row["city"]) in b["_cities"]
        known_area = norm_text(row["area"]) in b["_areas"]
        return {
            "predicted_rent": round(pred, -2),
            "low": round(max(lo, 0), -2),
            "high": round(hi, -2),
            "model_version": b["version"],
            "confidence": "high" if known_city and known_area else ("medium" if known_city else "low"),
            "known_city": known_city,
            "known_area": known_area,
        }


predictor = Predictor()
