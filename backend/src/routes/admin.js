const router = require('express').Router();
const db = require('../db');
const schemas = require('../utils/schemas');
const ml = require('../services/mlClient');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { badRequest, conflict, notFound } = require('../utils/errors');

router.use(requireAuth, requireAdmin);

const esc = (s) => `%${s.replace(/[%_\\]/g, '\\$&')}%`;
const paged = (rows, q) => {
  const total = rows[0] ? Number(rows[0].total_count) : 0;
  return { items: rows.map(({ total_count, ...r }) => r), page: q.page, limit: q.limit, total, total_pages: Math.ceil(total / q.limit) };
};
const COVER = `(SELECT url FROM listing_images i WHERE i.listing_id = l.id ORDER BY position LIMIT 1)`;

// ---------- Fraud alerts ----------
router.get('/alerts', async (req, res) => {
  const q = schemas.adminAlertsQuery.parse(req.query);
  const { rows } = await db.query(
    `SELECT a.id, a.listing_id, a.risk_score, a.flags, a.status, a.resolution, a.created_at, a.resolved_at,
            l.title, l.city, l.area, l.rent, l.predicted_rent, l.size_sqft, l.bhk, l.status AS listing_status,
            l.owner_id, u.name AS owner_name, u.email AS owner_email, u.is_banned AS owner_banned,
            ${COVER} AS cover_image, count(*) OVER() AS total_count
       FROM fraud_alerts a JOIN listings l ON l.id = a.listing_id JOIN users u ON u.id = l.owner_id
      WHERE a.status = $1
      ORDER BY a.risk_score DESC, a.created_at DESC LIMIT $2 OFFSET $3`,
    [q.status, q.limit, (q.page - 1) * q.limit]
  );
  res.json(paged(rows, q));
});

router.post('/alerts/:id/resolve', async (req, res) => {
  const body = schemas.adminResolve.parse(req.body);
  const newStatus = { approve: 'approved', reject: 'rejected', ban: 'banned' }[body.action];
  const resolution = { approve: 'approved', reject: 'rejected', ban: 'banned' }[body.action];

  const out = await db.tx(async (c) => {
    const { rows } = await c.query('SELECT * FROM fraud_alerts WHERE id = $1 FOR UPDATE', [req.params.id]);
    const alert = rows[0];
    if (!alert) throw notFound('Alert not found');
    if (alert.status === 'resolved') throw conflict('Alert was already resolved');
    const { rows: ls } = await c.query('UPDATE listings SET status = $2 WHERE id = $1 RETURNING owner_id', [alert.listing_id, newStatus]);
    await c.query(
      `UPDATE fraud_alerts SET status = 'resolved', resolution = $2, resolved_by = $3, resolved_at = now() WHERE id = $1`,
      [alert.id, body.note ? `${resolution}: ${body.note}` : resolution, req.user.id]
    );
    if (body.ban_owner) {
      if (ls[0].owner_id === req.user.id) throw badRequest('You cannot ban your own account');
      await c.query('UPDATE users SET is_banned = true WHERE id = $1', [ls[0].owner_id]);
      await c.query(`UPDATE listings SET status = 'banned' WHERE owner_id = $1`, [ls[0].owner_id]);
    }
    return { id: alert.id, listing_id: alert.listing_id, listing_status: body.ban_owner ? 'banned' : newStatus, owner_banned: body.ban_owner };
  });
  res.json(out);
});

// ---------- Listings moderation ----------
router.get('/listings', async (req, res) => {
  const q = schemas.adminListingsQuery.parse(req.query);
  const params = []; const where = ['TRUE'];
  if (q.status) { params.push(q.status); where.push(`l.status = $${params.length}`); }
  if (q.q) { params.push(esc(q.q)); where.push(`(l.title ILIKE $${params.length} OR l.city ILIKE $${params.length} OR l.area ILIKE $${params.length} OR u.email ILIKE $${params.length})`); }
  params.push(q.limit, (q.page - 1) * q.limit);
  const { rows } = await db.query(
    `SELECT l.id, l.title, l.city, l.area, l.rent, l.predicted_rent, l.status, l.fraud_score, l.created_at,
            u.id AS owner_id, u.name AS owner_name, u.email AS owner_email, ${COVER} AS cover_image, count(*) OVER() AS total_count
       FROM listings l JOIN users u ON u.id = l.owner_id
      WHERE ${where.join(' AND ')} ORDER BY l.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  res.json(paged(rows, q));
});

router.patch('/listings/:id', async (req, res) => {
  const { status } = schemas.adminListingStatus.parse(req.body);
  const { rows } = await db.query('UPDATE listings SET status = $2 WHERE id = $1 RETURNING id, status', [req.params.id, status]);
  if (!rows[0]) throw notFound('Listing not found');
  // Moving a listing out of review closes its open alert
  if (status !== 'pending') {
    await db.query(
      `UPDATE fraud_alerts SET status = 'resolved', resolution = $2, resolved_by = $3, resolved_at = now()
        WHERE listing_id = $1 AND status = 'open'`,
      [req.params.id, status, req.user.id]
    );
  }
  res.json({ listing: rows[0] });
});

// ---------- Users ----------
router.get('/users', async (req, res) => {
  const q = schemas.adminUsersQuery.parse(req.query);
  const params = []; let where = 'TRUE';
  if (q.q) { params.push(esc(q.q)); where = `(u.name ILIKE $1 OR u.email ILIKE $1)`; }
  params.push(q.limit, (q.page - 1) * q.limit);
  const { rows } = await db.query(
    `SELECT u.id, u.name, u.email, u.phone, u.role, u.is_banned, u.created_at,
            (SELECT count(*)::int FROM listings l WHERE l.owner_id = u.id) AS listing_count,
            (SELECT count(*)::int FROM listings l WHERE l.owner_id = u.id AND l.status IN ('pending','banned','rejected')) AS problem_listings,
            count(*) OVER() AS total_count
       FROM users u WHERE ${where} ORDER BY u.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  res.json(paged(rows, q));
});

router.patch('/users/:id', async (req, res) => {
  const body = schemas.adminUserPatch.parse(req.body);
  if (req.params.id === req.user.id) throw badRequest('You cannot change your own account here');
  const out = await db.tx(async (c) => {
    const { rows: cur } = await c.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!cur[0]) throw notFound('User not found');
    const sets = []; const params = [req.params.id];
    for (const [k, v] of Object.entries(body)) { params.push(v); sets.push(`${k} = $${params.length}`); }
    const { rows } = await c.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $1 RETURNING id, name, email, role, is_banned`, params);
    if (body.is_banned === true) await c.query(`UPDATE listings SET status = 'banned' WHERE owner_id = $1`, [req.params.id]);
    // Unbanning does not auto-publish: previously banned listings go back to review
    if (body.is_banned === false) await c.query(`UPDATE listings SET status = 'pending' WHERE owner_id = $1 AND status = 'banned'`, [req.params.id]);
    return rows[0];
  });
  res.json({ user: out });
});

// ---------- Analytics ----------
router.get('/stats', async (req, res) => {
  const q = (sql, p) => db.query(sql, p).then((r) => r.rows);
  const [users, byStatus, perDay, verdicts, flagTypes, alerts, scores, metrics] = await Promise.all([
    q(`SELECT count(*)::int AS total, count(*) FILTER (WHERE is_banned)::int AS banned, count(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS new_7d FROM users`),
    q(`SELECT status, count(*)::int AS n FROM listings GROUP BY status`),
    q(`SELECT to_char(d, 'YYYY-MM-DD') AS day, COALESCE(count(l.id), 0)::int AS n
         FROM generate_series(current_date - 13, current_date, '1 day') d
         LEFT JOIN listings l ON l.created_at::date = d::date GROUP BY d ORDER BY d`),
    q(`SELECT CASE WHEN rent > predicted_rent * 1.15 THEN 'above_market' WHEN rent < predicted_rent * 0.85 THEN 'below_market' ELSE 'fair' END AS verdict,
              count(*)::int AS n FROM listings WHERE predicted_rent IS NOT NULL AND status = 'approved' GROUP BY 1`),
    q(`SELECT f->>'type' AS type, count(*)::int AS n FROM fraud_alerts a, jsonb_array_elements(a.flags) f
        WHERE f->>'severity' <> 'info' GROUP BY 1 ORDER BY n DESC LIMIT 8`),
    q(`SELECT count(*) FILTER (WHERE status = 'open')::int AS open, count(*)::int AS total,
              count(*) FILTER (WHERE resolution LIKE 'approved%')::int AS approved,
              count(*) FILTER (WHERE resolution LIKE 'rejected%' OR resolution LIKE 'banned%')::int AS confirmed FROM fraud_alerts`),
    q(`SELECT round(avg(fraud_score))::int AS avg_score, count(*) FILTER (WHERE fraud_score >= 70)::int AS high_risk FROM listings WHERE fraud_score IS NOT NULL`),
    ml.getMetrics(),
  ]);

  const a = alerts[0];
  const reviewed = a.approved + a.confirmed;
  const statusMap = Object.fromEntries(byStatus.map((r) => [r.status, r.n]));
  res.json({
    users: users[0],
    listings: { total: byStatus.reduce((s, r) => s + r.n, 0), by_status: { approved: 0, pending: 0, rejected: 0, banned: 0, ...statusMap }, per_day: perDay },
    price_verdicts: Object.fromEntries(['fair', 'above_market', 'below_market'].map((v) => [v, verdicts.find((r) => r.verdict === v)?.n || 0])),
    fraud: {
      open_alerts: a.open, total_alerts: a.total, reviewed, confirmed_fraud: a.confirmed, false_alarms: a.approved,
      // Of the alerts an admin has reviewed, how many were genuinely problematic
      flag_precision_pct: reviewed ? Math.round((a.confirmed / reviewed) * 100) : null,
      avg_risk_score: scores[0].avg_score, high_risk_listings: scores[0].high_risk, top_flag_types: flagTypes,
    },
    model: metrics ? {
      available: true, version: metrics.version, best_model: metrics.best_model, dataset: metrics.dataset, rows: metrics.rows,
      test_metrics: metrics.test_metrics, comparison: metrics.model_comparison, trained_at: metrics.trained_at, note: metrics.note,
    } : { available: false },
  });
});

module.exports = router;
