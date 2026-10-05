import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { ROLES_KEY } from '../../common/decorators/roles.decorator.js';
import type { AuthenticatedRequest, OrgRole } from '../../common/types/auth.js';
import { Membership } from './entities/membership.schema.js';
import { Organization } from './entities/organization.schema.js';

/**
 * Resolves the caller's membership in the `:orgId` route param and attaches
 * it as `request.org`. Non-members get 404 so org ids cannot be probed;
 * members of a suspended organization get 403 ORG_SUSPENDED.
 * Combine with @Roles() to require a minimum role.
 */
@Injectable()
export class OrgMemberGuard implements CanActivate {
  constructor(
    @InjectModel(Membership.name)
    private readonly memberships: Model<Membership>,
    @InjectModel(Organization.name)
    private readonly organizations: Model<Organization>,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const orgId = request.params.orgId;
    if (!request.user || !orgId || !isValidObjectId(orgId)) {
      throw new NotFoundException('Organization not found');
    }

    const membership = await this.memberships
      .findOne({
        organizationId: new Types.ObjectId(orgId),
        userId: new Types.ObjectId(request.user.userId),
      })
      .exec();
    if (!membership) throw new NotFoundException('Organization not found');

    const org = await this.organizations
      .findById(orgId, { suspendedAt: 1, suspendedReason: 1 })
      .exec();
    if (org?.suspendedAt) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'ORG_SUSPENDED',
        message: org.suspendedReason
          ? `This organization is suspended: ${org.suspendedReason}`
          : 'This organization is suspended. Contact support.',
      });
    }

    const roles = this.reflector.getAllAndOverride<OrgRole[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (roles && !roles.includes(membership.role)) {
      throw new ForbiddenException(`Requires role: ${roles.join(' or ')}`);
    }

    request.org = { organizationId: orgId, role: membership.role };
    return true;
  }
}
