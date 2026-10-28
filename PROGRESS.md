# RentRadar - Progress Tracker
> To continue in a new chat: upload the latest zip and say "continue from PROGRESS.md".

## Decisions
- Maps: Leaflet + OpenStreetMap (free, no key). Geocoding: Nominatim.
- Images: local disk (`/uploads`). Backend: Express 5, zod, JWT, pg. DB: PostgreSQL 16 + PostGIS.
- Cosine-similarity image matching (not Siamese) - no labelled pairs available.
- ML contract (backend -> ML service):
  - `POST /predict` {city, area, size_sqft, bhk, bathrooms, furnishing, amenities[]} -> {predicted_rent, low, high, model_version}
  - `POST /fraud/check` {listing{..., phashes[], embeddings[]}, predicted_rent, candidates[]} -> {risk_score 0-100, flags[{type,severity,detail}], model_version}
  - Backend rounds floats, treats ML failure as null (fail-safe).

## Phases
- [x] **1. Database + backend auth & listings API** (53 tests passing against real PostgreSQL+PostGIS)
  - schema, JWT auth, profile, listing CRUD, search/filters, PostGIS radius + bbox map endpoint,
    image upload (magic-byte validated), rate limits, daily cap, exact-duplicate-image check,
    AI pipeline hook (`services/listingAnalysis.js`), fraud_alerts table
  - Benchmarked: 100k listings, all searches < 450 ms (target < 2 s)
- [x] **2. ML service** (34 pytest tests passing; verified end-to-end with the real backend)
  - `ml-service/app`: features.py (shared), data.py (Kaggle CSV loader + synthetic generator), train.py (Ridge vs RF vs XGBoost, auto-picks best by MAE,
    out-of-fold prediction intervals, market stats), predictor.py, main.py (/health /predict /metrics /admin/retrain)
  - Synthetic data has interactions so XGBoost wins on merit. Metrics note says 'synthetic' until a real CSV is used.
- [x] **3. Fraud detection** (ML: 66 pytest tests, backend: 55 jest tests, all passing; verified full-stack with real services)
  - `ml-service/app/fraud/`: rules.py (price/text/consistency), images.py (phash + 88-dim embedding, cosine), anomaly.py (IsolationForest),
    scorer.py (noisy-OR -> 0-100), endpoints `POST /fraud/check`, `POST /images/analyze`
  - Backend stores phash/embedding on upload, sends lat/lng + image_count; status auto-approve < 40, else pending + fraud_alert
  - Measured (synthetic data): 0% false positives on legit listings; rent <=30% of fair price -> 100% flagged; 50% -> ~half; 3x overpriced -> ~15% (approved with 'above_market' badge by design)
  - Real stolen-photo test (resized + JPEG q55 copy) caught via perceptual hash
- [x] **4. Frontend** (Next.js 15 + Tailwind 4 + Leaflet/OpenStreetMap; `next build` passes strict TS; 27 vitest tests; backend now 60 jest tests)
  - Pages: / (search + filters + live map, URL-synced), /listings/[id], /listings/new, /listings/[id]/edit, /dashboard, /profile, /login, /signup
  - Signature element: FairPriceGauge (asking rent vs AI expected range). Live AI rent suggestion in the post form (`POST /api/predict`).
  - Backend additions: `POST /api/predict`, `GET /api/meta/cities`; owner phone visible to logged-in users only.
  - Gotchas solved: explicit webpack `@` alias in next.config.mjs (tsconfig paths alone failed to resolve); TypeScript pinned to 5.x (TS 7 unsupported by Next 15).
  - NOT verifiable here: real-browser rendering (Leaflet map, layout/visual polish). Smoke-tested via HTTP only; check visually on your machine.
- [x] **5. Admin panel** (backend 92 jest tests, frontend 36 vitest tests; verified over real HTTP against real DB + ML service)
  - API `/api/admin/*` (admin-only, role re-checked from DB on every request): alerts queue + resolve (approve/reject/ban, optional ban owner, transactional),
    listings moderation, user management (ban hides listings; unban -> back to review; cannot modify self), analytics (counts, per-day, verdicts, flag types,
    flag precision from admin decisions, ML model accuracy via ML `/metrics`)
  - UI `/admin` (overview + model accuracy), `/admin/alerts`, `/admin/listings`, `/admin/users`
  - Mutation-tested: removing the admin role check fails 8 access-control tests.
- [x] **6. Final packaging**: Dockerfiles for all services + full docker-compose, README, docs/API.md, demo seed script, pinned ML deps (xgboost-cpu), final zip.
  - Final test totals: backend 94, ML 66, frontend 36 (all passing), `next build` OK.
  - Late fixes: duplicate detection only compares against EARLIER listings (original poster never flagged for being copied); demo data uses varied descriptions.
  - Docker images were NOT built here (no Docker in the build sandbox). Verified instead: backend runs with prod-only deps, frontend standalone output serves pages+assets,
    ML installs from pinned requirements in a clean venv and passes all tests, compose YAML validates. First `docker compose up --build` on your machine is the real end-to-end check.

## Known notes
- Docker files written but NOT executed here (no Docker in build environment) - verify with `docker compose up --build`.
- Frontend env: set `NEXT_PUBLIC_API_URL` (build-time) - add to docker-compose build args in Phase 6.
- Frontend/ML Docker images + compose services still to add (Phase 6).

- Sandbox quirk (not an app issue): PostgreSQL/background servers stop between tool calls; start them inside the same command when testing.
