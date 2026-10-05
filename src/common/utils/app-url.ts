import { ConfigService } from '@nestjs/config';

/** Builds a link into the web app (emails, Stripe redirects). */
export function appUrl(config: ConfigService, path: string): string {
  const base = config.get<string>('APP_URL', 'http://localhost:3001');
  return `${base.replace(/\/$/, '')}${path}`;
}
