import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { renderMail, type MailTemplate } from './mail.templates.js';

export interface SentMail {
  to: string;
  subject: string;
  html: string;
}

/**
 * Sends transactional email through AWS SES when MAIL_FROM is configured;
 * otherwise logs it, so local development works without credentials.
 * Delivery failures are logged, never thrown: email must not break a request.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly from?: string;
  private readonly ses?: SESv2Client;
  /** Last messages sent, for tests and the dev console. */
  readonly outbox: SentMail[] = [];

  constructor(config: ConfigService) {
    this.from = config.get<string>('MAIL_FROM');
    if (this.from) {
      this.ses = new SESv2Client({
        region: config.get<string>('AWS_REGION', 'ap-south-1'),
      });
    }
  }

  async send(
    to: string,
    template: MailTemplate,
    data: Record<string, unknown>,
  ): Promise<void> {
    const { subject, html } = renderMail(template, data);
    this.outbox.push({ to, subject, html });
    if (this.outbox.length > 50) this.outbox.shift();

    if (!this.ses || !this.from) {
      const link = typeof data.url === 'string' ? ` → ${data.url}` : '';
      this.logger.log(`[dev mail] to=${to} "${subject}"${link}`);
      return;
    }

    try {
      await this.ses.send(
        new SendEmailCommand({
          FromEmailAddress: this.from,
          Destination: { ToAddresses: [to] },
          Content: {
            Simple: {
              Subject: { Data: subject, Charset: 'UTF-8' },
              Body: { Html: { Data: html, Charset: 'UTF-8' } },
            },
          },
        }),
      );
    } catch (error) {
      this.logger.error(`Failed to send "${subject}" to ${to}`, error);
    }
  }
}
