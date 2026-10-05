import { IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import {
  PROJECT_STATUSES,
  type ProjectStatus,
} from '../entities/project.schema.js';

export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsIn(PROJECT_STATUSES)
  status?: ProjectStatus;
}
