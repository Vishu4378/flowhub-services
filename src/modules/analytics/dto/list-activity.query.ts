import { Type } from 'class-transformer';
import { IsDate, IsInt, IsOptional, Max, Min } from 'class-validator';

export class ListActivityQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  /** Cursor: return entries older than this timestamp. */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  before?: Date;
}
