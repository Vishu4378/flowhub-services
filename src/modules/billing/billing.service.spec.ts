import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Organization } from '../organizations/entities/organization.schema.js';
import { StripeService } from '../payments/stripe.service.js';
import { UsersService } from '../users/users.service.js';
import { BillingService, PlanLimitException } from './billing.service.js';
import { Subscription } from './entities/subscription.schema.js';

const ORG = '64b000000000000000000001';

describe('BillingService', () => {
  const subscription = { findOne: vi.fn() };
  const counts: Record<string, number> = {};
  const connection = {
    models: new Proxy(
      {},
      {
        get: (_t, name: string) => ({
          countDocuments: () => ({ exec: async () => counts[name] ?? 0 }),
        }),
      },
    ),
  };

  async function make(env: Record<string, string> = {}) {
    const module = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: getModelToken(Subscription.name), useValue: subscription },
        { provide: getModelToken(Organization.name), useValue: {} },
        { provide: getConnectionToken(), useValue: connection },
        { provide: StripeService, useValue: { isConfigured: true } },
        { provide: UsersService, useValue: {} },
        { provide: ConfigService, useValue: { get: (k: string) => env[k] } },
        { provide: EventEmitter2, useValue: { emit: vi.fn() } },
      ],
    }).compile();
    return module.get(BillingService);
  }

  const sub = (doc: unknown) =>
    subscription.findOne.mockReturnValue({ exec: async () => doc });

  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(counts).forEach((k) => delete counts[k]);
  });

  it('treats a missing or canceled subscription as free', async () => {
    const billing = await make();
    sub(null);
    expect((await billing.currentPlan(ORG)).id).toBe('free');
    sub({ plan: 'pro', status: 'canceled' });
    expect((await billing.currentPlan(ORG)).id).toBe('free');
    sub({ plan: 'pro', status: 'past_due' });
    expect((await billing.currentPlan(ORG)).id).toBe('pro');
  });

  it('counts pending invitations against the member limit', async () => {
    const billing = await make();
    sub(null);
    counts.Membership = 2;
    counts.Invitation = 1;
    await expect(
      billing.assertWithinLimit(ORG, 'members'),
    ).rejects.toBeInstanceOf(PlanLimitException);
    counts.Invitation = 0;
    await expect(
      billing.assertWithinLimit(ORG, 'members'),
    ).resolves.toBeUndefined();
  });

  it('never limits unlimited plans', async () => {
    const billing = await make();
    sub({ plan: 'business', status: 'active' });
    counts.Project = 10_000;
    await expect(
      billing.assertWithinLimit(ORG, 'projects'),
    ).resolves.toBeUndefined();
  });

  it('marks paid plans purchasable only when their price is configured', async () => {
    const without = await make();
    expect(without.listPlans().map((p) => p.purchasable)).toEqual([
      true,
      false,
      false,
    ]);
    const withPro = await make({ STRIPE_PRICE_PRO: 'price_1' });
    expect(withPro.listPlans().map((p) => p.purchasable)).toEqual([
      true,
      true,
      false,
    ]);
  });
});
