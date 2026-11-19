import type { FastifyInstance } from 'fastify';
import type { LogEntry } from '@maketa/shared';
import type { App } from '../app.js';

const schema = {
  params: {
    type: 'object',
    required: ['uuid'],
    properties: { uuid: { type: 'string', minLength: 1, maxLength: 100 } },
  },
} as const;

type UuidParams = { Params: { uuid: string } };

export function registerLogRoutes(fastify: FastifyInstance, app: App): void {
  fastify.get<UuidParams>(
    '/api/environments/:uuid/logs',
    { schema },
    async (request): Promise<LogEntry[]> => {
      app.store.get(request.params.uuid);

      return app.logs.list(request.params.uuid);
    },
  );

  fastify.delete<UuidParams>('/api/environments/:uuid/logs', { schema }, async (request, reply) => {
    app.store.get(request.params.uuid);
    app.logs.clear(request.params.uuid);

    return reply.code(204).send();
  });
}
