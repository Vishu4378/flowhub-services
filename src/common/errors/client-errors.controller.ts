import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Public } from '../decorators/public.decorator.js';
import { ErrorReporter } from './error-reporter.service.js';

class ClientErrorDto {
  @IsString()
  @MaxLength(500)
  message: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  stack?: string;

  /** Page the error happened on. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  userAgent?: string;
}

/**
 * Browser crash reports from the web app's error boundary. Public (the crash
 * may happen before login) and tightly rate limited per IP.
 */
@ApiTags('errors')
@Controller('client-errors')
export class ClientErrorsController {
  constructor(private readonly reporter: ErrorReporter) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post()
  @HttpCode(204)
  async report(@Body() dto: ClientErrorDto): Promise<void> {
    const error = new Error(dto.message);
    error.name = 'ClientError';
    error.stack = dto.stack ?? `ClientError: ${dto.message}`;
    // Not awaited: the browser shouldn't wait on our email.
    void this.reporter.report(error, {
      source: 'client',
      path: dto.url,
      detail: dto.userAgent,
    });
  }
}
