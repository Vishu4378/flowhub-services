import { IsIn } from 'class-validator';
import { ORG_ROLES, type OrgRole } from '../../../common/types/auth.js';

export class UpdateMemberDto {
  @IsIn(ORG_ROLES)
  role: OrgRole;
}
