import fs, { type FSWatcher } from 'node:fs';
import path from 'node:path';
import type { EnvironmentStore } from './environment-store.js';
import type { Logger } from './logger.js';

const DEBOUNCE_MS = 300;

/**
 * Watches the *directory* of every loaded environment file (a directory watch survives the atomic
 * replace of the file). fs.watch may emit duplicate or spurious events; the store compares hashes,
 * which makes them harmless.
 */
export class FileWatcher {
  private readonly watchers = new Map<string, FSWatcher>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private closed = false;

  constructor(
    private readonly store: EnvironmentStore,
    private readonly logger: Logger,
  ) {}

  /** Reconcile directory watchers with the list of loaded environments. */
  sync(): void {
    if (this.closed) {
      return;
    }
    const wanted = new Set(this.store.all().map((loaded) => path.dirname(loaded.path)));

    for (const [directory, watcher] of this.watchers) {
      if (!wanted.has(directory)) {
        watcher.close();
        this.watchers.delete(directory);
      }
    }
    for (const directory of wanted) {
      if (this.watchers.has(directory)) {
        continue;
      }
      try {
        const watcher = fs.watch(directory, (_event, filename) =>
          this.onEvent(directory, filename === null ? null : String(filename)),
        );
        watcher.on('error', (error) => {
          this.logger.warn(`Stopped watching ${directory}: ${error.message}`);
          watcher.close();
          this.watchers.delete(directory);
        });
        this.watchers.set(directory, watcher);
      } catch (error) {
        this.logger.warn(
          `Cannot watch ${directory} for changes: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  private onEvent(directory: string, filename: string | null): void {
    for (const loaded of this.store.all()) {
      if (
        path.dirname(loaded.path) !== directory ||
        (filename !== null && path.basename(loaded.path) !== filename)
      ) {
        continue;
      }
      const existing = this.timers.get(loaded.uuid);
      if (existing) {
        clearTimeout(existing);
      }
      const { uuid } = loaded;
      this.timers.set(
        uuid,
        setTimeout(() => {
          this.timers.delete(uuid);
          this.store
            .handleExternalChange(uuid)
            .catch((error) => this.logger.error('File watcher failed', error));
        }, DEBOUNCE_MS),
      );
    }
  }

  close(): void {
    this.closed = true;
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }
}
