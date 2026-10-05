import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentOrg } from '../../common/decorators/current-org.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe.js';
import type { AuthUser, OrgContext } from '../../common/types/auth.js';
import { CreateInvitationDto } from './dto/create-invitation.dto.js';
import { InvitationsService } from './invitations.service.js';
import { OrgMemberGuard } from './org-member.guard.js';

@ApiTags('invitations')
@Controller()
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @ApiBearerAuth()
  @Get('organizations/:orgId/invitations')
  @UseGuards(OrgMemberGuard)
  @Roles('owner', 'admin')
  list(@CurrentOrg() org: OrgContext) {
    return this.invitationsService.list(org.organizationId);
  }

  @ApiBearerAuth()
  @Post('organizations/:orgId/invitations')
  @UseGuards(OrgMemberGuard)
  @Roles('owner', 'admin')
  create(
    @CurrentOrg() org: OrgContext,
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateInvitationDto,
  ) {
    return this.invitationsService.create(org.organizationId, dto, {
      ...org,
      userId: user.userId,
    });
  }

  @ApiBearerAuth()
  @Delete('organizations/:orgId/invitations/:id')
  @UseGuards(OrgMemberGuard)
  @Roles('owner', 'admin')
  @HttpCode(204)
  revoke(
    @CurrentOrg() org: OrgContext,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    return this.invitationsService.revoke(org.organizationId, id);
  }

  @Public()
  @Get('invitations/:token')
  preview(@Param('token') token: string) {
    return this.invitationsService.preview(token);
  }

  @ApiBearerAuth()
  @Post('invitations/:token/accept')
  @HttpCode(200)
  accept(@Param('token') token: string, @CurrentUser() user: AuthUser) {
    return this.invitationsService.accept(token, user.userId);
  }
}
