import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe.js';
import type { AuthUser } from '../../common/types/auth.js';
import { ListNotificationsQuery } from './dto/list-notifications.query.js';
import { NotificationsService } from './notifications.service.js';

/** The caller's own notifications; there is no cross-user access. */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: ListNotificationsQuery) {
    return this.notificationsService.list(user.userId, query.unread);
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() user: AuthUser) {
    return this.notificationsService.unreadCount(user.userId);
  }

  @Post('read-all')
  @HttpCode(204)
  markAllRead(@CurrentUser() user: AuthUser) {
    return this.notificationsService.markAllRead(user.userId);
  }

  @Post(':id/read')
  @HttpCode(200)
  markRead(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    return this.notificationsService.markRead(user.userId, id);
  }
}
