import json

from app import config


def test_training_outputs(trained_dir):
    d, m = trained_dir
    assert (d / "rent_model.joblib").exists() and (d / "metrics.json").exists() and (d / "market_stats.json").exists()
    assert set(m["model_comparison"]) == {"linear_ridge", "random_forest", "xgboost"}
    assert m["best_model"] == min(m["model_comparison"], key=lambda k: m["model_comparison"][k]["mae"])
    assert m["dataset"] == "synthetic" and "SYNTHETIC" in m["note"]


def test_model_is_actually_accurate(trained_dir):
    _, m = trained_dir
    t = m["test_metrics"]
    assert t["r2"] > 0.9
    assert t["within_15pct"] > 70
    assert t["mape_pct"] < 15


def test_interval_calibration_is_sensible(trained_dir):
    _, m = trained_dir
    iv = m["interval_log_residual_p10_p90"]
    assert iv["lo"] < 0 < iv["hi"]


def test_market_stats_structure(trained_dir):
    d, _ = trained_dir
    stats = json.loads((d / "market_stats.json").read_text())
    assert "mumbai" in stats["city"] and stats["city"]["mumbai"]["median"] > stats["city"]["ahmedabad"]["median"]
    assert any(k.startswith("pune|") for k in stats["area"])
    s = stats["global"]
    assert s["p05"] < s["q1"] < s["median"] < s["q3"] < s["p95"]
