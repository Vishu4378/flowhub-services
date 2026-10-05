import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailService } from '../../mail/mail.service.js';

/** Where an error came from, for the alert email. Never include secrets. */
export interface ErrorContext {
  source: 'http' | 'listener' | 'process' | 'client';
  method?: string;
  path?: string;
  userId?: string;
  organizationId?: string;
  /** Free-form extra detail, e.g. the listener or browser URL. */
  detail?: string;
}

const DEDUPE_WINDOW_MS = 10 * 60 * 1000;
const HOURLY_CAP = 20;

interface Seen {
  lastSentAt: number;
  suppressed: number;
}

/**
 * Emails unexpected errors to ALERT_EMAILS. Built so a bad deploy can't flood
 * an inbox: the same error (same name, message and first stack frame) is sent
 * at most once per 10 minutes, with a count of what was suppressed, and no
 * more than 20 alerts go out per hour in total.
 *
 * Reporting never throws: a failure to alert must not break the request.
 */
@Injectable()
export class ErrorReporter {
  private readonly logger = new Logger(ErrorReporter.name);
  private readonly recipients: string[];
  private readonly environment: string;
  private readonly seen = new Map<string, Seen>();
  private sentThisHour: number[] = [];

  constructor(
    config: ConfigService,
    private readonly mail: MailService,
  ) {
    this.recipients = (config.get<string>('ALERT_EMAILS') ?? '')
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);
    this.environment = config.get<string>('NODE_ENV', 'development');
  }

  get enabled(): boolean {
    return this.recipients.length > 0;
  }

  async report(error: unknown, context: ErrorContext): Promise<void> {
    try {
      const err = normalize(error);
      this.logger.error(
        `[${context.source}] ${err.name}: ${err.message}`,
        err.stack,
      );
      if (!this.enabled) return;

      const now = Date.now();
      const key = fingerprint(err);
      const seen = this.seen.get(key);
      if (seen && now - seen.lastSentAt < DEDUPE_WINDOW_MS) {
        seen.suppressed++;
        return;
      }
      this.sentThisHour = this.sentThisHour.filter((t) => now - t < 3_600_000);
      if (this.sentThisHour.length >= HOURLY_CAP) {
        if (seen) seen.suppressed++;
        else this.seen.set(key, { lastSentAt: 0, suppressed: 1 });
        return;
      }

      const repeats = seen?.suppressed ?? 0;
      this.seen.set(key, { lastSentAt: now, suppressed: 0 });
      this.sentThisHour.push(now);
      this.prune(now);

      await Promise.all(
        this.recipients.map((to) =>
          this.mail.send(to, 'errorAlert', {
            environment: this.environment,
            name: err.name,
            message: err.message,
            stack: err.stack ?? '(no stack trace)',
            source: context.source,
            where: [context.method, context.path].filter(Boolean).join(' '),
            userId: context.userId,
            organizationId: context.organizationId,
            detail: context.detail,
            repeats,
            time: new Date(now).toISOString(),
          }),
        ),
      );
    } catch (failure) {
      // Deliberately swallowed: reporting must never cause another error.
      this.logger.error('Failed to send error alert', failure);
    }
  }

  /** Keeps the dedupe map small on long-running servers. */
  private prune(now: number) {
    if (this.seen.size < 500) return;
    for (const [key, value] of this.seen) {
      if (now - value.lastSentAt > DEDUPE_WINDOW_MS) this.seen.delete(key);
    }
  }
}

function normalize(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(typeof error === 'string' ? error : JSON.stringify(error));
}

/** Same bug → same key, even if ids in the message differ. */
export function fingerprint(err: Error): string {
  const frame =
    err.stack?.split('\n').find((l) => l.trim().startsWith('at ')) ?? '';
  const message = err.message.replace(/[0-9a-f]{24}|\d+/gi, '#');
  return `${err.name}|${message}|${frame.trim()}`;
}
