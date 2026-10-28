jest.mock('../src/services/mlClient');
const ml = require('../src/services/mlClient');
const { request, app, db, resetDb, makeUser, makeAdmin, validListing, auth, png } = require('./helpers');

const mlOk = (score = 10, predicted = 30000) => {
  ml.predictRent.mockResolvedValue({ predicted_rent: predicted, low: predicted * 0.9, high: predicted * 1.1, model_version: 't' });
  ml.checkFraud.mockResolvedValue({ risk_score: score, flags: score >= 40 ? [{ type: 'price_anomaly', severity: 'high', detail: 'x' }] : [], model_version: 't' });
};
const create = (user, o) => request(app).post('/api/listings').set(auth(user.token)).send(validListing(o));

beforeEach(async () => { await resetDb(); jest.resetAllMocks(); mlOk(); });
afterAll(() => db.close());

describe('create / read', () => {
  test('low-risk listing is auto-approved with prediction + fair verdict', async () => {
    const u = await makeUser();
    const res = await create(u);
    expect(res.status).toBe(201);
    expect(res.body.listing.status).toBe('approved');
    expect(res.body.listing.predicted_rent).toBe(30000);
    expect(res.body.listing.price_verdict).toBe('fair');
    expect(res.body.listing.fraud_score).toBeUndefined(); // hidden from owner
  });

  test('requires auth', async () => {
    expect((await request(app).post('/api/listings').send(validListing())).status).toBe(401);
  });

  test('high-risk listing is held as pending and raises a fraud alert', async () => {
    mlOk(85);
    const u = await makeUser();
    const res = await create(u, { rent: 3000 });
    expect(res.body.listing.status).toBe('pending');
    const alerts = await db.query('SELECT * FROM fraud_alerts');
    expect(alerts.rows).toHaveLength(1);
    expect(alerts.rows[0].risk_score).toBe(85);
    // not publicly visible
    expect((await request(app).get(`/api/listings/${res.body.listing.id}`)).status).toBe(404);
    expect((await request(app).get('/api/listings')).body.total).toBe(0);
    // owner can still see it
    expect((await request(app).get(`/api/listings/${res.body.listing.id}`).set(auth(u.token))).status).toBe(200);
  });

  test('ML service down: listing still created (fail-safe) with ml_unavailable flag', async () => {
    ml.predictRent.mockResolvedValue(null);
    ml.checkFraud.mockResolvedValue(null);
    const u = await makeUser();
    const res = await create(u);
    expect(res.status).toBe(201);
    expect(res.body.listing.status).toBe('approved');
    expect(res.body.listing.predicted_rent).toBeNull();
    const admin = await makeAdmin();
    const detail = await request(app).get(`/api/listings/${res.body.listing.id}`).set(auth(admin.token));
    expect(detail.body.listing.fraud_flags[0].type).toBe('ml_unavailable');
  });

  test('admin sees fraud fields, public does not', async () => {
    mlOk(50);
    const u = await makeUser(); const admin = await makeAdmin();
    const { body } = await create(u);
    const asAdmin = await request(app).get(`/api/listings/${body.listing.id}`).set(auth(admin.token));
    expect(asAdmin.body.listing.fraud_score).toBe(50);
    await db.query("UPDATE listings SET status='approved'");
    const pub = await request(app).get(`/api/listings/${body.listing.id}`);
    expect(pub.body.listing.fraud_score).toBeUndefined();
    expect(pub.body.listing.fraud_flags).toBeUndefined();
    expect(pub.body.listing.owner_phone).toBeUndefined();
  });

  test('owner phone is shown to logged-in users only', async () => {
    const owner = await makeUser({ phone: '+91 98765 43210' }); const viewer = await makeUser();
    const { body } = await create(owner);
    const anon = await request(app).get(`/api/listings/${body.listing.id}`);
    const authed = await request(app).get(`/api/listings/${body.listing.id}`).set(auth(viewer.token));
    expect(anon.body.listing.owner_phone).toBeUndefined();
    expect(authed.body.listing.owner_phone).toBe('+91 98765 43210');
    expect(authed.body.listing.fraud_score).toBeUndefined();
  });

  test.each([
    [{ title: 'abc' }], [{ rent: -5 }], [{ rent: 'cheap' }], [{ latitude: 123 }],
    [{ bhk: 0 }], [{ furnishing: 'luxury' }], [{ size_sqft: 10 }],
  ])('validation rejects %j', async (bad) => {
    const u = await makeUser();
    const res = await create(u, bad);
    expect(res.status).toBe(400);
  });

  test('HTML is stripped from text fields; amenities normalised', async () => {
    const u = await makeUser();
    const res = await create(u, { title: '<script>alert(1)</script>Nice flat here', amenities: ['Parking', 'parking', ' <b>Gym</b> '] });
    expect(res.body.listing.title).toBe('alert(1)Nice flat here');
    expect(res.body.listing.amenities.sort()).toEqual(['gym', 'parking']);
  });

  test('daily listing cap (spam protection)', async () => {
    const u = await makeUser();
    for (let i = 0; i < 5; i++) expect((await create(u)).status).toBe(201);
    expect((await create(u)).status).toBe(429);
  });

  test('invalid uuid -> 400, unknown id -> 404', async () => {
    expect((await request(app).get('/api/listings/not-a-uuid')).status).toBe(400);
    expect((await request(app).get('/api/listings/00000000-0000-0000-0000-000000000000')).status).toBe(404);
  });
});

describe('update / delete / ownership', () => {
  test('owner updates; prediction re-run; other user forbidden', async () => {
    const owner = await makeUser(); const other = await makeUser();
    const { body } = await create(owner);
    const id = body.listing.id;
    mlOk(10, 45000);
    const up = await request(app).put(`/api/listings/${id}`).set(auth(owner.token)).send({ rent: 52000, bhk: 3 });
    expect(up.status).toBe(200);
    expect(up.body.listing.rent).toBe(52000);
    expect(up.body.listing.predicted_rent).toBe(45000);
    expect(up.body.listing.price_verdict).toBe('above_market');
    expect((await request(app).put(`/api/listings/${id}`).set(auth(other.token)).send({ rent: 1000 })).status).toBe(403);
    expect((await request(app).delete(`/api/listings/${id}`).set(auth(other.token))).status).toBe(403);
    expect((await request(app).put(`/api/listings/${id}`).set(auth(owner.token)).send({})).status).toBe(400);
  });

  test('partial update does not wipe other fields (regression)', async () => {
    const owner = await makeUser();
    const { body } = await create(owner, { description: 'Keep me', bathrooms: 3, furnishing: 'furnished', amenities: ['gym'] });
    const up = await request(app).put(`/api/listings/${body.listing.id}`).set(auth(owner.token)).send({ rent: 31000 });
    expect(up.status).toBe(200);
    expect(up.body.listing).toMatchObject({ description: 'Keep me', bathrooms: 3, furnishing: 'furnished', amenities: ['gym'], rent: 31000 });
  });

  test('editing cannot un-ban a listing', async () => {
    const owner = await makeUser();
    const { body } = await create(owner);
    await db.query("UPDATE listings SET status='banned'");
    await request(app).put(`/api/listings/${body.listing.id}`).set(auth(owner.token)).send({ rent: 31000 });
    const { rows } = await db.query('SELECT status FROM listings');
    expect(rows[0].status).toBe('banned');
  });

  test('delete removes listing and cascades images', async () => {
    const owner = await makeUser();
    const { body } = await create(owner);
    await request(app).post(`/api/listings/${body.listing.id}/images`).set(auth(owner.token)).attach('photos', png('1'), 'a.png');
    expect((await request(app).delete(`/api/listings/${body.listing.id}`).set(auth(owner.token))).status).toBe(204);
    expect((await db.query('SELECT count(*)::int n FROM listings')).rows[0].n).toBe(0);
    expect((await db.query('SELECT count(*)::int n FROM listing_images')).rows[0].n).toBe(0);
  });

  test('mine/all lists only own listings including pending', async () => {
    const a = await makeUser(); const b = await makeUser();
    await create(a); mlOk(90); await create(a); await create(b);
    const res = await request(app).get('/api/listings/mine/all').set(auth(a.token));
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items.map((i) => i.status).sort()).toEqual(['approved', 'pending']);
  });
});

describe('search & filters', () => {
  beforeEach(async () => {
    const u = await makeUser();
    await create(u, { title: 'Cheap 1BHK Koramangala', city: 'Bengaluru', area: 'Koramangala', rent: 15000, bhk: 1, furnishing: 'unfurnished', amenities: ['parking'], latitude: 12.9352, longitude: 77.6245 });
    await create(u, { title: 'Big 3BHK Whitefield villa', city: 'Bengaluru', area: 'Whitefield', rent: 60000, bhk: 3, furnishing: 'furnished', amenities: ['parking', 'gym', 'pool'], latitude: 12.9698, longitude: 77.7500 });
    await create(u, { title: 'Sea facing 2BHK Bandra', city: 'Mumbai', area: 'Bandra', rent: 90000, bhk: 2, furnishing: 'semi-furnished', amenities: ['lift'], latitude: 19.0596, longitude: 72.8295 });
  });
  const get = (qs) => request(app).get(`/api/listings?${qs}`);

  test('no filters returns all approved with pagination meta', async () => {
    const res = await get('');
    expect(res.body.total).toBe(3);
    expect(res.body.items).toHaveLength(3);
    expect(res.body.total_pages).toBe(1);
  });
  test('pagination', async () => {
    const res = await get('limit=2&page=2');
    expect(res.body.items).toHaveLength(1);
    expect(res.body.total).toBe(3);
    expect(res.body.total_pages).toBe(2);
  });
  test('city filter is case-insensitive', async () => { expect((await get('city=MUMBAI')).body.total).toBe(1); });
  test('rent range', async () => { expect((await get('minRent=20000&maxRent=70000')).body.items.map((i) => i.area)).toEqual(['Whitefield']); });
  test('bhk / minBhk', async () => {
    expect((await get('bhk=2')).body.total).toBe(1);
    expect((await get('minBhk=2')).body.total).toBe(2);
  });
  test('furnishing', async () => { expect((await get('furnishing=furnished')).body.total).toBe(1); });
  test('amenities must all match', async () => {
    expect((await get('amenities=parking')).body.total).toBe(2);
    expect((await get('amenities=parking,gym')).body.total).toBe(1);
  });
  test('text search by area/title', async () => {
    expect((await get('q=bandra')).body.total).toBe(1);
    expect((await get('q=Koram')).body.total).toBe(1); // partial via ILIKE
  });
  test('sorting by rent', async () => {
    expect((await get('sort=rent_asc')).body.items.map((i) => i.rent)).toEqual([15000, 60000, 90000]);
    expect((await get('sort=rent_desc')).body.items[0].rent).toBe(90000);
  });
  test('PostGIS radius filter + distance sort', async () => {
    // Centered on Koramangala; Whitefield is ~16km away, Mumbai ~840km
    const near = await get('lat=12.9352&lng=77.6245&radius_km=5');
    expect(near.body.items.map((i) => i.area)).toEqual(['Koramangala']);
    const wide = await get('lat=12.9352&lng=77.6245&radius_km=30&sort=distance');
    expect(wide.body.items.map((i) => i.area)).toEqual(['Koramangala', 'Whitefield']);
    expect(wide.body.items[0].distance_km).toBeLessThan(0.2);
    expect(wide.body.items[1].distance_km).toBeGreaterThan(10);
  });
  test('map endpoint with bbox returns lightweight points', async () => {
    const res = await request(app).get('/api/listings/map?bbox=77.0,12.5,78.0,13.5');
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0]).toHaveProperty('latitude');
    expect(res.body.items[0]).not.toHaveProperty('description');
  });
  test('invalid query params -> 400', async () => {
    expect((await get('lat=12.9')).status).toBe(400);
    expect((await get('sort=distance')).status).toBe(400);
    expect((await get('limit=9999')).status).toBe(400);
    expect((await get('bbox=abc')).status).toBe(400);
  });
  test('SQL-injection-style input is harmless', async () => {
    const res = await get(`q=${encodeURIComponent("'; DROP TABLE listings;--")}&city=${encodeURIComponent("x' OR '1'='1")}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect((await db.query('SELECT count(*)::int n FROM listings')).rows[0].n).toBe(3);
  });
});

describe('images', () => {
  test('upload valid images; reject non-images and spoofed extensions', async () => {
    const u = await makeUser(); const { body } = await create(u); const id = body.listing.id;
    const ok = await request(app).post(`/api/listings/${id}/images`).set(auth(u.token)).attach('photos', png('1'), 'a.png');
    expect(ok.status).toBe(201);
    expect(ok.body.images[0].url).toMatch(/^\/uploads\/.+\.png$/);
    const fake = await request(app).post(`/api/listings/${id}/images`).set(auth(u.token)).attach('photos', Buffer.from('<?php echo 1; ?> not an image at all'), { filename: 'evil.png', contentType: 'image/png' });
    expect(fake.status).toBe(400);
    const none = await request(app).post(`/api/listings/${id}/images`).set(auth(u.token));
    expect(none.status).toBe(400);
  });
  test('enforces max image count and ownership', async () => {
    const u = await makeUser(); const other = await makeUser(); const { body } = await create(u); const id = body.listing.id;
    for (const s of ['1', '2', '3']) {
      expect((await request(app).post(`/api/listings/${id}/images`).set(auth(u.token)).attach('photos', png(s), `${s}.png`)).status).toBe(201);
    }
    expect((await request(app).post(`/api/listings/${id}/images`).set(auth(u.token)).attach('photos', png('4'), '4.png')).status).toBe(400);
    expect((await request(app).post(`/api/listings/${id}/images`).set(auth(other.token)).attach('photos', png('5'), '5.png')).status).toBe(403);
  });
  test('rejects oversize image', async () => {
    const u = await makeUser(); const { body } = await create(u);
    const big = Buffer.concat([png('x'), Buffer.alloc(6 * 1024 * 1024)]);
    const res = await request(app).post(`/api/listings/${body.listing.id}/images`).set(auth(u.token)).attach('photos', big, 'big.png');
    expect(res.status).toBe(400);
  });
  test('identical image reused in another listing is flagged (exact duplicate)', async () => {
    const a = await makeUser(); const b = await makeUser();
    const la = (await create(a)).body.listing; const lb = (await create(b)).body.listing;
    await request(app).post(`/api/listings/${la.id}/images`).set(auth(a.token)).attach('photos', png('same'), 'x.png');
    const dup = await request(app).post(`/api/listings/${lb.id}/images`).set(auth(b.token)).attach('photos', png('same'), 'y.png');
    expect(dup.status).toBe(201);
    expect(dup.body.listing.status).toBe('pending');
    const { rows } = await db.query("SELECT * FROM fraud_alerts WHERE listing_id = $1", [lb.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].flags.some((f) => f.type === 'duplicate_image_exact')).toBe(true);
  });
  test('stores ML fingerprint (phash/embedding) and sends lat/lng + image_count to fraud check', async () => {
    ml.analyzeImage.mockResolvedValue({ phash: 'abcdef0123456789', embedding: [0.1, 0.2, 0.3] });
    const u = await makeUser(); const { body } = await create(u);
    await request(app).post(`/api/listings/${body.listing.id}/images`).set(auth(u.token)).attach('photos', png('fp'), 'a.png');
    const { rows } = await db.query('SELECT phash, embedding FROM listing_images');
    expect(rows[0].phash).toBe('abcdef0123456789');
    expect(rows[0].embedding).toEqual([0.1, 0.2, 0.3]);
    const last = ml.checkFraud.mock.calls.at(-1)[0];
    expect(last.listing).toMatchObject({ latitude: 12.9784, longitude: 77.6408, image_count: 1, phashes: ['abcdef0123456789'] });
  });
  test('upload still works when ML fingerprinting is down', async () => {
    ml.analyzeImage.mockResolvedValue(null);
    const u = await makeUser(); const { body } = await create(u);
    const res = await request(app).post(`/api/listings/${body.listing.id}/images`).set(auth(u.token)).attach('photos', png('nofp'), 'a.png');
    expect(res.status).toBe(201);
    expect((await db.query('SELECT phash FROM listing_images')).rows[0].phash).toBeNull();
  });
  test('first poster is never flagged because of a later copy (exact image duplicate)', async () => {
    const a = await makeUser(); const b = await makeUser();
    const la = (await create(a)).body.listing;
    await request(app).post(`/api/listings/${la.id}/images`).set(auth(a.token)).attach('photos', png('orig'), 'x.png');
    const lb = (await create(b)).body.listing;
    const dup = await request(app).post(`/api/listings/${lb.id}/images`).set(auth(b.token)).attach('photos', png('orig'), 'y.png');
    expect(dup.body.listing.status).toBe('pending');           // the copy is flagged
    const edit = await request(app).put(`/api/listings/${la.id}`).set(auth(a.token)).send({ rent: 31000 });
    expect(edit.body.listing.status).toBe('approved');          // the original stays clean when re-checked
    expect((await db.query('SELECT count(*)::int n FROM fraud_alerts WHERE listing_id = $1', [la.id])).rows[0].n).toBe(0);
  });

  test('text/phash candidates sent to ML contain only EARLIER listings', async () => {
    const a = await makeUser(); const b = await makeUser();
    const la = (await create(a)).body.listing; const lb = (await create(b)).body.listing;
    await request(app).put(`/api/listings/${la.id}`).set(auth(a.token)).send({ rent: 31000 });
    const forA = ml.checkFraud.mock.calls.at(-1)[0];
    expect(forA.listing.id).toBe(la.id);
    expect(forA.candidates.map((c) => c.id)).not.toContain(lb.id);
    await request(app).put(`/api/listings/${lb.id}`).set(auth(b.token)).send({ rent: 31000 });
    const forB = ml.checkFraud.mock.calls.at(-1)[0];
    expect(forB.candidates.map((c) => c.id)).toContain(la.id);
  });

  test('delete a single image', async () => {
    const u = await makeUser(); const { body } = await create(u);
    const up = await request(app).post(`/api/listings/${body.listing.id}/images`).set(auth(u.token)).attach('photos', png('1'), 'a.png');
    const imgId = up.body.images[0].id;
    expect((await request(app).delete(`/api/listings/${body.listing.id}/images/${imgId}`).set(auth(u.token))).status).toBe(204);
    expect((await request(app).delete(`/api/listings/${body.listing.id}/images/${imgId}`).set(auth(u.token))).status).toBe(404);
  });
});
