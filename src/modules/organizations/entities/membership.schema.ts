import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ORG_ROLES, type OrgRole } from '../../../common/types/auth.js';

/**
 * Links a user to an organization. This is the tenancy root, so it is queried
 * both per-org and per-user and is deliberately not tenant-scoped.
 */
@Schema({ timestamps: true })
export class Membership {
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true })
  organizationId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: String, enum: ORG_ROLES, required: true, default: 'member' })
  role: OrgRole;
}

export type MembershipDocument = HydratedDocument<Membership>;
export const MembershipSchema = SchemaFactory.createForClass(Membership);
MembershipSchema.index({ organizationId: 1, userId: 1 }, { unique: true });
