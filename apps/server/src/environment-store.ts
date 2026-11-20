import fs from 'node:fs/promises';
import path from 'node:path';
import { BuildEnvironment, CloneObject, generateUUID, type Environment } from '@mockoon/commons';
import type {
  EnvironmentDetail,
  EnvironmentSummary,
  UiStatePatch,
  UpdateEnvironmentResponse,
} from '@stubhouse/shared';
import { environmentsDir, type Config } from './config.js';
import { loadEnvironmentFromText, validateClientEnvironment } from './environment-loader.js';
import { ApiError, errorMessage, notFound } from './errors.js';
import type { EventBus } from './event-bus.js';
import { isENOENT, isInsideDirectory, sha256, slugify, writeFileAtomic } from './fs-utils.js';
import type { Logger } from './logger.js';
import type { RuntimeManager } from './runtime-manager.js';
import type { SettingsStore } from './settings-store.js';

export type LoadedEnvironment = {
  uuid: string;
  path: string;
  /** null when the file could not be loaded at all. */
  environment: Environment | null;
  /** Starts at 1, +1 for every accepted change. */
  revision: number;
  /** sha256 of the text last written or read. */
  lastWrittenHash: string;
  fileError: string | null;
};

const FIRST_MOCK_PORT = 3001;

const serialize = (environment: Environment): string => JSON.stringify(environment, null, 2) + '\n';

const unique = (items: string[]): string[] => [...new Set(items)];

export class EnvironmentStore {
  private readonly loaded = new Map<string, LoadedEnvironment>();
  private readonly saveChains = new Map<string, Promise<void>>();
  private readonly pendingSaves = new Map<string, number>();
  private runtime!: RuntimeManager;
  /** Called whenever the set of watched files may have changed. */
  onPathsChanged: () => void = () => {};

  constructor(
    private readonly config: Config,
    private readonly settings: SettingsStore,
    private readonly bus: EventBus,
    private readonly logger: Logger,
  ) {}

  attachRuntime(runtime: RuntimeManager): void {
    this.runtime = runtime;
  }

  // ---------------------------------------------------------------------------------------------
  // Reading
  // ---------------------------------------------------------------------------------------------

  async init(): Promise<void> {
    await fs.mkdir(environmentsDir(this.config), { recursive: true });

    for (const descriptor of this.settings.get().environments) {
      const loaded: LoadedEnvironment = {
        uuid: descriptor.uuid,
        path: descriptor.path,
        environment: null,
        revision: 1,
        lastWrittenHash: '',
        fileError: null,
      };
      this.loaded.set(descriptor.uuid, loaded);
      await this.readFromDisk(loaded, true);
    }
    this.onPathsChanged();
  }

  /**
   * (Re)read an environment file. Returns true when the in-memory environment changed.
   * Failures keep the last valid version and set fileError.
   */
  private async readFromDisk(loaded: LoadedEnvironment, force: boolean): Promise<boolean> {
    const revisionBefore = loaded.revision;
    let text: string;
    try {
      text = await fs.readFile(loaded.path, 'utf8');
      if (!force && (loaded.revision !== revisionBefore || this.hasPendingSave(loaded.uuid))) {
        // the environment was updated while the file was being read: what was read is stale,
        // and our own write replaces it anyway
        return false;
      }
    } catch (error) {
      loaded.fileError = isENOENT(error)
        ? 'File no longer exists'
        : `File could not be read: ${errorMessage(error)}`;
      loaded.lastWrittenHash = '';

      return false;
    }

    const hash = sha256(text);
    if (!force && hash === loaded.lastWrittenHash && loaded.fileError === null) {
      return false;
    }

    try {
      const result = loadEnvironmentFromText(text);
      let mustSave = result.migrated;
      if (result.environment.uuid !== loaded.uuid) {
        // keep the uuid the rest of the application knows this file by
        result.environment.uuid = loaded.uuid;
        mustSave = true;
      }
      loaded.environment = result.environment;
      loaded.fileError = null;
      loaded.lastWrittenHash = hash;
      this.applyMigrationUiState(
        loaded.uuid,
        result.disabledRoutesFromMigration,
        result.collapsedFoldersFromMigration,
      );
      if (mustSave) {
        await this.scheduleSave(loaded);
      }

      return true;
    } catch (error) {
      loaded.fileError = errorMessage(error);
      loaded.lastWrittenHash = hash;

      return false;
    }
  }

  private applyMigrationUiState(uuid: string, disabledRoutes: string[], collapsed: string[]) {
    if (disabledRoutes.length === 0 && collapsed.length === 0) {
      return;
    }
    this.settings.update((settings) => {
      if (disabledRoutes.length > 0) {
        settings.disabledRoutes[uuid] = unique([
          ...(settings.disabledRoutes[uuid] ?? []),
          ...disabledRoutes,
        ]);
      }
      if (collapsed.length > 0) {
        settings.collapsedFolders[uuid] = unique([
          ...(settings.collapsedFolders[uuid] ?? []),
          ...collapsed,
        ]);
      }
    });
  }

  has(uuid: string): boolean {
    return this.loaded.has(uuid);
  }

  get(uuid: string): LoadedEnvironment {
    const loaded = this.loaded.get(uuid);
    if (!loaded) {
      throw notFound(uuid);
    }

    return loaded;
  }

  /** All loaded environments in sidebar order. */
  all(): LoadedEnvironment[] {
    return this.settings
      .get()
      .environments.flatMap((descriptor) => this.loaded.get(descriptor.uuid) ?? []);
  }

  isManaged(filePath: string): boolean {
    return isInsideDirectory(environmentsDir(this.config), filePath);
  }

  summary(uuid: string): EnvironmentSummary {
    const loaded = this.get(uuid);
    const environment = loaded.environment;

    return {
      uuid: loaded.uuid,
      name: environment?.name ?? path.basename(loaded.path),
      port: environment?.port ?? 0,
      hostname: environment?.hostname ?? '',
      endpointPrefix: environment?.endpointPrefix ?? '',
      tlsEnabled: environment?.tlsOptions?.enabled === true,
      path: loaded.path,
      managed: this.isManaged(loaded.path),
      revision: loaded.revision,
      status: this.runtime.status(uuid),
      lastError: this.runtime.lastError(uuid),
      fileError: loaded.fileError,
      hasData: environment !== null,
      routeCount: environment?.routes.length ?? 0,
    };
  }

  summaries(): EnvironmentSummary[] {
    return this.all().map((loaded) => this.summary(loaded.uuid));
  }

  /** Detail for the editor. Retries reading the file when nothing could be loaded so far. */
  async detail(uuid: string): Promise<EnvironmentDetail> {
    const loaded = this.get(uuid);
    if (!loaded.environment) {
      const changed = await this.readFromDisk(loaded, true);
      if (changed) {
        loaded.revision += 1;
        this.emitStatus(uuid);
      }
    }
    if (!loaded.environment) {
      throw new ApiError(
        422,
        'INVALID_ENVIRONMENT',
        loaded.fileError ?? 'Environment could not be loaded',
      );
    }
    const settings = this.settings.get();

    return {
      summary: this.summary(uuid),
      environment: loaded.environment,
      disabledRoutes: settings.disabledRoutes[uuid] ?? [],
      collapsedFolders: settings.collapsedFolders[uuid] ?? [],
    };
  }

  exportText(uuid: string): { filename: string; text: string } {
    const environment = this.requireData(uuid);

    return {
      filename: `${slugify(environment.name)}.json`,
      text: JSON.stringify(environment, null, 2),
    };
  }

  private requireData(uuid: string): Environment {
    const loaded = this.get(uuid);
    if (!loaded.environment) {
      throw new ApiError(
        422,
        'INVALID_ENVIRONMENT',
        loaded.fileError ?? 'Environment could not be loaded',
      );
    }

    return loaded.environment;
  }

  /** First port from 3001 not used by a loaded environment nor by the UI. */
  nextFreePort(): number {
    const used = new Set<number>([this.config.port]);
    for (const loaded of this.loaded.values()) {
      if (loaded.environment) {
        used.add(loaded.environment.port);
      }
    }
    let port = FIRST_MOCK_PORT;
    while (used.has(port) && port < 65535) {
      port += 1;
    }

    return port;
  }

  // ---------------------------------------------------------------------------------------------
  // Saving
  // ---------------------------------------------------------------------------------------------

  hasPendingSave(uuid: string): boolean {
    return (this.pendingSaves.get(uuid) ?? 0) > 0;
  }

  /**
   * Atomic save. Saves of the same environment run one after another, never in parallel.
   * Never rejects: a failed save is logged and surfaced as fileError.
   */
  private scheduleSave(loaded: LoadedEnvironment): Promise<void> {
    const { uuid } = loaded;
    this.pendingSaves.set(uuid, (this.pendingSaves.get(uuid) ?? 0) + 1);

    const run = async () => {
      // serialise at write time so queued saves always write the latest state
      const current = this.loaded.get(uuid);
      try {
        if (current?.environment) {
          const text = serialize(current.environment);
          current.lastWrittenHash = sha256(text);
          await writeFileAtomic(current.path, text);
          if (current.fileError !== null) {
            current.fileError = null;
            this.emitStatus(uuid);
          }
        }
      } catch (error) {
        this.logger.error(`Could not save ${loaded.path}`, error);
        if (current) {
          current.fileError = `File could not be written: ${errorMessage(error)}`;
          this.emitStatus(uuid);
        }
      } finally {
        const pending = (this.pendingSaves.get(uuid) ?? 1) - 1;
        if (pending > 0) {
          this.pendingSaves.set(uuid, pending);
        } else {
          this.pendingSaves.delete(uuid);
        }
      }
    };

    const chain = (this.saveChains.get(uuid) ?? Promise.resolve()).then(run);
    this.saveChains.set(uuid, chain);
    void chain.then(() => {
      if (this.saveChains.get(uuid) === chain) {
        this.saveChains.delete(uuid);
      }
    });

    return chain;
  }

  /** Wait for all saves in progress. */
  async flush(): Promise<void> {
    await Promise.all([...this.saveChains.values()]);
  }

  private async newManagedPath(name: string, uuid: string): Promise<string> {
    const directory = environmentsDir(this.config);
    await fs.mkdir(directory, { recursive: true });
    const base = `${slugify(name)}-${uuid.slice(0, 8)}`;
    const taken = new Set([...this.loaded.values()].map((loaded) => loaded.path));
    for (let index = 0; ; index += 1) {
      const candidate = path.join(directory, `${base}${index === 0 ? '' : `-${index}`}.json`);
      if (taken.has(candidate)) {
        continue;
      }
      try {
        await fs.access(candidate);
      } catch {
        return candidate;
      }
    }
  }

  // ---------------------------------------------------------------------------------------------
  // List operations
  // ---------------------------------------------------------------------------------------------

  private async register(
    environment: Environment,
    filePath: string,
    options: { save: boolean; hash?: string; disabledRoutes?: string[]; collapsed?: string[] },
  ): Promise<EnvironmentDetail> {
    const loaded: LoadedEnvironment = {
      uuid: environment.uuid,
      path: filePath,
      environment,
      revision: 1,
      lastWrittenHash: options.hash ?? '',
      fileError: null,
    };
    this.loaded.set(loaded.uuid, loaded);
    this.settings.update((settings) => {
      settings.environments.push({ uuid: loaded.uuid, path: filePath, wasRunning: false });
    });
    this.applyMigrationUiState(loaded.uuid, options.disabledRoutes ?? [], options.collapsed ?? []);
    if (options.save) {
      await this.scheduleSave(loaded);
    }
    this.onPathsChanged();
    this.bus.emit({ type: 'environment-added', summary: this.summary(loaded.uuid) });

    return this.detail(loaded.uuid);
  }

  async create(params: { name?: string; port?: number }): Promise<EnvironmentDetail> {
    const environment = BuildEnvironment({
      hasDefaultRoute: true,
      hasContentTypeHeader: true,
      hasCorsHeaders: true,
      port: params.port ?? this.nextFreePort(),
    });
    if (params.name?.trim()) {
      environment.name = params.name.trim();
    }
    const filePath = await this.newManagedPath(environment.name, environment.uuid);

    return this.register(environment, filePath, { save: true });
  }

  async openFromPath(filePath: string): Promise<EnvironmentDetail> {
    if (!path.isAbsolute(filePath) || !filePath.toLowerCase().endsWith('.json')) {
      throw new ApiError(400, 'BAD_REQUEST', 'Path must be absolute and end with .json');
    }
    const absPath = path.normalize(filePath);
    if ([...this.loaded.values()].some((loaded) => loaded.path === absPath)) {
      throw new ApiError(409, 'ALREADY_OPEN', 'This file is already in the list');
    }

    let text: string;
    try {
      text = await fs.readFile(absPath, 'utf8');
    } catch (error) {
      if (isENOENT(error)) {
        throw new ApiError(404, 'FILE_NOT_FOUND', `File not found: ${absPath}`);
      }
      throw new ApiError(400, 'BAD_REQUEST', `File could not be read: ${errorMessage(error)}`);
    }

    const result = loadEnvironmentFromText(text);
    let save = result.migrated;
    if (this.loaded.has(result.environment.uuid)) {
      result.environment.uuid = generateUUID();
      save = true;
    }

    return this.register(result.environment, absPath, {
      save,
      hash: sha256(text),
      disabledRoutes: result.disabledRoutesFromMigration,
      collapsed: result.collapsedFoldersFromMigration,
    });
  }

  async importFromText(_filename: string, text: string): Promise<EnvironmentDetail> {
    const result = loadEnvironmentFromText(text);
    if (this.loaded.has(result.environment.uuid)) {
      result.environment.uuid = generateUUID();
    }
    const filePath = await this.newManagedPath(result.environment.name, result.environment.uuid);

    return this.register(result.environment, filePath, {
      save: true,
      disabledRoutes: result.disabledRoutesFromMigration,
      collapsed: result.collapsedFoldersFromMigration,
    });
  }

  async duplicate(uuid: string): Promise<EnvironmentDetail> {
    const source = this.requireData(uuid);
    // route and response uuids stay the same: they only need to be unique within an environment
    const copy = CloneObject(source);
    copy.uuid = generateUUID();
    copy.name = `${source.name} (copy)`;
    copy.port = this.nextFreePort();
    const filePath = await this.newManagedPath(copy.name, copy.uuid);
    const settings = this.settings.get();

    return this.register(copy, filePath, {
      save: true,
      disabledRoutes: settings.disabledRoutes[uuid] ?? [],
      collapsed: settings.collapsedFolders[uuid] ?? [],
    });
  }

  async close(uuid: string, options: { deleteFile: boolean }): Promise<void> {
    const loaded = this.get(uuid);
    await this.runtime.stop(uuid);
    this.runtime.forget(uuid);
    await this.saveChains.get(uuid);

    this.loaded.delete(uuid);
    this.settings.update((settings) => {
      settings.environments = settings.environments.filter((item) => item.uuid !== uuid);
      delete settings.disabledRoutes[uuid];
      delete settings.collapsedFolders[uuid];
    });
    this.onPathsChanged();

    // only files Stubhouse created itself may be deleted
    if (options.deleteFile && this.isManaged(loaded.path)) {
      await fs.rm(loaded.path, { force: true });
    }
    this.bus.emit({ type: 'environment-removed', uuid });
  }

  reorder(uuids: string[]): void {
    const current = this.settings.get().environments;
    const byUuid = new Map(current.map((descriptor) => [descriptor.uuid, descriptor]));
    if (
      uuids.length !== current.length ||
      new Set(uuids).size !== uuids.length ||
      uuids.some((uuid) => !byUuid.has(uuid))
    ) {
      throw new ApiError(
        400,
        'BAD_REQUEST',
        'uuids must be a permutation of the open environments',
      );
    }
    this.settings.update((settings) => {
      settings.environments = uuids.map((uuid) => byUuid.get(uuid)!);
    });
    this.bus.emit({ type: 'environments-reordered', uuids });
  }

  // ---------------------------------------------------------------------------------------------
  // Changes
  // ---------------------------------------------------------------------------------------------

  async update(
    uuid: string,
    rawEnvironment: unknown,
    baseRevision: number,
    origin: string | null,
  ): Promise<UpdateEnvironmentResponse> {
    const loaded = this.get(uuid);
    if (baseRevision !== loaded.revision) {
      throw new ApiError(409, 'REVISION_CONFLICT', 'This environment was changed elsewhere', {
        revision: loaded.revision,
      });
    }
    if ((rawEnvironment as { uuid?: unknown } | null)?.uuid !== uuid) {
      throw new ApiError(400, 'BAD_REQUEST', 'environment.uuid must match the uuid in the URL');
    }
    const { environment, fixed } = validateClientEnvironment(rawEnvironment);

    const previous = loaded.environment;
    if (
      previous &&
      this.runtime.isActive(uuid) &&
      (previous.port !== environment.port || previous.hostname !== environment.hostname)
    ) {
      const conflict = this.runtime.portConflict(uuid, environment.port);
      if (conflict) {
        throw new ApiError(409, 'PORT_IN_USE', conflict);
      }
    }

    loaded.environment = environment;
    loaded.revision += 1;
    const revision = loaded.revision;
    const saved = this.scheduleSave(loaded);

    if (previous) {
      this.runtime.applyEnvironmentChange(uuid, previous, environment);
    }
    this.pruneUiState(uuid, environment);
    this.bus.emit({ type: 'environment-updated', uuid, revision, origin });
    if (
      !previous ||
      previous.name !== environment.name ||
      previous.port !== environment.port ||
      previous.hostname !== environment.hostname ||
      previous.endpointPrefix !== environment.endpointPrefix ||
      previous.tlsOptions?.enabled !== environment.tlsOptions?.enabled ||
      previous.routes.length !== environment.routes.length
    ) {
      this.emitStatus(uuid);
    }
    await saved;

    return fixed ? { revision, environment } : { revision };
  }

  /** Forget ui state of routes and folders that no longer exist. */
  private pruneUiState(uuid: string, environment: Environment): void {
    const settings = this.settings.get();
    const routes = new Set(environment.routes.map((route) => route.uuid));
    const folders = new Set(environment.folders.map((folder) => folder.uuid));
    const disabled = settings.disabledRoutes[uuid] ?? [];
    const collapsed = settings.collapsedFolders[uuid] ?? [];
    const nextDisabled = disabled.filter((item) => routes.has(item));
    const nextCollapsed = collapsed.filter((item) => folders.has(item));
    if (nextDisabled.length !== disabled.length || nextCollapsed.length !== collapsed.length) {
      this.settings.update((draft) => {
        draft.disabledRoutes[uuid] = nextDisabled;
        draft.collapsedFolders[uuid] = nextCollapsed;
      });
      this.runtime.updateDisabledRoutes(uuid, nextDisabled);
    }
  }

  setUiState(uuid: string, patch: UiStatePatch): void {
    const environment = this.requireData(uuid);
    const routes = new Set(environment.routes.map((route) => route.uuid));
    const folders = new Set(environment.folders.map((folder) => folder.uuid));
    let disabledChanged = false;

    this.settings.update((settings) => {
      if (patch.disabledRoutes) {
        // silently drop uuids that do not exist in the environment
        settings.disabledRoutes[uuid] = unique(patch.disabledRoutes).filter((item) =>
          routes.has(item),
        );
        disabledChanged = true;
      }
      if (patch.collapsedFolders) {
        settings.collapsedFolders[uuid] = unique(patch.collapsedFolders).filter((item) =>
          folders.has(item),
        );
      }
    });

    const settings = this.settings.get();
    const disabledRoutes = settings.disabledRoutes[uuid] ?? [];
    if (disabledChanged) {
      this.runtime.updateDisabledRoutes(uuid, disabledRoutes);
    }
    this.bus.emit({
      type: 'ui-state-updated',
      uuid,
      disabledRoutes,
      collapsedFolders: settings.collapsedFolders[uuid] ?? [],
    });
  }

  /** Called by the file watcher when the file of an environment may have changed on disk. */
  async handleExternalChange(uuid: string): Promise<void> {
    const loaded = this.loaded.get(uuid);
    // our own write is in progress and will overwrite whatever is there
    if (!loaded || this.hasPendingSave(uuid)) {
      return;
    }
    const previous = loaded.environment;
    const previousError = loaded.fileError;
    const changed = await this.readFromDisk(loaded, false);
    if (this.loaded.get(uuid) !== loaded) {
      return;
    }

    if (changed && loaded.environment) {
      loaded.revision += 1;
      this.logger.info(`Environment file changed on disk: ${loaded.path}`);
      if (previous) {
        this.runtime.applyEnvironmentChange(uuid, previous, loaded.environment);
      }
      this.pruneUiState(uuid, loaded.environment);
      this.bus.emit({
        type: 'environment-updated',
        uuid,
        revision: loaded.revision,
        origin: null,
      });
      this.emitStatus(uuid);
    } else if (loaded.fileError !== previousError) {
      if (loaded.fileError) {
        this.logger.warn(`Environment file ${loaded.path}: ${loaded.fileError}`);
      }
      this.emitStatus(uuid);
    }
  }

  emitStatus(uuid: string): void {
    if (this.loaded.has(uuid)) {
      this.bus.emit({ type: 'environment-status', summary: this.summary(uuid) });
    }
  }
}
