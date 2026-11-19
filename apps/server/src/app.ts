import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import { EnvironmentStore } from './environment-store.js';
import { ApiError } from './errors.js';
import { EventBus } from './event-bus.js';
import { FileWatcher } from './file-watcher.js';
import { LogStore } from './log-store.js';
import { consoleLogger, type Logger } from './logger.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerEnvironmentRoutes } from './routes/environments.js';
import { registerEventRoutes } from './routes/events.js';
import { registerLogRoutes } from './routes/logs.js';
import { registerRuntimeRoutes } from './routes/runtime.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerStateRoutes } from './routes/state.js';
import { RuntimeManager } from './runtime-manager.js';
import { registerSecurity, resolveAuth, type AuthState } from './security.js';
import { SettingsStore } from './settings-store.js';

const require = createRequire(import.meta.url);

export type AppOptions = {
  logger: Logger;
  /** Delay before answering a failed login. */
  loginFailureDelayMs: number;
  /** Watch environment files for external changes. */
  watchFiles: boolean;
};

export type App = {
  fastify: FastifyInstance;
  config: Config;
  options: AppOptions;
  bus: EventBus;
  settings: SettingsStore;
  store: EnvironmentStore;
  runtime: RuntimeManager;
  logs: LogStore;
  watcher: FileWatcher;
  auth: AuthState;
  serverInstanceId: string;
  appVersion: string;
  engineVersion: string;
  /** Names of the environments restarted because they were running at the last shutdown. */
  restored: string[];
  /** Stop mock servers, flush everything to disk and close the HTTP server. */
  close: () => Promise<void>;
};

const BODY_LIMIT_BYTES = 50 * 1024 * 1024;

const readVersion = (specifier: string): string => {
  try {
    return String(require(specifier).version);
  } catch {
    return 'unknown';
  }
};

/** Build the whole application. Used by the entry point and by tests. */
export async function createApp(config: Config, overrides: Partial<AppOptions> = {}): Promise<App> {
  const options: AppOptions = {
    logger: consoleLogger,
    loginFailureDelayMs: 500,
    watchFiles: true,
    ...overrides,
  };
  const { logger } = options;

  await fs.promises.mkdir(config.dataDir, { recursive: true });
  const auth = await resolveAuth(config);

  const bus = new EventBus();
  const settings = new SettingsStore(config.dataDir, logger);
  await settings.load();
  const store = new EnvironmentStore(config, settings, bus, logger);
  const logs = new LogStore(settings, bus);
  const runtime = new RuntimeManager(config, settings, store, logs, bus, logger);
  store.attachRuntime(runtime);
  const watcher = new FileWatcher(store, logger);
  if (options.watchFiles) {
    store.onPathsChanged = () => watcher.sync();
  }
  await store.init();

  const fastify = Fastify({
    bodyLimit: BODY_LIMIT_BYTES,
    forceCloseConnections: true,
    logger: false,
    // strict validation: no type coercion, unknown properties are an error
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
  });
  await fastify.register(fastifyCookie);

  fastify.setErrorHandler((error: FastifyError | ApiError, _request, reply) => {
    if (error instanceof ApiError) {
      return reply.code(error.status).send(error.toBody());
    }
    if (error.validation) {
      return reply
        .code(400)
        .send(new ApiError(400, 'BAD_REQUEST', error.message, error.validation).toBody());
    }
    if (typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500) {
      return reply
        .code(error.statusCode)
        .send(new ApiError(error.statusCode, 'BAD_REQUEST', error.message).toBody());
    }
    // full stack trace in the server log, no details for the client
    logger.error('Unexpected error', error);

    return reply
      .code(500)
      .send(new ApiError(500, 'INTERNAL_ERROR', 'Internal server error').toBody());
  });

  registerSecurity(fastify, config, auth);

  const app: App = {
    fastify,
    config,
    options,
    bus,
    settings,
    store,
    runtime,
    logs,
    watcher,
    auth,
    serverInstanceId: randomUUID(),
    appVersion: readVersion('../package.json'),
    engineVersion: readVersion('@mockoon/commons-server/package.json'),
    restored: [],
    close: async () => {
      watcher.close();
      await runtime.stopAll();
      await settings.flush();
      await store.flush();
      await fastify.close();
    },
  };

  registerAuthRoutes(fastify, app);
  registerStateRoutes(fastify, app);
  registerSettingsRoutes(fastify, app);
  registerEnvironmentRoutes(fastify, app);
  registerRuntimeRoutes(fastify, app);
  registerLogRoutes(fastify, app);
  registerEventRoutes(fastify, app);

  const webDistDir =
    config.webDistDir && fs.existsSync(`${config.webDistDir}/index.html`)
      ? config.webDistDir
      : null;
  if (webDistDir) {
    // static UI files are served without login; only the API is protected
    await fastify.register(fastifyStatic, { root: webDistDir });
  }

  fastify.setNotFoundHandler((request, reply) => {
    const pathname = request.url.split('?')[0] ?? '';
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      return reply
        .code(404)
        .send(new ApiError(404, 'NOT_FOUND', `Unknown API route ${pathname}`).toBody());
    }
    // single-page application: every other path that does not look like a file gets index.html
    const looksLikeFile = /\.[a-z0-9]+$/i.test(pathname);
    if (webDistDir && !looksLikeFile && (request.method === 'GET' || request.method === 'HEAD')) {
      return reply.sendFile('index.html');
    }

    return reply
      .code(404)
      .type('text/plain')
      .send(webDistDir ? 'Not found' : 'Not found. Run "pnpm build" to build the UI.');
  });

  app.restored = runtime.restoreOnStart();

  return app;
}
