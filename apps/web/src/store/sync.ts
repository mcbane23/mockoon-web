import type { ServerEvent } from '@maketa/shared';
import { errorText } from '../api/client';
import { connectEvents } from '../api/events';
import { S } from '../strings';
import { toastError, useAppStore } from './app-store';
import { useEnvironmentStore } from './environment-store';
import { useLogsStore } from './logs-store';

let serverInstanceId: string | null = null;

/** Missed events are never replayed: fetch the state, the open environment and its logs again. */
export async function reloadEverything(): Promise<void> {
  try {
    await useAppStore.getState().loadState();
    const environmentStore = useEnvironmentStore.getState();
    const { uuid } = environmentStore;
    if (uuid) {
      if (environmentStore.saveState === 'saved' || !environmentStore.environment) {
        await environmentStore.reload();
      }
      await useLogsStore
        .getState()
        .fetch(uuid)
        .catch(() => {});
    }
  } catch (error) {
    console.error('Reload failed', errorText(error));
  }
}

export function handleServerEvent(event: ServerEvent): void {
  const app = useAppStore.getState();
  const environmentStore = useEnvironmentStore.getState();

  switch (event.type) {
    case 'hello':
      if (serverInstanceId !== null && serverInstanceId !== event.serverInstanceId) {
        // the server was restarted
        void reloadEverything();
      }
      serverInstanceId = event.serverInstanceId;
      break;
    case 'environment-status':
      app.upsertSummary(event.summary);
      break;
    case 'environment-added':
      app.upsertSummary(event.summary, true);
      break;
    case 'environment-removed':
      app.removeSummary(event.uuid);
      useLogsStore.getState().forget(event.uuid);
      if (environmentStore.uuid === event.uuid) {
        environmentStore.unload();
      }
      break;
    case 'environments-reordered':
      app.reorderSummaries(event.uuids);
      break;
    case 'environment-updated':
      if (event.origin !== null && event.origin === clientIdRef.current) {
        break;
      }
      if (environmentStore.uuid === event.uuid) {
        environmentStore.handleRemoteUpdate();
      }
      break;
    case 'ui-state-updated':
      if (environmentStore.uuid === event.uuid) {
        environmentStore.applyServerUiState(event.disabledRoutes, event.collapsedFolders);
      }
      break;
    case 'settings-updated':
      void app.loadState().catch(() => {});
      break;
    case 'log':
      useLogsStore.getState().add(event.entry, app.state?.settings.maxLogsPerEnvironment ?? 100);
      break;
    case 'logs-cleared':
      useLogsStore.getState().clear(event.uuid);
      break;
    case 'runtime-error': {
      const name = app.summaries.find((item) => item.uuid === event.uuid)?.name ?? '';
      app.pushToast({
        kind: 'error',
        message: S.toasts.runtimeError(name, event.message),
        ...(event.routeUuid
          ? {
              action: {
                label: S.toasts.goToRoute,
                to: `/env/${event.uuid}/routes/${event.routeUuid}`,
              },
            }
          : {}),
      });
      break;
    }
  }
}

const clientIdRef: { current: string | null } = { current: null };

/** Open the SSE connection. Returns a function that closes it. */
export function startSync(clientId: string): () => void {
  clientIdRef.current = clientId;

  return connectEvents({
    onEvent: handleServerEvent,
    onDisconnect: () => useAppStore.getState().setConnection('reconnecting'),
    onReconnect: () => {
      useAppStore.getState().setConnection('connected');
      void reloadEverything();
    },
  });
}

export const reportError = (error: unknown) => toastError(errorText(error));
