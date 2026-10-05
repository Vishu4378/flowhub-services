import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { App } from 'supertest/types';

let mongo: MongoMemoryServer;
let app: INestApplication<App>;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri('flowhub-e2e');
  process.env.JWT_SECRET = 'e2e-secret';

  // Imported after env is set so ConfigModule picks up the test database.
  const { AppModule } = await import('../src/app.module.js');
  const { configureApp } = await import('../src/app.setup.js');
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = configureApp(moduleRef.createNestApplication());
  await app.init();
}, 120_000);

afterAll(async () => {
  await app?.close();
  await mongo?.stop();
});

const api = () => request(app.getHttpServer());

async function register(email: string, organizationName = 'Acme') {
  const res = await api()
    .post('/api/auth/register')
    .send({
      name: email.split('@')[0],
      email,
      password: 'password123',
      organizationName,
    })
    .expect(201);
  const me = await api()
    .get('/api/auth/me')
    .set('Authorization', `Bearer ${res.body.accessToken}`)
    .expect(200);
  return {
    token: res.body.accessToken as string,
    userId: res.body.user.id as string,
    orgId: me.body.organizations[0].id as string,
  };
}

describe('auth', () => {
  it('registers, logs in and hides the password hash', async () => {
    const res = await api()
      .post('/api/auth/register')
      .send({
        name: 'Ada',
        email: 'Ada@Example.com',
        password: 'password123',
        organizationName: 'Analytical Engines',
      })
      .expect(201);
    expect(res.body.user).toMatchObject({ email: 'ada@example.com' });
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(res.body.user._id).toBeUndefined();

    const login = await api()
      .post('/api/auth/login')
      .send({ email: 'ada@example.com', password: 'password123' })
      .expect(200);
    const me = await api()
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
    await register('dup@example.com');
    await api()
      .post('/api/auth/register')
      .send({
        name: 'x',
        email: 'dup@example.com',
        password: 'password123',
        organizationName: 'XY',
      })
      .expect(409);
    await api()
      .post('/api/auth/login')
      .send({ email: 'dup@example.com', password: 'nope' })
      .expect(401);
    await api().get('/api/auth/me').expect(401);
  });

  it('validates input', async () => {
    const res = await api()
      .post('/api/auth/register')
      .send({ email: 'not-an-email', password: 'short' })
      .expect(400);
    expect(res.body.message).toEqual(
      expect.arrayContaining([expect.any(String)]),
    );
  });
});

describe('projects', () => {
  it('runs the CRUD lifecycle inside one organization', async () => {
    const { token, orgId } = await register('pm@example.com');
    const auth = { Authorization: `Bearer ${token}` };
    const base = `/api/organizations/${orgId}/projects`;

    const created = await api()
      .post(base)
      .set(auth)
      .send({ name: 'Website relaunch', description: 'Q4' })
      .expect(201);
    expect(created.body).toMatchObject({
      name: 'Website relaunch',
      status: 'active',
      organizationId: orgId,
    });

    await api().post(base).set(auth).send({ name: 'Mobile app' }).expect(201);

    const search = await api().get(`${base}?search=web`).set(auth).expect(200);
    expect(search.body.map((p: { name: string }) => p.name)).toEqual([
      'Website relaunch',
    ]);

    await api()
      .patch(`${base}/${created.body.id}`)
      .set(auth)
      .send({ status: 'archived' })
      .expect(200);
    const archived = await api()
      .get(`${base}?status=archived`)
      .set(auth)
      .expect(200);
    expect(archived.body).toHaveLength(1);

    await api().delete(`${base}/${created.body.id}`).set(auth).expect(204);
    await api().get(`${base}/${created.body.id}`).set(auth).expect(404);
  });

  it('isolates tenants', async () => {
    const a = await register('a@tenant.com', 'Tenant A');
    const b = await register('b@tenant.com', 'Tenant B');
    const project = await api()
      .post(`/api/organizations/${a.orgId}/projects`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ name: 'Secret' })
      .expect(201);

    // B cannot see A's organization at all...
    await api()
      .get(`/api/organizations/${a.orgId}/projects`)
      .set('Authorization', `Bearer ${b.token}`)
      .expect(404);
    // ...nor reach A's project through B's own organization.
    await api()
      .get(`/api/organizations/${b.orgId}/projects/${project.body.id}`)
      .set('Authorization', `Bearer ${b.token}`)
      .expect(404);
  });
});

describe('members', () => {
  it('lets admins manage members and enforces roles', async () => {
    const owner = await register('owner@team.com', 'Team');
    const other = await register('member@team.com', 'Other');
    const ownerAuth = { Authorization: `Bearer ${owner.token}` };
    const memberAuth = { Authorization: `Bearer ${other.token}` };
    const members = `/api/organizations/${owner.orgId}/members`;

    await api()
      .post(members)
      .set(ownerAuth)
      .send({ email: 'member@team.com', role: 'member' })
      .expect(201);
    await api()
      .post(members)
      .set(ownerAuth)
      .send({ email: 'member@team.com', role: 'member' })
      .expect(409);
    await api()
      .post(members)
      .set(ownerAuth)
      .send({ email: 'nobody@team.com', role: 'member' })
      .expect(404);

    const list = await api().get(members).set(memberAuth).expect(200);
    expect(list.body.map((m: { role: string }) => m.role)).toEqual([
      'owner',
      'member',
    ]);

    // Members can read and create projects but not delete them or manage people.
    const project = await api()
      .post(`/api/organizations/${owner.orgId}/projects`)
      .set(memberAuth)
      .send({ name: 'By member' })
      .expect(201);
    await api()
      .delete(`/api/organizations/${owner.orgId}/projects/${project.body.id}`)
      .set(memberAuth)
      .expect(403);
    await api()
      .patch(`${members}/${owner.userId}`)
      .set(memberAuth)
      .send({ role: 'member' })
      .expect(403);

    // The last owner cannot step down.
    await api()
      .patch(`${members}/${owner.userId}`)
      .set(ownerAuth)
      .send({ role: 'admin' })
      .expect(400);

    // A member can leave.
    await api()
      .delete(`${members}/${other.userId}`)
      .set(memberAuth)
      .expect(204);
    await api().get(members).set(memberAuth).expect(404);
  });

  it('deletes an organization with its projects', async () => {
    const { token, orgId } = await register('del@example.com', 'Doomed');
    const auth = { Authorization: `Bearer ${token}` };
    await api()
      .post(`/api/organizations/${orgId}/projects`)
      .set(auth)
      .send({ name: 'P' })
      .expect(201);
    await api().delete(`/api/organizations/${orgId}`).set(auth).expect(204);
    const me = await api().get('/api/auth/me').set(auth).expect(200);
    expect(me.body.organizations).toEqual([]);
  });
});
