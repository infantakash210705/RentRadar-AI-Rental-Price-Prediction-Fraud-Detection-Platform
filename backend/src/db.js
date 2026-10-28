const { Pool } = require('pg');
const config = require('./config');
const logger = require('./logger');

const pool = new Pool({ connectionString: config.databaseUrl, max: 10, idleTimeoutMillis: 30000 });
pool.on('error', (err) => logger.error({ err }, 'Unexpected PostgreSQL pool error'));

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
  async tx(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
  close: () => pool.end(),
};
