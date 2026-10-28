const router = require('express').Router();
const db = require('../db');
const ml = require('../services/mlClient');
const schemas = require('../utils/schemas');
const rl = require('../middleware/rateLimit');
const { AppError } = require('../utils/errors');

// Cities that currently have approved listings (for filter dropdowns)
router.get('/meta/cities', async (req, res) => {
  const { rows } = await db.query(
    `SELECT initcap(lower(city)) AS city, count(*)::int AS count
       FROM listings WHERE status = 'approved' GROUP BY lower(city), initcap(lower(city)) ORDER BY count DESC, city`
  );
  res.json({ items: rows });
});

// Live "what should the rent be?" helper used by the posting form
router.post('/predict', rl.write, async (req, res) => {
  const data = schemas.predictInput.parse(req.body);
  const pred = await ml.predictRent(data);
  if (!pred) throw new AppError(503, 'Price prediction is temporarily unavailable', 'ml_unavailable');
  res.json({
    predicted_rent: Math.round(pred.predicted_rent), low: Math.round(pred.low), high: Math.round(pred.high),
    confidence: pred.confidence || null,
  });
});

module.exports = router;
