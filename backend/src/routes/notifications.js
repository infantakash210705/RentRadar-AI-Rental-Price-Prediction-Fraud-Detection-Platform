const router = require('express').Router();
const db = require('../db');
const schemas = require('../utils/schemas');
const { requireAuth } = require('../middleware/auth');
const { notFound } = require('../utils/errors');

router.use(requireAuth);

// Get paginated notifications for current user
router.get('/', async (req, res) => {
  const q = schemas.notificationsQuery.parse(req.query);
  const offset = (q.page - 1) * q.limit;

  const [itemsRes, unreadRes, countRes] = await Promise.all([
    db.query(
      `SELECT n.id, n.user_id, n.type, n.title, n.body, n.conversation_id, n.listing_id,
              n.is_read, n.read_at, n.created_at,
              l.title AS listing_title
         FROM notifications n
         LEFT JOIN listings l ON l.id = n.listing_id
        WHERE n.user_id = $1
        ORDER BY n.created_at DESC
        LIMIT $2 OFFSET $3`,
      [req.user.id, q.limit, offset]
    ),
    db.query(
      `SELECT count(*)::int AS count FROM notifications WHERE user_id = $1 AND is_read = FALSE`,
      [req.user.id]
    ),
    db.query(
      `SELECT count(*)::int AS total FROM notifications WHERE user_id = $1`,
      [req.user.id]
    ),
  ]);

  const total = countRes.rows[0].total;
  res.json({
    items: itemsRes.rows,
    unread_count: unreadRes.rows[0].count,
    page: q.page,
    limit: q.limit,
    total,
    total_pages: Math.ceil(total / q.limit),
  });
});

// Fast unread count endpoint for polling/header badge
router.get('/unread-count', async (req, res) => {
  const { rows } = await db.query(
    `SELECT count(*)::int AS count FROM notifications WHERE user_id = $1 AND is_read = FALSE`,
    [req.user.id]
  );
  res.json({ unread_count: rows[0].count });
});

// Mark single notification as read
router.patch('/:id/read', async (req, res) => {
  const { rows } = await db.query(
    `UPDATE notifications
        SET is_read = TRUE, read_at = now()
      WHERE id = $1 AND user_id = $2
      RETURNING *`,
    [req.params.id, req.user.id]
  );
  if (!rows[0]) throw notFound('Notification not found');

  const { rows: unread } = await db.query(
    `SELECT count(*)::int AS count FROM notifications WHERE user_id = $1 AND is_read = FALSE`,
    [req.user.id]
  );

  res.json({ notification: rows[0], unread_count: unread[0].count });
});

// Mark all notifications as read
router.patch('/read-all', async (req, res) => {
  await db.query(
    `UPDATE notifications
        SET is_read = TRUE, read_at = now()
      WHERE user_id = $1 AND is_read = FALSE`,
    [req.user.id]
  );
  res.json({ success: true, unread_count: 0 });
});

module.exports = router;
