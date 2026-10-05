import { IsString, Length } from 'class-validator';
import { TokenDto } from './token.dto.js';

export class ResetPasswordDto extends TokenDto {
  @IsString()
  @Length(8, 128)
  password: string;
}
