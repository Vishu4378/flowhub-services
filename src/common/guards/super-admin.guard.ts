import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthenticatedRequest } from '../types/auth.js';

/** Platform owners, configured as SUPER_ADMIN_EMAILS (comma-separated). */
export function superAdminEmails(config: ConfigService): Set<string> {
  return new Set(
    (config.get<string>('SUPER_ADMIN_EMAILS') ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Restricts /admin routes to platform owners. Runs after the global
 * JwtAuthGuard, so `request.user` is already set. Kept in config rather than
 * the database so no API call can ever grant it.
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const email = request.user?.email.toLowerCase();
    if (!email || !superAdminEmails(this.config).has(email)) {
      throw new ForbiddenException('Super admin access required');
    }
    return true;
  }
}
