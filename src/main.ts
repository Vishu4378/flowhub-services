import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import {
  AppModule,
  isObserveEnabled,
  ObserveInstrument,
} from './app.module.js';
import { configureApp } from './app.setup.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    instrument: isObserveEnabled() ? ObserveInstrument : undefined,
    // Keeps the raw bytes alongside the parsed body; Stripe signs the raw payload.
    rawBody: true,
  });
  configureApp(app);

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
