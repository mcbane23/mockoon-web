import type { FastifyInstance } from 'fastify';
import type { AppState } from '@stubhouse/shared';
import type { App } from '../app.js';
import { SETTINGS_LIMITS } from '../settings-store.js';
import { isValidSession, setSessionCookie } from '../security.js';

export function registerStateRoutes(fastify: FastifyInstance, app: App): void {
  fastify.get('/api/state', async (request, reply): Promise<AppState> => {
    // Re-send the cookie so the login is extended every time the application is opened.
    if (app.auth.active && isValidSession(request, app.auth)) {
      setSessionCookie(reply, app.auth);
    }

    return {
      settings: app.settings.appSettings(),
      limits: SETTINGS_LIMITS,
      environments: app.store.summaries(),
      authRequired: app.auth.active,
      appVersion: app.appVersion,
      engineVersion: app.engineVersion,
      dataDir: app.config.dataDir,
      uiPort: app.config.port,
      nextFreePort: app.store.nextFreePort(),
    };
  });
}
