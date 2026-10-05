import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, QueryFilter, Types } from 'mongoose';
import { appUrl } from '../../common/utils/app-url.js';
import { ConfigService } from '@nestjs/config';
import { MailService } from '../../mail/mail.service.js';
import { UsersService } from '../users/users.service.js';
import { Notification } from './entities/notification.schema.js';

export interface NotifyInput {
  type: string;
  title: string;
  body?: string;
  link?: string;
  orgId?: string;
}

@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(Notification.name)
    private readonly notifications: Model<Notification>,
    private readonly usersService: UsersService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  /** Creates an in-app notification for each user, optionally emailing them too. */
  async notify(
    userIds: string[],
    input: NotifyInput,
    options: { email?: boolean } = {},
  ): Promise<void> {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return;
    await this.notifications.insertMany(
      unique.map((userId) => ({
        userId: new Types.ObjectId(userId),
        orgId: input.orgId ? new Types.ObjectId(input.orgId) : null,
        type: input.type,
        title: input.title,
        body: input.body ?? '',
        link: input.link ?? null,
      })),
    );
    if (options.email) {
      const users = await this.usersService.findByIds(unique);
      await Promise.all(
        users.map((user) =>
          this.mail.send(user.email, 'notification', {
            title: input.title,
            body: input.body ?? '',
            url: input.link ? appUrl(this.config, input.link) : undefined,
          }),
        ),
      );
    }
  }

  list(userId: string, unreadOnly = false) {
    const filter: QueryFilter<Notification> = {
      userId: new Types.ObjectId(userId),
    };
    if (unreadOnly) filter.readAt = null;
    return this.notifications
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(50)
      .exec();
  }

  async unreadCount(userId: string) {
    const count = await this.notifications
      .countDocuments({ userId: new Types.ObjectId(userId), readAt: null })
      .exec();
    return { count };
  }

  async markRead(userId: string, id: string) {
    const notification = await this.notifications
      .findOneAndUpdate(
        { _id: id, userId: new Types.ObjectId(userId) },
        { $set: { readAt: new Date() } },
        { returnDocument: 'after' },
      )
      .exec();
    if (!notification) throw new NotFoundException('Notification not found');
    return notification;
  }

  async markAllRead(userId: string): Promise<void> {
    await this.notifications
      .updateMany(
        { userId: new Types.ObjectId(userId), readAt: null },
        { $set: { readAt: new Date() } },
      )
      .exec();
  }
}
