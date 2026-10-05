import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Req,
  UseGuards,
  type RawBodyRequest,
} from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CurrentOrg } from '../../common/decorators/current-org.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import type { OrgContext } from '../../common/types/auth.js';
import { OrgMemberGuard } from '../organizations/org-member.guard.js';
import { PaymentsService } from './payments.service.js';
import { StripeService } from './stripe.service.js';

@ApiTags('payments')
@Controller()
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly stripe: StripeService,
  ) {}

  /** Billing history for an organization; owners and admins only. */
  @ApiBearerAuth()
  @Get('organizations/:orgId/payments')
  @UseGuards(OrgMemberGuard)
  @Roles('owner', 'admin')
  list(@CurrentOrg() org: OrgContext) {
    return this.paymentsService.listForOrg(org.organizationId);
  }

  /** Stripe → us. Authenticated by signature, not by bearer token. */
  @Public()
  @SkipThrottle()
  @ApiExcludeEndpoint()
  @Post('payments/webhooks/stripe')
  @HttpCode(200)
  async stripeWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature?: string,
  ) {
    if (!req.rawBody || !signature) {
      throw new BadRequestException('Missing body or signature');
    }
    const event = this.stripe.constructEvent(req.rawBody, signature);
    await this.paymentsService.handleStripeEvent(event);
    return { received: true };
  }
}
