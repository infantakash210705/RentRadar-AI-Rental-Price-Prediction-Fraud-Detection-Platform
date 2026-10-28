const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');
const { unauthorized, forbidden } = require('../utils/errors');

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

async function loadUser(req) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    throw unauthorized('Invalid or expired token');
  }
  // Re-check DB so bans / role changes take effect immediately
  const { rows } = await db.query(
    'SELECT id, name, email, phone, role, is_banned FROM users WHERE id = $1',
    [payload.sub]
  );
  if (!rows[0]) throw unauthorized('User no longer exists');
  if (rows[0].is_banned) throw forbidden('Account is banned');
  return rows[0];
}

async function requireAuth(req, res, next) {
  const user = await loadUser(req);
  if (!user) throw unauthorized();
  req.user = user;
  next();
}

async function optionalAuth(req, res, next) {
  try {
    req.user = (await loadUser(req)) || null;
  } catch {
    req.user = null;
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') throw forbidden('Admin access required');
  next();
}

module.exports = { signToken, requireAuth, optionalAuth, requireAdmin };
