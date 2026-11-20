import type { FastifyInstance } from 'fastify';
import type { EnvironmentSummary } from '@mockpit/shared';
import type { App } from '../app.js';

const schema = {
  params: {
    type: 'object',
    required: ['uuid'],
    properties: { uuid: { type: 'string', minLength: 1, maxLength: 100 } },
  },
} as const;

type UuidParams = { Params: { uuid: string } };

export function registerRuntimeRoutes(fastify: FastifyInstance, app: App): void {
  fastify.post<UuidParams>(
    '/api/environments/:uuid/start',
    { schema },
    async (request, reply): Promise<EnvironmentSummary> => {
      reply.code(202);

      return app.runtime.start(request.params.uuid);
    },
  );

  fastify.post<UuidParams>(
    '/api/environments/:uuid/stop',
    { schema },
    async (request, reply): Promise<EnvironmentSummary> => {
      const { uuid } = request.params;
      app.store.get(uuid);
      await app.runtime.stop(uuid);
      reply.code(202);

      return app.store.summary(uuid);
    },
  );

  fastify.post<UuidParams>(
    '/api/environments/:uuid/restart',
    { schema },
    async (request, reply): Promise<EnvironmentSummary> => {
      const { uuid } = request.params;
      app.store.get(uuid);
      reply.code(202);

      return app.runtime.restart(uuid);
    },
  );
}
