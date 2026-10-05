import { IsOptional, IsString, Length } from 'class-validator';

export class UpdateOrganizationDto {
  @IsOptional()
  @IsString()
  @Length(2, 80)
  name?: string;
}
