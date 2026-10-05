import { ForbiddenException } from '@nestjs/common';
import type { OrgRole } from '../../common/types/auth.js';

/** Only owners can hand out the owner role. */
export function assertCanAssign(actor: OrgRole, target: OrgRole) {
  if (target === 'owner' && actor !== 'owner') {
    throw new ForbiddenException('Only owners can grant the owner role');
  }
}
