import {
  ArgumentsHost,
  Catch,
  ConflictException,
  HttpException,
} from '@nestjs/common';
import { BaseExceptionFilter, type HttpAdapterHost } from '@nestjs/core';
import { mongo } from 'mongoose';
import type { ErrorReporter } from '../errors/error-reporter.service.js';
import type { AuthenticatedRequest } from '../types/auth.js';

const DUPLICATE_KEY = 11000;

/**
 * The single global exception filter:
 * - unique-index violations become 409 instead of 500;
 * - crashes are reported (emailed) before Nest responds: any error that isn't
 *   an HttpException, plus explicit 500s (InternalServerErrorException);
 * - HttpExceptions with other statuses are answers the code chose on purpose
 *   (4xx client mistakes, 501 "not implemented", 503 "billing not configured")
 *   and are never reported.
 */
@Catch()
export class AppExceptionFilter extends BaseExceptionFilter {
  constructor(
    adapterHost: HttpAdapterHost,
    private readonly reporter: ErrorReporter,
  ) {
    super(adapterHost.httpAdapter);
  }

  catch(exception: unknown, host: ArgumentsHost) {
    if (
      exception instanceof mongo.MongoServerError &&
      exception.code === DUPLICATE_KEY
    ) {
      const field = Object.keys(exception.keyPattern ?? {})[0] ?? 'value';
      return super.catch(
        new ConflictException(`A record with this ${field} already exists`),
        host,
      );
    }

    const isCrash =
      !(exception instanceof HttpException) || exception.getStatus() === 500;
    if (isCrash && host.getType() === 'http') {
      const req = host.switchToHttp().getRequest<
        AuthenticatedRequest & {
          method: string;
          originalUrl?: string;
          url: string;
        }
      >();
      void this.reporter.report(exception, {
        source: 'http',
        method: req.method,
        // Path only: query strings can carry tokens (reset/invite links).
        path: (req.originalUrl ?? req.url).split('?')[0],
        userId: req.user?.userId,
        organizationId: req.org?.organizationId ?? req.params?.orgId,
      });
    }
    return super.catch(exception, host);
  }
}
