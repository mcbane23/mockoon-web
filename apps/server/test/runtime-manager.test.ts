import { BuildHTTPRoute, CloneObject, addRouteMutator, type Environment } from '@mockoon/commons';
import { describe, expect, it } from 'vitest';
import type { App } from '../src/app.js';
import { ApiError } from '../src/errors.js';
import {
  getFreePort,
  makeApp,
  occupyPort,
  startAndWait,
  until,
  waitForEvent,
  waitForStatus,
} from './helpers.js';

const createEnvironment = async (app: App, port?: number) =>
  (await app.store.create({ port: port ?? (await getFreePort()) })).environment;

const url = (environment: Pick<Environment, 'port'>, path = '') =>
  `http://127.0.0.1:${environment.port}/${path}`;

const defaultBody = (environment: Environment) => environment.routes[0]!.responses[0]!.body;

describe('RuntimeManager', () => {
  it('start serves the default response and logs the transaction', async () => {
    const app = await makeApp();
    const environment = await createEnvironment(app);
    await startAndWait(app, environment.uuid);

    expect(app.store.summary(environment.uuid).status).toBe('running');
    expect(app.settings.get().environments[0]?.wasRunning).toBe(true);

    const logged = waitForEvent(app.bus, (event) => event.type === 'log');
    const response = await fetch(url(environment, '?a=1'));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(defaultBody(environment));
    await logged;

    const logs = app.logs.list(environment.uuid);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      environmentUuid: environment.uuid,
      routeUUID: environment.routes[0]!.uuid,
      requestBodyTruncated: false,
      responseBodyTruncated: false,
      request: { method: 'get', urlPath: '/' },
      response: { statusCode: 200 },
    });
  });

  it('starting twice is rejected', async () => {
    const app = await makeApp();
    const environment = await createEnvironment(app);
    await startAndWait(app, environment.uuid);

    expect(() => app.runtime.start(environment.uuid)).toThrowError(
      expect.objectContaining({ code: 'ALREADY_RUNNING', status: 409 }),
    );
  });

  it('a route added through update is served immediately, without a restart', async () => {
    const app = await makeApp();
    const environment = await createEnvironment(app);
    await startAndWait(app, environment.uuid);

    const statuses: string[] = [];
    app.bus.subscribe((event) => {
      if (event.type === 'environment-status') {
        statuses.push(event.summary.status);
      }
    });

    const route = BuildHTTPRoute(true, {
      endpoint: 'users/:id',
      body: '{"id":"{{urlParam \'id\'}}"}',
    });
    const next = addRouteMutator(CloneObject(environment), route, 'root');
    await app.store.update(environment.uuid, next, 1, null);

    const response = await fetch(url(environment, 'users/42'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: '42' });
    expect(statuses.filter((status) => status !== 'running')).toEqual([]);
  });

  it('changing the port restarts the environment on the new port', async () => {
    const app = await makeApp();
    const environment = await createEnvironment(app);
    await startAndWait(app, environment.uuid);

    const newPort = await getFreePort();
    const stopped = waitForStatus(app.bus, environment.uuid, 'stopping');
    await app.store.update(
      environment.uuid,
      { ...CloneObject(environment), port: newPort },
      1,
      null,
    );
    await stopped;
    await until(() => app.store.summary(environment.uuid).status === 'running');
    expect(app.store.summary(environment.uuid).port).toBe(newPort);

    const response = await fetch(url({ port: newPort }));
    expect(await response.text()).toBe(defaultBody(environment));
    await expect(fetch(url(environment))).rejects.toThrow();
    expect(app.settings.get().environments[0]?.wasRunning).toBe(true);
  });

  it('two environments on the same port: the second gets PORT_IN_USE', async () => {
    const app = await makeApp();
    const first = await createEnvironment(app);
    const second = await createEnvironment(app, first.port);
    await startAndWait(app, first.uuid);

    let error: unknown;
    try {
      app.runtime.start(second.uuid);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('PORT_IN_USE');
    expect((error as ApiError).message).toContain(first.name);
    expect(app.store.summary(second.uuid).status).toBe('stopped');
  });

  it('the UI port cannot be used by a mock', async () => {
    const app = await makeApp({ port: 4455 });
    const environment = await createEnvironment(app, 4455);

    expect(() => app.runtime.start(environment.uuid)).toThrowError(
      expect.objectContaining({ code: 'PORT_IN_USE' }),
    );
  });

  it('a port held by a foreign program leaves the environment stopped with lastError', async () => {
    const app = await makeApp();
    const port = await getFreePort();
    await occupyPort(port);
    const environment = await createEnvironment(app, port);

    const failed = waitForEvent(
      app.bus,
      (event) => event.type === 'environment-status' && event.summary.lastError !== null,
    );
    app.runtime.start(environment.uuid);
    await failed;

    const summary = app.store.summary(environment.uuid);
    expect(summary.status).toBe('stopped');
    expect(summary.lastError).toEqual({
      code: 'PORT_ALREADY_USED',
      message: `Port ${port} is already in use by another program`,
    });
    expect(app.settings.get().environments[0]?.wasRunning).toBe(false);
  });

  it('a disabled route answers 404 and can be re-enabled while running', async () => {
    const app = await makeApp();
    const environment = await createEnvironment(app);
    const routeUuid = environment.routes[0]!.uuid;
    app.store.setUiState(environment.uuid, { disabledRoutes: [routeUuid, 'unknown-uuid'] });
    expect(app.settings.get().disabledRoutes[environment.uuid]).toEqual([routeUuid]);

    await startAndWait(app, environment.uuid);
    expect((await fetch(url(environment))).status).toBe(404);

    app.store.setUiState(environment.uuid, { disabledRoutes: [] });
    expect((await fetch(url(environment))).status).toBe(200);

    app.store.setUiState(environment.uuid, { disabledRoutes: [routeUuid] });
    expect((await fetch(url(environment))).status).toBe(404);
  });

  it('stop frees the port', async () => {
    const app = await makeApp();
    const environment = await createEnvironment(app);
    await startAndWait(app, environment.uuid);

    await app.runtime.stop(environment.uuid);
    expect(app.store.summary(environment.uuid).status).toBe('stopped');
    expect(app.settings.get().environments[0]?.wasRunning).toBe(false);
    await expect(fetch(url(environment))).rejects.toThrow();
    // the port can be bound again
    await occupyPort(environment.port);
  });

  it('logs survive a restart and are trimmed and truncated by the settings', async () => {
    const app = await makeApp();
    app.settings.update((settings) => {
      settings.logBodyLimitBytes = 1024;
      settings.maxLogsPerEnvironment = 10;
    });
    const environment = await createEnvironment(app);
    const big = BuildHTTPRoute(true, { endpoint: 'big', body: 'x'.repeat(5000) });
    await app.store.update(
      environment.uuid,
      addRouteMutator(CloneObject(environment), big, 'root'),
      1,
      null,
    );
    await startAndWait(app, environment.uuid);

    await fetch(url(environment, 'big'));
    await until(() => app.logs.list(environment.uuid).length === 1);
    const entry = app.logs.list(environment.uuid)[0]!;
    expect(entry.responseBodyTruncated).toBe(true);
    expect(entry.response.body).toHaveLength(1024);

    const running = waitForStatus(app.bus, environment.uuid, 'running');
    await app.runtime.restart(environment.uuid);
    await running;
    expect(app.logs.list(environment.uuid)).toHaveLength(1);

    for (let index = 0; index < 12; index += 1) {
      await fetch(url(environment));
    }
    await until(() => app.logs.list(environment.uuid).length === 10);
    expect(app.logs.list(environment.uuid)[0]?.request.urlPath).toBe('/');
  });

  it('restores running environments on the next start of the application', async () => {
    const first = await makeApp();
    const running = await createEnvironment(first);
    const idle = await createEnvironment(first);
    await startAndWait(first, running.uuid);
    await first.close();

    const second = await makeApp({ dataDir: first.config.dataDir });
    await until(() => second.store.summary(running.uuid).status === 'running');
    expect(second.restored).toEqual([running.name]);
    expect(second.store.summary(idle.uuid).status).toBe('stopped');
    expect((await fetch(url(running))).status).toBe(200);
  });
});
