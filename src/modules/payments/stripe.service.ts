import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

/**
 * Thin wrapper over the Stripe SDK. Every call goes through here so tests can
 * replace this one provider, and so a missing key fails with a clear 503.
 */
@Injectable()
export class StripeService {
  private readonly client: Stripe | null;
  private readonly webhookSecret?: string;

  constructor(config: ConfigService) {
    const key = config.get<string>('STRIPE_SECRET_KEY');
    this.client = key ? new Stripe(key) : null;
    this.webhookSecret = config.get<string>('STRIPE_WEBHOOK_SECRET');
  }

  get isConfigured(): boolean {
    return this.client !== null;
  }

  private get stripe(): Stripe {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'Billing is not configured on this server',
      );
    }
    return this.client;
  }

  async createCustomer(params: {
    name: string;
    email: string;
    organizationId: string;
  }): Promise<string> {
    const customer = await this.stripe.customers.create({
      name: params.name,
      email: params.email,
      metadata: { organizationId: params.organizationId },
    });
    return customer.id;
  }

  async createCheckoutSession(params: {
    customerId: string;
    priceId: string;
    organizationId: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<string> {
    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: params.customerId,
      line_items: [{ price: params.priceId, quantity: 1 }],
      client_reference_id: params.organizationId,
      // Copied onto the subscription so its webhooks identify the org.
      subscription_data: {
        metadata: { organizationId: params.organizationId },
      },
      allow_promotion_codes: true,
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
    });
    if (!session.url) throw new BadRequestException('Stripe returned no URL');
    return session.url;
  }

  async createPortalSession(customerId: string, returnUrl: string) {
    const session = await this.stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
    return session.url;
  }

  /** Verifies the signature and parses a webhook payload. */
  constructEvent(payload: Buffer, signature: string): Stripe.Event {
    if (!this.webhookSecret) {
      throw new ServiceUnavailableException(
        'Stripe webhooks are not configured',
      );
    }
    try {
      return this.stripe.webhooks.constructEvent(
        payload,
        signature,
        this.webhookSecret,
      );
    } catch {
      throw new BadRequestException('Invalid Stripe signature');
    }
  }
}
