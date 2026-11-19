import { useEffect, useState } from 'react';
import { NavLink, Navigate, Outlet, useParams } from 'react-router-dom';
import { Button } from '../../components/Button';
import { CopyButton } from '../../components/CopyButton';
import { isEditableTarget } from '../../lib/keyboard';
import { isUnreachableFromBrowser, mockBaseUrl } from '../../lib/mock-url';
import { useAppStore } from '../../store/app-store';
import { useEnvironmentStore } from '../../store/environment-store';
import { useLogsStore } from '../../store/logs-store';
import { S } from '../../strings';
import { closeEnvironment, restartEnvironment, startEnvironment, stopEnvironment } from './actions';
import styles from './EnvironmentLayout.module.css';
import { useShell } from './Shell';

const SAVE_LABELS = {
  saved: S.save.saved,
  saving: S.save.saving,
  dirty: S.save.dirty,
  error: S.save.error,
  conflict: S.save.conflict,
} as const;

/** Header of the open environment (start/stop, URL, save state, tabs) and the active tab. */
export function EnvironmentLayout() {
  const { envUuid = '' } = useParams();
  const shell = useShell();
  const summaries = useAppStore((store) => store.summaries);
  const summary = summaries.find((item) => item.uuid === envUuid);
  const load = useEnvironmentStore((store) => store.load);
  const reload = useEnvironmentStore((store) => store.reload);
  const overwrite = useEnvironmentStore((store) => store.overwrite);
  const openUuid = useEnvironmentStore((store) => store.uuid);
  const environment = useEnvironmentStore((store) => store.environment);
  const saveState = useEnvironmentStore((store) => store.saveState);
  const loading = useEnvironmentStore((store) => store.loading);
  const loadError = useEnvironmentStore((store) => store.loadError);
  const unread = useLogsStore((store) => store.unread[envUuid] ?? 0);
  const [dismissedError, setDismissedError] = useState<string | null>(null);

  const exists = summary !== undefined;

  useEffect(() => {
    if (!exists) {
      return;
    }
    void load(envUuid);
    void useLogsStore
      .getState()
      .fetch(envUuid)
      .catch(() => {});
  }, [envUuid, exists, load]);

  // warn about unsaved changes when leaving the page
  useEffect(() => {
    if (saveState !== 'dirty' && saveState !== 'saving') {
      return;
    }
    const listener = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = S.save.unsavedPrompt;
    };
    window.addEventListener('beforeunload', listener);

    return () => window.removeEventListener('beforeunload', listener);
  }, [saveState]);

  const status = summary?.status ?? 'stopped';
  const hasData = summary?.hasData ?? false;

  // Ctrl/Cmd+Enter start/stop (also from text fields), Ctrl/Cmd+Shift+R restart
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || !hasData) {
        return;
      }
      if (event.key === 'Enter' && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        if (status === 'running') {
          void stopEnvironment(envUuid);
        } else if (status === 'stopped') {
          void startEnvironment(envUuid);
        }
      } else if (
        event.shiftKey &&
        event.key.toLowerCase() === 'r' &&
        status === 'running' &&
        !isEditableTarget(event.target)
      ) {
        event.preventDefault();
        void restartEnvironment(envUuid);
      }
    };
    window.addEventListener('keydown', listener);

    return () => window.removeEventListener('keydown', listener);
  }, [envUuid, status, hasData]);

  if (!summary) {
    // the environment was closed (here or elsewhere): go to the next one or the empty state
    const next = summaries[0];

    return <Navigate to={next ? `/env/${next.uuid}/routes` : '/'} replace />;
  }

  const ready = openUuid === envUuid && environment !== null;
  const address = ready
    ? {
        hostname: environment.hostname,
        port: environment.port,
        endpointPrefix: environment.endpointPrefix,
        tlsEnabled: environment.tlsOptions?.enabled === true,
      }
    : summary;
  const baseUrl = mockBaseUrl(address);
  const errorKey = summary.lastError
    ? `${summary.lastError.code}:${summary.lastError.message}`
    : null;
  const busy = status === 'starting' || status === 'stopping';

  return (
    <div className={styles.layout}>
      <header className={styles.header}>
        <div className={styles.top}>
          {status === 'running' || status === 'stopping' ? (
            <Button
              variant="danger"
              icon={busy ? undefined : 'stop'}
              disabled={busy}
              onClick={() => void stopEnvironment(envUuid)}
            >
              {busy && <span className="spinner" />}
              {busy ? S.header.stopping : S.header.stop}
            </Button>
          ) : (
            <Button
              variant="primary"
              icon={busy ? undefined : 'play'}
              disabled={busy || !summary.hasData}
              onClick={() => void startEnvironment(envUuid)}
            >
              {busy && <span className="spinner" />}
              {busy ? S.header.starting : S.header.start}
            </Button>
          )}
          {status === 'running' && (
            <Button icon="restart" onClick={() => void restartEnvironment(envUuid)}>
              {S.header.restart}
            </Button>
          )}
          <h1 className={`${styles.name} truncate`}>{summary.name}</h1>
          {summary.hasData && (
            <span className={styles.url}>
              <code className="truncate" data-testid="base-url">
                {baseUrl}
              </code>
              <CopyButton text={baseUrl} label={S.header.copyUrl} />
            </span>
          )}
          <span className="grow" />
          {ready && (
            <span
              className={`${styles.save} ${styles[saveState]}`}
              role="status"
              data-testid="save-state"
            >
              {SAVE_LABELS[saveState]}
            </span>
          )}
        </div>
        <nav className="tabs" aria-label={summary.name}>
          <NavLink to="routes" className={({ isActive }) => `tab${isActive ? ' active' : ''}`}>
            {S.header.tabs.routes}
          </NavLink>
          <NavLink to="logs" className={({ isActive }) => `tab${isActive ? ' active' : ''}`}>
            {S.header.tabs.logs}
            {unread > 0 && (
              <span className="count" aria-label={S.header.unread(unread)}>
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </NavLink>
          <NavLink to="settings" className={({ isActive }) => `tab${isActive ? ' active' : ''}`}>
            {S.header.tabs.settings}
          </NavLink>
        </nav>
      </header>

      {summary.lastError && errorKey !== dismissedError && (
        <div className="banner banner-error" role="alert">
          <span className="grow">{summary.lastError.message}</span>
          <Button size="small" onClick={() => setDismissedError(errorKey)}>
            {S.common.dismiss}
          </Button>
        </div>
      )}
      {summary.fileError && summary.hasData && (
        <div className="banner banner-warning" role="status">
          {S.header.fileError(summary.fileError)}
        </div>
      )}
      {summary.hasData && isUnreachableFromBrowser(address.hostname) && (
        <div className="banner banner-warning" role="status">
          {S.header.loopbackOnly}
        </div>
      )}
      {ready && saveState === 'conflict' && (
        <div className="banner banner-warning" role="alert">
          <span className="grow">{S.save.conflictBanner}</span>
          <Button size="small" title={S.save.reloadHint} onClick={() => void reload()}>
            {S.save.reload}
          </Button>
          <Button size="small" title={S.save.overwriteHint} onClick={() => void overwrite()}>
            {S.save.overwrite}
          </Button>
        </div>
      )}

      <div className={styles.body}>
        {ready ? (
          <Outlet context={shell} />
        ) : loading || (openUuid !== envUuid && !loadError) ? (
          <div className="center" role="status">
            <span className="spinner" />
            {S.common.loading}
          </div>
        ) : (
          <div className="center" role="alert">
            <h2 style={{ color: 'var(--text)' }}>{S.brokenEnvironment.title}</h2>
            <p>{summary.fileError ?? loadError}</p>
            <p>
              {S.brokenEnvironment.path}: <code>{summary.path}</code>
            </p>
            <div className="row">
              <Button onClick={() => void load(envUuid)}>{S.brokenEnvironment.retry}</Button>
              <Button variant="danger" onClick={() => void closeEnvironment(envUuid, false)}>
                {S.brokenEnvironment.remove}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
