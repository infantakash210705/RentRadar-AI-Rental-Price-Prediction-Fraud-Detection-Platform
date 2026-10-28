const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
module.exports = async () => {
  const c = new Client({ connectionString: process.env.TEST_DATABASE_URL || 'postgres://rentradar:rentradar_dev@localhost:5432/rentradar_test' });
  await c.connect();
  await c.query(fs.readFileSync(path.resolve(__dirname, '../../db/schema.sql'), 'utf8'));
  await c.end();
};
