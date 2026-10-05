import { Global, Module } from '@nestjs/common';
import { ClientErrorsController } from './client-errors.controller.js';
import { ErrorReporter } from './error-reporter.service.js';

/** Error alerting, available everywhere (filters, listeners, main.ts). */
@Global()
@Module({
  controllers: [ClientErrorsController],
  providers: [ErrorReporter],
  exports: [ErrorReporter],
})
export class ErrorsModule {}
