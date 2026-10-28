# RentRadar REST API

Base URL: `http://localhost:4000/api`. JSON in/out. Send `Authorization: Bearer <token>` for authenticated routes.
Errors: `{ "error": { "code", "message", "details?" } }` with status 400 (validation), 401, 403, 404, 409, 429, 503.

## Auth & profile
| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/auth/signup` | – | `{name, email, password, phone?}` → `{user, token}` (password ≥8 chars with letter+digit). Role cannot be chosen |
| POST | `/auth/login` | – | `{email, password}` → `{user, token}` |
| GET | `/users/me` | user | Current user |
| PUT | `/users/me` | user | `{name?, phone?, currentPassword?, newPassword?}` |

## Listings
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/listings` | – | Search (approved only). Query: `q, city, minRent, maxRent, bhk, minBhk, furnishing, amenities (comma list, all must match), lat, lng, radius_km, sort (newest\|rent_asc\|rent_desc\|distance), page, limit(≤50)` → `{items, page, limit, total, total_pages}` |
| GET | `/listings/map` | – | Same filters plus `bbox=minLng,minLat,maxLng,maxLat` → `{items}` (≤500 light points) |
| GET | `/listings/:id` | optional | Approved listings are public. Owner/admin can see any status. Owner phone only when logged in. Admins also get `fraud_score`, `fraud_flags` |
| GET | `/listings/mine/all` | user | Own listings, any status |
| POST | `/listings` | user | Create. Runs prediction + fraud check; response `status` is `approved` or `pending`. Daily cap applies (429) |
| PUT | `/listings/:id` | owner/admin | Partial update; re-runs checks. Cannot un-ban |
| DELETE | `/listings/:id` | owner/admin | 204 |
| POST | `/listings/:id/images` | owner/admin | multipart, field `photos` (JPEG/PNG/WebP, ≤5 MB, ≤8 per listing) |
| DELETE | `/listings/:id/images/:imageId` | owner/admin | 204 |

Listing fields: `title, description, city, area, address?, latitude, longitude, size_sqft, bhk, bathrooms, furnishing (unfurnished|semi-furnished|furnished), rent, amenities[]`.
Output adds `predicted_rent`, `predicted_range [low, high]`, `price_verdict (fair|below_market|above_market)`, `status (pending|approved|rejected|banned)`.

## Helpers
| Method | Path | Notes |
|---|---|---|
| POST | `/predict` | `{city, area, size_sqft, bhk, bathrooms?, furnishing?, amenities?}` → `{predicted_rent, low, high, confidence}`; 503 `ml_unavailable` if the ML service is down |
| GET | `/meta/cities` | Cities with approved listings and counts |
| GET | `/health` | `{status, db}` |

## Messages & Conversations
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/messages/conversations` | user | List authenticated user's conversations with other participant, listing details, last message, unread count |
| POST | `/messages/conversations` | user | `{listing_id, initial_message?}` → `{conversation}`; creates or retrieves conversation between renter and owner; cannot message own listing |
| GET | `/messages/conversations/:id` | user | Conversation details (participants only) |
| GET | `/messages/conversations/:id/messages` | user | Message history (participants only); automatically marks incoming unread messages as read |
| POST | `/messages/conversations/:id/messages` | user | `{body}` → `{message}`; sends message, updates conversation, notifies recipient |

## Notifications
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/notifications` | user | `?page&limit` → paginated notifications with unread count |
| GET | `/notifications/unread-count` | user | `{unread_count}` (lightweight poll endpoint) |
| PATCH | `/notifications/:id/read` | user | Mark one notification as read |
| PATCH | `/notifications/read-all` | user | Mark all user notifications as read |

## Admin (admin role required, re-checked on every request)
| Method | Path | Notes |
|---|---|---|
| GET | `/admin/alerts` | `?status=open\|resolved&page&limit` ordered by risk |
| POST | `/admin/alerts/:id/resolve` | `{action: approve\|reject\|ban, ban_owner?, note?}` transactional; 409 if already resolved |
| GET | `/admin/listings` | `?status&q&page&limit` |
| PATCH | `/admin/listings/:id` | `{status}`; leaving `pending` closes the open alert |
| GET | `/admin/users` | `?q&page&limit` with listing counts |
| PATCH | `/admin/users/:id` | `{is_banned?, role?}`; ban hides their listings, unban returns them to review; cannot target yourself |
| GET | `/admin/stats` | Counts, per-day series, verdict split, fraud stats incl. flag precision, ML model accuracy |

## ML service (internal, port 8000)
| Method | Path | Notes |
|---|---|---|
| POST | `/predict` | Rent estimate + range + confidence |
| POST | `/fraud/check` | `{listing, predicted_rent, candidates[]}` → `{risk_score 0-100, flags[], category_scores, model_version}` |
| POST | `/images/analyze` | multipart `file` → `{phash, embedding, width, height}` |
| GET | `/metrics`, `/health` | Model accuracy / status |
| POST | `/admin/retrain` | Retrains from the current dataset. **No auth; keep the service on the internal network** |
