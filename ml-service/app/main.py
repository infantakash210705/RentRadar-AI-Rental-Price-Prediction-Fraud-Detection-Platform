from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI, File, HTTPException, UploadFile
from pydantic import BaseModel, Field, field_validator

from .fraud import images as imgmod
from .fraud.scorer import assess
from .predictor import predictor

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("rentradar.ml")


@asynccontextmanager
async def lifespan(app: FastAPI):
    predictor.load(train_if_missing=True)
    log.info("Rent model ready: %s", predictor.bundle["version"])
    yield


app = FastAPI(title="RentRadar ML Service", version="1.0.0", lifespan=lifespan)


class PredictRequest(BaseModel):
    city: str = Field(min_length=1, max_length=80)
    area: str = Field(min_length=1, max_length=100)
    size_sqft: int = Field(ge=50, le=100_000)
    bhk: int = Field(ge=1, le=10)
    bathrooms: int = Field(default=1, ge=1, le=10)
    furnishing: Literal["unfurnished", "semi-furnished", "furnished"] = "unfurnished"
    amenities: list[str] = Field(default_factory=list, max_length=50)

    @field_validator("amenities")
    @classmethod
    def _trim(cls, v):
        return [a[:60] for a in v]


@app.get("/health")
def health():
    return {"status": "ok" if predictor.ready else "loading", "model_version": predictor.bundle["version"] if predictor.ready else None}


@app.post("/predict")
def predict(req: PredictRequest):
    if not predictor.ready:
        raise HTTPException(503, "Model not loaded")
    return predictor.predict(req.model_dump())


@app.get("/metrics")
def metrics():
    """Model accuracy info, consumed by the admin analytics dashboard."""
    if not predictor.ready:
        raise HTTPException(503, "Model not loaded")
    return predictor.metrics


@app.post("/admin/retrain")
def retrain():
    """Retrain from current dataset (Kaggle CSV if present). Internal network only in docker-compose."""
    from .train import train
    m = train()
    predictor.load(train_if_missing=False)
    return {"version": m["version"], "test_metrics": m["test_metrics"], "dataset": m["dataset"]}


class FraudListing(BaseModel):
    id: str | None = None
    owner_id: str | None = None
    title: str = ""
    description: str = ""
    city: str = Field(min_length=1)
    area: str = ""
    size_sqft: int = Field(ge=1)
    bhk: int = Field(ge=1)
    bathrooms: int = 1
    furnishing: str = "unfurnished"
    rent: int = Field(ge=1)
    amenities: list[str] = Field(default_factory=list)
    latitude: float | None = None
    longitude: float | None = None
    phashes: list[str] = Field(default_factory=list)
    embeddings: list[list[float]] = Field(default_factory=list)
    image_count: int | None = None


class Candidate(BaseModel):
    id: str
    owner_id: str | None = None
    title: str = ""
    description: str = ""
    rent: int | None = None
    size_sqft: int | None = None
    phashes: list[str] = Field(default_factory=list)
    embeddings: list[list[float]] = Field(default_factory=list)


class FraudRequest(BaseModel):
    listing: FraudListing
    predicted_rent: float | None = None
    candidates: list[Candidate] = Field(default_factory=list, max_length=500)


@app.post("/fraud/check")
def fraud_check(req: FraudRequest):
    """Risk score 0-100 from price anomalies, duplicate text/images and inconsistent data."""
    return assess(req.listing.model_dump(), req.predicted_rent, [c.model_dump() for c in req.candidates])


MAX_IMAGE_BYTES = 10 * 1024 * 1024


@app.post("/images/analyze")
async def images_analyze(file: UploadFile = File(...)):
    data = await file.read(MAX_IMAGE_BYTES + 1)
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "Image too large")
    try:
        return imgmod.analyze(data)
    except imgmod.BadImage as e:
        raise HTTPException(400, str(e))
