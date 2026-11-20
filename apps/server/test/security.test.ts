import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AppState, AuthStatus } from '@mockpit/shared';
import { describe, expect, it } from 'vitest';
import type { App } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { SESSION_MAX_AGE_SECONDS } from '../src/security.js';
import { makeApp, tempDir } from './helpers.js';

type Options = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  host?: string;
  origin?: string;
  cookie?: string;
  payload?: object;
  remoteAddress?: string;
  contentType?: string;
};

const call = async (app: App, url: string, options: Options = {}) => {
  const headers: Record<string, string> = { host: options.host ?? 'localhost:3300' };
  if (options.origin) {
    headers.origin = options.origin;
  }
  if (options.cookie) {
    headers.cookie = options.cookie;
  }
  if (options.contentType) {
    headers['content-type'] = options.contentType;
  }
  const response = await app.fastify.inject({
    method: options.method ?? 'GET',
    url,
    headers,
    remoteAddress: options.remoteAddress,
    ...(options.payload ? { payload: options.payload } : {}),
  });
  const setCookie = response.headers['set-cookie'];

  return {
    status: response.statusCode,
    json: response.body ? JSON.parse(response.body) : undefined,
    setCookie: Array.isArray(setCookie) ? setCookie.join('; ') : (setCookie ?? ''),
  };
};

const cookiePair = (setCookie: string) => setCookie.split(';')[0]!;

const login = (app: App, password: string, options: Options = {}) =>
  call(app, '/api/auth/login', { method: 'POST', payload: { password }, ...options });

const LAN = { host: '0.0.0.0' } as const;
const LAN_HOST = '192.168.1.10:3300';

describe('without a password (loopback)', () => {
  it('rejects unknown Host names (DNS rebinding)', async () => {
    const app = await makeApp();
    const result = await call(app, '/api/state', { host: 'evil.example.com' });

    expect(result.status).toBe(403);
    expect(result.json.error.code).toBe('FORBIDDEN_HOST');
    expect(result.json.error.message).toContain('MOCKPIT_ALLOWED_HOSTS');
  });

  it('accepts IP addresses, localhost, the machine name and MOCKPIT_ALLOWED_HOSTS', async () => {
    const app = await makeApp({ allowedHosts: ['mockpit.lan'] });
    const machine = os.hostname();
    for (const host of [
      '127.0.0.1:3300',
      '192.168.1.10:3300',
      '[::1]:3300',
      'localhost:3300',
      'localhost',
      machine,
      `${machine.toUpperCase()}.local:3300`,
      'mockpit.lan:3300',
      'MOCKPIT.LAN',
    ]) {
      expect((await call(app, '/api/state', { host })).status, host).toBe(200);
    }
    expect((await call(app, '/api/state', { host: 'other.lan' })).status).toBe(403);
  });

  it('reports that no login is needed', async () => {
    const app = await makeApp();
    const status = (await call(app, '/api/auth/status')).json as AuthStatus;
    expect(status).toEqual({ authRequired: false, authenticated: true });
    expect(((await call(app, '/api/state')).json as AppState).authRequired).toBe(false);
    await expect(fs.access(path.join(app.config.dataDir, 'auth.json'))).rejects.toThrow();
  });
});

describe('Origin and Content-Type checks (both modes)', () => {
  it('rejects a foreign Origin on state-changing requests', async () => {
    const open = await makeApp();
    const foreign = await call(open, '/api/environments', {
      method: 'POST',
      origin: 'http://evil.example.com',
      payload: {},
    });
    expect(foreign.status).toBe(403);
    expect(foreign.json.error.code).toBe('FORBIDDEN_ORIGIN');

    const same = await call(open, '/api/environments', {
      method: 'POST',
      origin: 'http://localhost:3300',
      payload: {},
    });
    expect(same.status).toBe(201);
    // GET requests are not subject to the Origin check
    expect((await call(open, '/api/state', { origin: 'http://evil.example.com' })).status).toBe(
      200,
    );

    const protectedApp = await makeApp({ ...LAN, envPassword: 'secret' });
    const result = await login(protectedApp, 'secret', {
      host: LAN_HOST,
      origin: 'http://evil.example.com',
    });
    expect(result.status).toBe(403);
    expect(result.json.error.code).toBe('FORBIDDEN_ORIGIN');
  });

  it('accepts the Vite dev server origin only in development', async () => {
    const dev = await makeApp({ dev: true });
    const production = await makeApp();
    const options: Options = { method: 'POST', origin: 'http://localhost:5173', payload: {} };

    expect((await call(dev, '/api/environments', options)).status).toBe(201);
    expect((await call(production, '/api/environments', options)).status).toBe(403);
  });

  it('requires JSON bodies', async () => {
    const app = await makeApp();
    const response = await app.fastify.inject({
      method: 'POST',
      url: '/api/environments',
      headers: { host: 'localhost:3300', 'content-type': 'text/plain' },
      payload: '{"name":"x"}',
    });
    expect(response.statusCode).toBe(415);
  });
});

describe('with a password', () => {
  it('accepts any Host, requires the cookie and issues a 400-day cookie on login', async () => {
    const app = await makeApp({ ...LAN, envPassword: 'secret' });

    const status = await call(app, '/api/auth/status', { host: LAN_HOST });
    expect(status.json).toEqual({ authRequired: true, authenticated: false });

    const denied = await call(app, '/api/state', { host: LAN_HOST });
    expect(denied.status).toBe(401);
    expect(denied.json.error.code).toBe('UNAUTHORIZED');
    expect((await call(app, '/api/events', { host: LAN_HOST })).status).toBe(401);

    const wrong = await login(app, 'nope', { host: LAN_HOST });
    expect(wrong.status).toBe(401);
    expect(wrong.setCookie).toBe('');

    const ok = await login(app, 'secret', { host: LAN_HOST });
    expect(ok.status).toBe(204);
    expect(ok.setCookie).toMatch(/^mockpit_session=v1\.[0-9a-f]{64};/);
    expect(ok.setCookie).toContain(`Max-Age=${SESSION_MAX_AGE_SECONDS}`);
    expect(SESSION_MAX_AGE_SECONDS).toBe(400 * 24 * 60 * 60);
    expect(ok.setCookie).toContain('HttpOnly');
    expect(ok.setCookie).toContain('SameSite=Strict');
    expect(ok.setCookie).toContain('Path=/');
    expect(ok.setCookie).not.toContain('Secure');

    const cookie = cookiePair(ok.setCookie);
    const state = await call(app, '/api/state', { host: LAN_HOST, cookie });
    expect(state.status).toBe(200);
    expect((state.json as AppState).authRequired).toBe(true);
    // the cookie is re-sent so that the login is extended on every visit
    expect(cookiePair(state.setCookie)).toBe(cookie);
    expect(state.setCookie).toContain(`Max-Age=${SESSION_MAX_AGE_SECONDS}`);

    // an unusual Host name is fine when the password is active
    expect((await call(app, '/api/state', { host: 'server.example.com', cookie })).status).toBe(
      200,
    );

    const authed = await call(app, '/api/auth/status', { host: LAN_HOST, cookie });
    expect(authed.json).toEqual({ authRequired: true, authenticated: true });
  });

  it('rejects a tampered cookie', async () => {
    const app = await makeApp({ ...LAN, envPassword: 'secret' });
    const cookie = cookiePair((await login(app, 'secret', { host: LAN_HOST })).setCookie);
    const tampered = cookie.slice(0, -1) + (cookie.endsWith('0') ? '1' : '0');

    expect((await call(app, '/api/state', { host: LAN_HOST, cookie: tampered })).status).toBe(401);
    expect(
      (await call(app, '/api/state', { host: LAN_HOST, cookie: 'mockpit_session=v1.' })).status,
    ).toBe(401);
  });

  it('logout clears the cookie', async () => {
    const app = await makeApp({ ...LAN, envPassword: 'secret' });
    const result = await call(app, '/api/auth/logout', { method: 'POST', host: LAN_HOST });
    expect(result.status).toBe(204);
    expect(result.setCookie).toContain('mockpit_session=;');
    expect(result.setCookie).toContain('Max-Age=0');
  });

  it('the cookie survives a restart with the same auth.json and dies when the password or secret changes', async () => {
    const dataDir = await tempDir();
    const first = await makeApp({ ...LAN, dataDir });
    const authFile = path.join(dataDir, 'auth.json');
    const stored = JSON.parse(await fs.readFile(authFile, 'utf8'));
    const cookie = cookiePair((await login(first, stored.password, { host: LAN_HOST })).setCookie);
    await first.close();

    const second = await makeApp({ ...LAN, dataDir });
    expect((await call(second, '/api/state', { host: LAN_HOST, cookie })).status).toBe(200);
    await second.close();

    await fs.writeFile(authFile, JSON.stringify({ ...stored, password: 'changed-by-hand' }));
    const third = await makeApp({ ...LAN, dataDir });
    expect((await call(third, '/api/state', { host: LAN_HOST, cookie })).status).toBe(401);
    expect((await login(third, 'changed-by-hand', { host: LAN_HOST })).status).toBe(204);
    await third.close();

    await fs.writeFile(authFile, JSON.stringify({ ...stored, sessionSecret: 'ab'.repeat(32) }));
    const fourth = await makeApp({ ...LAN, dataDir });
    expect((await call(fourth, '/api/state', { host: LAN_HOST, cookie })).status).toBe(401);
  });

  it('limits login attempts per IP address', async () => {
    const app = await makeApp({ ...LAN, envPassword: 'secret' });
    const options = { host: LAN_HOST, remoteAddress: '10.0.0.5' };
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect((await login(app, 'wrong', options)).status).toBe(401);
    }
    const blocked = await login(app, 'secret', options);
    expect(blocked.status).toBe(429);
    expect(blocked.json.error.code).toBe('TOO_MANY_REQUESTS');

    // another address is not affected
    expect((await login(app, 'secret', { host: LAN_HOST, remoteAddress: '10.0.0.6' })).status).toBe(
      204,
    );
  });

  it('first start on a non-loopback host generates auth.json', async () => {
    const app = await makeApp(LAN);
    const authFile = path.join(app.config.dataDir, 'auth.json');
    const stored = JSON.parse(await fs.readFile(authFile, 'utf8'));

    expect(stored.password).toMatch(/^[A-Za-z0-9]{16}$/);
    expect(stored.sessionSecret).toMatch(/^[0-9a-f]{64}$/);
    expect(app.auth.generatedPassword).toBe(stored.password);
    if (process.platform !== 'win32') {
      expect((await fs.stat(authFile)).mode & 0o777).toBe(0o600);
    }
    expect((await login(app, stored.password, { host: LAN_HOST })).status).toBe(204);

    // a second start does not generate (or print) a new password
    await app.close();
    const again = await makeApp({ ...LAN, dataDir: app.config.dataDir });
    expect(again.auth.generatedPassword).toBeNull();
    expect(again.auth.password).toBe(stored.password);
  });

  it('MOCKPIT_PASSWORD wins over auth.json and also protects a loopback host', async () => {
    const dataDir = await tempDir();
    await fs.writeFile(
      path.join(dataDir, 'auth.json'),
      JSON.stringify({ password: 'from-file', sessionSecret: 'cd'.repeat(32) }),
    );
    const app = await makeApp({ ...LAN, dataDir, envPassword: 'from-env' });
    expect((await login(app, 'from-file', { host: LAN_HOST })).status).toBe(401);
    expect((await login(app, 'from-env', { host: LAN_HOST })).status).toBe(204);
    expect(app.auth.generatedPassword).toBeNull();

    const loopback = await makeApp({ envPassword: 'local' });
    expect((await call(loopback, '/api/state')).status).toBe(401);
    expect((await login(loopback, 'local')).status).toBe(204);
  });
});

describe('MOCKPIT_AUTH', () => {
  it('"off" on a non-loopback host needs no cookie and creates no auth.json', async () => {
    const app = await makeApp({ ...LAN, auth: 'off', envPassword: 'ignored' });

    const state = await call(app, '/api/state', { host: LAN_HOST });
    expect(state.status).toBe(200);
    expect((state.json as AppState).authRequired).toBe(false);
    await expect(fs.access(path.join(app.config.dataDir, 'auth.json'))).rejects.toThrow();
    // without a password the Host check is active again
    expect((await call(app, '/api/state', { host: 'evil.example.com' })).status).toBe(403);
  });

  it('an unknown value is an error at start', () => {
    expect(() => loadConfig({ MOCKPIT_AUTH: 'maybe' }, '/tmp')).toThrow(/MOCKPIT_AUTH/);
    expect(loadConfig({ MOCKPIT_AUTH: 'off' }, '/tmp').auth).toBe('off');
    expect(loadConfig({}, '/tmp')).toMatchObject({
      auth: 'on',
      port: 3300,
      host: '0.0.0.0',
      dataDir: '/tmp/data',
      envPassword: null,
      allowedHosts: [],
    });
    expect(
      loadConfig({ MOCKPIT_ALLOWED_HOSTS: 'A.lan, b.lan ,', MOCKPIT_PORT: '5000' }, '/tmp'),
    ).toMatchObject({ allowedHosts: ['a.lan', 'b.lan'], port: 5000 });
    expect(() => loadConfig({ MOCKPIT_PORT: 'abc' }, '/tmp')).toThrow(/MOCKPIT_PORT/);
  });

  it('still accepts the former MAKETA_* names, with MOCKPIT_* taking precedence', () => {
    expect(
      loadConfig({ MAKETA_PORT: '5000', MAKETA_AUTH: 'off', MAKETA_PASSWORD: 'old' }, '/tmp'),
    ).toMatchObject({ port: 5000, auth: 'off', envPassword: 'old' });
    expect(loadConfig({ MAKETA_PORT: '5000', MOCKPIT_PORT: '6000' }, '/tmp').port).toBe(6000);
  });
});
