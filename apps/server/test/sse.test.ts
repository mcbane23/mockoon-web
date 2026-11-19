import http from 'node:http';
import type { ServerEvent } from '@maketa/shared';
import { describe, expect, it } from 'vitest';
import { getFreePort, makeApp, onCleanup, until } from './helpers.js';

/** Minimal SSE client collecting parsed events. */
function connect(port: number): Promise<{ events: ServerEvent[]; close: () => void }> {
  return new Promise((resolve, reject) => {
    const events: ServerEvent[] = [];
    const request = http.get({ host: '127.0.0.1', port, path: '/api/events' }, (response) => {
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/event-stream');
      let buffer = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => {
        buffer += chunk;
        let index: number;
        while ((index = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          if (block.startsWith('data: ')) {
            events.push(JSON.parse(block.slice(6)));
          }
        }
      });
      resolve({ events, close: () => request.destroy() });
    });
    request.on('error', reject);
  });
}

describe('SSE', () => {
  it('sends hello, then status after a start and a log after a request', async () => {
    const app = await makeApp();
    const uiPort = await getFreePort();
    await app.fastify.listen({ port: uiPort, host: '127.0.0.1' });
    const { environment } = await app.store.create({ port: await getFreePort() });

    const client = await connect(uiPort);
    onCleanup(async () => client.close());
    await until(() => client.events.length > 0);
    expect(client.events[0]).toEqual({ type: 'hello', serverInstanceId: app.serverInstanceId });

    const response = await fetch(
      `http://127.0.0.1:${uiPort}/api/environments/${environment.uuid}/start`,
      {
        method: 'POST',
      },
    );
    expect(response.status).toBe(202);
    expect(((await response.json()) as { status: string }).status).toBe('starting');

    await until(() =>
      client.events.some(
        (event) => event.type === 'environment-status' && event.summary.status === 'running',
      ),
    );

    await fetch(`http://127.0.0.1:${environment.port}/`);
    await until(() => client.events.some((event) => event.type === 'log'));
    const log = client.events.find((event) => event.type === 'log');
    expect(log).toMatchObject({
      type: 'log',
      entry: { environmentUuid: environment.uuid, response: { statusCode: 200 } },
    });

    const types = client.events.map((event) => event.type);
    expect(types.indexOf('hello')).toBe(0);
    expect(types.indexOf('environment-status')).toBeLessThan(types.indexOf('log'));
  });

  it('removes the listener when the connection closes', async () => {
    const app = await makeApp();
    const uiPort = await getFreePort();
    await app.fastify.listen({ port: uiPort, host: '127.0.0.1' });
    const emitter = (app.bus as unknown as { emitter: { listenerCount: (name: string) => number } })
      .emitter;

    const client = await connect(uiPort);
    await until(() => emitter.listenerCount('event') === 1);
    client.close();
    await until(() => emitter.listenerCount('event') === 0);
  });
});
