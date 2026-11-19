export type EnvironmentDescriptor = {
  uuid: string;
  /** Absolute path of the environment file. */
  path: string;
  /** Whether the environment was running when the server last shut down. */
  wasRunning: boolean;
};

export type Settings = {
  version: 1;
  /** Order = order in the sidebar. */
  environments: EnvironmentDescriptor[];
  /** Environment uuid → uuids of disabled routes. */
  disabledRoutes: Record<string, string[]>;
  /** Environment uuid → uuids of collapsed folders. */
  collapsedFolders: Record<string, string[]>;
  maxLogsPerEnvironment: number;
  restoreRunningOnStart: boolean;
  enableRandomLatency: boolean;
  logBodyLimitBytes: number;
};

export type AppSettings = Omit<Settings, 'environments' | 'disabledRoutes' | 'collapsedFolders'>;

export type AppSettingsPatch = Partial<
  Pick<
    Settings,
    'maxLogsPerEnvironment' | 'restoreRunningOnStart' | 'enableRandomLatency' | 'logBodyLimitBytes'
  >
>;

export type NumberLimit = { min: number; max: number; default: number };
export type SettingsLimits = {
  maxLogsPerEnvironment: NumberLimit;
  logBodyLimitBytes: NumberLimit;
};
