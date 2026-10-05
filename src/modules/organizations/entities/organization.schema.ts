import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

@Schema({ timestamps: true })
export class Organization {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  slug: string;

  /** Set by a super admin; while set, every org-scoped route returns 403. */
  @Prop({ type: Date, default: null })
  suspendedAt: Date | null;

  @Prop({ type: String, default: null })
  suspendedReason: string | null;
}

export type OrganizationDocument = HydratedDocument<Organization>;
export const OrganizationSchema = SchemaFactory.createForClass(Organization);
