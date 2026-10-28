const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const schemas = require('../utils/schemas');
const { requireAuth } = require('../middleware/auth');
const { badRequest } = require('../utils/errors');

router.use(requireAuth);

router.get('/me', (req, res) => {
  const { id, name, email, phone, role } = req.user;
  res.json({ user: { id, name, email, phone, role } });
});

router.put('/me', async (req, res) => {
  const data = schemas.profileUpdate.parse(req.body);
  const sets = [];
  const params = [req.user.id];
  const add = (col, v) => { params.push(v); sets.push(`${col} = $${params.length}`); };

  if (data.name !== undefined) add('name', data.name);
  if (data.phone !== undefined) add('phone', data.phone);
  if (data.newPassword) {
    const { rows } = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (!(await bcrypt.compare(data.currentPassword, rows[0].password_hash))) {
      throw badRequest('Current password is incorrect');
    }
    add('password_hash', await bcrypt.hash(data.newPassword, 10));
  }
  if (!sets.length) throw badRequest('No fields to update');

  const { rows } = await db.query(
    `UPDATE users SET ${sets.join(', ')} WHERE id = $1 RETURNING id, name, email, phone, role`,
    params
  );
  res.json({ user: rows[0] });
});

module.exports = router;
