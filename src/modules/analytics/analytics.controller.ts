import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentOrg } from '../../common/decorators/current-org.decorator.js';
import type { OrgContext } from '../../common/types/auth.js';
import { OrgMemberGuard } from '../organizations/org-member.guard.js';
import { AnalyticsService } from './analytics.service.js';
import { ListActivityQuery } from './dto/list-activity.query.js';

@ApiTags('analytics')
@ApiBearerAuth()
@UseGuards(OrgMemberGuard)
@Controller('organizations/:orgId')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('analytics/overview')
  overview(@CurrentOrg() org: OrgContext) {
    return this.analyticsService.overview(org.organizationId);
  }

  @Get('activity')
  activity(@CurrentOrg() org: OrgContext, @Query() query: ListActivityQuery) {
    return this.analyticsService.list(org.organizationId, query);
  }
}
