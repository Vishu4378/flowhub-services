import { IsEmail, IsOptional, IsString, Length } from 'class-validator';

export class RegisterDto {
  @IsString()
  @Length(1, 80)
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @Length(8, 128)
  password: string;

  /** Required unless signing up through an invitation, which supplies the org. */
  @IsOptional()
  @IsString()
  @Length(2, 80)
  organizationName?: string;

  /** Invitation token from an invite link; the user joins that org on signup. */
  @IsOptional()
  @IsString()
  inviteToken?: string;
}
