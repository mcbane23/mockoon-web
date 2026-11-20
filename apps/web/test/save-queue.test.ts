import { BuildEnvironment, type Environment } from '@mockoon/commons';
import type { UpdateEnvironmentResponse } from '@stubhouse/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '../src/api/client';
import {
  RETRY_DELAYS_MS,
  SAVE_DEBOUNCE_MS,
  SaveQueue,
  type SaveSnapshot,
  type SaveState,
} from '../src/store/save-queue';

type Deferred = {
  resolve: (response: UpdateEnvironmentResponse) => void;
  reject: (error: unknown) => void;
  environment: Environment;
  baseRevision: number;
};

function setup() {
  const state: SaveSnapshot & { saveState: SaveState } = {
    uuid: 'env-1',
    environment: BuildEnvironment({
      hasDefaultRoute: true,
      hasContentTypeHeader: true,
      hasCorsHeaders: true,
      port: 3001,
    }),
    serverRevision: 1,
    version: 0,
    saveState: 'saved',
  };
  const calls: Deferred[] = [];
  const events: string[] = [];

  // a fake fetch: every PUT stays pending until the test settles it
  const put = vi.fn(
    (_uuid: string, environment: Environment, baseRevision: number) =>
      new Promise<UpdateEnvironmentResponse>((resolve, reject) => {
        calls.push({ resolve, reject, environment, baseRevision });
      }),
  );

  const queue = new SaveQueue({
    getSnapshot: () => ({ ...state }),
    put,
    setSaveState: (saveState) => {
      state.saveState = saveState;
      events.push(saveState);
    },
    onSaved: (_uuid, response, sentVersion) => {
      state.serverRevision = response.revision;
      if (response.environment && state.version === sentVersion) {
        state.environment = response.environment;
      }
    },
    onPortInUse: (_uuid, message) => {
      events.push(`port:${message}`);
      state.environment = { ...state.environment!, port: 3001 };
      state.version += 1;
    },
    onRejected: (_uuid, error) => events.push(`rejected:${error.code}`),
  });

  /** A local change, as the environment store does it. */
  const change = (name: string) => {
    state.environment = { ...state.environment!, name };
    state.version += 1;
    state.saveState = 'dirty';
    queue.notifyChange();
  };

  return { state, calls, events, put, queue, change };
}

const flushPromises = async () => {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
  }
};

describe('SaveQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces: one request 400 ms after the last change', async () => {
    const { change, put, calls, state } = setup();
    change('a');
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS - 100);
    change('ab');
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS - 100);
    expect(put).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100);
    expect(put).toHaveBeenCalledTimes(1);
    expect(calls[0]?.environment.name).toBe('ab');
    expect(calls[0]?.baseRevision).toBe(1);
    expect(state.saveState).toBe('saving');

    calls[0]!.resolve({ revision: 2 });
    await flushPromises();
    expect(state.saveState).toBe('saved');
    expect(state.serverRevision).toBe(2);
  });

  it('keeps one request in flight and sends the latest state right after it', async () => {
    const { change, put, calls, state } = setup();
    change('first');
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(put).toHaveBeenCalledTimes(1);

    // changes while the request is in flight
    change('second');
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    change('third');
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(put).toHaveBeenCalledTimes(1);

    calls[0]!.resolve({ revision: 2 });
    await flushPromises();
    // no extra debounce: the next request goes out immediately with the newest state
    expect(put).toHaveBeenCalledTimes(2);
    expect(calls[1]?.environment.name).toBe('third');
    expect(calls[1]?.baseRevision).toBe(2);
    expect(state.saveState).toBe('saving');

    calls[1]!.resolve({ revision: 3 });
    await flushPromises();
    expect(put).toHaveBeenCalledTimes(2);
    expect(state.saveState).toBe('saved');
    expect(state.serverRevision).toBe(3);
  });

  it('takes the environment repaired by the server only when nothing changed meanwhile', async () => {
    const first = setup();
    first.change('typed');
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    first.calls[0]!.resolve({
      revision: 2,
      environment: { ...first.state.environment!, name: 'repaired' },
    });
    await flushPromises();
    expect(first.state.environment?.name).toBe('repaired');

    const second = setup();
    second.change('typed');
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    second.change('typed more');
    second.calls[0]!.resolve({
      revision: 2,
      environment: { ...second.state.environment!, name: 'repaired' },
    });
    await flushPromises();
    expect(second.state.environment?.name).toBe('typed more');
  });

  it('a 409 REVISION_CONFLICT switches to "conflict" and stops sending', async () => {
    const { change, put, calls, state, queue } = setup();
    change('mine');
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    calls[0]!.reject(
      new ApiClientError(409, 'REVISION_CONFLICT', 'changed elsewhere', { revision: 5 }),
    );
    await flushPromises();
    expect(state.saveState).toBe('conflict');

    change('more');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(put).toHaveBeenCalledTimes(1);

    // "Overwrite": take the server revision and resume
    state.serverRevision = 5;
    queue.reset();
    queue.notifyChange();
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(put).toHaveBeenCalledTimes(2);
    expect(calls[1]?.baseRevision).toBe(5);
    expect(calls[1]?.environment.name).toBe('more');
  });

  it('retries network errors after 1 s, 2 s, 5 s and then every 5 s', async () => {
    const { change, put, calls, state } = setup();
    change('offline');
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);

    const delays = [...RETRY_DELAYS_MS, 5000];
    expect(delays).toEqual([1000, 2000, 5000, 5000]);
    for (const [index, delay] of delays.entries()) {
      calls[index]!.reject(new TypeError('Failed to fetch'));
      await flushPromises();
      expect(state.saveState).toBe('error');
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(put).toHaveBeenCalledTimes(index + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(put).toHaveBeenCalledTimes(index + 2);
    }

    calls[delays.length]!.resolve({ revision: 2 });
    await flushPromises();
    expect(state.saveState).toBe('saved');
  });

  it('PORT_IN_USE reverts the port through the host and saves the rest', async () => {
    const { change, put, calls, state, events } = setup();
    state.environment = { ...state.environment!, port: 4000 };
    change('with a new port');
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    calls[0]!.reject(new ApiClientError(409, 'PORT_IN_USE', 'Port 4000 is taken'));
    await flushPromises();

    expect(events).toContain('port:Port 4000 is taken');
    expect(put).toHaveBeenCalledTimes(2);
    expect(calls[1]?.environment.port).toBe(3001);
    expect(calls[1]?.environment.name).toBe('with a new port');
  });

  it('does not retry data the server rejects', async () => {
    const { change, put, calls, state, events } = setup();
    change('bad');
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    calls[0]!.reject(new ApiClientError(400, 'BAD_REQUEST', 'nope'));
    await flushPromises();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(put).toHaveBeenCalledTimes(1);
    expect(state.saveState).toBe('error');
    expect(events).toContain('rejected:BAD_REQUEST');
  });

  it('flushNow sends pending changes immediately', async () => {
    const { change, put, calls, queue, state } = setup();
    change('leaving');
    const flushed = queue.flushNow();
    expect(put).toHaveBeenCalledTimes(1);
    calls[0]!.resolve({ revision: 2 });
    await flushed;
    expect(state.saveState).toBe('saved');
    expect(queue.isBusy()).toBe(false);
  });
});
