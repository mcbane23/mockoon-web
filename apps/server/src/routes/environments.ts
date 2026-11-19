import type { FastifyInstance } from 'fastify';
import type {
  EnvironmentDetail,
  UiStatePatch,
  UpdateEnvironmentRequest,
  UpdateEnvironmentResponse,
} from '@maketa/shared';
import type { App } from '../app.js';

const uuidParams = {
  type: 'object',
  required: ['uuid'],
  properties: { uuid: { type: 'string', minLength: 1, maxLength: 100 } },
} as const;

const uuidList = {
  type: 'array',
  maxItems: 100_000,
  items: { type: 'string', minLength: 1, maxLength: 100 },
} as const;

type UuidParams = { Params: { uuid: string } };

const clientId = (headers: Record<string, unknown>): string | null => {
  const value = headers['x-client-id'];

  return typeof value === 'string' && value.length > 0 && value.length <= 100 ? value : null;
};

export function registerEnvironmentRoutes(fastify: FastifyInstance, app: App): void {
  const { store } = app;

  fastify.post<{ Body: { name?: string; port?: number } | undefined }>(
    '/api/environments',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', maxLength: 100 },
            port: { type: 'integer', minimum: 1, maximum: 65535 },
          },
        },
      },
    },
    async (request, reply): Promise<EnvironmentDetail> => {
      reply.code(201);

      return store.create(request.body ?? {});
    },
  );

  fastify.post<{ Body: { path: string } }>(
    '/api/environments/open',
    {
      schema: {
        body: {
          type: 'object',
          required: ['path'],
          additionalProperties: false,
          properties: { path: { type: 'string', minLength: 1, maxLength: 4096 } },
        },
      },
    },
    async (request, reply): Promise<EnvironmentDetail> => {
      reply.code(201);

      return store.openFromPath(request.body.path.trim());
    },
  );

  fastify.post<{ Body: { filename: string; content: string } }>(
    '/api/environments/import',
    {
      schema: {
        body: {
          type: 'object',
          required: ['filename', 'content'],
          additionalProperties: false,
          properties: {
            filename: { type: 'string', maxLength: 255 },
            content: { type: 'string' },
          },
        },
      },
    },
    async (request, reply): Promise<EnvironmentDetail> => {
      reply.code(201);

      return store.importFromText(request.body.filename, request.body.content);
    },
  );

  fastify.put<{ Body: { uuids: string[] } }>(
    '/api/environments/order',
    {
      schema: {
        body: {
          type: 'object',
          required: ['uuids'],
          additionalProperties: false,
          properties: { uuids: uuidList },
        },
      },
    },
    async (request, reply) => {
      store.reorder(request.body.uuids);

      return reply.code(204).send();
    },
  );

  fastify.get<UuidParams>(
    '/api/environments/:uuid',
    { schema: { params: uuidParams } },
    async (request): Promise<EnvironmentDetail> => store.detail(request.params.uuid),
  );

  fastify.put<UuidParams & { Body: UpdateEnvironmentRequest }>(
    '/api/environments/:uuid',
    {
      schema: {
        params: uuidParams,
        body: {
          type: 'object',
          required: ['environment', 'baseRevision'],
          additionalProperties: false,
          properties: {
            environment: { type: 'object' },
            baseRevision: { type: 'integer', minimum: 0 },
          },
        },
      },
    },
    async (request): Promise<UpdateEnvironmentResponse> =>
      store.update(
        request.params.uuid,
        request.body.environment,
        request.body.baseRevision,
        clientId(request.headers),
      ),
  );

  fastify.delete<UuidParams & { Querystring: { deleteFile?: 'true' | 'false' } }>(
    '/api/environments/:uuid',
    {
      schema: {
        params: uuidParams,
        querystring: {
          type: 'object',
          properties: { deleteFile: { type: 'string', enum: ['true', 'false'] } },
        },
      },
    },
    async (request, reply) => {
      await store.close(request.params.uuid, { deleteFile: request.query.deleteFile === 'true' });

      return reply.code(204).send();
    },
  );

  fastify.post<UuidParams>(
    '/api/environments/:uuid/duplicate',
    { schema: { params: uuidParams } },
    async (request, reply): Promise<EnvironmentDetail> => {
      reply.code(201);

      return store.duplicate(request.params.uuid);
    },
  );

  fastify.get<UuidParams>(
    '/api/environments/:uuid/export',
    { schema: { params: uuidParams } },
    async (request, reply) => {
      const { filename, text } = store.exportText(request.params.uuid);

      return reply
        .header('Content-Type', 'application/json; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(text);
    },
  );

  fastify.put<UuidParams & { Body: UiStatePatch }>(
    '/api/environments/:uuid/ui-state',
    {
      schema: {
        params: uuidParams,
        body: {
          type: 'object',
          additionalProperties: false,
          properties: { disabledRoutes: uuidList, collapsedFolders: uuidList },
        },
      },
    },
    async (request, reply) => {
      store.setUiState(request.params.uuid, request.body);

      return reply.code(204).send();
    },
  );
}
