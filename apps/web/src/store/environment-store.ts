import { CloneObject, type Environment } from '@mockoon/commons';
import type { EnvironmentDetail, UiStatePatch } from '@maketa/shared';
import { create } from 'zustand';
import { api, errorText } from '../api/client';
import { S } from '../strings';
import { toastError } from './app-store';
import { SaveQueue, type SaveState } from './save-queue';

const UI_STATE_DEBOUNCE_MS = 300;

type EnvironmentStore = {
  uuid: string | null;
  environment: Environment | null;
  serverRevision: number;
  disabledRoutes: string[];
  collapsedFolders: string[];
  saveState: SaveState;
  /** Counter of local changes, used by the save queue. */
  version: number;
  loading: boolean;
  loadError: string | null;
  /** Port and hostname as last confirmed by the server (to revert on PORT_IN_USE). */
  savedAddress: { port: number; hostname: string } | null;

  load: (uuid: string) => Promise<void>;
  /** Fetch the open environment again and drop local changes. */
  reload: () => Promise<void>;
  unload: () => void;
  mutate: (fn: (environment: Environment) => Environment) => void;
  setDisabledRoutes: (disabledRoutes: string[]) => void;
  setCollapsedFolders: (collapsedFolders: string[]) => void;
  applyServerUiState: (disabledRoutes: string[], collapsedFolders: string[]) => void;
  /** Resolve a conflict by sending the local version on top of the current server revision. */
  overwrite: () => Promise<void>;
  /** Another client or an external file change updated the open environment. */
  handleRemoteUpdate: () => void;
};

const EMPTY = {
  uuid: null,
  environment: null,
  serverRevision: 0,
  disabledRoutes: [],
  collapsedFolders: [],
  saveState: 'saved' as SaveState,
  version: 0,
  loading: false,
  loadError: null,
  savedAddress: null,
};

let uiStateTimer: ReturnType<typeof setTimeout> | null = null;
let pendingUiState: UiStatePatch = {};
let loadToken = 0;

export const useEnvironmentStore = create<EnvironmentStore>((set, get) => {
  const applyDetail = (detail: EnvironmentDetail) => {
    set((current) => ({
      uuid: detail.summary.uuid,
      environment: detail.environment,
      serverRevision: detail.summary.revision,
      disabledRoutes: detail.disabledRoutes,
      collapsedFolders: detail.collapsedFolders,
      saveState: 'saved',
      version: current.version + 1,
      loading: false,
      loadError: null,
      savedAddress: { port: detail.environment.port, hostname: detail.environment.hostname },
    }));
  };

  const flushUiState = () => {
    if (uiStateTimer) {
      clearTimeout(uiStateTimer);
      uiStateTimer = null;
    }
    const { uuid } = get();
    const patch = pendingUiState;
    pendingUiState = {};
    if (uuid && (patch.disabledRoutes || patch.collapsedFolders)) {
      api.putUiState(uuid, patch).catch((error) => toastError(errorText(error)));
    }
  };

  const scheduleUiState = (patch: UiStatePatch) => {
    pendingUiState = { ...pendingUiState, ...patch };
    if (uiStateTimer) {
      clearTimeout(uiStateTimer);
    }
    uiStateTimer = setTimeout(flushUiState, UI_STATE_DEBOUNCE_MS);
  };

  return {
    ...EMPTY,

    load: async (uuid) => {
      const token = ++loadToken;
      if (get().uuid !== uuid) {
        // do not lose pending changes of the environment we are leaving
        flushUiState();
        await saveQueue.flushNow().catch(() => {});
      }
      if (token !== loadToken) {
        return;
      }
      saveQueue.reset();
      set((current) => ({
        ...EMPTY,
        version: current.version + 1,
        uuid,
        loading: true,
      }));
      try {
        const detail = await api.getEnvironment(uuid);
        if (token === loadToken) {
          applyDetail(detail);
        }
      } catch (error) {
        if (token === loadToken) {
          set({ loading: false, loadError: errorText(error) });
        }
      }
    },

    reload: async () => {
      const { uuid } = get();
      if (!uuid) {
        return;
      }
      const token = ++loadToken;
      const { saveState: stateBefore, version: versionBefore } = get();
      saveQueue.reset();
      try {
        const detail = await api.getEnvironment(uuid);
        if (token === loadToken && get().uuid === uuid) {
          if (stateBefore === 'saved' && get().version !== versionBefore) {
            // edited while the reload was in flight: keep the edits. If the server really has
            // a newer revision, saving them reports the conflict.
            return;
          }
          applyDetail(detail);
        }
      } catch (error) {
        if (token === loadToken) {
          set({ loadError: errorText(error), environment: null });
        }
      }
    },

    unload: () => {
      loadToken += 1;
      saveQueue.reset();
      pendingUiState = {};
      set((current) => ({ ...EMPTY, version: current.version + 1 }));
    },

    mutate: (fn) => {
      const { environment, saveState } = get();
      if (!environment) {
        return;
      }
      const next = fn(environment);
      if (next === environment) {
        return;
      }
      set((current) => ({
        environment: next,
        version: current.version + 1,
        // while in conflict nothing is sent until the user picks Reload or Overwrite
        saveState: saveState === 'conflict' ? 'conflict' : 'dirty',
      }));
      saveQueue.notifyChange();
    },

    setDisabledRoutes: (disabledRoutes) => {
      set({ disabledRoutes });
      scheduleUiState({ disabledRoutes });
    },

    setCollapsedFolders: (collapsedFolders) => {
      set({ collapsedFolders });
      scheduleUiState({ collapsedFolders });
    },

    applyServerUiState: (disabledRoutes, collapsedFolders) => {
      // ignore echoes while a newer local change is still waiting to be sent
      if (uiStateTimer === null) {
        set({ disabledRoutes, collapsedFolders });
      }
    },

    overwrite: async () => {
      const { uuid } = get();
      if (!uuid) {
        return;
      }
      try {
        const detail = await api.getEnvironment(uuid);
        if (get().uuid !== uuid) {
          return;
        }
        set({ serverRevision: detail.summary.revision, saveState: 'dirty' });
        saveQueue.reset();
        saveQueue.notifyChange();
        await saveQueue.flushNow();
      } catch (error) {
        toastError(errorText(error));
      }
    },

    handleRemoteUpdate: () => {
      const { saveState } = get();
      if (saveState === 'saved') {
        void get().reload();
      } else if (saveState !== 'conflict') {
        // keep the queue quiet until the user picks Reload or Overwrite
        saveQueue.pause();
        set({ saveState: 'conflict' });
      }
    },
  };
});

export const saveQueue = new SaveQueue({
  getSnapshot: () => {
    const { uuid, environment, serverRevision, version } = useEnvironmentStore.getState();

    return { uuid, environment, serverRevision, version };
  },
  put: (uuid, environment, baseRevision) => api.putEnvironment(uuid, environment, baseRevision),
  setSaveState: (saveState) => {
    // a conflict detected through SSE while a request was in flight must not be overwritten
    if (useEnvironmentStore.getState().saveState !== 'conflict' || saveState === 'conflict') {
      useEnvironmentStore.setState({ saveState });
    }
  },
  onSaved: (uuid, response, sentVersion) => {
    const current = useEnvironmentStore.getState();
    if (current.uuid !== uuid) {
      return;
    }
    const untouched = current.version === sentVersion;
    // the server repaired the data: take its version unless there are newer local changes
    const environment =
      response.environment && untouched ? response.environment : current.environment;
    useEnvironmentStore.setState({
      serverRevision: response.revision,
      environment,
      savedAddress: environment
        ? {
            port: untouched ? environment.port : (current.savedAddress?.port ?? environment.port),
            hostname: untouched
              ? environment.hostname
              : (current.savedAddress?.hostname ?? environment.hostname),
          }
        : current.savedAddress,
    });
  },
  onPortInUse: (uuid, message) => {
    const current = useEnvironmentStore.getState();
    if (current.uuid !== uuid || !current.environment) {
      return;
    }
    toastError(message);
    const { savedAddress } = current;
    if (savedAddress) {
      useEnvironmentStore.setState({
        environment: {
          ...current.environment,
          port: savedAddress.port,
          hostname: savedAddress.hostname,
        },
        version: current.version + 1,
        saveState: 'dirty',
      });
    }
  },
  onRejected: (_uuid, error) => {
    toastError(S.save.rejected(error.message));
  },
});

/** Deep copy helper for callers that need to edit a value before handing it to a mutator. */
export const cloneEnvironment = (environment: Environment): Environment => CloneObject(environment);
