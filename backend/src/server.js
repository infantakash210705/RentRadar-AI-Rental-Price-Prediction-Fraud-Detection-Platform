const app = require('./app');
const config = require('./config');
const logger = require('./logger');
const db = require('./db');

const server = app.listen(config.port, () => logger.info(`RentRadar API listening on :${config.port}`));

const shutdown = (sig) => {
  logger.info(`${sig} received, shutting down`);
  server.close(async () => { await db.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 10000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => logger.error({ err }, 'Unhandled rejection'));
