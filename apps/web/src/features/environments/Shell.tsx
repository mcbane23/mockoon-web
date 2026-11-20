import { useCallback, useState } from 'react';
import { Outlet, useNavigate, useOutletContext } from 'react-router-dom';
import type { EnvironmentSummary } from '@stubhouse/shared';
import { Toasts } from '../../components/Toasts';
import { useAppStore } from '../../store/app-store';
import { S } from '../../strings';
import { createDemoEnvironment, importFile, pickFile } from './actions';
import { CloseEnvironmentDialog, NewEnvironmentDialog, OpenEnvironmentDialog } from './dialogs';
import styles from './Shell.module.css';
import { Sidebar } from './Sidebar';

type Dialog = { kind: 'new' } | { kind: 'open' } | { kind: 'close'; summary: EnvironmentSummary };

export type ShellContext = {
  newEnvironment: () => void;
  openEnvironment: () => void;
  importEnvironment: (file?: File) => void;
  createDemo: () => void;
  closeEnvironment: (summary: EnvironmentSummary) => void;
  onLoggedOut: () => void;
};

export const useShell = () => useOutletContext<ShellContext>();

/** Three-column frame: environments on the left, the active page on the right. */
export function Shell({ onLoggedOut }: { onLoggedOut: () => void }) {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const connection = useAppStore((store) => store.connection);
  const navigate = useNavigate();

  const goTo = useCallback((uuid: string) => navigate(`/env/${uuid}/routes`), [navigate]);

  const importEnvironment = useCallback(
    async (file?: File) => {
      const picked = file ?? (await pickFile());
      if (!picked) {
        return;
      }
      const detail = await importFile(picked);
      if (detail) {
        goTo(detail.summary.uuid);
      }
    },
    [goTo],
  );

  const context: ShellContext = {
    newEnvironment: () => setDialog({ kind: 'new' }),
    openEnvironment: () => setDialog({ kind: 'open' }),
    importEnvironment: (file) => void importEnvironment(file),
    createDemo: () =>
      void createDemoEnvironment().then((detail) => detail && goTo(detail.summary.uuid)),
    closeEnvironment: (summary) => setDialog({ kind: 'close', summary }),
    onLoggedOut,
  };

  return (
    <div className={styles.shell}>
      <Sidebar shell={context} />
      <main className={styles.main}>
        {connection === 'reconnecting' && (
          <div className="banner banner-warning" role="status">
            <span className="spinner" />
            {S.connection.lost}
          </div>
        )}
        <div className={styles.content}>
          <Outlet context={context} />
        </div>
      </main>
      <Toasts />

      {dialog?.kind === 'new' && (
        <NewEnvironmentDialog onClose={() => setDialog(null)} onCreated={goTo} />
      )}
      {dialog?.kind === 'open' && (
        <OpenEnvironmentDialog onClose={() => setDialog(null)} onCreated={goTo} />
      )}
      {dialog?.kind === 'close' && (
        <CloseEnvironmentDialog summary={dialog.summary} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}
