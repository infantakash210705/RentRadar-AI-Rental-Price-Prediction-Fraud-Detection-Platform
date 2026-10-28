/**
 * Runs the AI pipeline for a listing: rent prediction + fraud detection,
 * then decides status and raises fraud alerts. Fail-safe if ML is down.
 */
const config = require('../config');
const db = require('../db');
const logger = require('../logger');
const ml = require('./mlClient');

const HIGH_RISK = 70;
// ML models return floats; DB columns are integers. Also guards against NaN/garbage.
const toInt = (v) => (Number.isFinite(v) ? Math.round(v) : null);

async function analyzeListing(listingId) {
  const { rows } = await db.query('SELECT * FROM listings WHERE id = $1', [listingId]);
  const l = rows[0];
  if (!l) return null;

  // 1. Rent prediction
  const pred = await ml.predictRent({
    city: l.city, area: l.area, size_sqft: l.size_sqft, bhk: l.bhk,
    bathrooms: l.bathrooms, furnishing: l.furnishing, amenities: l.amenities,
  });

  // 2. Fraud inputs: own images + comparable listings in same city
  const [own, cands, exactDup] = await Promise.all([
    db.query('SELECT sha256, phash, embedding FROM listing_images WHERE listing_id = $1', [l.id]),
    db.query(
      `SELECT l2.id, l2.title, l2.description, l2.rent, l2.size_sqft, l2.owner_id,
              COALESCE(array_agg(i.phash) FILTER (WHERE i.phash IS NOT NULL), '{}') AS phashes,
              COALESCE(json_agg(i.embedding) FILTER (WHERE i.embedding IS NOT NULL), '[]') AS embeddings
         FROM listings l2 LEFT JOIN listing_images i ON i.listing_id = l2.id
        WHERE lower(l2.city) = lower($1) AND l2.id <> $2 AND l2.status IN ('approved','pending')
          AND l2.created_at < $3   -- first poster is presumed genuine: only compare against EARLIER listings
        GROUP BY l2.id ORDER BY l2.created_at DESC LIMIT 300`,
      [l.city, l.id, l.created_at]
    ),
    db.query(
      `SELECT DISTINCT i2.listing_id FROM listing_images i1
         JOIN listing_images i2 ON i1.sha256 = i2.sha256 AND i2.listing_id <> i1.listing_id
         JOIN listings l3 ON l3.id = i2.listing_id
        WHERE i1.listing_id = $1 AND l3.created_at < $2`,
      [l.id, l.created_at]
    ),
  ]);

  const fraud = await ml.checkFraud({
    listing: {
      id: l.id, title: l.title, description: l.description, city: l.city, area: l.area,
      size_sqft: l.size_sqft, bhk: l.bhk, bathrooms: l.bathrooms, furnishing: l.furnishing,
      rent: l.rent, amenities: l.amenities, owner_id: l.owner_id,
      latitude: l.latitude, longitude: l.longitude, image_count: own.rows.length,
      phashes: own.rows.map((r) => r.phash).filter(Boolean),
      embeddings: own.rows.map((r) => r.embedding).filter(Boolean),
    },
    predicted_rent: pred ? pred.predicted_rent : null,
    candidates: cands.rows,
  });

  // 3. Combine ML result with exact-duplicate-image check done in SQL
  let score = fraud ? fraud.risk_score : null;
  const flags = fraud ? [...fraud.flags] : [];
  if (exactDup.rows.length) {
    flags.push({
      type: 'duplicate_image_exact', severity: 'high',
      detail: `Identical image file also used in ${exactDup.rows.length} other listing(s)`,
      related_listing_ids: exactDup.rows.map((r) => r.listing_id),
    });
    score = Math.max(score ?? 0, HIGH_RISK);
  }
  if (!fraud) flags.push({ type: 'ml_unavailable', severity: 'info', detail: 'Fraud model unavailable; not scored' });

  // 4. Decide status (never override an admin ban)
  let status = l.status;
  if (status !== 'banned') {
    if (score === null) {
      status = config.autoApproveWhenMlDown ? 'approved' : 'pending';
    } else {
      status = score < config.autoApproveBelowRisk ? 'approved' : 'pending';
    }
  }

  await db.query(
    `UPDATE listings SET predicted_rent = $2, predicted_low = $3, predicted_high = $4,
            fraud_score = $5, fraud_flags = $6::jsonb, status = $7 WHERE id = $1`,
    [l.id, toInt(pred?.predicted_rent), toInt(pred?.low), toInt(pred?.high),
     toInt(score === null ? null : Math.min(100, Math.max(0, score))), JSON.stringify(flags), status]
  );

  if (score !== null && score >= config.autoApproveBelowRisk) {
    await db.query(
      `INSERT INTO fraud_alerts (listing_id, risk_score, flags)
       SELECT $1, $2, $3::jsonb
        WHERE NOT EXISTS (SELECT 1 FROM fraud_alerts WHERE listing_id = $1 AND status = 'open')`,
      [l.id, score, JSON.stringify(flags)]
    );
    logger.info({ listingId: l.id, score }, 'Listing flagged for review');
  }
  return { status, fraud_score: score, predicted_rent: toInt(pred?.predicted_rent) };
}

module.exports = { analyzeListing };
