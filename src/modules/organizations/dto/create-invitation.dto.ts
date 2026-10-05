import { IsEmail, IsIn } from 'class-validator';
import { ORG_ROLES, type OrgRole } from '../../../common/types/auth.js';

export class CreateInvitationDto {
  @IsEmail()
  email: string;

  @IsIn(ORG_ROLES)
  role: OrgRole;
}
