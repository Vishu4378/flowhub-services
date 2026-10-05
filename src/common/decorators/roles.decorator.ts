import { SetMetadata } from '@nestjs/common';
import type { OrgRole } from '../types/auth.js';

export const ROLES_KEY = 'orgRoles';

/** Restricts an org-scoped route to members holding one of these roles. */
export const Roles = (...roles: OrgRole[]) => SetMetadata(ROLES_KEY, roles);
