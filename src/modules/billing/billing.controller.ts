import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentOrg } from '../../common/decorators/current-org.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import type { AuthUser, OrgContext } from '../../common/types/auth.js';
import { OrgMemberGuard } from '../organizations/org-member.guard.js';
import { BillingService } from './billing.service.js';
import { CheckoutDto } from './dto/checkout.dto.js';

@ApiTags('billing')
@Controller()
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  /** Public: powers the marketing pricing page. */
  @Public()
  @Get('billing/plans')
  plans() {
    return this.billingService.listPlans();
  }

  @ApiBearerAuth()
  @Get('organizations/:orgId/billing')
  @UseGuards(OrgMemberGuard)
  overview(@CurrentOrg() org: OrgContext) {
    return this.billingService.overview(org.organizationId);
  }

  @ApiBearerAuth()
  @Post('organizations/:orgId/billing/checkout')
  @UseGuards(OrgMemberGuard)
  @Roles('owner')
  checkout(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Body() dto: CheckoutDto,
  ) {
    return this.billingService.createCheckout(
      org.organizationId,
      dto.plan,
      user.userId,
    );
  }

  @ApiBearerAuth()
  @Post('organizations/:orgId/billing/portal')
  @UseGuards(OrgMemberGuard)
  @Roles('owner')
  portal(@CurrentOrg() org: OrgContext) {
    return this.billingService.createPortal(org.organizationId);
  }
}
