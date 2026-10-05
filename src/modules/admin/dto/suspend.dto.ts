import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SuspendDto {
  /** Shown to the organization's members. */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}
