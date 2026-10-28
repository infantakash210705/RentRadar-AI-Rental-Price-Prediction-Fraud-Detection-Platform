const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const pinoHttp = require('pino-http');
const config = require('./config');
const logger = require('./logger');
const rl = require('./middleware/rateLimit');
const { notFoundHandler, errorHandler } = require('./middleware/error');
const db = require('./db');

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } })); // allow frontend to load /uploads images
app.use(cors({ origin: config.corsOrigins, credentials: true }));
app.use(pinoHttp({ logger, autoLogging: config.env !== 'test' }));
app.use(express.json({ limit: '100kb' }));
app.use(rl.global);

app.use('/uploads', express.static(config.uploadDir, { maxAge: '7d', index: false, dotfiles: 'deny' }));

app.get('/api/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ok', db: 'up' });
  } catch {
    res.status(503).json({ status: 'degraded', db: 'down' });
  }
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/listings', require('./routes/listings'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api', require('./routes/meta'));
app.use('/api/admin', require('./routes/admin'));

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
