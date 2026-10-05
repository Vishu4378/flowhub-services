import { INestApplication, ValidationPipe } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { ErrorReporter } from './common/errors/error-reporter.service.js';
import { AppExceptionFilter } from './common/filters/app-exception.filter.js';

/** Global HTTP setup shared by main.ts and the e2e tests. */
export function configureApp(app: INestApplication) {
  app.setGlobalPrefix('api', { exclude: ['health'] });
  app.enableCors({
    origin: (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(','),
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(
    new AppExceptionFilter(app.get(HttpAdapterHost), app.get(ErrorReporter)),
  );
  return app;
}
