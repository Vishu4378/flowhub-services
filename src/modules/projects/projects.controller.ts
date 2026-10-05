import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentOrg } from '../../common/decorators/current-org.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe.js';
import type { AuthUser, OrgContext } from '../../common/types/auth.js';
import { OrgMemberGuard } from '../organizations/org-member.guard.js';
import { CreateProjectDto } from './dto/create-project.dto.js';
import { ListProjectsQuery } from './dto/list-projects.query.js';
import { UpdateProjectDto } from './dto/update-project.dto.js';
import { ProjectsService } from './projects.service.js';

@ApiTags('projects')
@ApiBearerAuth()
@UseGuards(OrgMemberGuard)
@Controller('organizations/:orgId/projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get()
  list(@CurrentOrg() org: OrgContext, @Query() query: ListProjectsQuery) {
    return this.projectsService.list(org.organizationId, query);
  }

  @Post()
  create(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateProjectDto,
  ) {
    return this.projectsService.create(org.organizationId, user.userId, dto);
  }

  @Get(':id')
  get(
    @CurrentOrg() org: OrgContext,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    return this.projectsService.get(org.organizationId, id);
  }

  @Patch(':id')
  update(
    @CurrentOrg() org: OrgContext,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateProjectDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.projectsService.update(
      org.organizationId,
      id,
      dto,
      user.userId,
    );
  }

  /** Returns the new key once. Implementation is Phase 3 Day 14 (see service). */
  @Post(':id/api-key')
  @Roles('owner', 'admin')
  rotateApiKey(
    @CurrentOrg() org: OrgContext,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    return this.projectsService.rotateApiKey(org.organizationId, id);
  }

  @Delete(':id')
  @Roles('owner', 'admin')
  @HttpCode(204)
  remove(
    @CurrentOrg() org: OrgContext,
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.projectsService.remove(org.organizationId, id, user.userId);
  }
}
