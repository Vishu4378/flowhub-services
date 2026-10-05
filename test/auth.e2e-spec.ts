import {
  createTestApp,
  lastLinkTo,
  register,
  tokenFrom,
  uniqueEmail,
  type TestApp,
} from './harness.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
}, 120_000);
afterAll(() => t?.close());

describe('registration and login', () => {
  it('registers, logs in and never exposes the password hash', async () => {
    const res = await t
      .api()
      .post('/api/auth/register')
      .send({
        name: 'Ada',
        email: 'Ada@Example.com',
        password: 'password123',
        organizationName: 'Analytical Engines',
      })
      .expect(201);
    expect(res.body.user).toMatchObject({
      email: 'ada@example.com',
      emailVerifiedAt: null,
    });
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(res.body.user._id).toBeUndefined();

    const login = await t
      .api()
      .post('/api/auth/login')
      .send({ email: 'ada@example.com', password: 'password123' })
      .expect(200);
    const me = await t
      .api()
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(200);
    expect(me.body.organizations).toEqual([
      expect.objectContaining({
        name: 'Analytical Engines',
        slug: 'analytical-engines',
        role: 'owner',
      }),
    ]);
  });

  it('rejects duplicate emails, bad passwords and missing tokens', async () => {
    const { email } = await register(t);
    await t
      .api()
      .post('/api/auth/register')
      .send({
        name: 'x',
        email,
        password: 'password123',
        organizationName: 'XY',
      })
      .expect(409);
    await t
      .api()
      .post('/api/auth/login')
      .send({ email, password: 'nope' })
      .expect(401);
    await t.api().get('/api/auth/me').expect(401);
  });

  it('validates input and requires an organization name without an invite', async () => {
    const res = await t
      .api()
      .post('/api/auth/register')
      .send({ email: 'bad', password: 'short' })
      .expect(400);
    expect(res.body.message).toEqual(
      expect.arrayContaining([expect.any(String)]),
    );
    await t
      .api()
      .post('/api/auth/register')
      .send({ name: 'No Org', email: uniqueEmail(), password: 'password123' })
      .expect(400);
  });
});

describe('email verification', () => {
  it('verifies with the emailed link, once', async () => {
    const account = await register(t);
    const token = tokenFrom(lastLinkTo(t, account.email));
    expect(lastLinkTo(t, account.email)).toMatch(
      /^http:\/\/app\.test\/verify-email\?token=/,
    );

    await t.api().post('/api/auth/verify-email').send({ token }).expect(204);
    const me = await t.api().get('/api/auth/me').set(account.auth).expect(200);
    expect(me.body.user.emailVerifiedAt).not.toBeNull();

    await t.api().post('/api/auth/verify-email').send({ token }).expect(400);
    await t
      .api()
      .post('/api/auth/verify-email/resend')
      .set(account.auth)
      .expect(400);
  });

  it('resending invalidates the previous link', async () => {
    const account = await register(t);
    const first = tokenFrom(lastLinkTo(t, account.email));
    await t
      .api()
      .post('/api/auth/verify-email/resend')
      .set(account.auth)
      .expect(204);
    const second = tokenFrom(lastLinkTo(t, account.email));
    expect(second).not.toBe(first);
    await t
      .api()
      .post('/api/auth/verify-email')
      .send({ token: first })
      .expect(400);
    await t
      .api()
      .post('/api/auth/verify-email')
      .send({ token: second })
      .expect(204);
  });
});

describe('password reset and change', () => {
  it('resets the password through the emailed link', async () => {
    const { email } = await register(t);
    await t.api().post('/api/auth/forgot-password').send({ email }).expect(204);
    const link = lastLinkTo(t, email);
    expect(link).toMatch(/\/reset-password\?token=/);

    const reset = await t
      .api()
      .post('/api/auth/reset-password')
      .send({ token: tokenFrom(link), password: 'brand-new-pass' })
      .expect(200);
    expect(reset.body.accessToken).toEqual(expect.any(String));

    await t
      .api()
      .post('/api/auth/login')
      .send({ email, password: 'password123' })
      .expect(401);
    await t
      .api()
      .post('/api/auth/login')
      .send({ email, password: 'brand-new-pass' })
      .expect(200);
    await t
      .api()
      .post('/api/auth/reset-password')
      .send({ token: tokenFrom(link), password: 'another-pass' })
      .expect(400);
  });

  it('does not reveal whether an email is registered', async () => {
    const before = t.mail.outbox.length;
    await t
      .api()
      .post('/api/auth/forgot-password')
      .send({ email: 'nobody@nowhere.test' })
      .expect(204);
    expect(t.mail.outbox.length).toBe(before);
  });

  it('changes the password when the current one is right', async () => {
    const { email, auth } = await register(t);
    await t
      .api()
      .post('/api/auth/change-password')
      .set(auth)
      .send({ currentPassword: 'wrong', newPassword: 'changed-pass' })
      .expect(400);
    await t
      .api()
      .post('/api/auth/change-password')
      .set(auth)
      .send({ currentPassword: 'password123', newPassword: 'changed-pass' })
      .expect(204);
    await t
      .api()
      .post('/api/auth/login')
      .send({ email, password: 'changed-pass' })
      .expect(200);
  });
});
