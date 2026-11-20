import type { Transaction } from '@mockoon/commons';
import type { LogEntry } from '@mockpit/shared';
import type { EventBus } from './event-bus.js';
import type { SettingsStore } from './settings-store.js';

const truncate = (body: unknown, limitBytes: number): { body: any; truncated: boolean } => {
  if (typeof body !== 'string' || Buffer.byteLength(body, 'utf8') <= limitBytes) {
    return { body, truncated: false };
  }

  return {
    body: Buffer.from(body, 'utf8').subarray(0, limitBytes).toString('utf8'),
    truncated: true,
  };
};

/** Ring buffer of request logs per environment, newest first. Lost when Mockpit shuts down. */
export class LogStore {
  private readonly logs = new Map<string, LogEntry[]>();

  constructor(
    private readonly settings: SettingsStore,
    private readonly bus: EventBus,
  ) {}

  add(uuid: string, transaction: Transaction): LogEntry {
    const { logBodyLimitBytes, maxLogsPerEnvironment } = this.settings.get();
    const requestBody = truncate(transaction.request.body, logBodyLimitBytes);
    const responseBody = truncate(transaction.response.body, logBodyLimitBytes);
    const entry: LogEntry = {
      ...transaction,
      request: { ...transaction.request, body: requestBody.body },
      response: { ...transaction.response, body: responseBody.body },
      environmentUuid: uuid,
      requestBodyTruncated: requestBody.truncated,
      responseBodyTruncated: responseBody.truncated,
    };

    const list = this.logs.get(uuid) ?? [];
    list.unshift(entry);
    if (list.length > maxLogsPerEnvironment) {
      list.length = maxLogsPerEnvironment;
    }
    this.logs.set(uuid, list);
    this.bus.emit({ type: 'log', entry });

    return entry;
  }

  list(uuid: string): LogEntry[] {
    return this.logs.get(uuid) ?? [];
  }

  clear(uuid: string): void {
    this.logs.delete(uuid);
    this.bus.emit({ type: 'logs-cleared', uuid });
  }

  /** Forget an environment without notifying clients (it is being removed). */
  drop(uuid: string): void {
    this.logs.delete(uuid);
  }
}
