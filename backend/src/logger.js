const pino = require('pino');
const config = require('./config');
module.exports = pino({
  level: config.logLevel,
  redact: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.password_hash'],
});
