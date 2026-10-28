const rateLimit = require('express-rate-limit');
const config = require('../config');

const make = (windowMs, max, message) =>
  rateLimit({
    windowMs,
    limit: config.env === 'test' ? 10000 : max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: 'rate_limited', message } },
  });

module.exports = {
  global: make(60 * 1000, 300, 'Too many requests, slow down'),
  auth: make(15 * 60 * 1000, 20, 'Too many auth attempts, try again later'),
  write: make(60 * 1000, 30, 'Too many write requests, slow down'),
  upload: make(60 * 1000, 20, 'Too many uploads, slow down'),
};
