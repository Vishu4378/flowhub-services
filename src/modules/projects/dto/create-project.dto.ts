import { IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class CreateProjectDto {
  @IsString()
  @Length(1, 120)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}
