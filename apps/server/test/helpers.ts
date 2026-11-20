import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ServerEvent } from '@maketa/shared';
import { afterEach } from 'vitest';
import { createApp, type App, type AppOptions } from '../src/app.js';
import type { Config } from '../src/config.js';
import type { EventBus } from '../src/event-bus.js';
import { silentLogger } from '../src/logger.js';

export const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

export const readFixture = (name: string) => fs.readFile(path.join(fixturesDir, name), 'utf8');

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()!().catch(() => {});
  }
});

export const onCleanup = (fn: () => Promise<void>) => {
  cleanups.push(fn);
};

/** Temporary data directory, removed after the test. */
export async function tempDir(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'maketa-test-'));
  onCleanup(() => fs.rm(directory, { recursive: true, force: true }));

  return directory;
}

/** Open a net.Server on port 0, read the port, close it. */
export function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

/** Keep a port busy with a foreign server until the test ends. */
export function occupyPort(port: number): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(port, () => {
      onCleanup(() => new Promise((done) => server.close(() => done())));
      resolve(server);
    });
  });
}

export function waitForEvent<T extends ServerEvent = ServerEvent>(
  bus: EventBus,
  predicate: (event: ServerEvent) => boolean,
  timeoutMs = 5000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error('Timed out waiting for event'));
    }, timeoutMs);
    const unsubscribe = bus.subscribe((event) => {
      if (predicate(event)) {
        clearTimeout(timer);
        unsubscribe();
        resolve(event as T);
      }
    });
  });
}

export const waitForStatus = (bus: EventBus, uuid: string, status: string, timeoutMs?: number) =>
  waitForEvent<Extract<ServerEvent, { type: 'environment-status' }>>(
    bus,
    (event) =>
      event.type === 'environment-status' &&
      event.summary.uuid === uuid &&
      event.summary.status === status,
    timeoutMs,
  );

export async function makeConfig(overrides: Partial<Config> = {}): Promise<Config> {
  return {
    port: 3300,
    host: '127.0.0.1',
    dataDir: await tempDir(),
    envPassword: null,
    auth: 'on',
    allowedHosts: [],
    dev: false,
    webDistDir: null,
    ...overrides,
  };
}

export async function makeApp(
  overrides: Partial<Config> = {},
  options: Partial<AppOptions> = {},
): Promise<App> {
  const app = await createApp(await makeConfig(overrides), {
    logger: silentLogger,
    loginFailureDelayMs: 0,
    ...options,
  });
  onCleanup(() => app.close());

  return app;
}

/** Start an environment and wait until the engine is listening. */
export async function startAndWait(app: App, uuid: string): Promise<void> {
  const running = waitForStatus(app.bus, uuid, 'running');
  app.runtime.start(uuid);
  await running;
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function until(check: () => boolean | Promise<boolean>, timeoutMs = 5000) {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out waiting for condition');
    }
    await sleep(25);
  }
}
