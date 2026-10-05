import {
  createTestApp,
  eventually,
  PRICE_BUSINESS,
  register,
  stripeWebhook,
  subscriptionObject,
  uniqueEmail,
  type TestApp,
} from './harness.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
}, 120_000);
afterAll(() => t?.close());

describe('plans', () => {
  it('lists the public catalog without internal config', async () => {
    const res = await t.api().get('/api/billing/plans').expect(200);
    expect(res.body.map((p: { id: string }) => p.id)).toEqual([
      'free',
      'pro',
      'business',
    ]);
    expect(res.body[1]).toMatchObject({
      purchasable: true,
      limits: { projects: 50, members: 25 },
    });
    expect(res.body[1].stripePriceEnv).toBeUndefined();
  });
});

describe('subscriptions', () => {
  it('starts free, checks out, and upgrades when Stripe confirms', async () => {
    const owner = await register(t, uniqueEmail('owner'), 'Upgrade Co');
    const billing = `/api/organizations/${owner.orgId}/billing`;

    const before = await t.api().get(billing).set(owner.auth).expect(200);
    expect(before.body).toMatchObject({
      plan: { id: 'free' },
      status: 'none',
      usage: { projects: 0, members: 1 },
    });

    const checkout = await t
      .api()
      .post(`${billing}/checkout`)
      .set(owner.auth)
      .send({ plan: 'pro' })
      .expect(201);
    expect(checkout.body.url).toBe('https://checkout.stripe.test/session');
    expect(t.stripeCalls.checkout).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'cus_test',
        organizationId: owner.orgId,
        successUrl: `http://app.test/app/billing?org=${owner.orgId}&checkout=success`,
      }),
    );

    // Stripe → webhook: the subscription is active on Pro.
    await stripeWebhook(t, {
      type: 'customer.subscription.created',
      data: { object: subscriptionObject(owner.orgId, { id: 'sub_up' }) },
    }).expect(200);

    const after = await t.api().get(billing).set(owner.auth).expect(200);
    expect(after.body).toMatchObject({
      plan: { id: 'pro' },
      status: 'active',
      hasBillingAccount: true,
    });

    // The higher limit applies immediately.
    for (const name of ['1', '2', '3', '4']) {
      await t
        .api()
        .post(`/api/organizations/${owner.orgId}/projects`)
        .set(owner.auth)
        .send({ name })
        .expect(201);
    }

    // A second checkout is refused; the portal is the way to change plans.
    await t
      .api()
      .post(`${billing}/checkout`)
      .set(owner.auth)
      .send({ plan: 'business' })
      .expect(400);
    const portal = await t
      .api()
      .post(`${billing}/portal`)
      .set(owner.auth)
      .expect(201);
    expect(portal.body.url).toBe('https://billing.stripe.test/portal');

    // Plan change from the portal arrives as an update.
    await stripeWebhook(t, {
      type: 'customer.subscription.updated',
      data: {
        object: subscriptionObject(owner.orgId, {
          id: 'sub_up',
          price: PRICE_BUSINESS,
        }),
      },
    }).expect(200);
    expect((await t.api().get(billing).set(owner.auth)).body.plan.id).toBe(
      'business',
    );

    // Paid organizations cannot be deleted until canceled.
    await t
      .api()
      .delete(`/api/organizations/${owner.orgId}`)
      .set(owner.auth)
      .expect(400);

    await stripeWebhook(t, {
      type: 'customer.subscription.deleted',
      data: {
        object: subscriptionObject(owner.orgId, {
          id: 'sub_up',
          status: 'canceled',
        }),
      },
    }).expect(200);
    expect((await t.api().get(billing).set(owner.auth)).body).toMatchObject({
      plan: { id: 'free' },
      status: 'canceled',
    });

    // Owners are notified about plan changes.
    await eventually(async () => {
      const list = await t
        .api()
        .get('/api/notifications')
        .set(owner.auth)
        .expect(200);
      expect(
        list.body.filter(
          (n: { type: string }) => n.type === 'billing.subscription_changed',
        ).length,
      ).toBeGreaterThanOrEqual(2);
    });
  });

  it('only lets owners manage billing', async () => {
    const owner = await register(t, uniqueEmail('owner'));
    const admin = await register(t, uniqueEmail('admin'));
    await t
      .api()
      .post(`/api/organizations/${owner.orgId}/invitations`)
      .set(owner.auth)
      .send({ email: admin.email, role: 'admin' })
      .expect(201);
    const link = t.mail.outbox
      .filter((m) => m.to === admin.email)
      .pop()!
      .html.match(/invite\?token=([^"]+)"/)![1];
    await t
      .api()
      .post(`/api/invitations/${link}/accept`)
      .set(admin.auth)
      .expect(200);

    await t
      .api()
      .get(`/api/organizations/${owner.orgId}/billing`)
      .set(admin.auth)
      .expect(200);
    await t
      .api()
      .post(`/api/organizations/${owner.orgId}/billing/checkout`)
      .set(admin.auth)
      .send({ plan: 'pro' })
      .expect(403);
    await t
      .api()
      .post(`/api/organizations/${owner.orgId}/billing/portal`)
      .set(owner.auth)
      .expect(400); // no customer yet
  });
});

describe('payments webhook', () => {
  it('rejects unsigned or tampered requests', async () => {
    await t
      .api()
      .post('/api/payments/webhooks/stripe')
      .send({ type: 'invoice.paid' })
      .expect(400);
    await t
      .api()
      .post('/api/payments/webhooks/stripe')
      .set('stripe-signature', 't=1,v1=deadbeef')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ type: 'invoice.paid' }))
      .expect(400);
  });

  it('records invoices idempotently and alerts owners when a payment fails', async () => {
    const owner = await register(t, uniqueEmail('payer'), 'Paying Co');
    const invoice = (status: 'paid' | 'failed', id = 'in_1') => ({
      type: status === 'paid' ? 'invoice.paid' : 'invoice.payment_failed',
      data: {
        object: {
          id,
          object: 'invoice',
          amount_paid: status === 'paid' ? 1900 : 0,
          amount_due: 1900,
          currency: 'usd',
          number: 'FH-0001',
          created: Math.floor(Date.now() / 1000),
          hosted_invoice_url: 'https://invoice.stripe.test/1',
          invoice_pdf: 'https://invoice.stripe.test/1.pdf',
          lines: { data: [{ description: '1 × Pro (at $19.00 / month)' }] },
          parent: {
            subscription_details: { metadata: { organizationId: owner.orgId } },
          },
        },
      },
    });

    await stripeWebhook(t, invoice('paid')).expect(200);
    await stripeWebhook(t, invoice('paid')).expect(200); // retried by Stripe
    const payments = await t
      .api()
      .get(`/api/organizations/${owner.orgId}/payments`)
      .set(owner.auth)
      .expect(200);
    expect(payments.body).toEqual([
      expect.objectContaining({
        amount: 1900,
        currency: 'usd',
        status: 'paid',
        invoiceUrl: 'https://invoice.stripe.test/1',
      }),
    ]);

    await stripeWebhook(t, invoice('failed', 'in_2')).expect(200);
    await eventually(async () => {
      const list = await t
        .api()
        .get('/api/notifications')
        .set(owner.auth)
        .expect(200);
      expect(list.body[0]).toMatchObject({ type: 'billing.payment_failed' });
      // The email goes out right after the in-app notification.
      expect(
        t.mail.outbox.some(
          (m) => m.to === owner.email && m.subject.startsWith('Payment failed'),
        ),
      ).toBe(true);
    });
  });
});
