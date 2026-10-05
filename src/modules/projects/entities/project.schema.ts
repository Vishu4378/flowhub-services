import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { tenantScopePlugin } from '../../../database/tenant-scope.plugin.js';

export const PROJECT_STATUSES = ['active', 'archived'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

@Schema({ timestamps: true })
export class Project {
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true })
  organizationId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ trim: true, default: '' })
  description: string;

  @Prop({
    type: String,
    enum: PROJECT_STATUSES,
    required: true,
    default: 'active',
  })
  status: ProjectStatus;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy: Types.ObjectId;

  // ---- API key (Phase 3, Day 14 — yours to implement in ProjectsService) ----

  /** First characters of the key, safe to show in the UI (e.g. "fh_live_3k9a"). */
  @Prop({ type: String, default: null })
  apiKeyPrefix: string | null;

  /** SHA-256 of the full key. Never returned by the API (select: false). */
  @Prop({ type: String, default: null, select: false })
  apiKeyHash: string | null;

  @Prop({ type: Date, default: null })
  apiKeyCreatedAt: Date | null;
}

export type ProjectDocument = HydratedDocument<Project>;
export const ProjectSchema = SchemaFactory.createForClass(Project);
ProjectSchema.index({ organizationId: 1, status: 1, updatedAt: -1 });
// Unique among real keys only. (A sparse index would still collide on the
// many projects whose hash is null.) Looked up by hash for x-org-api-key.
ProjectSchema.index(
  { apiKeyHash: 1 },
  {
    unique: true,
    partialFilterExpression: { apiKeyHash: { $type: 'string' } },
  },
);
ProjectSchema.plugin(tenantScopePlugin);
