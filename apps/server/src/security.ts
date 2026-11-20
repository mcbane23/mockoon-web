import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isLoopbackHost, type Config } from './config.js';
import { ApiError } from './errors.js';
import { isENOENT, writeFileAtomic } from './fs-utils.js';

export const SESSION_COOKIE = 'mockpit_session';
/** Browsers cap cookie lifetime at about 400 days. */
export const SESSION_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;
const LOGIN_WINDOW_MS = 60_000;
const LOGIN_MAX_ATTEMPTS = 10;
const DEV_ORIGINS = ['localhost:5173', '127.0.0.1:5173'];

export type AuthState = {
  /** Whether a password is required (section 4.1 of the plan). */
  active: boolean;
  password: string;
  sessionSecret: string;
  /** Set only on the first start, when the password was just generated. */
  generatedPassword: string | null;
  authFilePath: string;
};

const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

export const generatePassword = (length = 16): string =>
  Array.from({ length }, () => PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)]).join('');

const sha256 = (value: string) => createHash('sha256').update(value).digest();

export const safeEqual = (a: string, b: string): boolean => timingSafeEqual(sha256(a), sha256(b));

/** Cookie value: v1.<HMAC-SHA256(sessionSecret, sha256(password))>. It carries no expiry. */
export const sessionToken = (auth: Pick<AuthState, 'password' | 'sessionSecret'>): string =>
  `v1.${createHmac('sha256', auth.sessionSecret).update(sha256(auth.password)).digest('hex')}`;

/**
 * Decide whether the password is active and where it comes from:
 * MOCKPIT_PASSWORD, then data/auth.json, then a generated one written to data/auth.json.
 */
export async function resolveAuth(config: Config): Promise<AuthState> {
  const authFilePath = path.join(config.dataDir, 'auth.json');
  const active =
    config.auth === 'on' && (!isLoopbackHost(config.host) || config.envPassword !== null);
  if (!active) {
    return {
      active: false,
      password: '',
      sessionSecret: '',
      generatedPassword: null,
      authFilePath,
    };
  }

  let stored: { password?: unknown; sessionSecret?: unknown } = {};
  let exists = true;
  try {
    stored = JSON.parse(await fs.readFile(authFilePath, 'utf8'));
  } catch (error) {
    if (!isENOENT(error)) {
      throw new Error(`Could not read ${authFilePath}: ${(error as Error).message}`, {
        cause: error,
      });
    }
    exists = false;
  }

  let filePassword = typeof stored.password === 'string' ? stored.password : '';
  let sessionSecret = typeof stored.sessionSecret === 'string' ? stored.sessionSecret : '';
  let generatedPassword: string | null = null;
  let mustWrite = !exists;

  if (!filePassword) {
    filePassword = generatePassword();
    mustWrite = true;
    if (config.envPassword === null) {
      generatedPassword = filePassword;
    }
  }
  if (!sessionSecret) {
    sessionSecret = randomBytes(32).toString('hex');
    mustWrite = true;
  }
  if (mustWrite) {
    await writeFileAtomic(
      authFilePath,
      JSON.stringify({ password: filePassword, sessionSecret }, null, 2) + '\n',
      0o600,
    );
    await fs.chmod(authFilePath, 0o600).catch(() => {});
  }

  return {
    active: true,
    password: config.envPassword ?? filePassword,
    sessionSecret,
    generatedPassword,
    authFilePath,
  };
}

/** Host name without port; handles IPv6 literals in brackets. */
export function hostnameOf(hostHeader: string): string {
  const host = hostHeader.trim().toLowerCase();
  if (host.startsWith('[')) {
    const end = host.indexOf(']');

    return end === -1 ? host : host.slice(0, end + 1);
  }
  const colon = host.lastIndexOf(':');

  return colon === -1 ? host : host.slice(0, colon);
}

export function isAllowedHost(hostHeader: string | undefined, config: Config): boolean {
  if (!hostHeader) {
    return false;
  }
  const hostname = hostnameOf(hostHeader);
  if (hostname === 'localhost') {
    return true;
  }
  const literal = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname;
  if (net.isIP(literal) !== 0) {
    return true;
  }
  const machine = os.hostname().toLowerCase();
  if (hostname === machine || hostname === `${machine}.local`) {
    return true;
  }

  return config.allowedHosts.includes(hostname);
}

export function isValidSession(request: FastifyRequest, auth: AuthState): boolean {
  const cookie = request.cookies[SESSION_COOKIE];

  return typeof cookie === 'string' && safeEqual(cookie, sessionToken(auth));
}

export function setSessionCookie(reply: FastifyReply, auth: AuthState): void {
  // no "Secure" attribute: the UI is served over plain HTTP
  reply.setCookie(SESSION_COOKIE, sessionToken(auth), {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.setCookie(SESSION_COOKIE, '', { httpOnly: true, sameSite: 'strict', path: '/', maxAge: 0 });
}

/** At most 10 login attempts per minute per IP address. */
export class LoginRateLimiter {
  private readonly attempts = new Map<string, number[]>();

  check(ip: string, now = Date.now()): void {
    const recent = (this.attempts.get(ip) ?? []).filter((time) => now - time < LOGIN_WINDOW_MS);
    if (recent.length >= LOGIN_MAX_ATTEMPTS) {
      this.attempts.set(ip, recent);
      throw new ApiError(
        429,
        'TOO_MANY_REQUESTS',
        'Too many login attempts. Try again in a minute.',
      );
    }
    recent.push(now);
    this.attempts.set(ip, recent);
    if (this.attempts.size > 10_000) {
      this.attempts.clear();
    }
  }
}

const AUTH_EXEMPT = new Set(['/api/auth/status', '/api/auth/login', '/api/auth/logout']);

/** onRequest hook for every /api/* route. */
export function registerSecurity(fastify: FastifyInstance, config: Config, auth: AuthState): void {
  fastify.addHook('onRequest', async (request) => {
    const pathname = request.url.split('?')[0] ?? '';
    if (!pathname.startsWith('/api/') && pathname !== '/api') {
      return;
    }
    const host = request.headers.host;

    // 1. Host check, only without a password: protection against DNS rebinding.
    if (!auth.active && !isAllowedHost(host, config)) {
      throw new ApiError(
        403,
        'FORBIDDEN_HOST',
        `Host "${host ?? ''}" is not allowed. Open the UI through an IP address or the machine name, or add this host name to MOCKPIT_ALLOWED_HOSTS.`,
      );
    }

    // 2. Origin check for state-changing methods, in both modes.
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      const origin = request.headers.origin;
      if (origin !== undefined) {
        let originHost = '';
        try {
          originHost = new URL(origin).host.toLowerCase();
        } catch {
          // "null" or garbage: rejected below
        }
        const allowed =
          originHost !== '' &&
          (originHost === (host ?? '').toLowerCase() ||
            (config.dev && DEV_ORIGINS.includes(originHost)));
        if (!allowed) {
          throw new ApiError(403, 'FORBIDDEN_ORIGIN', 'Cross-origin requests are not allowed');
        }
      }

      // 3. Bodies must be JSON.
      const hasBody =
        Number(request.headers['content-length'] ?? 0) > 0 ||
        request.headers['transfer-encoding'] !== undefined;
      const contentType = (request.headers['content-type'] ?? '').toLowerCase();
      if (hasBody && !contentType.startsWith('application/json')) {
        throw new ApiError(415, 'BAD_REQUEST', 'Content-Type must be application/json');
      }
    }

    // 4. Password.
    if (auth.active && !AUTH_EXEMPT.has(pathname) && !isValidSession(request, auth)) {
      throw new ApiError(401, 'UNAUTHORIZED', 'Log in to continue');
    }
  });
}
