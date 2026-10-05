import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { createObserveModule } from '@nestjs/observe';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ErrorsModule } from './common/errors/errors.module.js';
import { DatabaseModule } from './database/database.module.js';
import { MailModule } from './mail/mail.module.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { AnalyticsModule } from './modules/analytics/analytics.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { BillingModule } from './modules/billing/billing.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { OrganizationsModule } from './modules/organizations/organizations.module.js';
import { TenancyModule } from './modules/organizations/tenancy.module.js';
import { PaymentsModule } from './modules/payments/payments.module.js';
import { ProjectsModule } from './modules/projects/projects.module.js';
import { UsersModule } from './modules/users/users.module.js';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

/** Observe telemetry is opt-in: it only starts when credentials are set. */
export const isObserveEnabled = () => !!process.env.OBSERVE_APP_KEY;

function observeImports() {
  if (!isObserveEnabled()) return [];
  return [
    // Distributed tracing, logs, metrics and error telemetry. https://observe.nestjs.com
    ObserveModule.forRoot({
      appKey: process.env.OBSERVE_APP_KEY!,
      appSecret: process.env.OBSERVE_APP_SECRET ?? '',
      serviceId: 'flowhub-services',
    }),
  ];
}

@Module({
  imports: [
    // Must stay first: it loads .env into process.env, which observeImports() reads.
    ConfigModule.forRoot({ isGlobal: true }),
    ...observeImports(),
    EventEmitterModule.forRoot(),
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 300 }],
      // Tests hammer the API from one address.
      skipIf: () => process.env.NODE_ENV === 'test',
    }),
    DatabaseModule,
    MailModule,
    ErrorsModule,
    TenancyModule,
    AuthModule,
    UsersModule,
    OrganizationsModule,
    ProjectsModule,
    BillingModule,
    PaymentsModule,
    NotificationsModule,
    AnalyticsModule,
    AdminModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
