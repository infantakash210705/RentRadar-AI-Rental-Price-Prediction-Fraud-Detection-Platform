jest.mock('../src/services/mlClient');
const ml = require('../src/services/mlClient');
const { request, app, db, resetDb, makeUser, makeAdmin, validListing, auth } = require('./helpers');

const mlScore = (score, flags = []) => {
  ml.predictRent.mockResolvedValue({ predicted_rent: 30000, low: 27000, high: 33000 });
  ml.checkFraud.mockResolvedValue({ risk_score: score, flags, model_version: 't' });
  ml.analyzeImage.mockResolvedValue(null);
};
const flagged = (u, score = 85, o = {}) => {
  mlScore(score, [{ type: 'price_too_low', severity: 'high', detail: 'cheap' }]);
  return request(app).post('/api/listings').set(auth(u.token)).send(validListing(o)).then((r) => r.body.listing);
};
const clean = (u, o) => { mlScore(5); return request(app).post('/api/listings').set(auth(u.token)).send(validListing(o)).then((r) => r.body.listing); };

let admin;
beforeEach(async () => { await resetDb(); jest.resetAllMocks(); mlScore(5); ml.getMetrics.mockResolvedValue(null); admin = await makeAdmin(); });
afterAll(() => db.close());

describe('access control', () => {
  const endpoints = [
    ['get', '/api/admin/alerts'], ['post', '/api/admin/alerts/00000000-0000-0000-0000-000000000000/resolve'],
    ['get', '/api/admin/listings'], ['patch', '/api/admin/listings/00000000-0000-0000-0000-000000000000'],
    ['get', '/api/admin/users'], ['patch', '/api/admin/users/00000000-0000-0000-0000-000000000000'], ['get', '/api/admin/stats'],
  ];
  test.each(endpoints)('%s %s: anonymous => 401', async (m, url) => { expect((await request(app)[m](url)).status).toBe(401); });
  test.each(endpoints)('%s %s: normal user => 403', async (m, url) => {
    const u = await makeUser();
    expect((await request(app)[m](url).set(auth(u.token)).send({})).status).toBe(403);
  });
  test('banned admin loses access immediately', async () => {
    await db.query('UPDATE users SET is_banned = true WHERE id = $1', [admin.user.id]);
    expect((await request(app).get('/api/admin/stats').set(auth(admin.token))).status).toBe(403);
  });
  test('demoted admin loses access immediately (role re-checked from DB)', async () => {
    await db.query("UPDATE users SET role = 'user' WHERE id = $1", [admin.user.id]);
    expect((await request(app).get('/api/admin/stats').set(auth(admin.token))).status).toBe(403);
  });
});

describe('fraud alerts', () => {
  test('queue is ordered by risk and carries listing + owner context', async () => {
    const u = await makeUser();
    await flagged(u, 55, { title: 'Medium risk flat' }); await flagged(u, 92, { title: 'Highest risk flat' });
    const res = await request(app).get('/api/admin/alerts').set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.items.map((a) => a.risk_score)).toEqual([92, 55]);
    expect(res.body.items[0]).toMatchObject({ title: 'Highest risk flat', owner_email: u.email, listing_status: 'pending', status: 'open' });
    expect(res.body.items[0].flags[0].type).toBe('price_too_low');
  });

  test('approve publishes the listing and closes the alert, recording who decided', async () => {
    const u = await makeUser(); const l = await flagged(u);
    const [a] = (await request(app).get('/api/admin/alerts').set(auth(admin.token))).body.items;
    const r = await request(app).post(`/api/admin/alerts/${a.id}/resolve`).set(auth(admin.token)).send({ action: 'approve', note: 'Verified by phone' });
    expect(r.status).toBe(200);
    expect((await request(app).get(`/api/listings/${l.id}`)).status).toBe(200); // now public
    const row = (await db.query('SELECT * FROM fraud_alerts')).rows[0];
    expect(row).toMatchObject({ status: 'resolved', resolved_by: admin.user.id, resolution: 'approved: Verified by phone' });
    expect((await request(app).get('/api/admin/alerts').set(auth(admin.token))).body.total).toBe(0);
    expect((await request(app).get('/api/admin/alerts?status=resolved').set(auth(admin.token))).body.total).toBe(1);
  });

  test('resolving twice => 409 and no state change', async () => {
    const u = await makeUser(); await flagged(u);
    const [a] = (await request(app).get('/api/admin/alerts').set(auth(admin.token))).body.items;
    await request(app).post(`/api/admin/alerts/${a.id}/resolve`).set(auth(admin.token)).send({ action: 'ban' });
    const again = await request(app).post(`/api/admin/alerts/${a.id}/resolve`).set(auth(admin.token)).send({ action: 'approve' });
    expect(again.status).toBe(409);
    expect((await db.query('SELECT status FROM listings')).rows[0].status).toBe('banned');
  });

  test('reject lets the owner fix and resubmit', async () => {
    const u = await makeUser(); const l = await flagged(u);
    const [a] = (await request(app).get('/api/admin/alerts').set(auth(admin.token))).body.items;
    await request(app).post(`/api/admin/alerts/${a.id}/resolve`).set(auth(admin.token)).send({ action: 'reject' });
    expect((await db.query('SELECT status FROM listings')).rows[0].status).toBe('rejected');
    mlScore(5); // owner corrects the listing; re-check passes
    const fix = await request(app).put(`/api/listings/${l.id}`).set(auth(u.token)).send({ rent: 31000 });
    expect(fix.body.listing.status).toBe('approved');
  });

  test('ban + ban_owner bans the account and every listing; owner is locked out', async () => {
    const u = await makeUser(); await clean(u); await flagged(u);
    const [a] = (await request(app).get('/api/admin/alerts').set(auth(admin.token))).body.items;
    const r = await request(app).post(`/api/admin/alerts/${a.id}/resolve`).set(auth(admin.token)).send({ action: 'ban', ban_owner: true });
    expect(r.body.owner_banned).toBe(true);
    expect((await db.query("SELECT count(*)::int n FROM listings WHERE status <> 'banned'")).rows[0].n).toBe(0);
    expect((await request(app).get('/api/users/me').set(auth(u.token))).status).toBe(403);
    expect((await request(app).get('/api/listings')).body.total).toBe(0);
  });

  test('admin cannot ban their own account through an alert', async () => {
    const l = await flagged(admin);
    const [a] = (await request(app).get('/api/admin/alerts').set(auth(admin.token))).body.items;
    const r = await request(app).post(`/api/admin/alerts/${a.id}/resolve`).set(auth(admin.token)).send({ action: 'ban', ban_owner: true });
    expect(r.status).toBe(400);
    // transaction rolled back: alert still open, listing untouched
    expect((await db.query("SELECT status FROM fraud_alerts")).rows[0].status).toBe('open');
    expect((await db.query('SELECT status FROM listings WHERE id = $1', [l.id])).rows[0].status).toBe('pending');
    expect((await request(app).get('/api/admin/stats').set(auth(admin.token))).status).toBe(200);
  });

  test('validation + unknown alert', async () => {
    expect((await request(app).post('/api/admin/alerts/00000000-0000-0000-0000-000000000000/resolve').set(auth(admin.token)).send({ action: 'approve' })).status).toBe(404);
    expect((await request(app).post('/api/admin/alerts/00000000-0000-0000-0000-000000000000/resolve').set(auth(admin.token)).send({ action: 'explode' })).status).toBe(400);
    expect((await request(app).post('/api/admin/alerts/not-a-uuid/resolve').set(auth(admin.token)).send({ action: 'approve' })).status).toBe(400);
  });
});

describe('listing moderation', () => {
  test('filter by status and search by owner email', async () => {
    const u = await makeUser(); const v = await makeUser();
    await clean(u); await flagged(v);
    const pend = await request(app).get('/api/admin/listings?status=pending').set(auth(admin.token));
    expect(pend.body.total).toBe(1);
    expect(pend.body.items[0].owner_email).toBe(v.email);
    expect((await request(app).get(`/api/admin/listings?q=${encodeURIComponent(u.email)}`).set(auth(admin.token))).body.total).toBe(1);
    expect((await request(app).get('/api/admin/listings?status=nope').set(auth(admin.token))).status).toBe(400);
  });
  test('changing status closes the open alert; pending keeps it open', async () => {
    const u = await makeUser(); const l = await flagged(u);
    await request(app).patch(`/api/admin/listings/${l.id}`).set(auth(admin.token)).send({ status: 'pending' });
    expect((await db.query('SELECT status FROM fraud_alerts')).rows[0].status).toBe('open');
    const r = await request(app).patch(`/api/admin/listings/${l.id}`).set(auth(admin.token)).send({ status: 'approved' });
    expect(r.body.listing.status).toBe('approved');
    expect((await db.query('SELECT status, resolution FROM fraud_alerts')).rows[0]).toEqual({ status: 'resolved', resolution: 'approved' });
  });
  test('unknown listing 404, bad status 400', async () => {
    expect((await request(app).patch('/api/admin/listings/00000000-0000-0000-0000-000000000000').set(auth(admin.token)).send({ status: 'approved' })).status).toBe(404);
    expect((await request(app).patch('/api/admin/listings/00000000-0000-0000-0000-000000000000').set(auth(admin.token)).send({ status: 'weird' })).status).toBe(400);
  });
});

describe('user management', () => {
  test('list includes listing counts and supports search + pagination', async () => {
    const u = await makeUser({ name: 'Priya Sharma' }); await makeUser({ name: 'Other Person' });
    await clean(u); await flagged(u);
    const res = await request(app).get('/api/admin/users?q=priya').set(auth(admin.token));
    expect(res.body.total).toBe(1);
    expect(res.body.items[0]).toMatchObject({ name: 'Priya Sharma', listing_count: 2, problem_listings: 1 });
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
    expect((await request(app).get('/api/admin/users?limit=2&page=2').set(auth(admin.token))).body.items).toHaveLength(1);
  });
  test('ban hides their listings and blocks login; unban sends listings back to review', async () => {
    const u = await makeUser(); await clean(u);
    expect((await request(app).get('/api/listings')).body.total).toBe(1);
    await request(app).patch(`/api/admin/users/${u.user.id}`).set(auth(admin.token)).send({ is_banned: true });
    expect((await request(app).get('/api/listings')).body.total).toBe(0);
    expect((await request(app).post('/api/auth/login').send({ email: u.email, password: u.password })).status).toBe(401);
    await request(app).patch(`/api/admin/users/${u.user.id}`).set(auth(admin.token)).send({ is_banned: false });
    expect((await db.query('SELECT status FROM listings')).rows[0].status).toBe('pending'); // not auto-published
    expect((await request(app).post('/api/auth/login').send({ email: u.email, password: u.password })).status).toBe(200);
  });
  test('promote to admin works; admin cannot change themselves', async () => {
    const u = await makeUser();
    const r = await request(app).patch(`/api/admin/users/${u.user.id}`).set(auth(admin.token)).send({ role: 'admin' });
    expect(r.body.user.role).toBe('admin');
    expect((await request(app).get('/api/admin/stats').set(auth(u.token))).status).toBe(200);
    expect((await request(app).patch(`/api/admin/users/${admin.user.id}`).set(auth(admin.token)).send({ is_banned: true })).status).toBe(400);
    expect((await request(app).patch(`/api/admin/users/${admin.user.id}`).set(auth(admin.token)).send({ role: 'user' })).status).toBe(400);
  });
  test('validation + unknown user', async () => {
    const u = await makeUser();
    expect((await request(app).patch(`/api/admin/users/${u.user.id}`).set(auth(admin.token)).send({})).status).toBe(400);
    expect((await request(app).patch(`/api/admin/users/${u.user.id}`).set(auth(admin.token)).send({ role: 'root' })).status).toBe(400);
    expect((await request(app).patch('/api/admin/users/00000000-0000-0000-0000-000000000000').set(auth(admin.token)).send({ is_banned: true })).status).toBe(404);
  });
});

describe('analytics', () => {
  test('counts, verdicts, per-day series and flag precision are computed correctly', async () => {
    const u = await makeUser();
    await clean(u); await clean(u, { rent: 60000 });          // fair, above_market (approved)
    await flagged(u); await flagged(u); await flagged(u);       // 3 pending alerts
    const alerts = (await request(app).get('/api/admin/alerts').set(auth(admin.token))).body.items;
    await request(app).post(`/api/admin/alerts/${alerts[0].id}/resolve`).set(auth(admin.token)).send({ action: 'approve' }); // false alarm
    await request(app).post(`/api/admin/alerts/${alerts[1].id}/resolve`).set(auth(admin.token)).send({ action: 'ban' });     // confirmed
    ml.getMetrics.mockResolvedValue({ version: 'rent-xgboost-1', best_model: 'xgboost', dataset: 'synthetic', rows: 30000, test_metrics: { r2: 0.97, mae: 4800 }, model_comparison: {}, note: 'synthetic' });

    const s = (await request(app).get('/api/admin/stats').set(auth(admin.token))).body;
    expect(s.users.total).toBe(2);
    expect(s.listings.total).toBe(5);
    expect(s.listings.by_status).toMatchObject({ pending: 1, banned: 1 });
    expect(s.listings.by_status.approved).toBe(3);               // 2 clean + 1 admin-approved
    expect(s.listings.per_day).toHaveLength(14);
    expect(s.listings.per_day.at(-1).n).toBe(5);
    expect(s.price_verdicts).toMatchObject({ above_market: 1 });
    expect(s.fraud).toMatchObject({ open_alerts: 1, total_alerts: 3, reviewed: 2, confirmed_fraud: 1, false_alarms: 1, flag_precision_pct: 50 });
    expect(s.fraud.top_flag_types[0]).toEqual({ type: 'price_too_low', n: 3 });
    expect(s.model).toMatchObject({ available: true, version: 'rent-xgboost-1', test_metrics: { r2: 0.97 } });
  });
  test('works on an empty system and when the ML service is down', async () => {
    const s = (await request(app).get('/api/admin/stats').set(auth(admin.token))).body;
    expect(s.listings.total).toBe(0);
    expect(s.fraud.flag_precision_pct).toBeNull();
    expect(s.model).toEqual({ available: false });
    expect(s.price_verdicts).toEqual({ fair: 0, above_market: 0, below_market: 0 });
  });
});
