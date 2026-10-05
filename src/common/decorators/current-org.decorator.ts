import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest, OrgContext } from '../types/auth.js';

/** The membership resolved by OrgMemberGuard for the `:orgId` route param. */
export const CurrentOrg = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): OrgContext =>
    ctx.switchToHttp().getRequest<AuthenticatedRequest>().org!,
);
