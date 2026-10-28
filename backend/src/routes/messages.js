const router = require('express').Router();
const db = require('../db');
const schemas = require('../utils/schemas');
const { requireAuth } = require('../middleware/auth');
const rl = require('../middleware/rateLimit');
const { badRequest, forbidden, notFound } = require('../utils/errors');

router.use(requireAuth);

const COVER_SQL = `(SELECT url FROM listing_images i WHERE i.listing_id = l.id ORDER BY position LIMIT 1)`;

// List all conversations for the authenticated user
router.get('/conversations', async (req, res) => {
  const { rows } = await db.query(
    `SELECT c.id, c.listing_id, c.renter_id, c.owner_id, c.created_at, c.updated_at,
            l.title AS listing_title, l.city AS listing_city, l.area AS listing_area, l.rent AS listing_rent,
            ${COVER_SQL} AS listing_cover_image,
            CASE WHEN c.renter_id = $1 THEN u_owner.id ELSE u_renter.id END AS other_user_id,
            CASE WHEN c.renter_id = $1 THEN u_owner.name ELSE u_renter.name END AS other_user_name,
            (c.owner_id = $1) AS is_owner,
            lm.body AS last_message_body,
            lm.created_at AS last_message_created_at,
            lm.sender_id AS last_message_sender_id,
            (SELECT count(*)::int FROM messages m WHERE m.conversation_id = c.id AND m.sender_id <> $1 AND m.read_at IS NULL) AS unread_count
       FROM conversations c
       JOIN listings l ON l.id = c.listing_id
       JOIN users u_renter ON u_renter.id = c.renter_id
       JOIN users u_owner ON u_owner.id = c.owner_id
       LEFT JOIN LATERAL (
         SELECT body, created_at, sender_id
           FROM messages
          WHERE conversation_id = c.id
          ORDER BY created_at DESC
          LIMIT 1
       ) lm ON TRUE
      WHERE c.renter_id = $1 OR c.owner_id = $1
      ORDER BY c.updated_at DESC`,
    [req.user.id]
  );
  res.json({ items: rows });
});

// Create or get conversation for a listing
router.post('/conversations', rl.write, async (req, res) => {
  const data = schemas.createConversation.parse(req.body);

  const { rows: lRows } = await db.query('SELECT id, owner_id, title FROM listings WHERE id = $1', [data.listing_id]);
  const listing = lRows[0];
  if (!listing) throw notFound('Listing not found');

  if (listing.owner_id === req.user.id) {
    throw badRequest('You cannot message yourself about your own listing');
  }

  let conversationId;
  let isNew = false;

  const { rows: existing } = await db.query(
    'SELECT id FROM conversations WHERE listing_id = $1 AND renter_id = $2',
    [listing.id, req.user.id]
  );

  if (existing.length > 0) {
    conversationId = existing[0].id;
  } else {
    isNew = true;
    const { rows: created } = await db.query(
      `INSERT INTO conversations (listing_id, renter_id, owner_id)
       VALUES ($1, $2, $3) RETURNING id`,
      [listing.id, req.user.id, listing.owner_id]
    );
    conversationId = created[0].id;
  }

  if (data.initial_message) {
    await db.tx(async (c) => {
      await c.query(
        `INSERT INTO messages (conversation_id, sender_id, body)
         VALUES ($1, $2, $3)`,
        [conversationId, req.user.id, data.initial_message]
      );
      await c.query(`UPDATE conversations SET updated_at = now() WHERE id = $1`, [conversationId]);
      await c.query(
        `INSERT INTO notifications (user_id, type, title, body, conversation_id, listing_id)
         VALUES ($1, 'new_message', $2, $3, $4, $5)`,
        [
          listing.owner_id,
          `New message from ${req.user.name}`,
          `Regarding "${listing.title}": ${data.initial_message.slice(0, 100)}`,
          conversationId,
          listing.id,
        ]
      );
    });
  }

  // Fetch full conversation details to return
  const { rows } = await db.query(
    `SELECT c.id, c.listing_id, c.renter_id, c.owner_id, c.created_at, c.updated_at,
            l.title AS listing_title, l.city AS listing_city, l.area AS listing_area, l.rent AS listing_rent,
            ${COVER_SQL} AS listing_cover_image,
            u_owner.id AS other_user_id, u_owner.name AS other_user_name,
            FALSE AS is_owner,
            lm.body AS last_message_body,
            lm.created_at AS last_message_created_at,
            lm.sender_id AS last_message_sender_id,
            0 AS unread_count
       FROM conversations c
       JOIN listings l ON l.id = c.listing_id
       JOIN users u_owner ON u_owner.id = c.owner_id
       LEFT JOIN LATERAL (
         SELECT body, created_at, sender_id
           FROM messages
          WHERE conversation_id = c.id
          ORDER BY created_at DESC
          LIMIT 1
       ) lm ON TRUE
      WHERE c.id = $1`,
    [conversationId]
  );

  res.status(isNew ? 201 : 200).json({ conversation: rows[0] });
});

// Helper: load conversation and verify membership
async function loadConversation(id, userId) {
  const { rows } = await db.query(
    `SELECT c.id, c.listing_id, c.renter_id, c.owner_id, c.created_at, c.updated_at,
            l.title AS listing_title, l.city AS listing_city, l.area AS listing_area, l.rent AS listing_rent,
            l.status AS listing_status,
            ${COVER_SQL} AS listing_cover_image,
            u_renter.name AS renter_name,
            u_owner.name AS owner_name,
            CASE WHEN c.renter_id = $2 THEN u_owner.id ELSE u_renter.id END AS other_user_id,
            CASE WHEN c.renter_id = $2 THEN u_owner.name ELSE u_renter.name END AS other_user_name,
            (c.owner_id = $2) AS is_owner
       FROM conversations c
       JOIN listings l ON l.id = c.listing_id
       JOIN users u_renter ON u_renter.id = c.renter_id
       JOIN users u_owner ON u_owner.id = c.owner_id
      WHERE c.id = $1`,
    [id, userId]
  );
  const conv = rows[0];
  if (!conv) throw notFound('Conversation not found');
  if (conv.renter_id !== userId && conv.owner_id !== userId) {
    throw forbidden('You are not a participant in this conversation');
  }
  return conv;
}

// Get single conversation details
router.get('/conversations/:id', async (req, res) => {
  const conv = await loadConversation(req.params.id, req.user.id);
  res.json({ conversation: conv });
});

// Get messages for a conversation (and mark incoming as read)
router.get('/conversations/:id/messages', async (req, res) => {
  const conv = await loadConversation(req.params.id, req.user.id);

  // Mark other party's unread messages as read
  await db.query(
    `UPDATE messages SET read_at = now()
      WHERE conversation_id = $1 AND sender_id <> $2 AND read_at IS NULL`,
    [conv.id, req.user.id]
  );

  // Mark corresponding notifications for this user and conversation as read
  await db.query(
    `UPDATE notifications SET is_read = TRUE, read_at = now()
      WHERE conversation_id = $1 AND user_id = $2 AND is_read = FALSE`,
    [conv.id, req.user.id]
  );

  const { rows } = await db.query(
    `SELECT m.id, m.conversation_id, m.sender_id, m.body, m.read_at, m.created_at,
            u.name AS sender_name
       FROM messages m
       JOIN users u ON u.id = m.sender_id
      WHERE m.conversation_id = $1
      ORDER BY m.created_at ASC`,
    [conv.id]
  );

  res.json({ items: rows });
});

// Send a message in a conversation
router.post('/conversations/:id/messages', rl.write, async (req, res) => {
  const conv = await loadConversation(req.params.id, req.user.id);
  const data = schemas.createMessage.parse(req.body);

  const recipientId = conv.renter_id === req.user.id ? conv.owner_id : conv.renter_id;

  const message = await db.tx(async (c) => {
    const { rows } = await c.query(
      `INSERT INTO messages (conversation_id, sender_id, body)
       VALUES ($1, $2, $3)
       RETURNING id, conversation_id, sender_id, body, read_at, created_at`,
      [conv.id, req.user.id, data.body]
    );

    await c.query(`UPDATE conversations SET updated_at = now() WHERE id = $1`, [conv.id]);

    await c.query(
      `INSERT INTO notifications (user_id, type, title, body, conversation_id, listing_id)
       VALUES ($1, 'new_message', $2, $3, $4, $5)`,
      [
        recipientId,
        `New message from ${req.user.name}`,
        `Regarding "${conv.listing_title}": ${data.body.slice(0, 100)}`,
        conv.id,
        conv.listing_id,
      ]
    );

    return { ...rows[0], sender_name: req.user.name };
  });

  res.status(201).json({ message });
});

module.exports = router;
