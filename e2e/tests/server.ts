import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test as base, expect, type Page } from '@playwright/test';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const SERVER_ENTRY = path.join(REPO_ROOT, 'apps/server/dist/index.js');
export const FIXTURES_DIR = path.join(REPO_ROOT, 'apps/server/test/fixtures');

/** Ask the system for a port that is free right now. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

export class MaketaServer {
  private child: ChildProcess | null = null;
  output = '';

  constructor(
    readonly dataDir: string,
    readonly port: number,
    private readonly extraEnv: Record<string, string> = {},
  ) {}

  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  async start(): Promise<void> {
    const child = spawn(process.execPath, [SERVER_ENTRY], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        MAKETA_HOST: '127.0.0.1',
        MAKETA_PORT: String(this.port),
        MAKETA_DATA_DIR: this.dataDir,
        ...this.extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child = child;
    child.stdout?.on('data', (chunk: Buffer) => (this.output += chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer) => (this.output += chunk.toString()));

    const deadline = Date.now() + 20_000;
    for (;;) {
      if (child.exitCode !== null) {
        throw new Error(`The server exited with code ${child.exitCode}:\n${this.output}`);
      }
      try {
        const response = await fetch(`${this.url}/api/auth/status`);
        if (response.ok) {
          return;
        }
      } catch {
        // not listening yet
      }
      if (Date.now() > deadline) {
        throw new Error(`The server did not start in time:\n${this.output}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /** Stop the way a service manager would: SIGTERM and wait for the clean exit. */
  async stop(): Promise<void> {
    const child = this.child;
    this.child = null;
    if (!child || child.exitCode !== null) {
      return;
    }
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
    await exited;
    clearTimeout(timer);
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }
}

type Fixtures = {
  /** Start a server with a fresh data directory; stopped and cleaned up after the test. */
  startServer: (extraEnv?: Record<string, string>) => Promise<MaketaServer>;
  /** A server without a password, already started. */
  server: MaketaServer;
};

export const test = base.extend<Fixtures>({
  // Playwright requires an object pattern as the first argument of a fixture
  // eslint-disable-next-line no-empty-pattern
  startServer: async ({}, use) => {
    const servers: MaketaServer[] = [];
    await use(async (extraEnv = {}) => {
      const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'maketa-e2e-'));
      const server = new MaketaServer(dataDir, await freePort(), extraEnv);
      servers.push(server);
      await server.start();

      return server;
    });
    for (const server of servers) {
      await server.stop();
      await fs.rm(server.dataDir, { recursive: true, force: true });
    }
  },
  server: async ({ startServer }, use) => {
    await use(await startServer());
  },
});

export { expect };

/** Create an environment through the "New environment" dialog and wait until it is open. */
export async function createEnvironment(page: Page, name: string, port: number): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'New environment' });
  if (!(await dialog.isVisible())) {
    await page.getByTitle('New environment').click();
  }
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByLabel('Port').fill(String(port));
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('environment-item').filter({ hasText: name })).toBeVisible();
  await expect(page.getByTestId('base-url')).toContainText(`:${port}`);
}

/** Add an HTTP route to the open environment and set its path and (optionally) its body. */
export async function addRoute(page: Page, endpoint: string, body?: string): Promise<void> {
  await page.getByRole('button', { name: 'Add route or folder' }).click();
  await page.getByRole('menuitem', { name: 'HTTP route' }).click();
  await page.getByPlaceholder('users/:id').fill(endpoint);
  if (body !== undefined) {
    await page.getByRole('textbox', { name: 'Response body' }).fill(body);
  }
  await expect(page.getByRole('treeitem', { name: `GET /${endpoint}` })).toBeVisible();
  await expectSaved(page);
}

export async function expectSaved(page: Page): Promise<void> {
  await expect(page.getByTestId('save-state')).toHaveText('Saved');
}

export async function startOpenEnvironment(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
}
