jest.mock('../src/services/mlClient');
const ml = require('../src/services/mlClient');
const { request, app, db, resetDb, makeUser, validListing, auth } = require('./helpers');

beforeEach(async () => { await resetDb(); jest.resetAllMocks(); });
afterAll(() => db.close());

describe('POST /api/predict', () => {
  const body = { city: 'Pune', area: 'Baner', size_sqft: 900, bhk: 2 };
  test('returns rounded prediction', async () => {
    ml.predictRent.mockResolvedValue({ predicted_rent: 31234.6, low: 28000.2, high: 35000.9, confidence: 'high' });
    const res = await request(app).post('/api/predict').send(body);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ predicted_rent: 31235, low: 28000, high: 35001, confidence: 'high' });
    expect(ml.predictRent.mock.calls[0][0]).toMatchObject({ city: 'Pune', bathrooms: 1, furnishing: 'unfurnished', amenities: [] });
  });
  test('503 with clear code when ML is down', async () => {
    ml.predictRent.mockResolvedValue(null);
    const res = await request(app).post('/api/predict').send(body);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('ml_unavailable');
  });
  test('validates input', async () => {
    expect((await request(app).post('/api/predict').send({ ...body, size_sqft: 5 })).status).toBe(400);
    expect((await request(app).post('/api/predict').send({ city: 'Pune' })).status).toBe(400);
  });
});

describe('GET /api/meta/cities', () => {
  test('lists only cities with approved listings, grouped case-insensitively', async () => {
    ml.predictRent.mockResolvedValue(null); ml.checkFraud.mockResolvedValue(null);
    const u = await makeUser();
    const mk = (o) => request(app).post('/api/listings').set(auth(u.token)).send(validListing(o));
    await mk({ city: 'Pune' }); await mk({ city: 'pune' }); await mk({ city: 'Mumbai' });
    await db.query("UPDATE listings SET status='pending' WHERE city='Mumbai'");
    const res = await request(app).get('/api/meta/cities');
    expect(res.body.items).toEqual([{ city: 'Pune', count: 2 }]);
  });
});
