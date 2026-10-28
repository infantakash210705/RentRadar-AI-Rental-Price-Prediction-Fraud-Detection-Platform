import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
MODEL_DIR = Path(os.getenv("MODEL_DIR", BASE_DIR / "models"))
DATA_DIR = Path(os.getenv("DATA_DIR", BASE_DIR / "data"))
MODEL_PATH = MODEL_DIR / "rent_model.joblib"
METRICS_PATH = MODEL_DIR / "metrics.json"
MARKET_STATS_PATH = MODEL_DIR / "market_stats.json"
# Optional real dataset (Kaggle "House Rent Prediction Dataset"). Drop the CSV here.
KAGGLE_CSV = Path(os.getenv("RENT_DATASET_CSV", DATA_DIR / "House_Rent_Dataset.csv"))
SYNTHETIC_ROWS = int(os.getenv("SYNTHETIC_ROWS", "30000"))
RANDOM_STATE = 42
