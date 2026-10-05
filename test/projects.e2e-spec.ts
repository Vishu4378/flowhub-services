import {
  createTestApp,
  register,
  uniqueEmail,
  type TestApp,
} from './harness.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
}, 120_000);
afterAll(() => t?.close());

describe('projects', () => {
  it('runs the CRUD lifecycle inside one organization', async () => {
    const { auth, orgId } = await register(t);
    const base = `/api/organizations/${orgId}/projects`;

    const created = await t
      .api()
      .post(base)
      .set(auth)
      .send({ name: 'Website relaunch', description: 'Q4' })
      .expect(201);
    expect(created.body).toMatchObject({
      name: 'Website relaunch',
      status: 'active',
      organizationId: orgId,
    });
    await t.api().post(base).set(auth).send({ name: 'Mobile app' }).expect(201);

    const search = await t
      .api()
      .get(`${base}?search=web`)
      .set(auth)
      .expect(200);
    expect(search.body.map((p: { name: string }) => p.name)).toEqual([
      'Website relaunch',
    ]);

    await t
      .api()
      .patch(`${base}/${created.body.id}`)
      .set(auth)
      .send({ status: 'archived' })
      .expect(200);
    const archived = await t
      .api()
      .get(`${base}?status=archived`)
      .set(auth)
      .expect(200);
    expect(archived.body).toHaveLength(1);

    await t.api().delete(`${base}/${created.body.id}`).set(auth).expect(204);
    await t.api().get(`${base}/${created.body.id}`).set(auth).expect(404);
  });

  it('isolates tenants', async () => {
    const a = await register(t, uniqueEmail('a'), 'Tenant A');
    const b = await register(t, uniqueEmail('b'), 'Tenant B');
    const project = await t
      .api()
      .post(`/api/organizations/${a.orgId}/projects`)
      .set(a.auth)
      .send({ name: 'Secret' })
      .expect(201);

    await t
      .api()
      .get(`/api/organizations/${a.orgId}/projects`)
      .set(b.auth)
      .expect(404);
    await t
      .api()
      .get(`/api/organizations/${b.orgId}/projects/${project.body.id}`)
      .set(b.auth)
      .expect(404);
  });

  it('enforces the free plan project limit', async () => {
    const { auth, orgId } = await register(t);
    const base = `/api/organizations/${orgId}/projects`;
    for (const name of ['One', 'Two', 'Three']) {
      await t.api().post(base).set(auth).send({ name }).expect(201);
    }
    const res = await t
      .api()
      .post(base)
      .set(auth)
      .send({ name: 'Four' })
      .expect(402);
    expect(res.body).toMatchObject({
      code: 'PLAN_LIMIT',
      resource: 'projects',
      limit: 3,
    });
  });

  it('rejects unknown fields and bad ids', async () => {
    const { auth, orgId } = await register(t);
    await t
      .api()
      .post(`/api/organizations/${orgId}/projects`)
      .set(auth)
      .send({ name: 'X', hacked: true })
      .expect(400);
    await t
      .api()
      .get(`/api/organizations/${orgId}/projects/not-an-id`)
      .set(auth)
      .expect(400);
  });
});
