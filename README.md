# RentRadar: AI Rental Price Prediction & Fraud Detection

A rental marketplace where owners post homes, renters search them on a map, every listing gets an
**AI-estimated fair rent**, and suspicious listings are caught automatically and sent to an admin review queue.

```
 Browser ──► Next.js frontend (3000) ──► Express API (4000) ──► PostgreSQL + PostGIS
                                              │
                                              └──► FastAPI ML service (8000, internal)
                                                    • rent prediction (XGBoost / RF / Ridge, best wins)
                                                    • fraud scoring (rules + Isolation Forest + TF-IDF + image hashing)
```

**Everything is free.** Maps are OpenStreetMap (via Leaflet), address search is Nominatim, images are stored on disk, and
the database runs in Docker. **No third-party API key is needed.**

## Quick start (Docker)

Requires Docker with Compose v2.

```bash
cp .env.example .env.local
# edit .env.local and fill the REQUIRED values (database password, JWT secret, admin password)
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # paste the output as JWT_SECRET

docker compose --env-file .env.local up --build
```

Open **http://localhost:3000**. Log in as the admin with `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env.local`
(the account is created automatically on startup).

Optional demo data (≈68 listings across 8 cities, including a few deliberately suspicious ones for the admin queue):

```bash
docker compose exec -e DEMO_PASSWORD=ChooseOne123 backend node src/scripts/seedDemo.js
```

The first `docker compose up --build` is slow (it installs Python ML libraries and trains the model). Later starts are fast.

## Environment variables (`.env.local`)

| Variable | Required | Purpose |
|---|---|---|
| `POSTGRES_PASSWORD` | **yes** | Password for the Docker database |
| `JWT_SECRET` | **yes** | Signs login tokens (≥16 chars; generate with the command above). The API refuses to start in production without it |
| `ADMIN_PASSWORD` | **yes** | Password of the auto-created admin account (min 8 chars) |
| `ADMIN_EMAIL` | no | Admin login email (default `admin@rentradar.local`) |
| `NEXT_PUBLIC_API_URL` | no | URL the **browser** uses to reach the API (default `http://localhost:4000`). Baked in at build time: change it, then rebuild the frontend |
| `CORS_ORIGINS` | no | Allowed website origins, comma-separated (default `http://localhost:3000`) |
| `AUTO_APPROVE_BELOW_RISK` | no | Fraud score under this is published automatically (default 40) |
| `AUTO_APPROVE_WHEN_ML_DOWN` | no | Keep listings flowing if the ML service is down (default `true`) |
| `MAX_IMAGE_MB`, `MAX_IMAGES_PER_LISTING`, `MAX_LISTINGS_PER_DAY` | no | Upload and spam limits (5, 8, 10) |

## Running without Docker (development)

Prerequisites: Node 20+, Python 3.12, PostgreSQL 16 with PostGIS.

```bash
# 1. Database
createdb rentradar && psql rentradar -c "CREATE EXTENSION postgis"       # then set DATABASE_URL in .env.local

# 2. ML service (first start trains the model, ~30 s)
cd ml-service && python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --port 8000

# 3. Backend
cd backend && npm install
npm run migrate && npm run seed:admin && npm run dev                      # API on :4000

# 4. Frontend
cd frontend && npm install && npm run dev                                 # site on :3000
```

## Using your own rent data (recommended for real accuracy)

Out of the box the model trains on **synthetic** data, and the admin overview says so. For real-world accuracy,
download the Kaggle *House Rent Prediction Dataset*, save it as `ml-service/data/House_Rent_Dataset.csv`, and rebuild
(`docker compose build ml-service && docker compose up -d`) or run `python -m app.train`. See `ml-service/data/README.md`.

## Tests

```bash
cd backend    && npm test        # 94 tests, real PostgreSQL + PostGIS (needs a database named rentradar_test)
cd ml-service && python -m pytest  # 66 tests
cd frontend   && npm test        # 36 tests
```

Backend tests connect to `TEST_DATABASE_URL` (default `postgres://rentradar:rentradar_dev@localhost:5432/rentradar_test`).

## How it works

**Rent prediction.** Features: city, area, size, BHK, bathrooms, furnishing and 12 amenity flags. Ridge, Random Forest and
XGBoost are trained and compared on held-out data; the lowest-error model is used. Each prediction comes with a range
(10th–90th percentile of out-of-fold errors). Listings are labelled *fair* within ±15% of the estimate, otherwise *above* or *below market*.

**Fraud detection.** Independent signals are combined into a 0–100 risk score (probability-style "noisy-OR"):

| Signal | How |
|---|---|
| Price anomalies | Rent vs AI estimate (far below = "too good to be true"); Isolation Forest on price/size/rooms |
| Duplicate text | TF-IDF cosine similarity vs earlier listings (different owner = copied; same owner = repost) |
| Duplicate images | Exact SHA-256 match plus perceptual hash and embedding cosine similarity. Survives resizing and recompression |
| Inconsistent data | Size vs BHK, "3BHK" in the title but 2 in the field, map pin far from the city, scam phrasing, off-platform contact details |

Score < 40 is published automatically; otherwise the listing is held as *pending* and appears in **Admin → Fraud alerts**.
Duplicates are only judged against *earlier* listings, so the original poster is never penalised for being copied.
The image comparison uses perceptual hashing and cosine similarity (an option in the brief) rather than a trained Siamese
network, because a Siamese model needs a large labelled set of matching/non-matching image pairs.

**Admin panel** (`/admin`): fraud alert queue (approve / reject / ban, optionally ban the owner), listing moderation,
user management, and analytics including model accuracy and how often flagged listings turn out to be real problems.

## Security

JWT auth with the user re-checked in the database on every request (bans and demotions apply instantly), bcrypt passwords,
Helmet, CORS allow-list, rate limits (global, auth, writes, uploads), a daily per-user listing cap, zod validation on every
input, HTML stripping, parameterised SQL, image content checked by magic bytes (not file extension) with size/count limits,
owner phone numbers only shown to logged-in users, and the ML service not published outside the Docker network.

## Known limitations

- **Synthetic training data by default**: accuracy numbers shown in the admin panel then describe the data generator, not the real market.
- Fraud thresholds are calibrated on synthetic data. Expect to tune them (`AUTO_APPROVE_BELOW_RISK`, weights in `ml-service/app/fraud/rules.py`) once you see real listings.
- A listing priced far *above* market is approved with an "above market" label rather than blocked, because overpricing alone is not fraud.
- Images are stored on local disk (a Docker volume). For multiple servers, switch to object storage.
- Nominatim (address search) and OpenStreetMap tiles are free public services with usage policies. They suit demos and small sites; high traffic needs your own tile/geocoding provider.
- `db/schema.sql` is applied idempotently on startup; there is no versioned migration tool yet.

## Project layout

```
backend/      Express API, tests (jest)              ml-service/   FastAPI: app/ (models), app/fraud/, tests/
frontend/     Next.js + Tailwind, tests (vitest)     db/           schema.sql (PostGIS)
docs/API.md   REST API reference                     PROGRESS.md   build log and decisions
```

## Troubleshooting

- **Site loads but "Cannot reach the server"**: `NEXT_PUBLIC_API_URL` must be reachable from your *browser*; rebuild the frontend after changing it.
- **No AI price shown / "price suggestion unavailable"**: the ML service is down or still starting; listings still post (`docker compose logs ml-service`).
- **CORS errors**: add your site's origin to `CORS_ORIGINS`.
- **Port already in use**: change `BACKEND_PORT`, or stop whatever uses 3000/4000/5432.
