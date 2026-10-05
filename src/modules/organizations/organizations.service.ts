import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { randomBytes } from 'node:crypto';
import { Model, Types, type Connection } from 'mongoose';
import type { OrgContext, OrgRole } from '../../common/types/auth.js';
import { slugify } from '../../common/utils/slugify.js';
import { UsersService } from '../users/users.service.js';
import {
  Membership,
  MembershipDocument,
} from './entities/membership.schema.js';
import {
  Organization,
  OrganizationDocument,
} from './entities/organization.schema.js';
import { AddMemberDto } from './dto/add-member.dto.js';
import { UpdateOrganizationDto } from './dto/update-organization.dto.js';

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

  /** Adds an existing user by email. Invitations for new users come later. */
  async addMember(orgId: string, dto: AddMemberDto, ctx: OrgContext) {
    this.assertCanAssign(ctx.role, dto.role);
    const user = await this.usersService.findByEmail(dto.email);
    if (!user) {
      throw new NotFoundException(
        'No FlowHub account uses that email. Ask them to sign up first.',
      );
    }
    await this.memberships.create({
      organizationId: new Types.ObjectId(orgId),
      userId: user._id,
      role: dto.role,
    });
    return {
      userId: user.id as string,
      name: user.name,
      email: user.email,
      role: dto.role,
    };
  }

  async updateMemberRole(
    orgId: string,
    userId: string,
    role: OrgRole,
    ctx: OrgContext,
  ) {
    this.assertCanAssign(ctx.role, role);
    const membership = await this.requireMembership(orgId, userId);
    if (membership.role === 'owner' && role !== 'owner') {
      await this.assertNotLastOwner(orgId);
    }
    if (membership.role === 'owner' && ctx.role !== 'owner') {
      throw new ForbiddenException('Only owners can change an owner');
    }
    membership.role = role;
    await membership.save();
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
  }

  private async requireMembership(orgId: string, userId: string) {
    const membership = await this.findMembership(orgId, userId);
    if (!membership) throw new NotFoundException('Member not found');
    return membership;
  }

  private assertCanAssign(actor: OrgRole, target: OrgRole) {
    if (target === 'owner' && actor !== 'owner') {
      throw new ForbiddenException('Only owners can grant the owner role');
    }
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
