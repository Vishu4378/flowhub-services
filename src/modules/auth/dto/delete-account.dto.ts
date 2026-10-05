import { IsString, MinLength } from 'class-validator';

export class DeleteAccountDto {
  /** Re-entered to confirm a destructive action. */
  @IsString()
  @MinLength(1)
  password: string;
}
