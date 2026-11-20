import type { Environment, Transaction } from '@mockoon/commons';
import type { AppSettings, SettingsLimits } from './settings.js';

export type RuntimeStatus = 'stopped' | 'starting' | 'running' | 'stopping';

export type EnvironmentSummary = {
  uuid: string;
  name: string;
  port: number;
  hostname: string;
  endpointPrefix: string;
  tlsEnabled: boolean;
  path: string;
  /** True when the file lives in the data directory managed by Mockpit (can be deleted on close). */
  managed: boolean;
  revision: number;
  status: RuntimeStatus;
  /** Last start error. */
  lastError: { code: string; message: string } | null;
  /** The file on disk is currently missing or not a valid environment. */
  fileError: string | null;
  /** False when the file could not be loaded at all (nothing to show or run). */
  hasData: boolean;
  routeCount: number;
};

export type EnvironmentDetail = {
  summary: EnvironmentSummary;
  environment: Environment;
  disabledRoutes: string[];
  collapsedFolders: string[];
};

export type AppState = {
  settings: AppSettings;
  limits: SettingsLimits;
  environments: EnvironmentSummary[];
  authRequired: boolean;
  appVersion: string;
  engineVersion: string;
  /** Absolute path of the data directory on the server. */
  dataDir: string;
  /** Port of the UI/API server (mock environments cannot use it). */
  uiPort: number;
  /** Suggested port for a new environment. */
  nextFreePort: number;
};

export type AuthStatus = { authRequired: boolean; authenticated: boolean };

export type LogEntry = Transaction & {
  environmentUuid: string;
  requestBodyTruncated: boolean;
  responseBodyTruncated: boolean;
};

export type UpdateEnvironmentRequest = { environment: Environment; baseRevision: number };
export type UpdateEnvironmentResponse = { revision: number; environment?: Environment };
export type UiStatePatch = { disabledRoutes?: string[]; collapsedFolders?: string[] };

export type ApiErrorBody = { error: { code: string; message: string; details?: unknown } };
