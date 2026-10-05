import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsOptional } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { SuperAdminGuard } from '../../common/guards/super-admin.guard.js';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe.js';
import type { AuthUser } from '../../common/types/auth.js';
import { AdminService } from './admin.service.js';
import { AdminListQuery, AdminOrgListQuery } from './dto/admin-list.query.js';
import { SuspendDto } from './dto/suspend.dto.js';

class AdminActivityQuery {
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  before?: Date;
}

/** Platform owner endpoints. Every route requires SUPER_ADMIN_EMAILS membership. */
@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(SuperAdminGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('stats')
  stats() {
    return this.adminService.stats();
  }

  @Get('organizations')
  organizations(@Query() query: AdminOrgListQuery) {
    return this.adminService.listOrganizations(query);
  }

  @Get('organizations/:id')
  organization(@Param('id', ParseObjectIdPipe) id: string) {
    return this.adminService.getOrganization(id);
  }

  @Post('organizations/:id/suspend')
  @HttpCode(200)
  suspend(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: SuspendDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.adminService.suspend(id, dto.reason, user.userId);
  }

  @Post('organizations/:id/unsuspend')
  @HttpCode(200)
  unsuspend(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.adminService.unsuspend(id, user.userId);
  }

  @Delete('organizations/:id')
  @HttpCode(204)
  remove(@Param('id', ParseObjectIdPipe) id: string) {
    return this.adminService.deleteOrganization(id);
  }

  @Get('users')
  users(@Query() query: AdminListQuery) {
    return this.adminService.listUsers(query);
  }

  @Get('activity')
  activity(@Query() query: AdminActivityQuery) {
    return this.adminService.activity(query.before);
  }
}
