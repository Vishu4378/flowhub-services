import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type Stripe from 'stripe';
import {
  DomainEvent,
  type OrgEvent,
} from '../../common/events/domain-events.js';
import type { SubscriptionStatus } from '../billing/entities/subscription.schema.js';
import { Payment, type PaymentStatus } from './entities/payment.schema.js';
import {
  PaymentEvent,
  type SubscriptionSyncedEvent,
} from './payment-events.js';

const STRIPE_STATUS: Record<string, SubscriptionStatus> = {
  incomplete: 'incomplete',
  incomplete_expired: 'canceled',
  trialing: 'trialing',
  active: 'active',
  past_due: 'past_due',
  canceled: 'canceled',
  unpaid: 'unpaid',
  paused: 'canceled',
};

const idOf = (ref: string | { id: string } | null | undefined) =>
  typeof ref === 'string' ? ref : (ref?.id ?? null);

/** Turns provider webhooks into payment records and normalized events. */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectModel(Payment.name) private readonly payments: Model<Payment>,
    private readonly events: EventEmitter2,
  ) {}

  listForOrg(orgId: string) {
    return this.payments
      .find({ organizationId: new Types.ObjectId(orgId) })
      .sort({ occurredAt: -1 })
      .limit(100)
      .exec();
  }

  async handleStripeEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        return this.syncStripeSubscription(event.data.object);
      case 'invoice.paid':
        return this.recordStripeInvoice(event.data.object, 'paid');
      case 'invoice.payment_failed':
        return this.recordStripeInvoice(event.data.object, 'failed');
      default:
        this.logger.debug(`Ignoring Stripe event ${event.type}`);
    }
  }

  private async syncStripeSubscription(sub: Stripe.Subscription) {
    const organizationId = sub.metadata?.organizationId;
    if (!organizationId) {
      this.logger.warn(`Subscription ${sub.id} has no organizationId metadata`);
      return;
    }
    const item = sub.items.data[0];
    const payload: SubscriptionSyncedEvent = {
      organizationId,
      provider: 'stripe',
      customerId: idOf(sub.customer)!,
      subscriptionId: sub.id,
      priceId: item?.price.id ?? null,
      status: STRIPE_STATUS[sub.status] ?? 'incomplete',
      currentPeriodEnd: item?.current_period_end
        ? new Date(item.current_period_end * 1000)
        : null,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    };
    // Awaited so a failure makes the webhook return 5xx and Stripe retries.
    await this.events.emitAsync(PaymentEvent.SubscriptionSynced, payload);
  }

  private async recordStripeInvoice(
    invoice: Stripe.Invoice,
    status: PaymentStatus,
  ) {
    const organizationId =
      invoice.parent?.subscription_details?.metadata?.organizationId;
    if (!organizationId || !invoice.id) {
      this.logger.warn(`Invoice ${invoice.id} has no organizationId metadata`);
      return;
    }
    await this.payments
      .updateOne(
        {
          organizationId: new Types.ObjectId(organizationId),
          providerInvoiceId: invoice.id,
        },
        {
          provider: 'stripe',
          amount: status === 'paid' ? invoice.amount_paid : invoice.amount_due,
          currency: invoice.currency,
          status,
          description:
            invoice.lines?.data[0]?.description ??
            `Invoice ${invoice.number ?? ''}`,
          invoiceUrl: invoice.hosted_invoice_url ?? null,
          invoicePdfUrl: invoice.invoice_pdf ?? null,
          occurredAt: new Date(invoice.created * 1000),
        },
        { upsert: true },
      )
      .exec();

    if (status === 'failed') {
      this.events.emit(DomainEvent.PaymentFailed, {
        organizationId,
      } satisfies OrgEvent);
    }
  }
}
