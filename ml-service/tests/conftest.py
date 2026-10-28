import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app import config  # noqa: E402


@pytest.fixture(scope="session")
def trained_dir(tmp_path_factory):
    """Train once on a small synthetic set into a temp dir (never touches real models/)."""
    d = tmp_path_factory.mktemp("models")
    mp = pytest.MonkeyPatch()
    mp.setattr(config, "MODEL_DIR", d)
    mp.setattr(config, "MODEL_PATH", d / "rent_model.joblib")
    mp.setattr(config, "METRICS_PATH", d / "metrics.json")
    mp.setattr(config, "MARKET_STATS_PATH", d / "market_stats.json")
    mp.setattr(config, "KAGGLE_CSV", d / "does_not_exist.csv")
    mp.setattr(config, "SYNTHETIC_ROWS", 8000)
    from app.train import train
    metrics = train()
    yield d, metrics
    mp.undo()


@pytest.fixture(scope="session")
def client(trained_dir):
    from fastapi.testclient import TestClient
    from app.main import app
    with TestClient(app) as c:
        yield c
