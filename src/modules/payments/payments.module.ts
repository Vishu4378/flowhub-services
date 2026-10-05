import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Payment, PaymentSchema } from './entities/payment.schema.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';
import { StripeService } from './stripe.service.js';

/**
 * Payment providers (Stripe today) and the payment ledger. Knows nothing about
 * plans: it reports subscription changes as PaymentEvent.SubscriptionSynced.
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Payment.name, schema: PaymentSchema }]),
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService, StripeService],
  exports: [PaymentsService, StripeService],
})
export class PaymentsModule {}
