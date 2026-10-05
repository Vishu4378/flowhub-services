import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

const NINETY_DAYS = 90 * 24 * 60 * 60;

/** An in-app notification addressed to one user. Expires after 90 days. */
@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class Notification {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  /**
   * The organization it concerns, if any. Deliberately `orgId`, not
   * `organizationId`: notifications belong to the user, so they are not
   * tenant-scoped and survive the organization being deleted.
   */
  @Prop({ type: Types.ObjectId, ref: 'Organization', default: null })
  orgId: Types.ObjectId | null;

  @Prop({ required: true })
  type: string;

  @Prop({ required: true })
  title: string;

  @Prop({ default: '' })
  body: string;

  /** App path to open when clicked, e.g. /app/orgs/:id/members. */
  @Prop({ type: String, default: null })
  link: string | null;

  @Prop({ type: Date, default: null })
  readAt: Date | null;

  @Prop({ type: Date, default: Date.now, expires: NINETY_DAYS })
  createdAt: Date;
}

export type NotificationDocument = HydratedDocument<Notification>;
export const NotificationSchema = SchemaFactory.createForClass(Notification);
NotificationSchema.index({ userId: 1, createdAt: -1 });
