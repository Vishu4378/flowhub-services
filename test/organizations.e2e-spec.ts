import {
  createTestApp,
  eventually,
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

describe('invitations', () => {
  it('lets a new person sign up through an invite and join the org', async () => {
    const owner = await register(t, uniqueEmail('owner'), 'Invite Co');
    const invitee = uniqueEmail('new');

    await t
      .api()
      .post(`/api/organizations/${owner.orgId}/invitations`)
      .set(owner.auth)
      .send({ email: invitee, role: 'admin' })
      .expect(201);
    const link = lastLinkTo(t, invitee);
    expect(link).toMatch(/^http:\/\/app\.test\/invite\//);
    const token = tokenFrom(link);

    const preview = await t.api().get(`/api/invitations/${token}`).expect(200);
    expect(preview.body).toMatchObject({
      organizationName: 'Invite Co',
      email: invitee,
      role: 'admin',
      accountExists: false,
    });

    // Signing up with a different email than invited is refused.
    await t
      .api()
      .post('/api/auth/register')
      .send({
        name: 'Wrong',
        email: uniqueEmail('wrong'),
        password: 'password123',
        inviteToken: token,
      })
      .expect(400);

    const res = await t
      .api()
      .post('/api/auth/register')
      .send({
        name: 'Newbie',
        email: invitee,
        password: 'password123',
        inviteToken: token,
      })
      .expect(201);
    expect(res.body.user.emailVerifiedAt).not.toBeNull();
    const me = await t
      .api()
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${res.body.accessToken}`)
      .expect(200);
    expect(me.body.organizations).toEqual([
      expect.objectContaining({ id: owner.orgId, role: 'admin' }),
    ]);

    // The invitation is single use.
    await t.api().get(`/api/invitations/${token}`).expect(404);
    // The owner hears about it.
    await eventually(async () => {
      const list = await t
        .api()
        .get('/api/notifications')
        .set(owner.auth)
        .expect(200);
      expect(list.body[0]).toMatchObject({
        type: 'member.joined',
        title: expect.stringContaining('Newbie joined'),
      });
    });
  });

  it('lets an existing user accept only with the invited email', async () => {
    const owner = await register(t, uniqueEmail('owner'), 'Second Co');
    const existing = await register(t, uniqueEmail('existing'));
    const stranger = await register(t, uniqueEmail('stranger'));

    await t
      .api()
      .post(`/api/organizations/${owner.orgId}/invitations`)
      .set(owner.auth)
      .send({ email: existing.email, role: 'member' })
      .expect(201);
    const token = tokenFrom(lastLinkTo(t, existing.email));

    // Existing users also get an in-app notification.
    await eventually(async () => {
      const count = await t
        .api()
        .get('/api/notifications/unread-count')
        .set(existing.auth)
        .expect(200);
      expect(count.body.count).toBe(1);
    });

    await t
      .api()
      .post(`/api/invitations/${token}/accept`)
      .set(stranger.auth)
      .expect(403);
    const accepted = await t
      .api()
      .post(`/api/invitations/${token}/accept`)
      .set(existing.auth)
      .expect(200);
    expect(accepted.body.organizationId).toBe(owner.orgId);

    // Inviting a current member is a conflict.
    await t
      .api()
      .post(`/api/organizations/${owner.orgId}/invitations`)
      .set(owner.auth)
      .send({ email: existing.email, role: 'member' })
      .expect(409);
  });

  it('lists and revokes pending invitations; members cannot invite', async () => {
    const owner = await register(t, uniqueEmail('owner'));
    const email = uniqueEmail('pending');
    const created = await t
      .api()
      .post(`/api/organizations/${owner.orgId}/invitations`)
      .set(owner.auth)
      .send({ email, role: 'member' })
      .expect(201);
    const token = tokenFrom(lastLinkTo(t, email));

    const list = await t
      .api()
      .get(`/api/organizations/${owner.orgId}/invitations`)
      .set(owner.auth)
      .expect(200);
    expect(list.body).toEqual([
      expect.objectContaining({ email, role: 'member' }),
    ]);
    expect(list.body[0].tokenHash).toBeDefined(); // hash only; the token itself is never stored

    await t
      .api()
      .delete(
        `/api/organizations/${owner.orgId}/invitations/${created.body.id}`,
      )
      .set(owner.auth)
      .expect(204);
    await t.api().get(`/api/invitations/${token}`).expect(404);
  });

  it('enforces the free plan member limit, counting pending invites', async () => {
    const owner = await register(t, uniqueEmail('owner'), 'Small Team');
    const invite = (email: string) =>
      t
        .api()
        .post(`/api/organizations/${owner.orgId}/invitations`)
        .set(owner.auth)
        .send({ email, role: 'member' });
    await invite(uniqueEmail()).expect(201);
    await invite(uniqueEmail()).expect(201);
    const res = await invite(uniqueEmail()).expect(402);
    expect(res.body).toMatchObject({
      code: 'PLAN_LIMIT',
      resource: 'members',
      limit: 3,
    });
  });
});

describe('member management', () => {
  async function teamWithMember() {
    const owner = await register(t, uniqueEmail('owner'), 'Team');
    const member = await register(t, uniqueEmail('member'), 'Other');
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
    return {
      owner,
      member,
      members: `/api/organizations/${owner.orgId}/members`,
    };
  }

  it('enforces roles and the last-owner rule', async () => {
    const { owner, member, members } = await teamWithMember();
    const list = await t.api().get(members).set(member.auth).expect(200);
    expect(list.body.map((m: { role: string }) => m.role)).toEqual([
      'owner',
      'member',
    ]);

    await t
      .api()
      .patch(`${members}/${owner.userId}`)
      .set(member.auth)
      .send({ role: 'member' })
      .expect(403);
    await t
      .api()
      .patch(`${members}/${owner.userId}`)
      .set(owner.auth)
      .send({ role: 'admin' })
      .expect(400);

    await t
      .api()
      .patch(`${members}/${member.userId}`)
      .set(owner.auth)
      .send({ role: 'admin' })
      .expect(200);
    await eventually(async () => {
      const list = await t
        .api()
        .get('/api/notifications')
        .set(member.auth)
        .expect(200);
      expect(list.body.map((n: { type: string }) => n.type)).toContain(
        'member.role_changed',
      );
    });
  });

  it('lets a member leave', async () => {
    const { member, members } = await teamWithMember();
    await t
      .api()
      .delete(`${members}/${member.userId}`)
      .set(member.auth)
      .expect(204);
    await t.api().get(members).set(member.auth).expect(404);
  });

  it('deletes a free organization with its data', async () => {
    const { orgId, auth } = await register(t, uniqueEmail(), 'Doomed');
    await t
      .api()
      .post(`/api/organizations/${orgId}/projects`)
      .set(auth)
      .send({ name: 'P' })
      .expect(201);
    await t.api().delete(`/api/organizations/${orgId}`).set(auth).expect(204);
    const me = await t.api().get('/api/auth/me').set(auth).expect(200);
    expect(me.body.organizations).toEqual([]);
  });
});
