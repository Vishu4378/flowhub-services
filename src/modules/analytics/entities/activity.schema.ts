import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { tenantScopePlugin } from '../../../database/tenant-scope.plugin.js';

const ONE_YEAR = 365 * 24 * 60 * 60;

/** One entry in an organization's activity log. Kept for a year. */
// minimize: false keeps `meta: {}` in API output instead of dropping the key.
@Schema({ timestamps: { createdAt: true, updatedAt: false }, minimize: false })
export class Activity {
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true })
  organizationId: Types.ObjectId;

  /** Domain event name, e.g. project.created. */
  @Prop({ required: true })
  type: string;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  actorId: Types.ObjectId | null;

  /** What it happened to, denormalized so the log survives deletions. */
  @Prop({
    type: { id: String, name: String, kind: String },
    default: null,
    _id: false,
  })
  subject: { id: string; name: string; kind: string } | null;

  @Prop({ type: Object, default: {} })
  meta: Record<string, unknown>;

  @Prop({ type: Date, default: Date.now, expires: ONE_YEAR })
  createdAt: Date;
}

export type ActivityDocument = HydratedDocument<Activity>;
export const ActivitySchema = SchemaFactory.createForClass(Activity);
ActivitySchema.index({ organizationId: 1, createdAt: -1 });
ActivitySchema.plugin(tenantScopePlugin);
