import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { tenantScopePlugin } from '../../../database/tenant-scope.plugin.js';
import { PLAN_IDS, type PlanId } from '../plans.js';

export const SUBSCRIPTION_STATUSES = [
  'none',
  'incomplete',
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** Statuses in which the paid plan's limits apply. */
export const ENTITLED_STATUSES: readonly SubscriptionStatus[] = [
  'trialing',
  'active',
  'past_due',
];

/** One per organization. Absent means the organization is on the free plan. */
@Schema({ timestamps: true })
export class Subscription {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    unique: true,
  })
  organizationId: Types.ObjectId;

  @Prop({ type: String, enum: PLAN_IDS, required: true, default: 'free' })
  plan: PlanId;

  @Prop({
    type: String,
    enum: SUBSCRIPTION_STATUSES,
    required: true,
    default: 'none',
  })
  status: SubscriptionStatus;

  @Prop({ type: String, default: 'stripe' })
  provider: string;

  @Prop({ type: String, default: null, index: true })
  customerId: string | null;

  @Prop({ type: String, default: null, index: true })
  subscriptionId: string | null;

  @Prop({ type: Date, default: null })
  currentPeriodEnd: Date | null;

  @Prop({ default: false })
  cancelAtPeriodEnd: boolean;
}

export type SubscriptionDocument = HydratedDocument<Subscription>;
export const SubscriptionSchema = SchemaFactory.createForClass(Subscription);
SubscriptionSchema.plugin(tenantScopePlugin);
