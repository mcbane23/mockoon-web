import { BuildDemoEnvironment } from '@mockoon/commons';
import type { EnvironmentDetail } from '@mockpit/shared';
import { api, errorText } from '../../api/client';
import { copyText } from '../../lib/clipboard';
import { toastError, toastInfo, useAppStore } from '../../store/app-store';
import { S } from '../../strings';

/** Run an API call and show failures as a toast. Returns undefined on failure. */
/*
 * Status changes are taken from the SSE stream only. The HTTP response of start/stop/restart can
 * be processed after a newer "environment-status" event (an engine starts within a millisecond),
 * and applying it would put a stale "starting" over "running".
 */
async function guarded<T>(call: () => Promise<T>): Promise<T | undefined> {
  try {
    return await call();
  } catch (error) {
    toastError(errorText(error));

    return undefined;
  }
}

const adopt = (detail: EnvironmentDetail): EnvironmentDetail => {
  // the SSE "environment-added" event may arrive before or after this response
  const store = useAppStore.getState();
  if (!store.summaries.some((item) => item.uuid === detail.summary.uuid)) {
    store.upsertSummary(detail.summary, true);
  }

  return detail;
};

export async function startEnvironment(uuid: string): Promise<void> {
  await guarded(() => api.start(uuid));
}

export async function stopEnvironment(uuid: string): Promise<void> {
  await guarded(() => api.stop(uuid));
}

export async function restartEnvironment(uuid: string): Promise<void> {
  await guarded(() => api.restart(uuid));
}

export async function duplicateEnvironment(uuid: string): Promise<EnvironmentDetail | undefined> {
  const detail = await guarded(() => api.duplicateEnvironment(uuid));

  return detail ? adopt(detail) : undefined;
}

export async function createEnvironment(body: {
  name?: string;
  port?: number;
}): Promise<EnvironmentDetail> {
  return adopt(await api.createEnvironment(body));
}

export async function openEnvironment(path: string): Promise<EnvironmentDetail> {
  return adopt(await api.openEnvironment(path));
}

export async function importFile(file: File): Promise<EnvironmentDetail | undefined> {
  try {
    return adopt(await api.importEnvironment(file.name, await file.text()));
  } catch (error) {
    toastError(S.dialogs.importFailed(errorText(error)));

    return undefined;
  }
}

export async function createDemoEnvironment(): Promise<EnvironmentDetail | undefined> {
  try {
    return adopt(await api.importEnvironment('demo.json', JSON.stringify(BuildDemoEnvironment())));
  } catch (error) {
    toastError(S.dialogs.importFailed(errorText(error)));

    return undefined;
  }
}

export async function closeEnvironment(uuid: string, deleteFile: boolean): Promise<boolean> {
  const ok = await guarded(async () => {
    await api.closeEnvironment(uuid, deleteFile);

    return true;
  });
  if (ok) {
    useAppStore.getState().removeSummary(uuid);
  }

  return ok === true;
}

/** Download the environment as a JSON file. */
export function exportEnvironment(uuid: string): void {
  const link = document.createElement('a');
  link.href = api.exportUrl(uuid);
  link.download = '';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export async function copyToClipboard(text: string): Promise<void> {
  if (await copyText(text)) {
    toastInfo(S.common.copied);
  } else {
    toastError(S.common.copyFailed);
  }
}

/** Pick a .json file from this computer. */
export function pickFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}
