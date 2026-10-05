import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isValidObjectId } from 'mongoose';
import { ROLES_KEY } from '../../common/decorators/roles.decorator.js';
import type { AuthenticatedRequest, OrgRole } from '../../common/types/auth.js';
import { OrganizationsService } from './organizations.service.js';

/**
 * Resolves the caller's membership in the `:orgId` route param and attaches
 * it as `request.org`. Non-members get 404 so org ids cannot be probed.
 * Combine with @Roles() to require a minimum role.
 */
@Injectable()
export class OrgMemberGuard implements CanActivate {
  constructor(
    private readonly organizations: OrganizationsService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const orgId = request.params.orgId;
    if (!request.user || !orgId || !isValidObjectId(orgId)) {
      throw new NotFoundException('Organization not found');
    }

    const membership = await this.organizations.findMembership(
      orgId,
      request.user.userId,
    );
    if (!membership) throw new NotFoundException('Organization not found');

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
