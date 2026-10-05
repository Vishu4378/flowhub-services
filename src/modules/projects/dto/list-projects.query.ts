import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  PROJECT_STATUSES,
  type ProjectStatus,
} from '../entities/project.schema.js';

export class ListProjectsQuery {
  @IsOptional()
  @IsIn(PROJECT_STATUSES)
  status?: ProjectStatus;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}
