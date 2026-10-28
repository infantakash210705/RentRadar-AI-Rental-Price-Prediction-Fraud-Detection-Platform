const config = require('../config');
const db = require('../db');

const FAIR_BAND = 0.15; // +/-15% around predicted rent counts as "fair"

function priceVerdict(rent, predicted) {
  if (!predicted) return null;
  const diff = (rent - predicted) / predicted;
  if (diff > FAIR_BAND) return 'above_market';
  if (diff < -FAIR_BAND) return 'below_market';
  return 'fair';
}

/** Shape a listing row for API output. Fraud internals only go to admins. */
function serialize(row, { admin = false, owner = false, authed = false } = {}) {
  const out = {
    id: row.id,
    owner_id: row.owner_id,
    owner_name: row.owner_name,
    title: row.title,
    description: row.description,
    city: row.city,
    area: row.area,
    address: row.address,
    latitude: row.latitude,
    longitude: row.longitude,
    size_sqft: row.size_sqft,
    bhk: row.bhk,
    bathrooms: row.bathrooms,
    furnishing: row.furnishing,
    rent: row.rent,
    amenities: row.amenities,
    status: row.status,
    predicted_rent: row.predicted_rent,
    predicted_range: row.predicted_low ? [row.predicted_low, row.predicted_high] : null,
    price_verdict: priceVerdict(row.rent, row.predicted_rent),
    cover_image: row.cover_image || null,
    images: row.images,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
  if (row.distance_m !== undefined) out.distance_km = Math.round(row.distance_m / 100) / 10;
  if (admin || owner || authed) out.owner_phone = row.owner_phone; // contact details need a login (anti-scraping)
  if (admin) {
    out.fraud_score = row.fraud_score;
    out.fraud_flags = row.fraud_flags;
  }
  if (owner && !admin) out.fraud_score = undefined; // owners see status only
  return out;
}

function buildFilters(q, startIdx = 1) {
  const where = [`l.status = 'approved'`];
  const params = [];
  const add = (v) => { params.push(v); return `$${startIdx + params.length - 1}`; };

  if (q.city) where.push(`lower(l.city) = lower(${add(q.city)})`);
  if (q.q) {
    const tsq = add(q.q);
    const like = add(`%${q.q.replace(/[%_\\]/g, '\\$&')}%`);
    where.push(`(l.search_vector @@ plainto_tsquery('simple', ${tsq}) OR l.area ILIKE ${like} OR l.title ILIKE ${like})`);
  }
  if (q.minRent !== undefined) where.push(`l.rent >= ${add(q.minRent)}`);
  if (q.maxRent !== undefined) where.push(`l.rent <= ${add(q.maxRent)}`);
  if (q.bhk !== undefined) where.push(`l.bhk = ${add(q.bhk)}`);
  if (q.minBhk !== undefined) where.push(`l.bhk >= ${add(q.minBhk)}`);
  if (q.furnishing) where.push(`l.furnishing = ${add(q.furnishing)}`);
  if (q.amenities && q.amenities.length) where.push(`l.amenities @> ${add(q.amenities)}::text[]`);
  if (q.lat !== undefined && q.radius_km !== undefined) {
    where.push(`ST_DWithin(l.location, ST_SetSRID(ST_MakePoint(${add(q.lng)}, ${add(q.lat)}), 4326)::geography, ${add(q.radius_km * 1000)})`);
  }
  if (q.bbox) {
    const [minLng, minLat, maxLng, maxLat] = q.bbox.split(',').map(Number);
    where.push(`l.location::geometry && ST_MakeEnvelope(${add(minLng)}, ${add(minLat)}, ${add(maxLng)}, ${add(maxLat)}, 4326)`);
  }
  return { where: where.join(' AND '), params };
}

async function search(q) {
  const { where, params } = buildFilters(q);
  const idx = (v) => { params.push(v); return `$${params.length}`; };

  let distanceSql = '';
  let orderSql = 'l.created_at DESC';
  if (q.lat !== undefined) {
    const lng = idx(q.lng); const lat = idx(q.lat);
    distanceSql = `, ST_Distance(l.location, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography) AS distance_m`;
    if (q.sort === 'distance') orderSql = 'distance_m ASC';
  }
  if (q.sort === 'rent_asc') orderSql = 'l.rent ASC, l.created_at DESC';
  if (q.sort === 'rent_desc') orderSql = 'l.rent DESC, l.created_at DESC';

  const limit = idx(q.limit);
  const offset = idx((q.page - 1) * q.limit);
  const { rows } = await db.query(
    `SELECT l.*, u.name AS owner_name,
            (SELECT url FROM listing_images i WHERE i.listing_id = l.id ORDER BY position LIMIT 1) AS cover_image,
            count(*) OVER() AS total_count ${distanceSql}
       FROM listings l JOIN users u ON u.id = l.owner_id
      WHERE ${where}
      ORDER BY ${orderSql}
      LIMIT ${limit} OFFSET ${offset}`,
    params
  );
  const total = rows[0] ? Number(rows[0].total_count) : 0;
  return {
    items: rows.map((r) => serialize(r)),
    page: q.page,
    limit: q.limit,
    total,
    total_pages: Math.ceil(total / q.limit),
  };
}

async function mapPoints(q) {
  const { where, params } = buildFilters(q);
  const { rows } = await db.query(
    `SELECT l.id, l.title, l.latitude, l.longitude, l.rent, l.bhk, l.area, l.predicted_rent,
            (SELECT url FROM listing_images i WHERE i.listing_id = l.id ORDER BY position LIMIT 1) AS cover_image
       FROM listings l WHERE ${where}
      ORDER BY l.created_at DESC LIMIT 500`,
    params
  );
  return rows.map((r) => ({ ...r, price_verdict: priceVerdict(r.rent, r.predicted_rent), predicted_rent: undefined }));
}

async function getById(id) {
  const { rows } = await db.query(
    `SELECT l.*, u.name AS owner_name, u.phone AS owner_phone,
            COALESCE((SELECT json_agg(json_build_object('id', i.id, 'url', i.url) ORDER BY i.position)
                        FROM listing_images i WHERE i.listing_id = l.id), '[]') AS images,
            (SELECT url FROM listing_images i WHERE i.listing_id = l.id ORDER BY position LIMIT 1) AS cover_image
       FROM listings l JOIN users u ON u.id = l.owner_id WHERE l.id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function listByOwner(ownerId) {
  const { rows } = await db.query(
    `SELECT l.*, u.name AS owner_name, u.phone AS owner_phone,
            (SELECT url FROM listing_images i WHERE i.listing_id = l.id ORDER BY position LIMIT 1) AS cover_image
       FROM listings l JOIN users u ON u.id = l.owner_id
      WHERE l.owner_id = $1 ORDER BY l.created_at DESC`,
    [ownerId]
  );
  return rows;
}

module.exports = { serialize, search, mapPoints, getById, listByOwner, priceVerdict, config };
