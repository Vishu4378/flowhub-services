export const ORG_ROLES = ['owner', 'admin', 'member'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

/** Payload signed into the access token. */
export interface JwtPayload {
  sub: string;
  email: string;
}

/** The authenticated caller, attached to the request by JwtAuthGuard. */
export interface AuthUser {
  userId: string;
  email: string;
}

/** The caller's membership in the organization named by the route. */
export interface OrgContext {
  organizationId: string;
  role: OrgRole;
}

export interface AuthenticatedRequest {
  user?: AuthUser;
  org?: OrgContext;
  headers: Record<string, string | string[] | undefined>;
  params: Record<string, string>;
}
