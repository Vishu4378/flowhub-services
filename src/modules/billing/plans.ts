/**
 * The plan catalog. Prices are display values and MUST match the Stripe
 * prices whose ids are configured in STRIPE_PRICE_PRO / STRIPE_PRICE_BUSINESS;
 * Stripe is the source of truth for what is actually charged.
 * `null` limits mean unlimited.
 */
export const PLAN_IDS = ['free', 'pro', 'business'] as const;
export type PlanId = (typeof PLAN_IDS)[number];
export type PaidPlanId = Exclude<PlanId, 'free'>;
export type LimitedResource = 'projects' | 'members';

export interface Plan {
  id: PlanId;
  name: string;
  description: string;
  /** Monthly price in the smallest currency unit (cents). */
  priceMonthly: number;
  currency: string;
  limits: Record<LimitedResource, number | null>;
  features: string[];
  /** Env var holding the Stripe price id; null for the free plan. */
  stripePriceEnv: string | null;
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: 'free',
    name: 'Free',
    description: 'For individuals and small teams getting started.',
    priceMonthly: 0,
    currency: 'usd',
    limits: { projects: 3, members: 3 },
    features: ['Up to 3 projects', 'Up to 3 members', 'Roles and permissions'],
    stripePriceEnv: null,
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    description: 'For growing teams that run many projects.',
    priceMonthly: 1900,
    currency: 'usd',
    limits: { projects: 50, members: 25 },
    features: ['Up to 50 projects', 'Up to 25 members', 'Email support'],
    stripePriceEnv: 'STRIPE_PRICE_PRO',
  },
  business: {
    id: 'business',
    name: 'Business',
    description: 'For organizations that need room to scale.',
    priceMonthly: 7900,
    currency: 'usd',
    limits: { projects: null, members: null },
    features: ['Unlimited projects', 'Unlimited members', 'Priority support'],
    stripePriceEnv: 'STRIPE_PRICE_BUSINESS',
  },
};
