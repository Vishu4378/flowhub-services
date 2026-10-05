import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  DomainEvent,
  type MemberEvent,
  type MemberInvitedEvent,
  type OrgEvent,
  type OrgSuspensionEvent,
  type SubscriptionChangedEvent,
} from '../../common/events/domain-events.js';
import type { OrgRole } from '../../common/types/auth.js';
import { Membership } from '../organizations/entities/membership.schema.js';
import { Organization } from '../organizations/entities/organization.schema.js';
import { ErrorReporter } from '../../common/errors/error-reporter.service.js';
import { appPaths } from '../../common/utils/app-url.js';
import { UsersService } from '../users/users.service.js';
import { NotificationsService } from './notifications.service.js';

/**
 * Decides who hears about what. Listeners never throw back into the emitting
 * request: a failed notification is logged, the user's action still succeeds.
 */
@Injectable()
export class NotificationsListener {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly usersService: UsersService,
    private readonly reporter: ErrorReporter,
    @InjectModel(Membership.name)
    private readonly memberships: Model<Membership>,
    @InjectModel(Organization.name)
    private readonly organizations: Model<Organization>,
  ) {}

  @OnEvent(DomainEvent.MemberInvited, { async: true })
  async onInvited(event: MemberInvitedEvent) {
    await this.safely(async () => {
      const user = await this.usersService.findByEmail(event.email);
      if (!user) return; // They'll get the email; no account to notify yet.
      const url = new URL(event.inviteUrl);
      const invitePath = `${url.pathname}${url.search}`;
      await this.notifications.notify([user.id as string], {
        type: 'member.invited',
        title: `You're invited to ${event.organizationName}`,
        body: `You've been invited to join as ${event.role}.`,
        link: invitePath,
      });
    });
  }

  @OnEvent(DomainEvent.MemberJoined, { async: true })
  async onJoined(event: MemberEvent) {
    await this.safely(async () => {
      const [org, user, admins] = await Promise.all([
        this.orgName(event.organizationId),
        this.usersService.findById(event.userId),
        this.memberIds(event.organizationId, ['owner', 'admin']),
      ]);
      await this.notifications.notify(
        admins.filter((id) => id !== event.userId),
        {
          type: 'member.joined',
          orgId: event.organizationId,
          title: `${user.name} joined ${org}`,
          body: `${user.name} accepted the invitation and joined as ${event.role}.`,
          link: appPaths.org(event.organizationId, 'members'),
        },
      );
    });
  }

  @OnEvent(DomainEvent.MemberRoleChanged, { async: true })
  async onRoleChanged(event: MemberEvent) {
    await this.safely(async () => {
      if (event.userId === event.actorId) return;
      const org = await this.orgName(event.organizationId);
      await this.notifications.notify([event.userId], {
        type: 'member.role_changed',
        orgId: event.organizationId,
        title: `Your role in ${org} changed`,
        body: `You are now ${event.role === 'admin' ? 'an' : 'a'} ${event.role}.`,
        link: appPaths.org(event.organizationId, 'members'),
      });
    });
  }

  @OnEvent(DomainEvent.MemberRemoved, { async: true })
  async onRemoved(event: MemberEvent) {
    await this.safely(async () => {
      if (event.userId === event.actorId) return; // They left on their own.
      const org = await this.orgName(event.organizationId);
      await this.notifications.notify([event.userId], {
        type: 'member.removed',
        title: `You were removed from ${org}`,
        body: 'You no longer have access to its projects.',
      });
    });
  }

  @OnEvent(DomainEvent.SubscriptionChanged, { async: true })
  async onSubscriptionChanged(event: SubscriptionChangedEvent) {
    await this.safely(async () => {
      const [org, owners] = await Promise.all([
        this.orgName(event.organizationId),
        this.memberIds(event.organizationId, ['owner']),
      ]);
      const plan = event.plan.charAt(0).toUpperCase() + event.plan.slice(1);
      await this.notifications.notify(owners, {
        type: 'billing.subscription_changed',
        orgId: event.organizationId,
        title: `${org} is on the ${plan} plan`,
        body:
          event.status === 'past_due'
            ? 'Your last payment failed. Update your card to keep your plan.'
            : `Subscription status: ${event.status.replace('_', ' ')}.`,
        link: appPaths.org(event.organizationId, 'billing'),
      });
    });
  }

  @OnEvent(DomainEvent.OrganizationSuspended, { async: true })
  async onSuspended(event: OrgSuspensionEvent) {
    await this.safely(async () => {
      const [org, owners] = await Promise.all([
        this.orgName(event.organizationId),
        this.memberIds(event.organizationId, ['owner']),
      ]);
      await this.notifications.notify(
        owners,
        {
          type: 'organization.suspended',
          orgId: event.organizationId,
          title: `${org} has been suspended`,
          body: event.reason ?? 'Contact support to restore access.',
        },
        { email: true },
      );
    });
  }

  @OnEvent(DomainEvent.OrganizationUnsuspended, { async: true })
  async onUnsuspended(event: OrgSuspensionEvent) {
    await this.safely(async () => {
      const [org, owners] = await Promise.all([
        this.orgName(event.organizationId),
        this.memberIds(event.organizationId, ['owner']),
      ]);
      await this.notifications.notify(owners, {
        type: 'organization.unsuspended',
        orgId: event.organizationId,
        title: `${org} is active again`,
        body: 'Access has been restored for everyone.',
        link: appPaths.org(event.organizationId, 'overview'),
      });
    });
  }

  @OnEvent(DomainEvent.PaymentFailed, { async: true })
  async onPaymentFailed(event: OrgEvent) {
    await this.safely(async () => {
      const [org, owners] = await Promise.all([
        this.orgName(event.organizationId),
        this.memberIds(event.organizationId, ['owner']),
      ]);
      await this.notifications.notify(
        owners,
        {
          type: 'billing.payment_failed',
          orgId: event.organizationId,
          title: `Payment failed for ${org}`,
          body: 'We could not charge your card. Update your payment method to avoid losing your plan.',
          link: appPaths.org(event.organizationId, 'billing'),
        },
        { email: true },
      );
    });
  }

  private async memberIds(orgId: string, roles: OrgRole[]): Promise<string[]> {
    const members = await this.memberships
      .find({ organizationId: new Types.ObjectId(orgId), role: { $in: roles } })
      .exec();
    return members.map((m) => m.userId.toString());
  }

  private async orgName(orgId: string): Promise<string> {
    const org = await this.organizations.findById(orgId).exec();
    return org?.name ?? 'your organization';
  }

  private async safely(fn: () => Promise<void>) {
    try {
      await fn();
    } catch (error) {
      await this.reporter.report(error, {
        source: 'listener',
        detail: 'notifications',
      });
    }
  }
}
