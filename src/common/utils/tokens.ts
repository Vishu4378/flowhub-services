import { createHash, randomBytes } from 'node:crypto';

/** A URL-safe random token and the SHA-256 hash we store instead of it. */
export function createToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
