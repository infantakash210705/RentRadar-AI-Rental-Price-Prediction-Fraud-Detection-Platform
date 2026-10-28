const { request, app, db, resetDb, makeUser, auth } = require('./helpers');

beforeEach(resetDb);
afterAll(() => db.close());

describe('auth', () => {
  test('signup returns user + token and never leaks password hash', async () => {
    const res = await request(app).post('/api/auth/signup').send({ name: 'Asha', email: 'ASHA@Example.com', password: 'Secret123' });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.email).toBe('asha@example.com');
    expect(res.body.user.role).toBe('user');
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
  });

  test('duplicate email -> 409', async () => {
    await makeUser({ email: 'dup@example.com' });
    const res = await request(app).post('/api/auth/signup').send({ name: 'Other', email: 'dup@example.com', password: 'Secret123' });
    expect(res.status).toBe(409);
  });

  test.each([
    [{ name: 'A', email: 'a@b.com', password: 'Secret123' }],
    [{ name: 'Asha', email: 'not-an-email', password: 'Secret123' }],
    [{ name: 'Asha', email: 'a@b.com', password: 'short1' }],
    [{ name: 'Asha', email: 'a@b.com', password: 'onlyletters' }],
    [{ name: 'Asha123', email: 'a@b.com', password: 'Secret123' }],
    [{ name: '12345', email: 'a@b.com', password: 'Secret123' }],
  ])('invalid signup %j -> 400', async (body) => {
    const res = await request(app).post('/api/auth/signup').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  test('role cannot be self-assigned at signup', async () => {
    const res = await request(app).post('/api/auth/signup').send({ name: 'Mallory', email: 'm@x.com', password: 'Secret123', role: 'admin' });
    expect(res.body.user.role).toBe('user');
  });

  test('login success and failures', async () => {
    const u = await makeUser();
    const ok = await request(app).post('/api/auth/login').send({ email: u.email, password: u.password });
    expect(ok.status).toBe(200);
    expect(ok.body.token).toBeTruthy();
    const bad = await request(app).post('/api/auth/login').send({ email: u.email, password: 'wrongpass1' });
    expect(bad.status).toBe(401);
    const unknown = await request(app).post('/api/auth/login').send({ email: 'nobody@x.com', password: 'whatever1' });
    expect(unknown.status).toBe(401);
    expect(unknown.body.error.message).toBe(bad.body.error.message); // no user enumeration
  });

  test('banned user cannot login or use existing token', async () => {
    const u = await makeUser();
    await db.query('UPDATE users SET is_banned = true WHERE id = $1', [u.user.id]);
    expect((await request(app).post('/api/auth/login').send({ email: u.email, password: u.password })).status).toBe(401);
    expect((await request(app).get('/api/users/me').set(auth(u.token))).status).toBe(403);
  });
});

describe('profile', () => {
  test('requires auth; rejects garbage token', async () => {
    expect((await request(app).get('/api/users/me')).status).toBe(401);
    expect((await request(app).get('/api/users/me').set(auth('garbage'))).status).toBe(401);
  });

  test('update name/phone', async () => {
    const u = await makeUser();
    const res = await request(app).put('/api/users/me').set(auth(u.token)).send({ name: 'New Name', phone: '+91 98765 43210' });
    expect(res.status).toBe(200);
    expect(res.body.user.name).toBe('New Name');
    expect(res.body.user.phone).toBe('+91 98765 43210');
  });

  test('change password needs correct current password', async () => {
    const u = await makeUser();
    const bad = await request(app).put('/api/users/me').set(auth(u.token)).send({ currentPassword: 'wrong1234', newPassword: 'Newpass123' });
    expect(bad.status).toBe(400);
    const ok = await request(app).put('/api/users/me').set(auth(u.token)).send({ currentPassword: u.password, newPassword: 'Newpass123' });
    expect(ok.status).toBe(200);
    const login = await request(app).post('/api/auth/login').send({ email: u.email, password: 'Newpass123' });
    expect(login.status).toBe(200);
  });

  test('empty update -> 400', async () => {
    const u = await makeUser();
    expect((await request(app).put('/api/users/me').set(auth(u.token)).send({})).status).toBe(400);
  });
});

describe('health + misc', () => {
  test('health ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.body).toEqual({ status: 'ok', db: 'up' });
  });
  test('unknown route -> JSON 404, malformed JSON -> 400', async () => {
    expect((await request(app).get('/api/nope')).status).toBe(404);
    const res = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{bad json');
    expect(res.status).toBe(400);
  });
});
