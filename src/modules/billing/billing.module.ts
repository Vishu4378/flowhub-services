import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PaymentsModule } from '../payments/payments.module.js';
import { UsersModule } from '../users/users.module.js';
import { BillingController } from './billing.controller.js';
import { BillingService } from './billing.service.js';
import {
  Subscription,
  SubscriptionSchema,
} from './entities/subscription.schema.js';

/** Plans, subscriptions and plan limits. Uses PaymentsModule for Stripe. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Subscription.name, schema: SubscriptionSchema },
    ]),
    PaymentsModule,
    UsersModule,
  ],
  controllers: [BillingController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
