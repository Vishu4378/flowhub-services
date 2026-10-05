import { IsString, Length } from 'class-validator';

export class TokenDto {
  @IsString()
  @Length(20, 200)
  token: string;
}
