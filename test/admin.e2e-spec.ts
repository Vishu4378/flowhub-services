import {
  createTestApp,
  eventually,
  lastLinkTo,
  register,
  stripeWebhook,
  subscriptionObject,
  SUPER_ADMIN_EMAIL,
  tokenFrom,
  uniqueEmail,
  type Account,
  type TestApp,
} from './harness.js';

let t: TestApp;
let root: Account;
beforeAll(async () => {
  t = await createTestApp();
  root = await register(t, SUPER_ADMIN_EMAIL, 'Platform HQ');
}, 120_000);
afterAll(() => t?.close());

describe('super admin', () => {
  it('is only available to configured emails', async () => {
    const someone = await register(t);
    await t.api().get('/api/admin/stats').set(someone.auth).expect(403);
    await t.api().get('/api/admin/stats').expect(401);
    const me = await t.api().get('/api/auth/me').set(root.auth).expect(200);
    expect(me.body.isSuperAdmin).toBe(true);
    expect(
      (await t.api().get('/api/auth/me').set(someone.auth)).body.isSuperAdmin,
    ).toBe(false);
  });

  it('sees every organization with plan and counts', async () => {
    const owner = await register(t, uniqueEmail('owner'), 'Zebra Logistics');
    await t
      .api()
      .post(`/api/organizations/${owner.orgId}/projects`)
      .set(owner.auth)
      .send({ name: 'Fleet' })
      .expect(201);
    await stripeWebhook(t, {
      type: 'customer.subscription.created',
      data: { object: subscriptionObject(owner.orgId, { id: 'sub_admin' }) },
    }).expect(200);

    const list = await t
      .api()
      .get('/api/admin/organizations?search=zebra')
      .set(root.auth)
      .expect(200);
    expect(list.body).toMatchObject({ total: 1, page: 1 });
    expect(list.body.items[0]).toMatchObject({
      name: 'Zebra Logistics',
      members: 1,
      projects: 1,
      plan: 'pro',
      subscriptionStatus: 'active',
      suspendedAt: null,
    });

    const detail = await t
      .api()
      .get(`/api/admin/organizations/${owner.orgId}`)
      .set(root.auth)
      .expect(200);
    expect(detail.body.members).toEqual([
      expect.objectContaining({ email: owner.email, role: 'owner' }),
    ]);

    const stats = await t
      .api()
      .get('/api/admin/stats')
      .set(root.auth)
      .expect(200);
    expect(stats.body.organizations.paying).toBeGreaterThanOrEqual(1);
    expect(stats.body.revenue.mrr).toBeGreaterThanOrEqual(1900);
    expect(stats.body.users.total).toBeGreaterThanOrEqual(2);
  });

  it('suspends an organization, locking out its members until restored', async () => {
    const owner = await register(t, uniqueEmail('owner'), 'Shady Co');
    const projects = `/api/organizations/${owner.orgId}/projects`;
    await t.api().get(projects).set(owner.auth).expect(200);

    await t
      .api()
      .post(`/api/admin/organizations/${owner.orgId}/suspend`)
      .set(root.auth)
      .send({ reason: 'Unpaid invoices' })
      .expect(200);
    const blocked = await t.api().get(projects).set(owner.auth).expect(403);
    expect(blocked.body).toMatchObject({
      code: 'ORG_SUSPENDED',
      message: expect.stringContaining('Unpaid invoices'),
    });

    // Still listed for the member, flagged, so the UI can explain why.
    const me = await t.api().get('/api/auth/me').set(owner.auth).expect(200);
    expect(me.body.organizations[0].suspendedAt).not.toBeNull();
    await eventually(async () => {
      const n = await t
        .api()
        .get('/api/notifications')
        .set(owner.auth)
        .expect(200);
      expect(n.body[0]).toMatchObject({ type: 'organization.suspended' });
    });

    const suspended = await t
      .api()
      .get('/api/admin/organizations?status=suspended')
      .set(root.auth)
      .expect(200);
    expect(suspended.body.items.map((o: { id: string }) => o.id)).toContain(
      owner.orgId,
    );

    await t
      .api()
      .post(`/api/admin/organizations/${owner.orgId}/unsuspend`)
      .set(root.auth)
      .expect(200);
    await t.api().get(projects).set(owner.auth).expect(200);
  });

  it('shows a global audit log and lists users', async () => {
    const owner = await register(t, uniqueEmail('audited'), 'Audited Inc');
    await t
      .api()
      .post(`/api/organizations/${owner.orgId}/projects`)
      .set(owner.auth)
      .send({ name: 'Tracked' })
      .expect(201);
    await eventually(async () => {
      const log = await t
        .api()
        .get('/api/admin/activity')
        .set(root.auth)
        .expect(200);
      expect(log.body[0]).toMatchObject({
        type: 'project.created',
        organizationName: 'Audited Inc',
        subject: expect.objectContaining({ name: 'Tracked' }),
      });
    });

    const users = await t
      .api()
      .get(`/api/admin/users?search=${encodeURIComponent(owner.email)}`)
      .set(root.auth)
      .expect(200);
    expect(users.body.items).toEqual([
      expect.objectContaining({
        email: owner.email,
        organizations: 1,
        isSuperAdmin: false,
      }),
    ]);
    expect(users.body.items[0].passwordHash).toBeUndefined();
  });

  it('deletes free organizations but not paid ones', async () => {
    const free = await register(t, uniqueEmail(), 'Free To Go');
    await t
      .api()
      .delete(`/api/admin/organizations/${free.orgId}`)
      .set(root.auth)
      .expect(204);
    await t
      .api()
      .get(`/api/admin/organizations/${free.orgId}`)
      .set(root.auth)
      .expect(404);

    const paid = await register(t, uniqueEmail(), 'Paid Stays');
    await stripeWebhook(t, {
      type: 'customer.subscription.created',
      data: { object: subscriptionObject(paid.orgId, { id: 'sub_keep' }) },
    }).expect(200);
    await t
      .api()
      .delete(`/api/admin/organizations/${paid.orgId}`)
      .set(root.auth)
      .expect(400);
  });
});

describe('account self-service', () => {
  it('exports the account as a JSON download', async () => {
    const me = await register(t, uniqueEmail('export'), 'Export Co');
    const res = await t
      .api()
      .get('/api/auth/account/export')
      .set(me.auth)
      .expect(200);
    expect(res.headers['content-disposition']).toContain(
      'flowhub-account.json',
    );
    expect(res.body).toMatchObject({
      user: { email: me.email },
      organizations: [
        expect.objectContaining({ name: 'Export Co', role: 'owner' }),
      ],
    });
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it('deletes the account and its solo organizations', async () => {
    const me = await register(t, uniqueEmail('leaver'), 'Solo Org');
    await t
      .api()
      .delete('/api/auth/account')
      .set(me.auth)
      .send({ password: 'wrong' })
      .expect(400);
    await t
      .api()
      .delete('/api/auth/account')
      .set(me.auth)
      .send({ password: 'password123' })
      .expect(204);
    await t
      .api()
      .post('/api/auth/login')
      .send({ email: me.email, password: 'password123' })
      .expect(401);
    await t
      .api()
      .get(`/api/admin/organizations/${me.orgId}`)
      .set(root.auth)
      .expect(404);
  });

  it('refuses while the user is the only owner of a team', async () => {
    const owner = await register(t, uniqueEmail('owner'), 'Team Org');
    const member = await register(t, uniqueEmail('member'));
    await t
      .api()
      .post(`/api/organizations/${owner.orgId}/invitations`)
      .set(owner.auth)
      .send({ email: member.email, role: 'member' })
      .expect(201);
    await t
      .api()
      .post(`/api/invitations/${tokenFrom(lastLinkTo(t, member.email))}/accept`)
      .set(member.auth)
      .expect(200);

    const res = await t
      .api()
      .delete('/api/auth/account')
      .set(owner.auth)
      .send({ password: 'password123' })
      .expect(400);
    expect(res.body.message).toContain(
      'Make someone else an owner of Team Org',
    );

    // A plain member can always leave: their own org goes, the team stays.
    await t
      .api()
      .delete('/api/auth/account')
      .set(member.auth)
      .send({ password: 'password123' })
      .expect(204);
    const members = await t
      .api()
      .get(`/api/organizations/${owner.orgId}/members`)
      .set(owner.auth)
      .expect(200);
    expect(members.body).toHaveLength(1);
  });
});

describe('project API keys (scaffold)', () => {
  it('is wired for admins but not implemented yet', async () => {
    const { auth, orgId } = await register(t);
    const project = await t
      .api()
      .post(`/api/organizations/${orgId}/projects`)
      .set(auth)
      .send({ name: 'App' })
      .expect(201);
    expect(project.body).toMatchObject({
      apiKeyPrefix: null,
      apiKeyCreatedAt: null,
    });
    expect(project.body.apiKeyHash).toBeUndefined();
    await t
      .api()
      .post(`/api/organizations/${orgId}/projects/${project.body.id}/api-key`)
      .set(auth)
      .expect(501);
  });
});
