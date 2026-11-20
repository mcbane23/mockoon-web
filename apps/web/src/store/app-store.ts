import type { AppState, EnvironmentSummary } from '@mockpit/shared';
import { create } from 'zustand';
import { api } from '../api/client';

export type ToastKind = 'info' | 'success' | 'error';

export type Toast = {
  id: number;
  kind: ToastKind;
  message: string;
  /** Optional in-app link shown as a button. */
  action?: { label: string; to: string };
};

export type ConnectionState = 'connected' | 'reconnecting';

const MAX_TOASTS = 4;
const TOAST_MS = 5000;
const ERROR_TOAST_MS = 10_000;

type AppStore = {
  state: AppState | null;
  summaries: EnvironmentSummary[];
  connection: ConnectionState;
  toasts: Toast[];
  loadState: () => Promise<AppState>;
  upsertSummary: (summary: EnvironmentSummary, addIfMissing?: boolean) => void;
  removeSummary: (uuid: string) => void;
  reorderSummaries: (uuids: string[]) => void;
  setConnection: (connection: ConnectionState) => void;
  pushToast: (toast: Omit<Toast, 'id'>) => void;
  dismissToast: (id: number) => void;
  reset: () => void;
};

let nextToastId = 1;

export const useAppStore = create<AppStore>((set, get) => ({
  state: null,
  summaries: [],
  connection: 'connected',
  toasts: [],

  loadState: async () => {
    const state = await api.state();
    set({ state, summaries: state.environments });

    return state;
  },

  upsertSummary: (summary, addIfMissing = false) =>
    set((current) => {
      const exists = current.summaries.some((item) => item.uuid === summary.uuid);
      if (!exists) {
        return addIfMissing ? { summaries: [...current.summaries, summary] } : current;
      }

      return {
        summaries: current.summaries.map((item) => (item.uuid === summary.uuid ? summary : item)),
      };
    }),

  removeSummary: (uuid) =>
    set((current) => ({ summaries: current.summaries.filter((item) => item.uuid !== uuid) })),

  reorderSummaries: (uuids) =>
    set((current) => {
      const byUuid = new Map(current.summaries.map((item) => [item.uuid, item]));
      const ordered = uuids.flatMap((uuid) => byUuid.get(uuid) ?? []);
      const rest = current.summaries.filter((item) => !uuids.includes(item.uuid));

      return { summaries: [...ordered, ...rest] };
    }),

  setConnection: (connection) => set({ connection }),

  pushToast: (toast) => {
    const id = nextToastId++;
    // at most 4 at once: the oldest ones make room
    set((current) => ({ toasts: [...current.toasts, { ...toast, id }].slice(-MAX_TOASTS) }));
    setTimeout(() => get().dismissToast(id), toast.kind === 'error' ? ERROR_TOAST_MS : TOAST_MS);
  },

  dismissToast: (id) =>
    set((current) => ({ toasts: current.toasts.filter((toast) => toast.id !== id) })),

  reset: () => set({ state: null, summaries: [], toasts: [] }),
}));

export const toastError = (message: string) =>
  useAppStore.getState().pushToast({ kind: 'error', message });

export const toastInfo = (message: string) =>
  useAppStore.getState().pushToast({ kind: 'info', message });
