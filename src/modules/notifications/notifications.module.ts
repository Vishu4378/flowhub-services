import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../users/users.module.js';
import {
  Notification,
  NotificationSchema,
} from './entities/notification.schema.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsListener } from './notifications.listener.js';
import { NotificationsService } from './notifications.service.js';

/** In-app (and optional email) notifications, fed by domain events. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Notification.name, schema: NotificationSchema },
    ]),
    UsersModule,
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsListener],
  exports: [NotificationsService],
})
export class NotificationsModule {}
