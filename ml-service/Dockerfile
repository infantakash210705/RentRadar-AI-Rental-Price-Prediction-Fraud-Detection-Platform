FROM python:3.12-slim
# libgomp is required by xgboost / scikit-learn
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 curl && rm -rf /var/lib/apt/lists/*
WORKDIR /srv
COPY ml-service/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY ml-service/app ./app
COPY ml-service/data ./data
# Train at build time so the container starts instantly. Uses data/House_Rent_Dataset.csv if present, else synthetic data.
RUN python -m app.train
RUN useradd -m -u 10001 ml && chown -R ml /srv
USER ml
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD curl -fs http://localhost:8000/health || exit 1
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
