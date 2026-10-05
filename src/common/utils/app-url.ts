import { ConfigService } from '@nestjs/config';

/** Builds an absolute link into the web app (emails, Stripe redirects). */
export function appUrl(config: ConfigService, path: string): string {
  const base = config.get<string>('APP_URL', 'http://localhost:3001');
  return `${base.replace(/\/$/, '')}${path}`;
}

export type OrgPage =
  'overview' | 'projects' | 'members' | 'billing' | 'settings';

/**
 * App paths. The web app is a static export, so ids travel as query
 * parameters (one HTML file per page) instead of path segments.
 * Keep in sync with flowhub.com/src/lib/routes.ts.
 */
export const appPaths = {
  org: (orgId: string, page: OrgPage, extra: Record<string, string> = {}) =>
    `/app/${page}?${new URLSearchParams({ org: orgId, ...extra }).toString()}`,
  invite: (token: string) => `/invite?token=${encodeURIComponent(token)}`,
  verifyEmail: (token: string) =>
    `/verify-email?token=${encodeURIComponent(token)}`,
  resetPassword: (token: string) =>
    `/reset-password?token=${encodeURIComponent(token)}`,
};
