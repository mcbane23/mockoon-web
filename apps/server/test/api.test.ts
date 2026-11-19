import fs from 'node:fs/promises';
import path from 'node:path';
import { BuildDemoEnvironment, CloneObject, HighestMigrationId } from '@mockoon/commons';
import type {
  ApiErrorBody,
  AppState,
  EnvironmentDetail,
  EnvironmentSummary,
  LogEntry,
} from '@maketa/shared';
import { describe, expect, it } from 'vitest';
import type { App } from '../src/app.js';
import { fixturesDir, getFreePort, makeApp, readFixture, tempDir, until } from './helpers.js';

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

const call = async <T = any>(app: App, method: Method, url: string, payload?: unknown) => {
  const response = await app.fastify.inject({
    method,
    url,
    headers: { host: 'localhost:4400', 'x-client-id': 'test-client' },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
  const text = response.body;
  let json: unknown = undefined;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    // not json
  }

  return { status: response.statusCode, json: json as T, text, headers: response.headers };
};

const errorCode = (result: { json: unknown }) => (result.json as ApiErrorBody).error.code;

const createEnvironment = async (app: App, body: object = {}) =>
  (await call<EnvironmentDetail>(app, 'POST', '/api/environments', body)).json;

describe('HTTP API', () => {
  it('GET /state', async () => {
    const app = await makeApp();
    await createEnvironment(app, { name: 'One' });
    const { status, json } = await call<AppState>(app, 'GET', '/api/state');

    expect(status).toBe(200);
    expect(json.environments.map((item) => item.name)).toEqual(['One']);
    expect(json.authRequired).toBe(false);
    expect(json.engineVersion).toBe('9.10.0');
    expect(json.appVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(json.uiPort).toBe(4400);
    expect(json.dataDir).toBe(app.config.dataDir);
    expect(json.nextFreePort).toBe(3002);
    expect(json.settings).toEqual({
      version: 1,
      maxLogsPerEnvironment: 100,
      restoreRunningOnStart: true,
      enableRandomLatency: false,
      logBodyLimitBytes: 524288,
    });
    expect(json.settings).not.toHaveProperty('environments');
  });

  it('PUT /settings', async () => {
    const app = await makeApp();
    const ok = await call(app, 'PUT', '/api/settings', {
      maxLogsPerEnvironment: 50,
      enableRandomLatency: true,
    });
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({ maxLogsPerEnvironment: 50, enableRandomLatency: true });
    expect(app.settings.get().maxLogsPerEnvironment).toBe(50);

    for (const body of [
      { maxLogsPerEnvironment: 5 },
      { maxLogsPerEnvironment: 5000 },
      { restoreRunningOnStart: 'yes' },
      { unknown: 1 },
    ]) {
      const bad = await call(app, 'PUT', '/api/settings', body);
      expect(bad.status).toBe(400);
      expect(errorCode(bad)).toBe('BAD_REQUEST');
    }
  });

  it('POST /environments', async () => {
    const app = await makeApp();
    const created = await call<EnvironmentDetail>(app, 'POST', '/api/environments', {
      name: 'Orders',
      port: 3555,
    });
    expect(created.status).toBe(201);
    expect(created.json.environment).toMatchObject({
      name: 'Orders',
      port: 3555,
      lastMigration: HighestMigrationId,
    });
    expect(created.json.summary).toMatchObject({ status: 'stopped', revision: 1, routeCount: 1 });

    expect((await call(app, 'POST', '/api/environments', { port: 70000 })).status).toBe(400);
    expect((await call(app, 'POST', '/api/environments', { port: 'x' })).status).toBe(400);
    expect((await call(app, 'POST', '/api/environments', { name: 'x'.repeat(101) })).status).toBe(
      400,
    );
  });

  it('POST /environments/open', async () => {
    const app = await makeApp();
    const directory = await tempDir();
    const filePath = path.join(directory, 'env.json');
    await fs.copyFile(path.join(fixturesDir, 'with-out-of-scope.json'), filePath);

    const opened = await call<EnvironmentDetail>(app, 'POST', '/api/environments/open', {
      path: filePath,
    });
    expect(opened.status).toBe(201);
    expect(opened.json.summary.path).toBe(filePath);

    const again = await call(app, 'POST', '/api/environments/open', { path: filePath });
    expect(again.status).toBe(409);
    expect(errorCode(again)).toBe('ALREADY_OPEN');

    const missing = await call(app, 'POST', '/api/environments/open', {
      path: path.join(directory, 'nope.json'),
    });
    expect(missing.status).toBe(404);
    expect(errorCode(missing)).toBe('FILE_NOT_FOUND');

    expect(
      (await call(app, 'POST', '/api/environments/open', { path: 'relative.json' })).status,
    ).toBe(400);
    expect((await call(app, 'POST', '/api/environments/open', {})).status).toBe(400);

    const invalidPath = path.join(directory, 'invalid.json');
    await fs.writeFile(invalidPath, 'not json');
    const invalid = await call(app, 'POST', '/api/environments/open', { path: invalidPath });
    expect(invalid.status).toBe(422);
    expect(errorCode(invalid)).toBe('INVALID_JSON');
  });

  it('POST /environments/import', async () => {
    const app = await makeApp();
    const content = await readFixture('with-out-of-scope.json');
    const imported = await call<EnvironmentDetail>(app, 'POST', '/api/environments/import', {
      filename: 'with-out-of-scope.json',
      content,
    });
    expect(imported.status).toBe(201);
    expect(imported.json.environment).toEqual(JSON.parse(content));
    expect(imported.json.summary.managed).toBe(true);

    const cases: [string, string][] = [
      ['{', 'INVALID_JSON'],
      ['{"a":1}', 'NOT_AN_ENVIRONMENT'],
      [JSON.stringify({ source: 'mockoon:1.0.0', data: [] }), 'LEGACY_EXPORT_FORMAT'],
      [JSON.stringify({ ...BuildDemoEnvironment(), lastMigration: 999 }), 'ENVIRONMENT_TOO_RECENT'],
    ];
    for (const [text, code] of cases) {
      const result = await call(app, 'POST', '/api/environments/import', {
        filename: 'x.json',
        content: text,
      });
      expect(result.status).toBe(422);
      expect(errorCode(result)).toBe(code);
    }
  });

  it('PUT /environments/order', async () => {
    const app = await makeApp();
    const a = (await createEnvironment(app)).environment.uuid;
    const b = (await createEnvironment(app)).environment.uuid;

    expect((await call(app, 'PUT', '/api/environments/order', { uuids: [b, a] })).status).toBe(204);
    const state = await call<AppState>(app, 'GET', '/api/state');
    expect(state.json.environments.map((item) => item.uuid)).toEqual([b, a]);

    expect((await call(app, 'PUT', '/api/environments/order', { uuids: [a] })).status).toBe(400);
    expect((await call(app, 'PUT', '/api/environments/order', { uuids: 'x' })).status).toBe(400);
  });

  it('GET and PUT /environments/:uuid', async () => {
    const app = await makeApp();
    const { environment } = await createEnvironment(app);
    const base = `/api/environments/${environment.uuid}`;

    const detail = await call<EnvironmentDetail>(app, 'GET', base);
    expect(detail.status).toBe(200);
    expect(detail.json.environment).toEqual(environment);
    expect(detail.json.disabledRoutes).toEqual([]);

    const unknown = await call(app, 'GET', '/api/environments/unknown');
    expect(unknown.status).toBe(404);
    expect(errorCode(unknown)).toBe('NOT_FOUND');

    const changed = { ...CloneObject(environment), name: 'Renamed' };
    const saved = await call(app, 'PUT', base, { environment: changed, baseRevision: 1 });
    expect(saved.status).toBe(200);
    expect(saved.json).toEqual({ revision: 2 });

    const conflict = await call(app, 'PUT', base, { environment: changed, baseRevision: 1 });
    expect(conflict.status).toBe(409);
    expect(errorCode(conflict)).toBe('REVISION_CONFLICT');
    expect((conflict.json as ApiErrorBody).error.details).toEqual({ revision: 2 });

    expect((await call(app, 'PUT', base, { environment: changed })).status).toBe(400);
    expect(
      (
        await call(app, 'PUT', base, {
          environment: { ...changed, lastMigration: 1 },
          baseRevision: 2,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call(app, 'PUT', '/api/environments/unknown', {
          environment: changed,
          baseRevision: 1,
        })
      ).status,
    ).toBe(404);
  });

  it('PUT /environments/:uuid answers PORT_IN_USE when a running environment moves to a used port', async () => {
    const app = await makeApp();
    const first = (await createEnvironment(app, { port: await getFreePort() })).environment;
    const second = (await createEnvironment(app, { port: await getFreePort() })).environment;
    for (const environment of [first, second]) {
      await call(app, 'POST', `/api/environments/${environment.uuid}/start`);
    }
    await until(() => app.store.summaries().every((summary) => summary.status === 'running'));

    const result = await call(app, 'PUT', `/api/environments/${second.uuid}`, {
      environment: { ...second, port: first.port },
      baseRevision: 1,
    });
    expect(result.status).toBe(409);
    expect(errorCode(result)).toBe('PORT_IN_USE');
    expect(app.store.summary(second.uuid).port).toBe(second.port);
  });

  it('DELETE /environments/:uuid', async () => {
    const app = await makeApp();
    const kept = await createEnvironment(app);
    const removed = await createEnvironment(app);

    expect((await call(app, 'DELETE', `/api/environments/${kept.environment.uuid}`)).status).toBe(
      204,
    );
    expect(
      (await call(app, 'DELETE', `/api/environments/${removed.environment.uuid}?deleteFile=true`))
        .status,
    ).toBe(204);
    await expect(fs.access(kept.summary.path)).resolves.toBeUndefined();
    await expect(fs.access(removed.summary.path)).rejects.toThrow();
    expect((await call(app, 'DELETE', `/api/environments/${kept.environment.uuid}`)).status).toBe(
      404,
    );
  });

  it('POST /environments/:uuid/duplicate', async () => {
    const app = await makeApp();
    const { environment } = await createEnvironment(app, { name: 'Original' });
    const copy = await call<EnvironmentDetail>(
      app,
      'POST',
      `/api/environments/${environment.uuid}/duplicate`,
    );
    expect(copy.status).toBe(201);
    expect(copy.json.environment.name).toBe('Original (copy)');
    expect((await call(app, 'POST', '/api/environments/unknown/duplicate')).status).toBe(404);
  });

  it('GET /environments/:uuid/export', async () => {
    const app = await makeApp();
    const { environment } = await createEnvironment(app, { name: 'My  API v2!' });
    const exported = await call(app, 'GET', `/api/environments/${environment.uuid}/export`);

    expect(exported.status).toBe(200);
    expect(exported.headers['content-disposition']).toBe('attachment; filename="my-api-v2.json"');
    expect(JSON.parse(exported.text)).toEqual(environment);
    expect(exported.text).toBe(JSON.stringify(environment, null, 2));
    expect((await call(app, 'GET', '/api/environments/unknown/export')).status).toBe(404);
  });

  it('PUT /environments/:uuid/ui-state', async () => {
    const app = await makeApp();
    const { environment } = await createEnvironment(app);
    const routeUuid = environment.routes[0]!.uuid;
    const base = `/api/environments/${environment.uuid}`;

    const result = await call(app, 'PUT', `${base}/ui-state`, {
      disabledRoutes: [routeUuid, 'does-not-exist'],
      collapsedFolders: ['does-not-exist'],
    });
    expect(result.status).toBe(204);
    const detail = await call<EnvironmentDetail>(app, 'GET', base);
    expect(detail.json.disabledRoutes).toEqual([routeUuid]);
    expect(detail.json.collapsedFolders).toEqual([]);

    expect((await call(app, 'PUT', '/api/environments/unknown/ui-state', {})).status).toBe(404);
    expect((await call(app, 'PUT', `${base}/ui-state`, { disabledRoutes: 'x' })).status).toBe(400);
  });

  it('start, stop, restart and logs', async () => {
    const app = await makeApp();
    const { environment } = await createEnvironment(app, { port: await getFreePort() });
    const base = `/api/environments/${environment.uuid}`;
    const isRunning = () => app.store.summary(environment.uuid).status === 'running';

    const started = await call<EnvironmentSummary>(app, 'POST', `${base}/start`);
    expect(started.status).toBe(202);
    expect(started.json.status).toBe('starting');
    await until(isRunning);

    const twice = await call(app, 'POST', `${base}/start`);
    expect(twice.status).toBe(409);
    expect(errorCode(twice)).toBe('ALREADY_RUNNING');

    await fetch(`http://127.0.0.1:${environment.port}/?x=1`);
    await until(() => app.logs.list(environment.uuid).length === 1);
    const logs = await call<LogEntry[]>(app, 'GET', `${base}/logs`);
    expect(logs.status).toBe(200);
    expect(logs.json).toHaveLength(1);
    expect(logs.json[0]?.request.queryParams).toEqual({ x: '1' });

    const restarted = await call<EnvironmentSummary>(app, 'POST', `${base}/restart`);
    expect(restarted.status).toBe(202);
    await until(isRunning);
    expect((await fetch(`http://127.0.0.1:${environment.port}/`)).status).toBe(200);

    expect((await call(app, 'DELETE', `${base}/logs`)).status).toBe(204);
    expect((await call<LogEntry[]>(app, 'GET', `${base}/logs`)).json).toEqual([]);

    const stopped = await call<EnvironmentSummary>(app, 'POST', `${base}/stop`);
    expect(stopped.status).toBe(202);
    expect(stopped.json.status).toBe('stopped');

    for (const action of ['start', 'stop', 'restart']) {
      expect((await call(app, 'POST', `/api/environments/unknown/${action}`)).status).toBe(404);
    }
    expect((await call(app, 'GET', '/api/environments/unknown/logs')).status).toBe(404);
    expect((await call(app, 'DELETE', '/api/environments/unknown/logs')).status).toBe(404);
  });

  it('unknown API routes answer with a JSON 404 and unexpected errors hide details', async () => {
    const app = await makeApp();
    const unknown = await call(app, 'GET', '/api/nope');
    expect(unknown.status).toBe(404);
    expect(errorCode(unknown)).toBe('NOT_FOUND');

    app.store.summaries = () => {
      throw new Error('secret detail');
    };
    const failed = await call(app, 'GET', '/api/state');
    expect(failed.status).toBe(500);
    expect(failed.json).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  });

  it('serves the built UI and falls back to index.html', async () => {
    const webDistDir = await tempDir();
    await fs.writeFile(path.join(webDistDir, 'index.html'), '<html>maketa</html>');
    await fs.mkdir(path.join(webDistDir, 'assets'));
    await fs.writeFile(path.join(webDistDir, 'assets', 'app.js'), 'console.log(1)');
    const app = await makeApp({ webDistDir });

    expect((await call(app, 'GET', '/')).text).toContain('maketa');
    expect((await call(app, 'GET', '/env/123/routes')).text).toContain('maketa');
    expect((await call(app, 'GET', '/assets/app.js')).text).toBe('console.log(1)');
    expect((await call(app, 'GET', '/api/unknown')).status).toBe(404);
    // a missing file is a 404, not the application shell
    const missing = await call(app, 'GET', '/assets/missing.js');
    expect(missing.status).toBe(404);
    expect(missing.text).not.toContain('maketa');
  });
});
