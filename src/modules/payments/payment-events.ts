import type { SubscriptionStatus } from '../billing/entities/subscription.schema.js';

/**
 * Internal events from payment providers, normalized so billing never sees
 * provider-specific payloads. Adding Razorpay means emitting the same shape.
 */
export const PaymentEvent = {
  SubscriptionSynced: 'payments.subscription_synced',
} as const;

export interface SubscriptionSyncedEvent {
  organizationId: string;
  provider: string;
  customerId: string;
  subscriptionId: string;
  priceId: string | null;
  status: SubscriptionStatus;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}
