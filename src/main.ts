import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import {
  AppModule,
  isObserveEnabled,
  ObserveInstrument,
} from './app.module.js';
import { configureApp } from './app.setup.js';
import { ErrorReporter } from './common/errors/error-reporter.service.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    instrument: isObserveEnabled() ? ObserveInstrument : undefined,
    // Keeps the raw bytes alongside the parsed body; Stripe signs the raw payload.
    rawBody: true,
  });
  configureApp(app);

  // Errors outside any request (timers, stray promises) still reach the inbox.
  const reporter = app.get(ErrorReporter);
  process.on('unhandledRejection', (reason) => {
    void reporter.report(reason, {
      source: 'process',
      detail: 'unhandledRejection',
    });
  });
  process.on('uncaughtException', (error) => {
    // The process is in an unknown state: report, then exit and let Docker restart it.
    void reporter
      .report(error, { source: 'process', detail: 'uncaughtException' })
      .finally(() => process.exit(1));
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('FlowHub API')
    .setVersion('0.0.1')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, () =>
    SwaggerModule.createDocument(app, swaggerConfig),
  );

  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
