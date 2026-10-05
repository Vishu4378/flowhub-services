import type { OrgRole } from '../types/auth.js';

/**
 * Domain events emitted by feature services and consumed by cross-cutting
 * modules (notifications, analytics) so features never import those directly.
 */
export const DomainEvent = {
  UserRegistered: 'user.registered',
  ProjectCreated: 'project.created',
  ProjectUpdated: 'project.updated',
  ProjectArchived: 'project.archived',
  ProjectRestored: 'project.restored',
  ProjectDeleted: 'project.deleted',
  MemberInvited: 'member.invited',
  MemberJoined: 'member.joined',
  MemberRoleChanged: 'member.role_changed',
  MemberRemoved: 'member.removed',
  OrganizationCreated: 'organization.created',
  OrganizationSuspended: 'organization.suspended',
  OrganizationUnsuspended: 'organization.unsuspended',
  SubscriptionChanged: 'subscription.changed',
  PaymentFailed: 'payment.failed',
} as const;
export type DomainEventName = (typeof DomainEvent)[keyof typeof DomainEvent];

/** Common shape: who did what, in which organization. */
export interface OrgEvent {
  organizationId: string;
  /** The user who caused the event; absent for system events (webhooks). */
  actorId?: string;
}

export interface ProjectEvent extends OrgEvent {
  projectId: string;
  projectName: string;
}

export interface MemberInvitedEvent extends OrgEvent {
  email: string;
  role: OrgRole;
  organizationName: string;
  inviteUrl: string;
}

export interface MemberEvent extends OrgEvent {
  userId: string;
  role: OrgRole;
}

export interface SubscriptionChangedEvent extends OrgEvent {
  plan: string;
  status: string;
}

export interface UserRegisteredEvent {
  userId: string;
  email: string;
  name: string;
}

export interface OrgSuspensionEvent extends OrgEvent {
  reason: string | null;
}
