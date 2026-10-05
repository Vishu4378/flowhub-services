import { IsString, Length, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  currentPassword: string;

  @IsString()
  @Length(8, 128)
  newPassword: string;
}
