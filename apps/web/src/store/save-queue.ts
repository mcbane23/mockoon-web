import type { Environment } from '@mockoon/commons';
import type { UpdateEnvironmentResponse } from '@maketa/shared';
import { ApiClientError } from '../api/client';

export type SaveState = 'saved' | 'dirty' | 'saving' | 'conflict' | 'error';

export type SaveSnapshot = {
  uuid: string | null;
  environment: Environment | null;
  serverRevision: number;
  /** Counter of local changes. */
  version: number;
};

export type SaveQueueHost = {
  getSnapshot: () => SaveSnapshot;
  put: (
    uuid: string,
    environment: Environment,
    baseRevision: number,
  ) => Promise<UpdateEnvironmentResponse>;
  setSaveState: (state: SaveState) => void;
  /** A save succeeded. sentVersion is the local version that was sent. */
  onSaved: (uuid: string, response: UpdateEnvironmentResponse, sentVersion: number) => void;
  /** 409 PORT_IN_USE: the host puts the previous port back (which counts as a local change). */
  onPortInUse: (uuid: string, message: string) => void;
  /** The server rejected the data (4xx other than a conflict). Retrying would not help. */
  onRejected: (uuid: string, error: ApiClientError) => void;
};

export const SAVE_DEBOUNCE_MS = 400;
export const RETRY_DELAYS_MS = [1000, 2000, 5000];

/**
 * Sends the whole environment to the server after local changes:
 * debounced, at most one PUT in flight, the newest state always wins.
 */
export class SaveQueue {
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryIndex = 0;
  private inFlight: Promise<void> | null = null;
  private stopped = false;

  constructor(private readonly host: SaveQueueHost) {}

  /** Call after every local change. */
  notifyChange(): void {
    if (this.stopped) {
      return;
    }
    this.clearTimers();
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.send();
    }, SAVE_DEBOUNCE_MS);
  }

  /** Send pending changes right away and wait for the outcome. */
  async flushNow(): Promise<void> {
    if (this.debounceTimer || this.retryTimer) {
      this.clearTimers();
      await this.send();
    } else if (this.inFlight) {
      await this.inFlight;
    }
  }

  /** Forget timers and resume normal operation (new environment loaded, or conflict resolved). */
  reset(): void {
    this.clearTimers();
    this.retryIndex = 0;
    this.stopped = false;
  }

  /** Stop sending until reset() is called (a conflict was detected elsewhere). */
  pause(): void {
    this.clearTimers();
    this.stopped = true;
  }

  /** True while a change is waiting to be sent or being sent. */
  isBusy(): boolean {
    return this.debounceTimer !== null || this.retryTimer !== null || this.inFlight !== null;
  }

  private clearTimers(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private send(): Promise<void> {
    if (this.inFlight) {
      // the request in flight re-sends when it finds a newer version afterwards
      return this.inFlight;
    }
    const snapshot = this.host.getSnapshot();
    const { uuid, environment, version } = snapshot;
    if (this.stopped || !uuid || !environment) {
      return Promise.resolve();
    }

    this.host.setSaveState('saving');
    const stillSameEnvironment = () => this.host.getSnapshot().uuid === uuid;

    this.inFlight = this.host
      .put(uuid, environment, snapshot.serverRevision)
      .then(
        (response) => {
          this.retryIndex = 0;
          this.host.onSaved(uuid, response, version);

          return 'done' as const;
        },
        (error: unknown) => {
          if (!stillSameEnvironment()) {
            return 'done' as const;
          }
          if (error instanceof ApiClientError && error.code === 'REVISION_CONFLICT') {
            this.stopped = true;
            this.host.setSaveState('conflict');

            return 'stop' as const;
          }
          if (error instanceof ApiClientError && error.code === 'PORT_IN_USE') {
            this.host.onPortInUse(uuid, error.message);

            return 'done' as const;
          }
          if (error instanceof ApiClientError && error.status >= 400 && error.status < 500) {
            this.host.setSaveState('error');
            this.host.onRejected(uuid, error);

            return 'stop' as const;
          }

          // network error or 5xx: retry after 1 s, 2 s, 5 s, then every 5 s
          this.host.setSaveState('error');
          const delay =
            RETRY_DELAYS_MS[Math.min(this.retryIndex, RETRY_DELAYS_MS.length - 1)] ?? 5000;
          this.retryIndex += 1;
          this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            void this.send();
          }, delay);

          return 'stop' as const;
        },
      )
      .then((outcome) => {
        this.inFlight = null;
        if (outcome !== 'done' || !stillSameEnvironment()) {
          return;
        }
        if (this.host.getSnapshot().version !== version) {
          // changes arrived while the request was in flight: send the latest state right away
          if (!this.debounceTimer) {
            return this.send();
          }
        } else {
          this.host.setSaveState('saved');
        }
      });

    return this.inFlight;
  }
}
