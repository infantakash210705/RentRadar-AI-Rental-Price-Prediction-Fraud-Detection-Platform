const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const schemas = require('../utils/schemas');
const { signToken } = require('../middleware/auth');
const rl = require('../middleware/rateLimit');
const { conflict, unauthorized } = require('../utils/errors');

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role });

router.post('/signup', rl.auth, async (req, res) => {
  const data = schemas.signup.parse(req.body);
  const hash = await bcrypt.hash(data.password, 10);
  try {
    const { rows } = await db.query(
      `INSERT INTO users (name, email, password_hash, phone) VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, phone, role`,
      [data.name, data.email, hash, data.phone || null]
    );
    res.status(201).json({ user: publicUser(rows[0]), token: signToken(rows[0]) });
  } catch (err) {
    if (err.code === '23505') throw conflict('An account with this email already exists');
    throw err;
  }
});

// Constant-ish time: always run bcrypt compare even for unknown emails
const DUMMY_HASH = '$2a$10$CwTycUXWue0Thq9StjUM0uJ8.JpWdGZ2ZpJz8kqk5rJ6y4Xq2pQ7K';
router.post('/login', rl.auth, async (req, res) => {
  const data = schemas.login.parse(req.body);
  const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [data.email]);
  const user = rows[0];
  const ok = await bcrypt.compare(data.password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) throw unauthorized('Invalid email or password');
  if (user.is_banned) throw unauthorized('Account is banned');
  res.json({ user: publicUser(user), token: signToken(user) });
});

module.exports = router;
