import type { ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import type { ServerEvent } from '@stubhouse/shared';
import type { App } from '../app.js';

const PING_INTERVAL_MS = 25_000;

/**
 * Server-sent events. There is no replay of missed events: after every reconnect the client
 * reloads the state, the open environment and the logs.
 */
export function registerEventRoutes(fastify: FastifyInstance, app: App): void {
  const open = new Set<ServerResponse>();

  fastify.get('/api/events', (request, reply) => {
    reply.hijack();
    const response = reply.raw;
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const send = (event: ServerEvent) => {
      response.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    send({ type: 'hello', serverInstanceId: app.serverInstanceId });

    const unsubscribe = app.bus.subscribe(send);
    const ping = setInterval(() => response.write(': ping\n\n'), PING_INTERVAL_MS);
    open.add(response);

    request.raw.on('close', () => {
      clearInterval(ping);
      unsubscribe();
      open.delete(response);
    });
  });

  fastify.addHook('preClose', async () => {
    for (const response of open) {
      response.end();
    }
  });
}
