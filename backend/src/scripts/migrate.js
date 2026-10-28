const fs = require('fs');
const path = require('path');
const db = require('../db');

(async () => {
  const candidates = [path.resolve(__dirname, '../../../db/schema.sql'), path.resolve(__dirname, '../../db/schema.sql')];
  const file = candidates.find((p) => fs.existsSync(p));
  if (!file) throw new Error('schema.sql not found');
  await db.query(fs.readFileSync(file, 'utf8'));
  console.log('Migration complete:', file);
  await db.close();
})().catch((e) => { console.error(e); process.exit(1); });
