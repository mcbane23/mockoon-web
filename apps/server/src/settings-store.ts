import fs from 'node:fs/promises';
import path from 'node:path';
import type { AppSettings, Settings, SettingsLimits } from '@mockpit/shared';
import { isENOENT, writeFileAtomic } from './fs-utils.js';
import type { Logger } from './logger.js';

export const SETTINGS_LIMITS: SettingsLimits = {
  maxLogsPerEnvironment: { min: 10, max: 1000, default: 100 },
  logBodyLimitBytes: { min: 1024, max: 52_428_800, default: 524_288 },
};

export const defaultSettings = (): Settings => ({
  version: 1,
  environments: [],
  disabledRoutes: {},
  collapsedFolders: {},
  maxLogsPerEnvironment: SETTINGS_LIMITS.maxLogsPerEnvironment.default,
  restoreRunningOnStart: true,
  enableRandomLatency: false,
  logBodyLimitBytes: SETTINGS_LIMITS.logBodyLimitBytes.default,
});

const SAVE_DEBOUNCE_MS = 200;

const clampInt = (value: unknown, limit: { min: number; max: number; default: number }) =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(limit.max, Math.max(limit.min, Math.round(value)))
    : limit.default;

const stringArrayRecord = (value: unknown): Record<string, string[]> => {
  const result: Record<string, string[]> = {};
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    for (const [key, list] of Object.entries(value)) {
      if (Array.isArray(list)) {
        result[key] = list.filter((item): item is string => typeof item === 'string');
      }
    }
  }

  return result;
};

/** Tolerant normalisation of whatever is in settings.json. */
export function normalizeSettings(raw: unknown): Settings {
  const defaults = defaultSettings();
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return defaults;
  }
  const input = raw as Record<string, unknown>;
  const seen = new Set<string>();
  const environments = (Array.isArray(input.environments) ? input.environments : []).flatMap(
    (item: any) => {
      if (
        !item ||
        typeof item.uuid !== 'string' ||
        typeof item.path !== 'string' ||
        seen.has(item.uuid)
      ) {
        return [];
      }
      seen.add(item.uuid);

      return [{ uuid: item.uuid, path: item.path, wasRunning: item.wasRunning === true }];
    },
  );

  const keepKnown = (record: Record<string, string[]>) =>
    Object.fromEntries(Object.entries(record).filter(([uuid]) => seen.has(uuid)));

  return {
    version: 1,
    environments,
    // drop keys of environments that are no longer in the list
    disabledRoutes: keepKnown(stringArrayRecord(input.disabledRoutes)),
    collapsedFolders: keepKnown(stringArrayRecord(input.collapsedFolders)),
    maxLogsPerEnvironment: clampInt(
      input.maxLogsPerEnvironment,
      SETTINGS_LIMITS.maxLogsPerEnvironment,
    ),
    restoreRunningOnStart:
      typeof input.restoreRunningOnStart === 'boolean'
        ? input.restoreRunningOnStart
        : defaults.restoreRunningOnStart,
    enableRandomLatency:
      typeof input.enableRandomLatency === 'boolean'
        ? input.enableRandomLatency
        : defaults.enableRandomLatency,
    logBodyLimitBytes: clampInt(input.logBodyLimitBytes, SETTINGS_LIMITS.logBodyLimitBytes),
  };
}

export class SettingsStore {
  private settings: Settings = defaultSettings();
  private timer: NodeJS.Timeout | null = null;
  private dirty = false;
  private writing: Promise<void> = Promise.resolve();
  readonly filePath: string;

  constructor(
    dataDir: string,
    private readonly logger: Logger,
  ) {
    this.filePath = path.join(dataDir, 'settings.json');
  }

  async load(): Promise<void> {
    let text: string;
    try {
      text = await fs.readFile(this.filePath, 'utf8');
    } catch (error) {
      if (!isENOENT(error)) {
        throw error;
      }
      this.settings = defaultSettings();
      await this.writeNow();

      return;
    }

    try {
      this.settings = normalizeSettings(JSON.parse(text));
    } catch {
      const brokenPath = `${this.filePath}.broken-${Date.now()}`;
      await fs.rename(this.filePath, brokenPath);
      this.logger.warn(
        `settings.json could not be parsed. It was renamed to ${brokenPath} and a new one was created.`,
      );
      this.settings = defaultSettings();
      await this.writeNow();
    }
  }

  get(): Settings {
    return this.settings;
  }

  appSettings(): AppSettings {
    const { maxLogsPerEnvironment, restoreRunningOnStart, enableRandomLatency, logBodyLimitBytes } =
      this.settings;

    return {
      version: 1,
      maxLogsPerEnvironment,
      restoreRunningOnStart,
      enableRandomLatency,
      logBodyLimitBytes,
    };
  }

  /** Mutate the settings object in place and schedule a save. */
  update(mutator: (settings: Settings) => void): void {
    mutator(this.settings);
    this.dirty = true;
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, SAVE_DEBOUNCE_MS);
    this.timer.unref();
  }

  /** Save immediately (if anything changed) and wait for pending writes. */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.dirty) {
      this.dirty = false;
      await this.writeNow();
    } else {
      await this.writing;
    }
  }

  private writeNow(): Promise<void> {
    const text = JSON.stringify(this.settings, null, 2) + '\n';
    this.writing = this.writing
      .then(() => writeFileAtomic(this.filePath, text))
      .catch((error) => this.logger.error('Could not save settings.json', error));

    return this.writing;
  }
}
