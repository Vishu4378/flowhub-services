import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  DomainEvent,
  type DomainEventName,
  type MemberEvent,
  type MemberInvitedEvent,
  type OrgEvent,
  type OrgSuspensionEvent,
  type ProjectEvent,
  type SubscriptionChangedEvent,
} from '../../common/events/domain-events.js';
import { ErrorReporter } from '../../common/errors/error-reporter.service.js';
import { UsersService } from '../users/users.service.js';
import {
  AnalyticsService,
  type RecordActivityInput,
} from './analytics.service.js';

/** Writes every org-level domain event to the activity log. */
@Injectable()
export class AnalyticsListener {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly usersService: UsersService,
    private readonly reporter: ErrorReporter,
  ) {}

  @OnEvent(DomainEvent.ProjectCreated, { async: true })
  onProjectCreated(e: ProjectEvent) {
    return this.project(DomainEvent.ProjectCreated, e);
  }

  @OnEvent(DomainEvent.ProjectUpdated, { async: true })
  onProjectUpdated(e: ProjectEvent) {
    return this.project(DomainEvent.ProjectUpdated, e);
  }

  @OnEvent(DomainEvent.ProjectArchived, { async: true })
  onProjectArchived(e: ProjectEvent) {
    return this.project(DomainEvent.ProjectArchived, e);
  }

  @OnEvent(DomainEvent.ProjectRestored, { async: true })
  onProjectRestored(e: ProjectEvent) {
    return this.project(DomainEvent.ProjectRestored, e);
  }

  @OnEvent(DomainEvent.ProjectDeleted, { async: true })
  onProjectDeleted(e: ProjectEvent) {
    return this.project(DomainEvent.ProjectDeleted, e);
  }

  @OnEvent(DomainEvent.MemberInvited, { async: true })
  onInvited(e: MemberInvitedEvent) {
    return this.safely(DomainEvent.MemberInvited, e, {
      subject: { id: e.email, name: e.email, kind: 'invitation' },
      meta: { role: e.role },
    });
  }

  @OnEvent(DomainEvent.MemberJoined, { async: true })
  onJoined(e: MemberEvent) {
    return this.member(DomainEvent.MemberJoined, e);
  }

  @OnEvent(DomainEvent.MemberRoleChanged, { async: true })
  onRoleChanged(e: MemberEvent) {
    return this.member(DomainEvent.MemberRoleChanged, e);
  }

  @OnEvent(DomainEvent.MemberRemoved, { async: true })
  onRemoved(e: MemberEvent) {
    return this.member(DomainEvent.MemberRemoved, e);
  }

  @OnEvent(DomainEvent.OrganizationCreated, { async: true })
  onOrgCreated(e: OrgEvent) {
    return this.safely(DomainEvent.OrganizationCreated, e, {});
  }

  @OnEvent(DomainEvent.OrganizationSuspended, { async: true })
  onSuspended(e: OrgSuspensionEvent) {
    return this.safely(DomainEvent.OrganizationSuspended, e, {
      meta: { reason: e.reason },
    });
  }

  @OnEvent(DomainEvent.OrganizationUnsuspended, { async: true })
  onUnsuspended(e: OrgSuspensionEvent) {
    return this.safely(DomainEvent.OrganizationUnsuspended, e, {});
  }

  @OnEvent(DomainEvent.SubscriptionChanged, { async: true })
  onSubscription(e: SubscriptionChangedEvent) {
    return this.safely(DomainEvent.SubscriptionChanged, e, {
      meta: { plan: e.plan, status: e.status },
    });
  }

  private project(type: DomainEventName, e: ProjectEvent) {
    return this.safely(type, e, {
      subject: { id: e.projectId, name: e.projectName, kind: 'project' },
    });
  }

  private async member(type: DomainEventName, e: MemberEvent) {
    const user = await this.usersService.findById(e.userId).catch(() => null);
    return this.safely(type, e, {
      subject: { id: e.userId, name: user?.name ?? 'A member', kind: 'member' },
      meta: { role: e.role },
    });
  }

  private async safely(
    type: DomainEventName,
    event: OrgEvent,
    extra: Pick<RecordActivityInput, 'subject' | 'meta'>,
  ) {
    try {
      await this.analytics.record({
        organizationId: event.organizationId,
        actorId: event.actorId,
        type,
        ...extra,
      });
    } catch (error) {
      await this.reporter.report(error, {
        source: 'listener',
        organizationId: event.organizationId,
        detail: `analytics ${type}`,
      });
    }
  }
}
