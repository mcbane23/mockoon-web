import '../polyfills';
import type { Environment } from '@mockoon/commons';
import type {
  ApiErrorBody,
  AppSettings,
  AppSettingsPatch,
  AppState,
  AuthStatus,
  EnvironmentDetail,
  EnvironmentSummary,
  LogEntry,
  UiStatePatch,
  UpdateEnvironmentResponse,
} from '@maketa/shared';

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

/** Random id per browser tab; the server echoes it as "origin" in SSE events. */
export const clientId: string = crypto.randomUUID();

let onUnauthorized: () => void = () => {};

export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

export async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'X-Client-Id': clientId };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(`/api${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    let payload: ApiErrorBody | null = null;
    try {
      payload = (await response.json()) as ApiErrorBody;
    } catch {
      // not a JSON error body
    }
    const error = new ApiClientError(
      response.status,
      payload?.error?.code ?? 'HTTP_ERROR',
      payload?.error?.message ?? `Request failed (${response.status})`,
      payload?.error?.details,
    );
    if (response.status === 401 && !path.startsWith('/auth/')) {
      onUnauthorized();
    }
    throw error;
  }
  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

const env = (uuid: string) => `/environments/${encodeURIComponent(uuid)}`;

export const api = {
  authStatus: () => request<AuthStatus>('GET', '/auth/status'),
  login: (password: string) => request<void>('POST', '/auth/login', { password }),
  logout: () => request<void>('POST', '/auth/logout'),
  state: () => request<AppState>('GET', '/state'),
  updateSettings: (patch: AppSettingsPatch) => request<AppSettings>('PUT', '/settings', patch),

  createEnvironment: (body: { name?: string; port?: number }) =>
    request<EnvironmentDetail>('POST', '/environments', body),
  openEnvironment: (path: string) =>
    request<EnvironmentDetail>('POST', '/environments/open', { path }),
  importEnvironment: (filename: string, content: string) =>
    request<EnvironmentDetail>('POST', '/environments/import', { filename, content }),
  reorderEnvironments: (uuids: string[]) => request<void>('PUT', '/environments/order', { uuids }),
  getEnvironment: (uuid: string) => request<EnvironmentDetail>('GET', env(uuid)),
  putEnvironment: (uuid: string, environment: Environment, baseRevision: number) =>
    request<UpdateEnvironmentResponse>('PUT', env(uuid), { environment, baseRevision }),
  closeEnvironment: (uuid: string, deleteFile: boolean) =>
    request<void>('DELETE', `${env(uuid)}?deleteFile=${deleteFile ? 'true' : 'false'}`),
  duplicateEnvironment: (uuid: string) =>
    request<EnvironmentDetail>('POST', `${env(uuid)}/duplicate`),
  exportUrl: (uuid: string) => `/api${env(uuid)}/export`,
  putUiState: (uuid: string, patch: UiStatePatch) =>
    request<void>('PUT', `${env(uuid)}/ui-state`, patch),

  start: (uuid: string) => request<EnvironmentSummary>('POST', `${env(uuid)}/start`),
  stop: (uuid: string) => request<EnvironmentSummary>('POST', `${env(uuid)}/stop`),
  restart: (uuid: string) => request<EnvironmentSummary>('POST', `${env(uuid)}/restart`),

  logs: (uuid: string) => request<LogEntry[]>('GET', `${env(uuid)}/logs`),
  clearLogs: (uuid: string) => request<void>('DELETE', `${env(uuid)}/logs`),
};

export const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
