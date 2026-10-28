const request = require('supertest');
const db = require('../src/db');
const app = require('../src/app');

let counter = 0;
async function resetDb() {
  await db.query('TRUNCATE notifications, messages, conversations, fraud_alerts, listing_images, listings, users RESTART IDENTITY CASCADE');
}
async function makeUser(overrides = {}) {
  counter += 1;
  const body = { name: 'Test User', email: `user${counter}@example.com`, password: 'Passw0rdX', ...overrides };
  const res = await request(app).post('/api/auth/signup').send(body);
  if (res.status !== 201) throw new Error('signup failed: ' + JSON.stringify(res.body));
  return { token: res.body.token, user: res.body.user, email: body.email, password: body.password };
}
async function makeAdmin() {
  const u = await makeUser({ name: 'Admin Person' });
  await db.query("UPDATE users SET role = 'admin' WHERE id = $1", [u.user.id]);
  return u;
}
const validListing = (o = {}) => ({
  title: '2BHK near metro station', description: 'Spacious flat, close to market.',
  city: 'Bengaluru', area: 'Indiranagar', latitude: 12.9784, longitude: 77.6408,
  size_sqft: 1000, bhk: 2, bathrooms: 2, furnishing: 'semi-furnished', rent: 30000,
  amenities: ['parking', 'lift'], ...o,
});
const auth = (t) => ({ Authorization: `Bearer ${t}` });
// Minimal valid-signature PNG; `salt` makes the bytes (and hash) unique
const png = (salt = 'a') => Buffer.concat([
  Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex'),
  Buffer.from(salt),
]);
module.exports = { request, app, db, resetDb, makeUser, makeAdmin, validListing, auth, png };
