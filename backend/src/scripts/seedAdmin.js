const bcrypt = require('bcryptjs');
const db = require('../db');

(async () => {
  const email = (process.env.ADMIN_EMAIL || 'admin@rentradar.local').toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!password || password.length < 8) throw new Error('Set ADMIN_PASSWORD (min 8 chars) in .env.local');
  const hash = await bcrypt.hash(password, 10);
  await db.query(
    `INSERT INTO users (name, email, password_hash, role) VALUES ('Administrator', $1, $2, 'admin')
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'admin', is_banned = false`,
    [email, hash]
  );
  console.log(`Admin ready: ${email}`);
  await db.close();
})().catch((e) => { console.error(e); process.exit(1); });
