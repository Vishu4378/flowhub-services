import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import {
  Model,
  QueryFilter,
  Types,
  type Connection,
  type PipelineStage,
} from 'mongoose';
import {
  DomainEvent,
  type OrgSuspensionEvent,
} from '../../common/events/domain-events.js';
import { superAdminEmails } from '../../common/guards/super-admin.guard.js';
import { ENTITLED_STATUSES } from '../billing/entities/subscription.schema.js';
import { PLANS, type PlanId } from '../billing/plans.js';
import { Membership } from '../organizations/entities/membership.schema.js';
import { Organization } from '../organizations/entities/organization.schema.js';
import { OrganizationsService } from '../organizations/organizations.service.js';
import { User } from '../users/entities/user.schema.js';
import { AdminListQuery, AdminOrgListQuery } from './dto/admin-list.query.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Cross-tenant reads are this module's whole job, so tenant scope is skipped on purpose. */
const CROSS_TENANT = { skipTenantScope: true };

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface SubscriptionRow {
  organizationId: Types.ObjectId;
  plan: PlanId;
  status: string;
  currentPeriodEnd: Date | null;
}

/**
 * Platform-owner views across every organization. Reads other modules'
 * collections through the connection by model name, like billing does, so
 * this module depends on nothing but organizations (for deletion).
 */
@Injectable()
export class AdminService {
  constructor(
    @InjectModel(Organization.name)
    private readonly organizations: Model<Organization>,
    @InjectModel(Membership.name)
    private readonly memberships: Model<Membership>,
    @InjectConnection() private readonly connection: Connection,
    private readonly organizationsService: OrganizationsService,
    private readonly config: ConfigService,
    private readonly events: EventEmitter2,
  ) {}

  private model<T = unknown>(name: string): Model<T> {
    return this.connection.model<T>(name);
  }

  async stats() {
    const since30 = new Date(Date.now() - 30 * DAY_MS);
    const since12w = new Date(Date.now() - 12 * 7 * DAY_MS);
    const Users = this.model<User>('User');
    const [
      orgs,
      suspended,
      users,
      signups30,
      projects,
      subs,
      revenue,
      signupsByWeek,
    ] = await Promise.all([
      this.organizations.countDocuments().exec(),
      this.organizations.countDocuments({ suspendedAt: { $ne: null } }).exec(),
      Users.countDocuments().exec(),
      Users.countDocuments({ createdAt: { $gte: since30 } }).exec(),
      this.model('Project').countDocuments({}).setOptions(CROSS_TENANT).exec(),
      this.model<SubscriptionRow>('Subscription')
        .find({ status: { $in: ENTITLED_STATUSES } })
        .setOptions(CROSS_TENANT)
        .lean<SubscriptionRow[]>()
        .exec(),
      this.model('Payment')
        .aggregate<{ _id: string; total: number }>([
          {
            $match: {
              organizationId: { $exists: true },
              status: 'paid',
              occurredAt: { $gte: since30 },
            },
          },
          { $group: { _id: '$currency', total: { $sum: '$amount' } } },
        ])
        .option(CROSS_TENANT as never)
        .exec(),
      Users.aggregate<{ _id: Date; count: number }>([
        { $match: { createdAt: { $gte: since12w } } },
        {
          $group: {
            _id: {
              $dateTrunc: {
                date: '$createdAt',
                unit: 'week',
                startOfWeek: 'monday',
              },
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]).exec(),
    ]);

    const byPlan: Record<string, number> = { pro: 0, business: 0 };
    let mrr = 0;
    for (const sub of subs) {
      byPlan[sub.plan] = (byPlan[sub.plan] ?? 0) + 1;
      mrr += PLANS[sub.plan]?.priceMonthly ?? 0;
    }

    return {
      organizations: { total: orgs, suspended, paying: subs.length, byPlan },
      users: { total: users, signupsLast30Days: signups30 },
      projects: { total: projects },
      revenue: {
        /** Monthly recurring revenue implied by active subscriptions (plan catalog prices, USD cents). */
        mrr,
        currency: 'usd',
        last30Days: revenue.map((r) => ({ currency: r._id, amount: r.total })),
      },
      signupsByWeek: signupsByWeek.map((w) => ({
        weekStart: w._id,
        count: w.count,
      })),
    };
  }

  async listOrganizations(query: AdminOrgListQuery) {
    const { page, pageSize, skip } = paging(query);
    const filter: QueryFilter<Organization> = {};
    if (query.search?.trim()) {
      const re = { $regex: escapeRegex(query.search.trim()), $options: 'i' };
      filter.$or = [{ name: re }, { slug: re }];
    }
    if (query.status === 'suspended') filter.suspendedAt = { $ne: null };
    if (query.status === 'active') filter.suspendedAt = null;

    const [total, orgs] = await Promise.all([
      this.organizations.countDocuments(filter).exec(),
      this.organizations
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .exec(),
    ]);
    const ids = orgs.map((o) => o._id);
    const [members, projects, subs] = await Promise.all([
      this.countBy(this.memberships, ids),
      this.countBy(this.model('Project'), ids),
      this.subscriptionsFor(ids),
    ]);

    return {
      total,
      page,
      pageSize,
      items: orgs.map((o) => {
        const sub = subs.get(o.id as string);
        return Object.assign(o.toJSON(), {
          members: members.get(o.id as string) ?? 0,
          projects: projects.get(o.id as string) ?? 0,
          plan: effectivePlan(sub),
          subscriptionStatus: sub?.status ?? 'none',
        });
      }),
    };
  }

  async getOrganization(orgId: string) {
    const org = await this.organizations.findById(orgId).exec();
    if (!org) throw new NotFoundException('Organization not found');
    const organizationId = org._id;
    const [memberships, subs, projects, activity] = await Promise.all([
      this.memberships.find({ organizationId }).sort({ createdAt: 1 }).exec(),
      this.subscriptionsFor([organizationId]),
      this.model('Project').countDocuments({ organizationId }).exec(),
      this.recentActivity({ organizationId }, 20),
    ]);
    const users = await this.model<User>('User')
      .find({ _id: { $in: memberships.map((m) => m.userId) } })
      .exec();
    const byId = new Map(users.map((u) => [u.id as string, u]));
    const sub = subs.get(orgId);

    return Object.assign(org.toJSON(), {
      plan: effectivePlan(sub),
      subscriptionStatus: sub?.status ?? 'none',
      currentPeriodEnd: sub?.currentPeriodEnd ?? null,
      projects,
      members: memberships.flatMap((m) => {
        const u = byId.get(m.userId.toString());
        return u
          ? [
              {
                userId: u.id as string,
                name: u.name,
                email: u.email,
                role: m.role,
              },
            ]
          : [];
      }),
      activity,
    });
  }

  async suspend(orgId: string, reason: string | undefined, actorId: string) {
    const org = await this.organizations
      .findByIdAndUpdate(
        orgId,
        { suspendedAt: new Date(), suspendedReason: reason?.trim() || null },
        { returnDocument: 'after' },
      )
      .exec();
    if (!org) throw new NotFoundException('Organization not found');
    this.events.emit(DomainEvent.OrganizationSuspended, {
      organizationId: orgId,
      actorId,
      reason: org.suspendedReason,
    } satisfies OrgSuspensionEvent);
    return org;
  }

  async unsuspend(orgId: string, actorId: string) {
    const org = await this.organizations
      .findByIdAndUpdate(
        orgId,
        { suspendedAt: null, suspendedReason: null },
        { returnDocument: 'after' },
      )
      .exec();
    if (!org) throw new NotFoundException('Organization not found');
    this.events.emit(DomainEvent.OrganizationUnsuspended, {
      organizationId: orgId,
      actorId,
      reason: null,
    } satisfies OrgSuspensionEvent);
    return org;
  }

  /** Same rules as an owner deleting it: paid subscriptions must be canceled first. */
  async deleteOrganization(orgId: string): Promise<void> {
    if (!(await this.organizations.exists({ _id: orgId }))) {
      throw new NotFoundException('Organization not found');
    }
    await this.organizationsService.remove(orgId);
  }

  async listUsers(query: AdminListQuery) {
    const { page, pageSize, skip } = paging(query);
    const filter: QueryFilter<User> = {};
    if (query.search?.trim()) {
      const re = { $regex: escapeRegex(query.search.trim()), $options: 'i' };
      filter.$or = [{ name: re }, { email: re }];
    }
    const Users = this.model<User>('User');
    const [total, users] = await Promise.all([
      Users.countDocuments(filter).exec(),
      Users.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .exec(),
    ]);
    const orgCounts = await this.memberships
      .aggregate<{ _id: Types.ObjectId; count: number }>([
        { $match: { userId: { $in: users.map((u) => u._id) } } },
        { $group: { _id: '$userId', count: { $sum: 1 } } },
      ])
      .exec();
    const counts = new Map(orgCounts.map((c) => [c._id.toString(), c.count]));
    const admins = superAdminEmails(this.config);
    return {
      total,
      page,
      pageSize,
      items: users.map((u) =>
        Object.assign(u.toJSON(), {
          organizations: counts.get(u.id as string) ?? 0,
          isSuperAdmin: admins.has(u.email),
        }),
      ),
    };
  }

  /** Global audit log, newest first; paginate with `before`. */
  activity(before?: Date, limit = 50) {
    return this.recentActivity(
      before ? { createdAt: { $lt: before } } : {},
      limit,
    );
  }

  private async recentActivity(filter: QueryFilter<unknown>, limit: number) {
    const entries = await this.model<{
      organizationId: Types.ObjectId;
      actorId: Types.ObjectId | null;
    }>('Activity')
      .find(filter)
      .setOptions(CROSS_TENANT)
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();
    const orgIds = [
      ...new Set(entries.map((e) => e.organizationId.toString())),
    ];
    const actorIds = [
      ...new Set(
        entries.flatMap((e) => (e.actorId ? [e.actorId.toString()] : [])),
      ),
    ];
    const [orgs, actors] = await Promise.all([
      this.organizations.find({ _id: { $in: orgIds } }, { name: 1 }).exec(),
      this.model<User>('User')
        .find({ _id: { $in: actorIds } }, { name: 1 })
        .exec(),
    ]);
    const orgNames = new Map(orgs.map((o) => [o.id as string, o.name]));
    const actorNames = new Map(actors.map((u) => [u.id as string, u.name]));
    return entries.map((e) =>
      Object.assign(e.toJSON(), {
        organizationName:
          orgNames.get(e.organizationId.toString()) ?? 'Deleted organization',
        actorName: e.actorId
          ? (actorNames.get(e.actorId.toString()) ?? 'Former member')
          : null,
      }),
    );
  }

  private async countBy(model: Model<any>, ids: Types.ObjectId[]) {
    const pipeline: PipelineStage[] = [
      { $match: { organizationId: { $in: ids } } },
      { $group: { _id: '$organizationId', count: { $sum: 1 } } },
    ];
    const rows = await model
      .aggregate<{ _id: Types.ObjectId; count: number }>(pipeline)
      .option(CROSS_TENANT as never)
      .exec();
    return new Map(rows.map((r) => [r._id.toString(), r.count]));
  }

  private async subscriptionsFor(ids: Types.ObjectId[]) {
    const subs = await this.model<SubscriptionRow>('Subscription')
      .find({ organizationId: { $in: ids } })
      .lean<SubscriptionRow[]>()
      .exec();
    return new Map(subs.map((s) => [s.organizationId.toString(), s]));
  }
}

function effectivePlan(sub: SubscriptionRow | undefined): PlanId {
  return sub && (ENTITLED_STATUSES as readonly string[]).includes(sub.status)
    ? sub.plan
    : 'free';
}

function paging(query: AdminListQuery) {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 25;
  return { page, pageSize, skip: (page - 1) * pageSize };
}
