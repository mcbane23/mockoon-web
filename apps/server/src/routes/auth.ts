import type { FastifyInstance } from 'fastify';
import type { AuthStatus } from '@mockpit/shared';
import type { App } from '../app.js';
import { ApiError } from '../errors.js';
import {
  LoginRateLimiter,
  clearSessionCookie,
  isValidSession,
  safeEqual,
  setSessionCookie,
} from '../security.js';

export function registerAuthRoutes(fastify: FastifyInstance, app: App): void {
  const limiter = new LoginRateLimiter();

  fastify.get('/api/auth/status', async (request): Promise<AuthStatus> => {
    return {
      authRequired: app.auth.active,
      authenticated: !app.auth.active || isValidSession(request, app.auth),
    };
  });

  fastify.post<{ Body: { password: string } }>(
    '/api/auth/login',
    {
      schema: {
        body: {
          type: 'object',
          required: ['password'],
          additionalProperties: false,
          properties: { password: { type: 'string', maxLength: 1024 } },
        },
      },
    },
    async (request, reply) => {
      if (!app.auth.active) {
        return reply.code(204).send();
      }
      limiter.check(request.ip);
      if (!safeEqual(request.body.password, app.auth.password)) {
        await new Promise((resolve) => setTimeout(resolve, app.options.loginFailureDelayMs));
        throw new ApiError(401, 'UNAUTHORIZED', 'Wrong password');
      }
      setSessionCookie(reply, app.auth);

      return reply.code(204).send();
    },
  );

  fastify.post('/api/auth/logout', async (_request, reply) => {
    clearSessionCookie(reply);

    return reply.code(204).send();
  });
}
