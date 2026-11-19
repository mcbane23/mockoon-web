import type { LogEntry } from '@maketa/shared';
import { create } from 'zustand';
import { api } from '../api/client';

type LogsStore = {
  logs: Record<string, LogEntry[]>;
  /** Unread count per environment. */
  unread: Record<string, number>;
  /** Environment whose Logs tab is currently visible. */
  activeUuid: string | null;
  fetch: (uuid: string) => Promise<void>;
  add: (entry: LogEntry, max: number) => void;
  clear: (uuid: string) => void;
  setActive: (uuid: string | null) => void;
  forget: (uuid: string) => void;
};

export const useLogsStore = create<LogsStore>((set, get) => ({
  logs: {},
  unread: {},
  activeUuid: null,

  fetch: async (uuid) => {
    const entries = await api.logs(uuid);
    set((current) => ({ logs: { ...current.logs, [uuid]: entries } }));
  },

  add: (entry, max) => {
    const uuid = entry.environmentUuid;
    const { activeUuid } = get();
    set((current) => {
      const existing = current.logs[uuid] ?? [];
      if (existing.some((item) => item.uuid === entry.uuid)) {
        return current;
      }

      return {
        logs: { ...current.logs, [uuid]: [entry, ...existing].slice(0, max) },
        unread:
          activeUuid === uuid
            ? current.unread
            : { ...current.unread, [uuid]: (current.unread[uuid] ?? 0) + 1 },
      };
    });
  },

  clear: (uuid) =>
    set((current) => ({
      logs: { ...current.logs, [uuid]: [] },
      unread: { ...current.unread, [uuid]: 0 },
    })),

  setActive: (uuid) =>
    set((current) => ({
      activeUuid: uuid,
      unread: uuid ? { ...current.unread, [uuid]: 0 } : current.unread,
    })),

  forget: (uuid) =>
    set((current) => {
      const logs = { ...current.logs };
      const unread = { ...current.unread };
      delete logs[uuid];
      delete unread[uuid];

      return { logs, unread };
    }),
}));
