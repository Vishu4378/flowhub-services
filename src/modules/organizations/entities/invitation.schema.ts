import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ORG_ROLES, type OrgRole } from '../../../common/types/auth.js';
import { tenantScopePlugin } from '../../../database/tenant-scope.plugin.js';

/** A pending invitation. Deleted when accepted, revoked, or expired (TTL). */
@Schema({ timestamps: true })
export class Invitation {
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true })
  organizationId: Types.ObjectId;

  @Prop({ required: true, lowercase: true, trim: true })
  email: string;

  @Prop({ type: String, enum: ORG_ROLES, required: true })
  role: OrgRole;

  /** SHA-256 of the emailed token; the token itself is never stored. */
  @Prop({ required: true, unique: true })
  tokenHash: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  invitedBy: Types.ObjectId;

  @Prop({ required: true, expires: 0 })
  expiresAt: Date;
}

export type InvitationDocument = HydratedDocument<Invitation>;
export const InvitationSchema = SchemaFactory.createForClass(Invitation);
// One live invitation per email per org; re-inviting replaces it.
InvitationSchema.index({ organizationId: 1, email: 1 }, { unique: true });
InvitationSchema.plugin(tenantScopePlugin);
