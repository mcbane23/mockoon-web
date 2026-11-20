import path from 'node:path';
import { IsEqual, type Environment, type Transaction } from '@mockoon/commons';
import { MockoonServer } from '@mockoon/commons-server';
import type { EnvironmentSummary, RuntimeStatus } from '@stubhouse/shared';
import type { Config } from './config.js';
import type { EnvironmentStore, LoadedEnvironment } from './environment-store.js';
import { ApiError, errorMessage } from './errors.js';
import type { EventBus } from './event-bus.js';
import type { LogStore } from './log-store.js';
import type { Logger } from './logger.js';
import type { SettingsStore } from './settings-store.js';

type RuntimeEntry = {
  server: MockoonServer;
  status: RuntimeStatus;
  port: number;
  /** Resolves once the engine reported "stopped" (or the stop timed out). */
  stopped: Promise<void>;
  resolveStopped: () => void;
};

type StartError = { code: string; message: string };

/** Fields that the engine only reads when it starts (or that are restarted out of caution). */
const RESTART_FIELDS = [
  'port',
  'hostname',
  'tlsOptions',
  'cors',
  'proxyMode',
  'proxyHost',
  'proxyRemovePrefix',
  'proxyReqHeaders',
  'proxyResHeaders',
] as const satisfies readonly (keyof Environment)[];

const STOP_TIMEOUT_MS = 5000;

export const needsRestart = (previous: Environment, next: Environment): boolean =>
  RESTART_FIELDS.some((field) => !IsEqual(previous[field], next[field]));

const startErrorMessage = (code: string, environment: Environment, original: Error | null) => {
  switch (code) {
    case 'PORT_ALREADY_USED':
      return `Port ${environment.port} is already in use by another program`;
    case 'PORT_INVALID':
      return `Port ${environment.port} is invalid or requires elevated privileges`;
    case 'HOSTNAME_UNKNOWN':
      return `Hostname "${environment.hostname}" could not be resolved`;
    case 'HOSTNAME_UNAVAILABLE':
      return `Hostname "${environment.hostname}" is not available on this machine`;
    case 'CERT_FILE_NOT_FOUND':
      return 'TLS certificate file not found';
    default:
      return original?.message ?? code;
  }
};

export class RuntimeManager {
  private readonly entries = new Map<string, RuntimeEntry>();
  private readonly lastErrors = new Map<string, StartError>();
  private shuttingDown = false;

  constructor(
    private readonly config: Config,
    private readonly settings: SettingsStore,
    private readonly store: EnvironmentStore,
    private readonly logs: LogStore,
    private readonly bus: EventBus,
    private readonly logger: Logger,
  ) {}

  status(uuid: string): RuntimeStatus {
    return this.entries.get(uuid)?.status ?? 'stopped';
  }

  lastError(uuid: string): StartError | null {
    return this.lastErrors.get(uuid) ?? null;
  }

  /** Starting or running. */
  isActive(uuid: string): boolean {
    const status = this.status(uuid);

    return status === 'starting' || status === 'running';
  }

  forget(uuid: string): void {
    this.lastErrors.delete(uuid);
    this.logs.drop(uuid);
  }

  /** Message describing who uses the port, or null when it is free as far as Stubhouse knows. */
  portConflict(uuid: string, port: number): string | null {
    if (port === this.config.port) {
      return `Port ${port} is used by the Stubhouse UI`;
    }
    for (const [otherUuid, entry] of this.entries) {
      if (otherUuid !== uuid && entry.port === port && entry.status !== 'stopping') {
        const name = this.store.has(otherUuid) ? this.store.summary(otherUuid).name : otherUuid;

        return `Port ${port} is already used by the running environment "${name}"`;
      }
    }

    return null;
  }

  private createServer(loaded: LoadedEnvironment, environment: Environment): MockoonServer {
    const settings = this.settings.get();

    return new MockoonServer(environment, {
      // for relative file paths in responses
      environmentDirectory: path.dirname(loaded.path),
      disabledRoutes: settings.disabledRoutes[loaded.uuid] ?? [],
      // defaults to true: must be switched off
      enableAdminApi: false,
      disableTls: false,
      maxTransactionLogs: settings.maxLogsPerEnvironment,
      enableRandomLatency: settings.enableRandomLatency,
      envVarsPrefix: 'MOCKOON_',
    });
  }

  private setWasRunning(uuid: string, wasRunning: boolean): void {
    const descriptor = this.settings.get().environments.find((item) => item.uuid === uuid);
    if (descriptor && descriptor.wasRunning !== wasRunning) {
      this.settings.update((settings) => {
        const target = settings.environments.find((item) => item.uuid === uuid);
        if (target) {
          target.wasRunning = wasRunning;
        }
      });
    }
  }

  /** Returns immediately with status "starting"; the outcome arrives as an SSE event. */
  start(uuid: string): EnvironmentSummary {
    const loaded = this.store.get(uuid);
    if (this.status(uuid) !== 'stopped') {
      throw new ApiError(409, 'ALREADY_RUNNING', 'Environment is already running');
    }
    const environment = loaded.environment;
    if (!environment) {
      throw new ApiError(
        409,
        'INVALID_ENVIRONMENT',
        loaded.fileError ?? 'Environment could not be loaded',
      );
    }
    const conflict = this.portConflict(uuid, environment.port);
    if (conflict) {
      throw new ApiError(409, 'PORT_IN_USE', conflict);
    }

    // always a new instance: never reuse an old one
    const server = this.createServer(loaded, environment);
    let resolveStopped: () => void = () => {};
    const stopped = new Promise<void>((resolve) => {
      resolveStopped = resolve;
    });
    const entry: RuntimeEntry = {
      server,
      status: 'starting',
      port: environment.port,
      stopped,
      resolveStopped,
    };
    this.entries.set(uuid, entry);
    this.lastErrors.delete(uuid);
    this.store.emitStatus(uuid);

    const isCurrent = () => this.entries.get(uuid) === entry;

    const failStart = (code: string, original: Error | null) => {
      const message = startErrorMessage(code, environment, original);
      this.lastErrors.set(uuid, { code, message });
      this.logger.warn(`Environment "${environment.name}" failed to start: ${message}`);
      entry.status = 'stopped';
      this.entries.delete(uuid);
      try {
        server.stop();
      } catch {
        // the engine may not have created its http server yet
      }
      entry.resolveStopped();
      this.store.emitStatus(uuid);
    };

    // Listeners must be registered before start(): without an "error" listener EventEmitter throws.
    server.on('started', () => {
      if (!isCurrent()) {
        return;
      }
      entry.status = 'running';
      this.lastErrors.delete(uuid);
      this.setWasRunning(uuid, true);
      this.logger.info(`Environment "${environment.name}" started on port ${environment.port}`);
      this.store.emitStatus(uuid);
    });

    server.on('stopped', () => {
      entry.resolveStopped();
      if (!isCurrent()) {
        return;
      }
      entry.status = 'stopped';
      this.entries.delete(uuid);
      this.logger.info(`Environment "${environment.name}" stopped`);
      this.store.emitStatus(uuid);
    });

    server.on('error', (code: string, original: Error | null, payload?: any) => {
      if (!isCurrent()) {
        return;
      }
      if (entry.status === 'starting') {
        failStart(code, original);

        return;
      }
      const message = original?.message ?? code;
      this.logger.warn(`Environment "${environment.name}" runtime error ${code}: ${message}`);
      this.bus.emit({
        type: 'runtime-error',
        uuid,
        code,
        message,
        ...(typeof payload?.routeUuid === 'string' ? { routeUuid: payload.routeUuid } : {}),
      });
    });

    server.on('transaction-complete', (transaction: Transaction) => {
      this.logs.add(uuid, transaction);
    });

    try {
      server.start();
    } catch (error) {
      if (isCurrent()) {
        failStart(
          'UNKNOWN_SERVER_ERROR',
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }

    return this.store.summary(uuid);
  }

  async stop(uuid: string, options: { keepWasRunning?: boolean } = {}): Promise<void> {
    if (!options.keepWasRunning && !this.shuttingDown) {
      this.setWasRunning(uuid, false);
    }
    const entry = this.entries.get(uuid);
    if (!entry) {
      return;
    }
    if (entry.status !== 'stopping') {
      entry.status = 'stopping';
      this.store.emitStatus(uuid);
      try {
        entry.server.stop();
      } catch (error) {
        this.logger.warn(`Error while stopping environment ${uuid}: ${errorMessage(error)}`);
        entry.resolveStopped();
      }
    }

    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      entry.stopped,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, STOP_TIMEOUT_MS);
      }),
    ]);
    clearTimeout(timer);

    // force the state when the engine never reported "stopped"
    if (this.entries.get(uuid) === entry) {
      entry.status = 'stopped';
      this.entries.delete(uuid);
      this.store.emitStatus(uuid);
    }
  }

  /** Stop then start. Request counters and engine global variables are reset, as in Mockoon. */
  async restart(uuid: string): Promise<EnvironmentSummary> {
    await this.stop(uuid, { keepWasRunning: true });

    return this.start(uuid);
  }

  /** Apply a changed environment to the running engine: hot update, or restart when required. */
  applyEnvironmentChange(uuid: string, previous: Environment, next: Environment): void {
    const entry = this.entries.get(uuid);
    if (!entry || !this.isActive(uuid)) {
      return;
    }
    if (needsRestart(previous, next)) {
      void this.restart(uuid).catch((error) => {
        const code = error instanceof ApiError ? error.code : 'UNKNOWN_SERVER_ERROR';
        this.lastErrors.set(uuid, { code, message: errorMessage(error) });
        this.store.emitStatus(uuid);
      });
    } else {
      entry.server.updateEnvironment(next);
    }
  }

  updateDisabledRoutes(uuid: string, disabledRoutes: string[]): void {
    this.entries.get(uuid)?.server.updateDisabledRoutes(disabledRoutes);
  }

  /** Start every environment that was running at the last shutdown. One failure does not stop the others. */
  restoreOnStart(): string[] {
    const settings = this.settings.get();
    if (!settings.restoreRunningOnStart) {
      return [];
    }
    const started: string[] = [];
    for (const descriptor of settings.environments) {
      if (!descriptor.wasRunning || !this.store.has(descriptor.uuid)) {
        continue;
      }
      try {
        started.push(this.start(descriptor.uuid).name);
      } catch (error) {
        const code = error instanceof ApiError ? error.code : 'UNKNOWN_SERVER_ERROR';
        this.lastErrors.set(descriptor.uuid, { code, message: errorMessage(error) });
        this.logger.warn(
          `Environment ${descriptor.path} could not be restarted: ${errorMessage(error)}`,
        );
      }
    }

    return started;
  }

  /** Stop all mock servers without touching wasRunning. */
  async stopAll(): Promise<void> {
    this.shuttingDown = true;
    await Promise.all([...this.entries.keys()].map((uuid) => this.stop(uuid)));
  }
}
