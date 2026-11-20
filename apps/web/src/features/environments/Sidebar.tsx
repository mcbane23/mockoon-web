import type { EnvironmentSummary } from '@mockpit/shared';
import { useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { api } from '../../api/client';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { MenuList, type MenuItem } from '../../components/Menu';
import { SortableList, arrayMove } from '../../components/SortableList';
import { toastError, useAppStore } from '../../store/app-store';
import { S } from '../../strings';
import {
  copyToClipboard,
  duplicateEnvironment,
  exportEnvironment,
  restartEnvironment,
  startEnvironment,
  stopEnvironment,
} from './actions';
import type { ShellContext } from './Shell';
import styles from './Sidebar.module.css';
import { useNavigate } from 'react-router-dom';

type DotState = 'running' | 'pending' | 'stopped' | 'error';

export const dotState = (summary: EnvironmentSummary): DotState => {
  if (summary.status === 'starting' || summary.status === 'stopping') {
    return 'pending';
  }
  if (summary.status === 'running') {
    return 'running';
  }

  return summary.lastError || summary.fileError ? 'error' : 'stopped';
};

const dotLabel = (state: DotState, summary: EnvironmentSummary): string => {
  if (state === 'error') {
    return S.sidebar.status.error;
  }

  return S.sidebar.status[summary.status];
};

export function Sidebar({ shell }: { shell: ShellContext }) {
  const summaries = useAppStore((store) => store.summaries);
  const reorderSummaries = useAppStore((store) => store.reorderSummaries);
  const location = useLocation();
  const navigate = useNavigate();
  const [menu, setMenu] = useState<{ uuid: string; x: number; y: number } | null>(null);
  const [fileOver, setFileOver] = useState(false);

  const activeUuid = /^\/env\/([^/]+)/.exec(location.pathname)?.[1] ?? null;

  const reorder = (from: number, to: number) => {
    const previous = summaries.map((item) => item.uuid);
    const uuids = arrayMove(previous, from, to);
    reorderSummaries(uuids);
    api.reorderEnvironments(uuids).catch((error: Error) => {
      reorderSummaries(previous);
      toastError(error.message);
    });
  };

  const menuItems = (summary: EnvironmentSummary): MenuItem[] => {
    const index = summaries.findIndex((item) => item.uuid === summary.uuid);
    const active = summary.status === 'running' || summary.status === 'starting';

    return [
      active
        ? { label: S.sidebar.stop, onSelect: () => void stopEnvironment(summary.uuid) }
        : {
            label: S.sidebar.start,
            disabled: !summary.hasData || summary.status !== 'stopped',
            onSelect: () => void startEnvironment(summary.uuid),
          },
      {
        label: S.sidebar.restart,
        disabled: summary.status !== 'running',
        onSelect: () => void restartEnvironment(summary.uuid),
      },
      'separator',
      {
        label: S.sidebar.duplicate,
        disabled: !summary.hasData,
        onSelect: () =>
          void duplicateEnvironment(summary.uuid).then(
            (detail) => detail && navigate(`/env/${detail.summary.uuid}/routes`),
          ),
      },
      {
        label: S.sidebar.export,
        disabled: !summary.hasData,
        onSelect: () => exportEnvironment(summary.uuid),
      },
      { label: S.sidebar.copyPath, onSelect: () => void copyToClipboard(summary.path) },
      'separator',
      {
        label: S.common.moveUp,
        disabled: index <= 0,
        onSelect: () => reorder(index, index - 1),
      },
      {
        label: S.common.moveDown,
        disabled: index === summaries.length - 1,
        onSelect: () => reorder(index, index + 1),
      },
      'separator',
      {
        label: S.sidebar.closeEnvironment,
        danger: true,
        onSelect: () => shell.closeEnvironment(summary),
      },
    ];
  };

  const menuSummary = menu ? summaries.find((item) => item.uuid === menu.uuid) : undefined;
  const hasFiles = (event: React.DragEvent) => event.dataTransfer.types.includes('Files');

  return (
    <aside
      className={`${styles.sidebar}${fileOver ? ` ${styles.fileOver}` : ''}`}
      aria-label={S.sidebar.title}
      onDragOver={(event) => {
        if (hasFiles(event)) {
          event.preventDefault();
          setFileOver(true);
        }
      }}
      onDragLeave={() => setFileOver(false)}
      onDrop={(event) => {
        if (!hasFiles(event)) {
          return;
        }
        event.preventDefault();
        setFileOver(false);
        const file = event.dataTransfer.files[0];
        if (file) {
          shell.importEnvironment(file);
        }
      }}
    >
      <div className={styles.brand}>
        <Link to="/" className={styles.brandLink}>
          <span className={styles.logo} aria-hidden="true">
            M
          </span>
          <span className={styles.label}>{S.appName}</span>
        </Link>
      </div>

      <nav className={styles.list} aria-label={S.sidebar.title}>
        <SortableList ids={summaries.map((item) => item.uuid)} onMove={reorder}>
          {({ id, handleProps }) => {
            const summary = summaries.find((item) => item.uuid === id);
            if (!summary) {
              return null;
            }
            const state = dotState(summary);
            const active = summary.status === 'running' || summary.status === 'starting';
            const busy = summary.status === 'starting' || summary.status === 'stopping';

            return (
              <div
                className={`${styles.item}${activeUuid === id ? ` ${styles.active}` : ''}`}
                data-testid="environment-item"
                onPointerDown={handleProps.onPointerDown}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setMenu({ uuid: id, x: event.clientX, y: event.clientY });
                }}
              >
                <Link
                  to={`/env/${id}/routes`}
                  className={styles.itemLink}
                  aria-current={activeUuid === id ? 'page' : undefined}
                  title={summary.fileError ?? summary.lastError?.message ?? summary.name}
                  draggable={false}
                >
                  <span
                    className={`${styles.dot} ${styles[state]}`}
                    role="img"
                    aria-label={dotLabel(state, summary)}
                  />
                  <span className={styles.label}>
                    <span
                      className={`${styles.name} truncate${summary.hasData ? '' : ` ${styles.broken}`}`}
                    >
                      {summary.name}
                    </span>
                    <span className={`${styles.port} muted`}>
                      {summary.hasData ? `:${summary.port}` : ''}
                      {summary.tlsEnabled && (
                        <span title={S.sidebar.tls} aria-label={S.sidebar.tls} role="img">
                          {' '}
                          <Icon name="lock" size={11} />
                        </span>
                      )}
                    </span>
                  </span>
                </Link>
                <span className={styles.itemActions}>
                  <Button
                    size="small"
                    variant="ghost"
                    iconOnly
                    icon={active ? 'stop' : 'play'}
                    label={
                      active
                        ? S.sidebar.stopNamed(summary.name)
                        : S.sidebar.startNamed(summary.name)
                    }
                    disabled={busy || !summary.hasData}
                    onClick={() => void (active ? stopEnvironment(id) : startEnvironment(id))}
                  />
                  <Button
                    size="small"
                    variant="ghost"
                    iconOnly
                    icon="dots"
                    label={S.sidebar.actionsFor(summary.name)}
                    aria-haspopup="menu"
                    onClick={(event) => {
                      const rect = event.currentTarget.getBoundingClientRect();
                      setMenu({ uuid: id, x: rect.left, y: rect.bottom + 4 });
                    }}
                  />
                </span>
              </div>
            );
          }}
        </SortableList>
      </nav>

      <div className={styles.footer}>
        <div className={styles.footerButtons}>
          <Button
            size="small"
            icon="plus"
            onClick={shell.newEnvironment}
            title={S.dialogs.newTitle}
          >
            <span className={styles.label}>{S.sidebar.newEnvironment}</span>
          </Button>
          <Button
            size="small"
            icon="file"
            onClick={shell.openEnvironment}
            title={S.dialogs.openTitle}
          >
            <span className={styles.label}>{S.sidebar.openFile}</span>
          </Button>
          <Button
            size="small"
            icon="upload"
            onClick={() => shell.importEnvironment()}
            title={S.sidebar.dropHint}
          >
            <span className={styles.label}>{S.sidebar.importFile}</span>
          </Button>
        </div>
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            `${styles.settingsLink}${isActive ? ` ${styles.active}` : ''}`
          }
          title={S.sidebar.appSettings}
        >
          <Icon name="settings" />
          <span className={styles.label}>{S.sidebar.appSettings}</span>
        </NavLink>
      </div>

      {menu && menuSummary && (
        <MenuList
          position={{ x: menu.x, y: menu.y }}
          items={menuItems(menuSummary)}
          label={S.sidebar.actionsFor(menuSummary.name)}
          onClose={() => setMenu(null)}
        />
      )}
    </aside>
  );
}
