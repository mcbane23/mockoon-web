import type { EnvironmentSummary, LogEntry } from './api.js';

export type ServerEvent =
  | { type: 'hello'; serverInstanceId: string }
  | { type: 'environment-status'; summary: EnvironmentSummary }
  /** origin = clientId, or null for an external file change. */
  | { type: 'environment-updated'; uuid: string; revision: number; origin: string | null }
  | { type: 'environment-added'; summary: EnvironmentSummary }
  | { type: 'environment-removed'; uuid: string }
  | { type: 'environments-reordered'; uuids: string[] }
  | {
      type: 'ui-state-updated';
      uuid: string;
      disabledRoutes: string[];
      collapsedFolders: string[];
    }
  | { type: 'settings-updated' }
  | { type: 'log'; entry: LogEntry }
  | { type: 'logs-cleared'; uuid: string }
  | { type: 'runtime-error'; uuid: string; code: string; message: string; routeUuid?: string };
