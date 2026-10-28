const { request, app, db, resetDb, makeUser, validListing, auth } = require('./helpers');

beforeEach(resetDb);
afterAll(() => db.close());

describe('messaging and notifications', () => {
  async function setup() {
    const owner = await makeUser({ name: 'Owner User' });
    const renter = await makeUser({ name: 'Renter User' });
    const outsider = await makeUser({ name: 'Outsider User' });

    const lRes = await request(app)
      .post('/api/listings')
      .set(auth(owner.token))
      .send(validListing({ title: 'Luxury 2BHK in Indiranagar' }));
    expect(lRes.status).toBe(201);
    const listing = lRes.body.listing;

    return { owner, renter, outsider, listing };
  }

  test('renter can start a conversation with owner regarding a listing', async () => {
    const { owner, renter, listing } = await setup();

    const res = await request(app)
      .post('/api/messages/conversations')
      .set(auth(renter.token))
      .send({ listing_id: listing.id, initial_message: 'Hi, is this apartment still available?' });

    expect(res.status).toBe(201);
    expect(res.body.conversation).toBeDefined();
    expect(res.body.conversation.listing_id).toBe(listing.id);
    expect(res.body.conversation.other_user_name).toBe('Owner User');

    // Check message was inserted
    const mRes = await request(app)
      .get(`/api/messages/conversations/${res.body.conversation.id}/messages`)
      .set(auth(renter.token));
    expect(mRes.status).toBe(200);
    expect(mRes.body.items).toHaveLength(1);
    expect(mRes.body.items[0].body).toBe('Hi, is this apartment still available?');

    // Owner should have received a notification
    const nRes = await request(app)
      .get('/api/notifications')
      .set(auth(owner.token));
    expect(nRes.status).toBe(200);
    expect(nRes.body.items).toHaveLength(1);
    expect(nRes.body.items[0].title).toContain('New message from Renter User');
    expect(nRes.body.unread_count).toBe(1);
  });

  test('owner cannot message themselves about their own listing', async () => {
    const { owner, listing } = await setup();

    const res = await request(app)
      .post('/api/messages/conversations')
      .set(auth(owner.token))
      .send({ listing_id: listing.id });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/cannot message yourself/i);
  });

  test('repeated conversation requests do not create duplicate conversations', async () => {
    const { renter, listing } = await setup();

    const res1 = await request(app)
      .post('/api/messages/conversations')
      .set(auth(renter.token))
      .send({ listing_id: listing.id });
    expect(res1.status).toBe(201);

    const res2 = await request(app)
      .post('/api/messages/conversations')
      .set(auth(renter.token))
      .send({ listing_id: listing.id });
    expect(res2.status).toBe(200);
    expect(res2.body.conversation.id).toBe(res1.body.conversation.id);

    // List should only have 1 conversation
    const listRes = await request(app)
      .get('/api/messages/conversations')
      .set(auth(renter.token));
    expect(listRes.body.items).toHaveLength(1);
  });

  test('non-participant cannot view or send messages in a conversation', async () => {
    const { renter, outsider, listing } = await setup();

    const convRes = await request(app)
      .post('/api/messages/conversations')
      .set(auth(renter.token))
      .send({ listing_id: listing.id, initial_message: 'Hello!' });
    const convId = convRes.body.conversation.id;

    // Outsider tries to view conversation details
    const getRes = await request(app)
      .get(`/api/messages/conversations/${convId}`)
      .set(auth(outsider.token));
    expect(getRes.status).toBe(403);

    // Outsider tries to read messages
    const msgsRes = await request(app)
      .get(`/api/messages/conversations/${convId}/messages`)
      .set(auth(outsider.token));
    expect(msgsRes.status).toBe(403);

    // Outsider tries to send message
    const sendRes = await request(app)
      .post(`/api/messages/conversations/${convId}/messages`)
      .set(auth(outsider.token))
      .send({ body: 'Sneaky message' });
    expect(sendRes.status).toBe(403);
  });

  test('both parties can exchange messages and unread counts update', async () => {
    const { owner, renter, listing } = await setup();

    // 1. Renter initiates
    const convRes = await request(app)
      .post('/api/messages/conversations')
      .set(auth(renter.token))
      .send({ listing_id: listing.id, initial_message: 'Is rent negotiable?' });
    const convId = convRes.body.conversation.id;

    // 2. Owner checks conversation list (should see 1 unread message)
    const ownerConvList = await request(app)
      .get('/api/messages/conversations')
      .set(auth(owner.token));
    expect(ownerConvList.body.items).toHaveLength(1);
    expect(ownerConvList.body.items[0].unread_count).toBe(1);

    // 3. Owner opens messages (marks incoming as read)
    const ownerMsgs = await request(app)
      .get(`/api/messages/conversations/${convId}/messages`)
      .set(auth(owner.token));
    expect(ownerMsgs.body.items).toHaveLength(1);

    // 4. Owner unread count is now 0
    const ownerConvListAfter = await request(app)
      .get('/api/messages/conversations')
      .set(auth(owner.token));
    expect(ownerConvListAfter.body.items[0].unread_count).toBe(0);

    // 5. Owner replies
    const replyRes = await request(app)
      .post(`/api/messages/conversations/${convId}/messages`)
      .set(auth(owner.token))
      .send({ body: 'Yes, a little bit for immediate move-in.' });
    expect(replyRes.status).toBe(201);

    // 6. Renter receives notification
    const renterNotifs = await request(app)
      .get('/api/notifications')
      .set(auth(renter.token));
    expect(renterNotifs.body.items).toHaveLength(1);
    expect(renterNotifs.body.items[0].title).toContain('New message from Owner User');
    expect(renterNotifs.body.unread_count).toBe(1);

    // 7. Renter opens conversation
    const renterMsgs = await request(app)
      .get(`/api/messages/conversations/${convId}/messages`)
      .set(auth(renter.token));
    expect(renterMsgs.body.items).toHaveLength(2);

    // Notification for renter should be marked as read
    const renterNotifsAfter = await request(app)
      .get('/api/notifications/unread-count')
      .set(auth(renter.token));
    expect(renterNotifsAfter.body.unread_count).toBe(0);
  });

  test('notification management: mark read and mark-all read', async () => {
    const { owner, renter, listing } = await setup();

    // Renter creates conversation and sends 2 messages
    const convRes = await request(app)
      .post('/api/messages/conversations')
      .set(auth(renter.token))
      .send({ listing_id: listing.id, initial_message: 'First msg' });
    const convId = convRes.body.conversation.id;

    await request(app)
      .post(`/api/messages/conversations/${convId}/messages`)
      .set(auth(renter.token))
      .send({ body: 'Second msg' });

    // Owner has 2 unread notifications
    const unread = await request(app)
      .get('/api/notifications/unread-count')
      .set(auth(owner.token));
    expect(unread.body.unread_count).toBe(2);

    const list = await request(app)
      .get('/api/notifications')
      .set(auth(owner.token));
    const firstNotifId = list.body.items[0].id;

    // Mark single notification read
    const markOne = await request(app)
      .patch(`/api/notifications/${firstNotifId}/read`)
      .set(auth(owner.token));
    expect(markOne.status).toBe(200);
    expect(markOne.body.unread_count).toBe(1);

    // Mark all as read
    const markAll = await request(app)
      .patch('/api/notifications/read-all')
      .set(auth(owner.token));
    expect(markAll.status).toBe(200);
    expect(markAll.body.unread_count).toBe(0);
  });

  test('message validation: empty message or overly long message is rejected', async () => {
    const { renter, listing } = await setup();

    const convRes = await request(app)
      .post('/api/messages/conversations')
      .set(auth(renter.token))
      .send({ listing_id: listing.id });
    const convId = convRes.body.conversation.id;

    // Empty message
    const emptyRes = await request(app)
      .post(`/api/messages/conversations/${convId}/messages`)
      .set(auth(renter.token))
      .send({ body: '   ' });
    expect(emptyRes.status).toBe(400);

    // Over 2000 chars
    const longRes = await request(app)
      .post(`/api/messages/conversations/${convId}/messages`)
      .set(auth(renter.token))
      .send({ body: 'a'.repeat(2001) });
    expect(longRes.status).toBe(400);
  });
});
