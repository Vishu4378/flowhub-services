import { IsString, Length } from 'class-validator';

export class CreateOrganizationDto {
  @IsString()
  @Length(2, 80)
  name: string;
}
