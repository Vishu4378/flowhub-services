import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import Stripe from 'stripe';
import request from 'supertest';
import type { MailService } from '../src/mail/mail.service.js';
import type { StripeService } from '../src/modules/payments/stripe.service.js';

export const STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';
export const PRICE_PRO = 'price_pro_test';
export const SUPER_ADMIN_EMAIL = 'root@flowhub.test';
export const PRICE_BUSINESS = 'price_business_test';

export interface TestApp {
  app: INestApplication;
  api: () => ReturnType<typeof request>;
  mail: MailService;
  stripe: StripeService;
  /** Spies on the stubbed Stripe calls, for asserting what was sent. */
  stripeCalls: {
    checkout: ReturnType<typeof vi.fn>;
    portal: ReturnType<typeof vi.fn>;
  };
  close: () => Promise<void>;
}

/**
 * Boots the real AppModule against a throwaway in-memory MongoDB. Stripe
 * network calls are stubbed; webhook signature checks stay real.
 */
export async function createTestApp(): Promise<TestApp> {
  const mongo = await MongoMemoryServer.create();
  Object.assign(process.env, {
    MONGODB_URI: mongo.getUri('flowhub-e2e'),
    JWT_SECRET: 'e2e-secret',
    APP_URL: 'http://app.test',
    MAIL_FROM: '',
    STRIPE_SECRET_KEY: 'sk_test_dummy',
    STRIPE_WEBHOOK_SECRET,
    STRIPE_PRICE_PRO: PRICE_PRO,
    STRIPE_PRICE_BUSINESS: PRICE_BUSINESS,
    OBSERVE_APP_KEY: '',
    SUPER_ADMIN_EMAILS: SUPER_ADMIN_EMAIL,
  });

  // Imported after env is set so ConfigModule picks it up.
  const { AppModule } = await import('../src/app.module.js');
  const { configureApp } = await import('../src/app.setup.js');
  const { MailService } = await import('../src/mail/mail.service.js');
  const { StripeService } =
    await import('../src/modules/payments/stripe.service.js');

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = configureApp(moduleRef.createNestApplication({ rawBody: true }));
  await app.init();

  const stripe = app.get(StripeService);
  vi.spyOn(stripe, 'createCustomer').mockResolvedValue('cus_test');
  const checkout = vi
    .fn()
    .mockResolvedValue('https://checkout.stripe.test/session');
  const portal = vi
    .fn()
    .mockResolvedValue('https://billing.stripe.test/portal');
  stripe.createCheckoutSession = checkout;
  stripe.createPortalSession = portal;

  return {
    app,
    api: () => request(app.getHttpServer()),
    mail: app.get(MailService),
    stripe,
    stripeCalls: { checkout, portal },
    close: async () => {
      await app.close();
      await mongo.stop();
    },
  };
}

export interface Account {
  token: string;
  userId: string;
  orgId: string;
  email: string;
  auth: { Authorization: string };
}

let counter = 0;
export const uniqueEmail = (prefix = 'user') =>
  `${prefix}${++counter}@example.com`;

export async function register(
  t: TestApp,
  email = uniqueEmail(),
  organizationName = 'Acme',
): Promise<Account> {
  const res = await t
    .api()
    .post('/api/auth/register')
    .send({
      name: email.split('@')[0],
      email,
      password: 'password123',
      organizationName,
    })
    .expect(201);
  const auth = { Authorization: `Bearer ${res.body.accessToken}` };
  const me = await t.api().get('/api/auth/me').set(auth).expect(200);
  return {
    token: res.body.accessToken,
    userId: res.body.user.id,
    orgId: me.body.organizations[0].id,
    email,
    auth,
  };
}

/** The link in the most recent email sent to `to`. */
export function lastLinkTo(t: TestApp, to: string): string {
  const mail = [...t.mail.outbox].reverse().find((m) => m.to === to);
  if (!mail) throw new Error(`No email sent to ${to}`);
  const match = mail.html.match(/href="([^"]+)"/);
  if (!match) throw new Error(`No link in "${mail.subject}"`);
  return match[1];
}

export const tokenFrom = (link: string) =>
  new URL(link).searchParams.get('token') ?? link.split('/').pop()!;

/** Listeners run asynchronously; poll until the assertion passes. */
export async function eventually<T>(
  fn: () => Promise<T>,
  timeoutMs = 3000,
): Promise<T> {
  const started = Date.now();
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      if (Date.now() - started > timeoutMs) throw error;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}

/** Sends a Stripe-signed webhook, exactly as Stripe would. */
export function stripeWebhook(
  t: TestApp,
  event: { type: string; data: { object: unknown } },
) {
  const payload = JSON.stringify({
    id: `evt_${Date.now()}`,
    object: 'event',
    ...event,
  });
  const header = new Stripe('sk_test_dummy').webhooks.generateTestHeaderString({
    payload,
    secret: STRIPE_WEBHOOK_SECRET,
  });
  return t
    .api()
    .post('/api/payments/webhooks/stripe')
    .set('stripe-signature', header)
    .set('Content-Type', 'application/json')
    .send(payload);
}

export function subscriptionObject(
  orgId: string,
  overrides: { status?: string; price?: string; id?: string } = {},
) {
  return {
    id: overrides.id ?? 'sub_test',
    object: 'subscription',
    customer: 'cus_test',
    status: overrides.status ?? 'active',
    cancel_at_period_end: false,
    metadata: { organizationId: orgId },
    items: {
      data: [
        {
          price: { id: overrides.price ?? PRICE_PRO },
          current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
        },
      ],
    },
  };
}
