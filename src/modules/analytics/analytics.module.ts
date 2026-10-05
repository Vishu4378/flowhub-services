import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../users/users.module.js';
import { AnalyticsController } from './analytics.controller.js';
import { AnalyticsListener } from './analytics.listener.js';
import { AnalyticsService } from './analytics.service.js';
import { Activity, ActivitySchema } from './entities/activity.schema.js';

/** Activity log (from domain events) and per-organization stats. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Activity.name, schema: ActivitySchema },
    ]),
    UsersModule,
  ],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, AnalyticsListener],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
