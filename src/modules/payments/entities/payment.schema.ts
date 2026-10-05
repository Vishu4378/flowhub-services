import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { tenantScopePlugin } from '../../../database/tenant-scope.plugin.js';

export const PAYMENT_STATUSES = ['paid', 'failed'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** A charge attempt reported by a provider (one per invoice). */
@Schema({ timestamps: true })
export class Payment {
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true })
  organizationId: Types.ObjectId;

  @Prop({ required: true })
  provider: string;

  /** Provider invoice id; unique so webhook retries are idempotent. */
  @Prop({ required: true, unique: true })
  providerInvoiceId: string;

  /** Smallest currency unit (cents). */
  @Prop({ required: true })
  amount: number;

  @Prop({ required: true })
  currency: string;

  @Prop({ type: String, enum: PAYMENT_STATUSES, required: true })
  status: PaymentStatus;

  @Prop({ default: '' })
  description: string;

  @Prop({ type: String, default: null })
  invoiceUrl: string | null;

  @Prop({ type: String, default: null })
  invoicePdfUrl: string | null;

  @Prop({ required: true })
  occurredAt: Date;
}

export type PaymentDocument = HydratedDocument<Payment>;
export const PaymentSchema = SchemaFactory.createForClass(Payment);
PaymentSchema.index({ organizationId: 1, occurredAt: -1 });
PaymentSchema.plugin(tenantScopePlugin);
