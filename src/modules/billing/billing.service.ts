import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Model, Types, type Connection } from 'mongoose';
import {
  DomainEvent,
  type SubscriptionChangedEvent,
} from '../../common/events/domain-events.js';
import { appUrl } from '../../common/utils/app-url.js';
import { Organization } from '../organizations/entities/organization.schema.js';
import {
  PaymentEvent,
  type SubscriptionSyncedEvent,
} from '../payments/payment-events.js';
import { StripeService } from '../payments/stripe.service.js';
import { UsersService } from '../users/users.service.js';
import {
  ENTITLED_STATUSES,
  Subscription,
} from './entities/subscription.schema.js';
import {
  PLAN_IDS,
  PLANS,
  type LimitedResource,
  type PaidPlanId,
  type Plan,
  type PlanId,
} from './plans.js';

/** Thrown when an action would exceed the organization's plan. */
export class PlanLimitException extends HttpException {
  constructor(resource: LimitedResource, limit: number, plan: Plan) {
    super(
      {
        statusCode: HttpStatus.PAYMENT_REQUIRED,
        error: 'Plan limit reached',
        code: 'PLAN_LIMIT',
        resource,
        limit,
        message: `The ${plan.name} plan allows up to ${limit} ${resource}. Upgrade to add more.`,
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}

@Injectable()
export class BillingService {
  constructor(
    @InjectModel(Subscription.name)
    private readonly subscriptions: Model<Subscription>,
    @InjectModel(Organization.name)
    private readonly organizations: Model<Organization>,
    @InjectConnection() private readonly connection: Connection,
    private readonly stripe: StripeService,
    private readonly usersService: UsersService,
    private readonly config: ConfigService,
    private readonly events: EventEmitter2,
  ) {}

  /** Public catalog, flagged with whether each paid plan can be bought here. */
  listPlans() {
    return PLAN_IDS.map((id) => {
      const { stripePriceEnv, ...plan } = PLANS[id];
      return {
        ...plan,
        purchasable:
          stripePriceEnv === null ||
          (this.stripe.isConfigured && !!this.config.get(stripePriceEnv)),
      };
    });
  }

  /** The plan whose limits currently apply to the organization. */
  async currentPlan(orgId: string): Promise<Plan> {
    const sub = await this.find(orgId);
    return sub && ENTITLED_STATUSES.includes(sub.status)
      ? PLANS[sub.plan]
      : PLANS.free;
  }

  async overview(orgId: string) {
    const [sub, plan, usage] = await Promise.all([
      this.find(orgId),
      this.currentPlan(orgId),
      this.usage(orgId),
    ]);
    const { stripePriceEnv: _, ...publicPlan } = plan;
    return {
      plan: publicPlan,
      status: sub?.status ?? 'none',
      currentPeriodEnd: sub?.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
      hasBillingAccount: !!sub?.customerId,
      usage,
      billingEnabled: this.stripe.isConfigured,
    };
  }

  /**
   * Call before creating a limited resource. `adding` is how many will be
   * created (default 1). Members include pending invitations.
   */
  async assertWithinLimit(
    orgId: string,
    resource: LimitedResource,
    adding = 1,
  ): Promise<void> {
    const plan = await this.currentPlan(orgId);
    const limit = plan.limits[resource];
    if (limit === null) return;
    const usage = await this.usage(orgId);
    if (usage[resource] + adding > limit) {
      throw new PlanLimitException(resource, limit, plan);
    }
  }

  /** Owner only: returns a Stripe Checkout URL for the chosen plan. */
  async createCheckout(orgId: string, planId: PaidPlanId, userId: string) {
    const plan = PLANS[planId];
    const priceId =
      plan.stripePriceEnv && this.config.get<string>(plan.stripePriceEnv);
    if (!priceId) {
      throw new BadRequestException(`The ${plan.name} plan is not available`);
    }
    const sub = await this.find(orgId);
    if (sub?.subscriptionId && ENTITLED_STATUSES.includes(sub.status)) {
      throw new BadRequestException(
        'This organization already has a subscription. Use "Manage billing" to change plans.',
      );
    }
    const customerId = await this.ensureCustomer(orgId, userId);
    const base = `/app/orgs/${orgId}/billing`;
    const url = await this.stripe.createCheckoutSession({
      customerId,
      priceId,
      organizationId: orgId,
      successUrl: appUrl(this.config, `${base}?checkout=success`),
      cancelUrl: appUrl(this.config, `${base}?checkout=canceled`),
    });
    return { url };
  }

  /** Stripe's hosted portal: change plan, update card, cancel, download invoices. */
  async createPortal(orgId: string) {
    const sub = await this.find(orgId);
    if (!sub?.customerId) {
      throw new BadRequestException(
        'This organization has no billing account yet',
      );
    }
    const url = await this.stripe.createPortalSession(
      sub.customerId,
      appUrl(this.config, `/app/orgs/${orgId}/billing`),
    );
    return { url };
  }

  @OnEvent(PaymentEvent.SubscriptionSynced, { promisify: true })
  async onSubscriptionSynced(event: SubscriptionSyncedEvent): Promise<void> {
    const plan = this.planForPrice(event.priceId);
    const organizationId = new Types.ObjectId(event.organizationId);
    const previous = await this.subscriptions
      .findOne({ organizationId })
      .exec();
    // Ignore stale events for a subscription that has since been replaced.
    if (
      previous?.subscriptionId &&
      previous.subscriptionId !== event.subscriptionId &&
      event.status === 'canceled'
    ) {
      return;
    }
    await this.subscriptions
      .updateOne(
        { organizationId },
        {
          plan: event.status === 'canceled' ? 'free' : plan,
          status: event.status,
          provider: event.provider,
          customerId: event.customerId,
          subscriptionId: event.subscriptionId,
          currentPeriodEnd: event.currentPeriodEnd,
          cancelAtPeriodEnd: event.cancelAtPeriodEnd,
        },
        { upsert: true },
      )
      .exec();

    if (previous?.plan !== plan || previous?.status !== event.status) {
      this.events.emit(DomainEvent.SubscriptionChanged, {
        organizationId: event.organizationId,
        plan: event.status === 'canceled' ? 'free' : plan,
        status: event.status,
      } satisfies SubscriptionChangedEvent);
    }
  }

  private planForPrice(priceId: string | null): PlanId {
    for (const id of PLAN_IDS) {
      const env = PLANS[id].stripePriceEnv;
      if (env && priceId && this.config.get(env) === priceId) return id;
    }
    return 'free';
  }

  private find(orgId: string) {
    return this.subscriptions
      .findOne({ organizationId: new Types.ObjectId(orgId) })
      .exec();
  }

  private async ensureCustomer(orgId: string, userId: string): Promise<string> {
    const sub = await this.find(orgId);
    if (sub?.customerId) return sub.customerId;
    const [org, user] = await Promise.all([
      this.organizations.findById(orgId).exec(),
      this.usersService.findById(userId),
    ]);
    if (!org) throw new NotFoundException('Organization not found');
    const customerId = await this.stripe.createCustomer({
      name: org.name,
      email: user.email,
      organizationId: orgId,
    });
    await this.subscriptions
      .updateOne(
        { organizationId: new Types.ObjectId(orgId) },
        {
          $set: { customerId },
          $setOnInsert: { plan: 'free', status: 'none' },
        },
        { upsert: true },
      )
      .exec();
    return customerId;
  }

  /**
   * Counts limited resources. Uses the connection's models by name so billing
   * does not depend on the projects/organizations modules (avoids cycles).
   */
  private async usage(orgId: string): Promise<Record<LimitedResource, number>> {
    const organizationId = new Types.ObjectId(orgId);
    const count = (model: string) =>
      this.connection.models[model]
        ?.countDocuments({ organizationId })
        .exec() ?? Promise.resolve(0);
    const [projects, memberships, invitations] = await Promise.all([
      count('Project'),
      count('Membership'),
      count('Invitation'),
    ]);
    return { projects, members: memberships + invitations };
  }
}
