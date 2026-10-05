import {
  createTestApp,
  eventually,
  register,
  type TestApp,
} from './harness.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
}, 120_000);
afterAll(() => t?.close());

describe('analytics', () => {
  it('logs activity and summarizes the organization', async () => {
    const { orgId, auth } = await register(t);
    const base = `/api/organizations/${orgId}/projects`;
    const a = await t
      .api()
      .post(base)
      .set(auth)
      .send({ name: 'Alpha' })
      .expect(201);
    await t.api().post(base).set(auth).send({ name: 'Beta' }).expect(201);
    await t
      .api()
      .patch(`${base}/${a.body.id}`)
      .set(auth)
      .send({ status: 'archived' })
      .expect(200);

    const activity = await eventually(async () => {
      const res = await t
        .api()
        .get(`/api/organizations/${orgId}/activity`)
        .set(auth)
        .expect(200);
      expect(res.body).toHaveLength(4); // org created + 2 projects + archive
      return res.body;
    });
    expect(activity[0]).toMatchObject({
      type: 'project.archived',
      subject: { name: 'Alpha', kind: 'project' },
      actorName: expect.any(String),
    });

    const page = await t
      .api()
      .get(
        `/api/organizations/${orgId}/activity?limit=2&before=${encodeURIComponent(activity[1].createdAt)}`,
      )
      .set(auth)
      .expect(200);
    expect(page.body.map((e: { id: string }) => e.id)).toEqual([
      activity[2].id,
      activity[3].id,
    ]);

    const overview = await t
      .api()
      .get(`/api/organizations/${orgId}/analytics/overview`)
      .set(auth)
      .expect(200);
    expect(overview.body.totals).toEqual({
      activeProjects: 1,
      archivedProjects: 1,
      members: 1,
      eventsLast30Days: 4,
    });
    expect(overview.body.projectsCreatedByWeek).toHaveLength(12);
    expect(overview.body.projectsCreatedByWeek.at(-1).count).toBe(2);
  });
});

describe('notifications', () => {
  it('marks notifications read', async () => {
    const { userId, auth } = await register(t);
    const { NotificationsService } =
      await import('../src/modules/notifications/notifications.service.js');
    const service = t.app.get(NotificationsService);
    await service.notify([userId], { type: 'test', title: 'First' });
    await service.notify([userId], { type: 'test', title: 'Second' });

    expect(
      (await t.api().get('/api/notifications/unread-count').set(auth)).body
        .count,
    ).toBe(2);
    const list = await t.api().get('/api/notifications').set(auth).expect(200);
    await t
      .api()
      .post(`/api/notifications/${list.body[0].id}/read`)
      .set(auth)
      .expect(200);
    expect(
      (await t.api().get('/api/notifications?unread=true').set(auth)).body,
    ).toHaveLength(1);

    await t.api().post('/api/notifications/read-all').set(auth).expect(204);
    expect(
      (await t.api().get('/api/notifications/unread-count').set(auth)).body
        .count,
    ).toBe(0);
  });

  it('cannot read someone else’s notification', async () => {
    const owner = await register(t);
    const other = await register(t);
    const { NotificationsService } =
      await import('../src/modules/notifications/notifications.service.js');
    await t.app
      .get(NotificationsService)
      .notify([owner.userId], { type: 'test', title: 'Private' });
    const list = await t
      .api()
      .get('/api/notifications')
      .set(owner.auth)
      .expect(200);
    // Explicit, so a rare flake here reports what was actually returned.
    expect(list.body).toEqual([expect.objectContaining({ title: 'Private' })]);
    const [mine] = list.body;
    await t
      .api()
      .post(`/api/notifications/${mine.id}/read`)
      .set(other.auth)
      .expect(404);
  });
});
