import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

export const SESSION_COOKIE = 'battlebots_session';
const SESSION_AGE_SECONDS = 12 * 60 * 60;

export interface AuthConfig {
  password: string;
  secret: string;
  production: boolean;
  allowedOrigins: readonly string[];
}

export function readAuthConfig(env: NodeJS.ProcessEnv): AuthConfig {
  const production = env.NODE_ENV === 'production';
  const password = env.DEMO_PASSWORD || (production ? '' : 'let-the-bots-battle');
  const secret = env.SESSION_SECRET || (production ? '' : randomBytes(32).toString('hex'));
  if (!password || secret.length < 32) {
    throw new Error('Set DEMO_PASSWORD and a SESSION_SECRET of at least 32 characters before production startup.');
  }
  const allowedOrigins = env.ALLOWED_ORIGINS?.trim()
    ? env.ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()) : [];
  if (allowedOrigins.some((origin) => parseOrigin(origin) === null)) {
    throw new Error('ALLOWED_ORIGINS must contain comma-separated HTTP or HTTPS origins without paths, credentials, or wildcards.');
  }
  return { password, secret, production, allowedOrigins: [...new Set(allowedOrigins)] };
}

export function passwordsEqual(candidate: string, expected: string): boolean {
  // HMAC produces fixed-size digests, so comparison does not reveal password length.
  const first = createHmac('sha256', 'battlebots-password-comparison').update(candidate).digest();
  const second = createHmac('sha256', 'battlebots-password-comparison').update(expected).digest();
  return timingSafeEqual(first, second);
}

export function issueSession(config: AuthConfig, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ expires: now + SESSION_AGE_SECONDS * 1_000, nonce: randomBytes(16).toString('hex') })).toString('base64url');
  const signature = createHmac('sha256', config.secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function sessionValid(token: string, config: AuthConfig, now = Date.now()): boolean {
  if (token.length > 1_024 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return false;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return false;
  const expected = createHmac('sha256', config.secret).update(payload).digest();
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return typeof parsed === 'object' && parsed !== null && 'expires' in parsed &&
      typeof parsed.expires === 'number' && parsed.expires > now && parsed.expires <= now + SESSION_AGE_SECONDS * 1_000 &&
      'nonce' in parsed && typeof parsed.nonce === 'string';
  } catch {
    return false;
  }
}

export function cookieToken(headers: Pick<IncomingMessage['headers'], 'cookie'>): string {
  const entry = headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  return entry?.slice(SESSION_COOKIE.length + 1) ?? '';
}

export function isAuthenticated(request: IncomingMessage, config: AuthConfig): boolean {
  return sessionValid(requestToken(request.headers), config);
}

/** Explicit credentials take precedence; malformed tokens never fall back to a cookie. */
export function requestToken(headers: Pick<IncomingMessage['headers'], 'cookie' | 'authorization'>,
  transportToken?: string): string {
  if (transportToken !== undefined) return transportToken;
  if (headers.authorization !== undefined) return /^Bearer (\S+)$/i.exec(headers.authorization)?.[1] ?? '';
  return cookieToken(headers);
}

function parseOrigin(origin: string): URL | null {
  try {
    const parsed = new URL(origin);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.origin === origin ? parsed : null;
  } catch { return null; }
}

export function originAllowed(origin: string | null | undefined, host: string | null | undefined,
  config: AuthConfig): boolean {
  if (origin === undefined || origin === null) return true;
  const parsed = parseOrigin(origin);
  return parsed !== null && (parsed.host === host || config.allowedOrigins.includes(parsed.origin));
}

/** CORS headers are only emitted for an exact permitted browser origin. */
export function corsHeaders(origin: string | null | undefined, host: string | null | undefined,
  config: AuthConfig): Record<string, string> {
  if (!origin || !originAllowed(origin, host, config)) return { Vary: 'Origin' };
  return {
    Vary: 'Origin',
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '600',
  };
}

export function preflightAllowed(method: string | string[] | undefined,
  headers: string | string[] | undefined): boolean {
  if (typeof method !== 'string' || !['GET', 'POST'].includes(method.toUpperCase())) return false;
  if (headers === undefined) return true;
  return typeof headers === 'string' && headers.split(',').every((header) =>
    ['authorization', 'content-type'].includes(header.trim().toLowerCase()));
}

export function sessionCookie(token: string, config: AuthConfig): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_AGE_SECONDS}${config.production ? '; Secure' : ''}`;
}
