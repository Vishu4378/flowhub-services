import { IsIn } from 'class-validator';
import type { PaidPlanId } from '../plans.js';

export class CheckoutDto {
  @IsIn(['pro', 'business'])
  plan: PaidPlanId;
}
