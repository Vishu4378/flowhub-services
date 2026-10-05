import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentOrg } from '../../common/decorators/current-org.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe.js';
import type { AuthUser, OrgContext } from '../../common/types/auth.js';
import { CreateOrganizationDto } from './dto/create-organization.dto.js';
import { UpdateMemberDto } from './dto/update-member.dto.js';
import { UpdateOrganizationDto } from './dto/update-organization.dto.js';
import { OrgMemberGuard } from './org-member.guard.js';
import { OrganizationsService, withRole } from './organizations.service.js';

@ApiTags('organizations')
@ApiBearerAuth()
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.organizationsService.listForUser(user.userId);
  }

  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateOrganizationDto,
  ) {
    const org = await this.organizationsService.createWithOwner(
      user.userId,
      dto.name,
    );
    return withRole(org, 'owner');
  }

  @Get(':orgId')
  @UseGuards(OrgMemberGuard)
  get(@Param('orgId') orgId: string, @CurrentOrg() org: OrgContext) {
    return this.organizationsService.get(orgId, org);
  }

  @Patch(':orgId')
  @UseGuards(OrgMemberGuard)
  @Roles('owner', 'admin')
  update(
    @Param('orgId') orgId: string,
    @Body() dto: UpdateOrganizationDto,
    @CurrentOrg() org: OrgContext,
  ) {
    return this.organizationsService.update(orgId, dto, org);
  }

  @Delete(':orgId')
  @UseGuards(OrgMemberGuard)
  @Roles('owner')
  @HttpCode(204)
  remove(@Param('orgId') orgId: string) {
    return this.organizationsService.remove(orgId);
  }

  @Get(':orgId/members')
  @UseGuards(OrgMemberGuard)
  listMembers(@Param('orgId') orgId: string) {
    return this.organizationsService.listMembers(orgId);
  }

  @Patch(':orgId/members/:userId')
  @UseGuards(OrgMemberGuard)
  @Roles('owner', 'admin')
  updateMember(
    @Param('orgId') orgId: string,
    @Param('userId', ParseObjectIdPipe) userId: string,
    @Body() dto: UpdateMemberDto,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
  ) {
    return this.organizationsService.updateMemberRole(orgId, userId, dto.role, {
      ...org,
      userId: user.userId,
    });
  }

  /** Admins remove others; any member may remove themselves (leave). */
  @Delete(':orgId/members/:userId')
  @UseGuards(OrgMemberGuard)
  @HttpCode(204)
  removeMember(
    @Param('orgId') orgId: string,
    @Param('userId', ParseObjectIdPipe) userId: string,
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
  ) {
    return this.organizationsService.removeMember(orgId, userId, {
      ...org,
      userId: user.userId,
    });
  }
}
