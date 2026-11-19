import type { FastifyInstance } from 'fastify';
import type { AppSettings, AppSettingsPatch } from '@maketa/shared';
import type { App } from '../app.js';
import { SETTINGS_LIMITS } from '../settings-store.js';

export function registerSettingsRoutes(fastify: FastifyInstance, app: App): void {
  fastify.put<{ Body: AppSettingsPatch }>(
    '/api/settings',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            maxLogsPerEnvironment: {
              type: 'integer',
              minimum: SETTINGS_LIMITS.maxLogsPerEnvironment.min,
              maximum: SETTINGS_LIMITS.maxLogsPerEnvironment.max,
            },
            restoreRunningOnStart: { type: 'boolean' },
            enableRandomLatency: { type: 'boolean' },
            logBodyLimitBytes: {
              type: 'integer',
              minimum: SETTINGS_LIMITS.logBodyLimitBytes.min,
              maximum: SETTINGS_LIMITS.logBodyLimitBytes.max,
            },
          },
        },
      },
    },
    async (request): Promise<AppSettings> => {
      const patch = request.body;
      app.settings.update((settings) => {
        Object.assign(settings, patch);
      });
      app.bus.emit({ type: 'settings-updated' });

      return app.settings.appSettings();
    },
  );
}
