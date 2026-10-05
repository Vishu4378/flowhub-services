import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { randomBytes } from 'node:crypto';
import { Model, Types, type Connection } from 'mongoose';
import {
  DomainEvent,
  type MemberEvent,
  type OrgEvent,
} from '../../common/events/domain-events.js';
import type { OrgContext, OrgRole } from '../../common/types/auth.js';
import { slugify } from '../../common/utils/slugify.js';
import { BillingService } from '../billing/billing.service.js';
import { UsersService } from '../users/users.service.js';
import {
  Membership,
  MembershipDocument,
} from './entities/membership.schema.js';
import {
  Organization,
  OrganizationDocument,
} from './entities/organization.schema.js';
import { UpdateOrganizationDto } from './dto/update-organization.dto.js';
import { assertCanAssign } from './roles.js';

/** Serializes an organization together with the caller's role in it. */
export function withRole(org: OrganizationDocument, role: OrgRole) {
  return Object.assign(org.toJSON(), { role });
}

@Injectable()
export class OrganizationsService {
  constructor(
    @InjectModel(Organization.name)
    private readonly organizations: Model<Organization>,
    @InjectModel(Membership.name)
    private readonly memberships: Model<Membership>,
    @InjectConnection() private readonly connection: Connection,
    private readonly usersService: UsersService,
    private readonly billingService: BillingService,
    private readonly events: EventEmitter2,
  ) {}

  /** Creates an organization and makes `userId` its owner. */
  async createWithOwner(
    userId: string,
    name: string,
  ): Promise<OrganizationDocument> {
    const slug = await this.uniqueSlug(name);
    const org = await this.organizations.create({ name, slug });
    await this.memberships.create({
      organizationId: org._id,
      userId: new Types.ObjectId(userId),
      role: 'owner',
    });
    this.events.emit(DomainEvent.OrganizationCreated, {
      organizationId: org.id as string,
      actorId: userId,
    } satisfies OrgEvent);
    return org;
  }

  /** Every organization the user belongs to, with their role in each. */
  async listForUser(userId: string) {
    const memberships = await this.memberships
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: 1 })
      .exec();
    const orgs = await this.organizations
      .find({ _id: { $in: memberships.map((m) => m.organizationId) } })
      .exec();
    const byId = new Map(orgs.map((o) => [o.id as string, o]));
    return memberships.flatMap((m) => {
      const org = byId.get(m.organizationId.toString());
      return org ? [withRole(org, m.role)] : [];
    });
  }

  async get(orgId: string, ctx: OrgContext) {
    const org = await this.organizations.findById(orgId).exec();
    if (!org) throw new NotFoundException('Organization not found');
    return withRole(org, ctx.role);
  }

  async update(orgId: string, dto: UpdateOrganizationDto, ctx: OrgContext) {
    const org = await this.organizations
      .findByIdAndUpdate(orgId, dto, {
        returnDocument: 'after',
        runValidators: true,
      })
      .exec();
    if (!org) throw new NotFoundException('Organization not found');
    return withRole(org, ctx.role);
  }

  /** Owner only: removes the organization, its memberships and tenant data. */
  async remove(orgId: string): Promise<void> {
    const plan = await this.billingService.currentPlan(orgId);
    if (plan.id !== 'free') {
      throw new BadRequestException(
        'Cancel the subscription under Billing before deleting this organization',
      );
    }
    const organizationId = new Types.ObjectId(orgId);
    for (const model of Object.values(this.connection.models)) {
      if (
        model.schema.path('organizationId') &&
        model.modelName !== Membership.name
      ) {
        await model.deleteMany({ organizationId }).exec();
      }
    }
    await this.memberships.deleteMany({ organizationId }).exec();
    await this.organizations.deleteOne({ _id: organizationId }).exec();
  }

  /**
   * What deleting this user's account would do: organizations where they are
   * the only member get deleted; any where they are the only owner but others
   * remain block the deletion (ownership must be handed over first).
   */
  async accountDeletionPlan(userId: string) {
    const memberships = await this.memberships
      .find({ userId: new Types.ObjectId(userId) })
      .exec();
    const deleteOrgs: string[] = [];
    const blockers: string[] = [];
    for (const m of memberships) {
      if (m.role !== 'owner') continue;
      const organizationId = m.organizationId;
      const [members, owners, org] = await Promise.all([
        this.memberships.countDocuments({ organizationId }).exec(),
        this.memberships
          .countDocuments({ organizationId, role: 'owner' })
          .exec(),
        this.organizations.findById(organizationId, { name: 1 }).exec(),
      ]);
      const name = org?.name ?? 'an organization';
      if (members === 1) {
        const plan = await this.billingService.currentPlan(
          organizationId.toString(),
        );
        if (plan.id !== 'free') {
          blockers.push(
            `Cancel the ${plan.name} subscription of ${name} first`,
          );
        } else {
          deleteOrgs.push(organizationId.toString());
        }
      } else if (owners === 1) {
        blockers.push(`Make someone else an owner of ${name} first`);
      }
    }
    return { deleteOrgs, blockers };
  }

  /** Removes every membership of a user (used when an account is deleted). */
  async removeAllMemberships(userId: string): Promise<void> {
    const memberships = await this.memberships
      .find({ userId: new Types.ObjectId(userId) })
      .exec();
    await this.memberships
      .deleteMany({ userId: new Types.ObjectId(userId) })
      .exec();
    for (const m of memberships) {
      this.events.emit(DomainEvent.MemberRemoved, {
        organizationId: m.organizationId.toString(),
        actorId: userId,
        userId,
        role: m.role,
      } satisfies MemberEvent);
    }
  }

  findMembership(
    orgId: string,
    userId: string,
  ): Promise<MembershipDocument | null> {
    return this.memberships
      .findOne({
        organizationId: new Types.ObjectId(orgId),
        userId: new Types.ObjectId(userId),
      })
      .exec();
  }

  async listMembers(orgId: string) {
    const memberships = await this.memberships
      .find({ organizationId: new Types.ObjectId(orgId) })
      .sort({ createdAt: 1 })
      .exec();
    const users = await this.usersService.findByIds(
      memberships.map((m) => m.userId.toString()),
    );
    const byId = new Map(users.map((u) => [u.id as string, u]));
    return memberships.flatMap((m) => {
      const user = byId.get(m.userId.toString());
      return user
        ? [
            {
              userId: user.id as string,
              name: user.name,
              email: user.email,
              role: m.role,
              joinedAt: (m as unknown as { createdAt: Date }).createdAt,
            },
          ]
        : [];
    });
  }

  async updateMemberRole(
    orgId: string,
    userId: string,
    role: OrgRole,
    ctx: OrgContext & { userId: string },
  ) {
    assertCanAssign(ctx.role, role);
    const membership = await this.requireMembership(orgId, userId);
    if (membership.role === 'owner' && role !== 'owner') {
      await this.assertNotLastOwner(orgId);
    }
    if (membership.role === 'owner' && ctx.role !== 'owner') {
      throw new ForbiddenException('Only owners can change an owner');
    }
    const previous = membership.role;
    membership.role = role;
    await membership.save();
    if (previous !== role) {
      this.events.emit(DomainEvent.MemberRoleChanged, {
        organizationId: orgId,
        actorId: ctx.userId,
        userId,
        role,
      } satisfies MemberEvent);
    }
    return { userId, role };
  }

  async removeMember(
    orgId: string,
    userId: string,
    ctx: OrgContext & { userId: string },
  ): Promise<void> {
    const membership = await this.requireMembership(orgId, userId);
    const isSelf = userId === ctx.userId;
    if (!isSelf && ctx.role === 'member') {
      throw new ForbiddenException('Only admins can remove members');
    }
    if (membership.role === 'owner') {
      if (!isSelf && ctx.role !== 'owner') {
        throw new ForbiddenException('Only owners can remove an owner');
      }
      await this.assertNotLastOwner(orgId);
    }
    await membership.deleteOne();
    this.events.emit(DomainEvent.MemberRemoved, {
      organizationId: orgId,
      actorId: ctx.userId,
      userId,
      role: membership.role,
    } satisfies MemberEvent);
  }

  private async requireMembership(orgId: string, userId: string) {
    const membership = await this.findMembership(orgId, userId);
    if (!membership) throw new NotFoundException('Member not found');
    return membership;
  }

  private async assertNotLastOwner(orgId: string) {
    const owners = await this.memberships
      .countDocuments({
        organizationId: new Types.ObjectId(orgId),
        role: 'owner',
      })
      .exec();
    if (owners <= 1) {
      throw new BadRequestException('An organization needs at least one owner');
    }
  }

  private async uniqueSlug(name: string): Promise<string> {
    const base = slugify(name) || 'org';
    if (!(await this.organizations.exists({ slug: base }))) return base;
    return `${base}-${randomBytes(3).toString('hex')}`;
  }
}
