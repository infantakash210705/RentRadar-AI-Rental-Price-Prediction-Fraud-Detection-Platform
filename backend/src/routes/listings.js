const router = require('express').Router();
const multer = require('multer');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const db = require('../db');
const config = require('../config');
const schemas = require('../utils/schemas');
const svc = require('../services/listingService');
const { analyzeListing } = require('../services/listingAnalysis');
const ml = require('../services/mlClient');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const rl = require('../middleware/rateLimit');
const { detectImageType, sha256 } = require('../utils/images');
const { AppError, badRequest, forbidden, notFound } = require('../utils/errors');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxImageBytes, files: config.maxImagesPerListing },
});

// ---------- Public search ----------
router.get('/', async (req, res) => {
  res.json(await svc.search(schemas.searchQuery.parse(req.query)));
});

router.get('/map', async (req, res) => {
  const q = schemas.searchQuery.parse(req.query);
  res.json({ items: await svc.mapPoints(q) });
});

// ---------- Owner's listings (must come before /:id) ----------
router.get('/mine/all', requireAuth, async (req, res) => {
  const rows = await svc.listByOwner(req.user.id);
  res.json({ items: rows.map((r) => svc.serialize(r, { owner: true })) });
});

router.get('/:id', optionalAuth, async (req, res) => {
  const row = await svc.getById(req.params.id);
  if (!row) throw notFound('Listing not found');
  const isAdmin = req.user?.role === 'admin';
  const isOwner = req.user?.id === row.owner_id;
  if (row.status !== 'approved' && !isAdmin && !isOwner) throw notFound('Listing not found');
  res.json({ listing: svc.serialize(row, { admin: isAdmin, owner: isOwner, authed: !!req.user }) });
});

// ---------- Create / update / delete ----------
router.post('/', requireAuth, rl.write, async (req, res) => {
  const data = schemas.listingCreate.parse(req.body);

  const { rows: cnt } = await db.query(
    `SELECT count(*)::int AS n FROM listings WHERE owner_id = $1 AND created_at > now() - interval '24 hours'`,
    [req.user.id]
  );
  if (cnt[0].n >= config.maxListingsPerDay) {
    throw new AppError(429, 'Daily listing limit reached', 'rate_limited');
  }

  const { rows } = await db.query(
    `INSERT INTO listings (owner_id, title, description, city, area, address, latitude, longitude,
                           size_sqft, bhk, bathrooms, furnishing, rent, amenities)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
    [req.user.id, data.title, data.description, data.city, data.area, data.address || null,
     data.latitude, data.longitude, data.size_sqft, data.bhk, data.bathrooms, data.furnishing,
     data.rent, data.amenities]
  );
  await analyzeListing(rows[0].id);
  const listing = await svc.getById(rows[0].id);
  res.status(201).json({ listing: svc.serialize(listing, { owner: true }) });
});

async function loadOwned(req) {
  const row = await svc.getById(req.params.id);
  if (!row) throw notFound('Listing not found');
  if (row.owner_id !== req.user.id && req.user.role !== 'admin') throw forbidden('Not your listing');
  return row;
}

router.put('/:id', requireAuth, rl.write, async (req, res) => {
  const existing = await loadOwned(req);
  const data = schemas.listingUpdate.parse(req.body);

  const sets = [];
  const params = [existing.id];
  for (const [col, v] of Object.entries(data)) {
    params.push(v);
    sets.push(`${col} = $${params.length}`);
  }
  // A rejected listing goes back for re-review after the owner edits it
  if (existing.status === 'rejected') sets.push(`status = 'pending'`);
  await db.query(`UPDATE listings SET ${sets.join(', ')} WHERE id = $1`, params);

  await analyzeListing(existing.id);
  const listing = await svc.getById(existing.id);
  res.json({ listing: svc.serialize(listing, { owner: true, admin: req.user.role === 'admin' }) });
});

router.delete('/:id', requireAuth, rl.write, async (req, res) => {
  const existing = await loadOwned(req);
  const { rows } = await db.query('SELECT filename FROM listing_images WHERE listing_id = $1', [existing.id]);
  await db.query('DELETE FROM listings WHERE id = $1', [existing.id]);
  await Promise.all(rows.map((r) => fs.unlink(path.join(config.uploadDir, r.filename)).catch(() => {})));
  res.status(204).end();
});

// ---------- Images ----------
router.post('/:id/images', requireAuth, rl.upload, upload.array('photos', config.maxImagesPerListing), async (req, res) => {
  const existing = await loadOwned(req);
  const files = req.files || [];
  if (!files.length) throw badRequest('No images uploaded (use field name "photos")');

  const { rows: cnt } = await db.query('SELECT count(*)::int AS n FROM listing_images WHERE listing_id = $1', [existing.id]);
  if (cnt[0].n + files.length > config.maxImagesPerListing) {
    throw badRequest(`A listing can have at most ${config.maxImagesPerListing} images`);
  }

  // Validate all files before writing any
  const checked = files.map((f) => {
    const type = detectImageType(f.buffer);
    if (!type) throw badRequest(`"${f.originalname}" is not a valid JPEG, PNG or WebP image`);
    return { buffer: f.buffer, type, hash: sha256(f.buffer) };
  });

  await fs.mkdir(config.uploadDir, { recursive: true });
  let position = cnt[0].n;
  const inserted = [];
  for (const c of checked) {
    const filename = `${crypto.randomUUID()}.${c.type.ext}`;
    await fs.writeFile(path.join(config.uploadDir, filename), c.buffer);
    const fp = (await ml.analyzeImage(c.buffer, filename, c.type.mime)) || {}; // null-safe: ML down => no fingerprint
    const { rows } = await db.query(
      `INSERT INTO listing_images (listing_id, url, filename, sha256, phash, embedding, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, url`,
      [existing.id, `/uploads/${filename}`, filename, c.hash, fp.phash || null, fp.embedding || null, position++]
    );
    inserted.push(rows[0]);
  }
  await analyzeListing(existing.id); // re-run fraud checks now that images exist
  const listing = await svc.getById(existing.id);
  res.status(201).json({ images: inserted, listing: svc.serialize(listing, { owner: true, admin: req.user.role === 'admin' }) });
});

router.delete('/:id/images/:imageId', requireAuth, async (req, res) => {
  const existing = await loadOwned(req);
  const { rows } = await db.query(
    'DELETE FROM listing_images WHERE id = $1 AND listing_id = $2 RETURNING filename',
    [req.params.imageId, existing.id]
  );
  if (!rows[0]) throw notFound('Image not found');
  await fs.unlink(path.join(config.uploadDir, rows[0].filename)).catch(() => {});
  res.status(204).end();
});

module.exports = router;
