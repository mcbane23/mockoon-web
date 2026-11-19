import { BINARY_BODY } from '@mockoon/commons';
import type { LogEntry } from '@maketa/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, errorText } from '../../api/client';
import { Button } from '../../components/Button';
import { CopyButton } from '../../components/CopyButton';
import { Toggle } from '../../components/Toggle';
import { isEditableTarget, isModifier } from '../../lib/keyboard';
import { methodBadgeFor, statusClass } from '../../lib/method';
import { mockBaseUrl } from '../../lib/mock-url';
import { toastError, useAppStore } from '../../store/app-store';
import { useEnvironmentStore } from '../../store/environment-store';
import { useLogsStore } from '../../store/logs-store';
import { S } from '../../strings';
import styles from './LogsPage.module.css';

const EMPTY: LogEntry[] = [];

const pad = (value: number, length = 2) => String(value).padStart(length, '0');

const formatTime = (timestamp: number, withMs = false): string => {
  const date = new Date(timestamp);
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;

  return withMs ? `${time}.${pad(date.getMilliseconds(), 3)}` : time;
};

const formatBytes = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${Math.round(bytes / 1024 / 1024)} MB`
    : bytes >= 1024
      ? `${Math.round(bytes / 1024)} KB`
      : `${bytes} B`;

export const matchesLogFilter = (entry: LogEntry, filter: string): boolean => {
  const query = filter.trim().toLowerCase();

  return (
    !query ||
    (entry.request.urlPath ?? '').toLowerCase().includes(query) ||
    entry.request.method.toLowerCase().includes(query) ||
    String(entry.response.statusCode).includes(query)
  );
};

export function LogsPage() {
  const { envUuid = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const live = useLogsStore((store) => store.logs[envUuid] ?? EMPTY);
  const setActive = useLogsStore((store) => store.setActive);
  const summary = useAppStore((store) => store.summaries.find((item) => item.uuid === envUuid));
  const environment = useEnvironmentStore((store) => store.environment);
  const [filter, setFilter] = useState('');
  /** While paused the list is frozen at this snapshot. */
  const [frozen, setFrozen] = useState<LogEntry[] | null>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  // opening the tab resets the unread counter, and it stays at zero while the tab is visible
  useEffect(() => {
    setActive(envUuid);

    return () => setActive(null);
  }, [envUuid, setActive]);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (
        isModifier(event) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === 'f' &&
        !isEditableTarget(event.target)
      ) {
        event.preventDefault();
        filterRef.current?.focus();
        filterRef.current?.select();
      }
    };
    window.addEventListener('keydown', listener);

    return () => window.removeEventListener('keydown', listener);
  }, []);

  const entries = frozen ?? live;
  const newWhilePaused = useMemo(() => {
    if (!frozen) {
      return 0;
    }
    const known = new Set(frozen.map((entry) => entry.uuid));

    return live.filter((entry) => !known.has(entry.uuid)).length;
  }, [frozen, live]);

  const visible = useMemo(
    () => entries.filter((entry) => matchesLogFilter(entry, filter)),
    [entries, filter],
  );
  const selectedUuid = searchParams.get('log');
  const selected = entries.find((entry) => entry.uuid === selectedUuid) ?? null;

  const select = (uuid: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('log', uuid);
    setSearchParams(next, { replace: true });
  };

  const clear = () => {
    setFrozen(null);
    api.clearLogs(envUuid).catch((error) => toastError(errorText(error)));
  };

  const baseUrl = summary ? mockBaseUrl(summary) : '';

  return (
    <div className={styles.page}>
      <div className={styles.listColumn}>
        <div className={styles.toolbar}>
          <input
            ref={filterRef}
            className="input"
            type="search"
            placeholder={S.logs.filter}
            aria-label={S.logs.filterLabel}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setFilter('');
              }
            }}
          />
          <Button onClick={clear} disabled={live.length === 0}>
            {S.logs.clear}
          </Button>
        </div>
        <div className={styles.toolbar}>
          <Toggle
            checked={frozen !== null}
            label={S.logs.pause}
            onChange={(paused) => setFrozen(paused ? live : null)}
          />
          {frozen && newWhilePaused > 0 && (
            <span className="count" role="status">
              {S.logs.newWhilePaused(newWhilePaused)}
            </span>
          )}
        </div>

        {entries.length === 0 ? (
          <div className="center">
            {summary?.status === 'running' ? (
              <>
                <p>{S.logs.empty}</p>
                <code>curl {baseUrl}</code>
              </>
            ) : (
              <p>{S.logs.notRunning}</p>
            )}
          </div>
        ) : visible.length === 0 ? (
          <div className="center">{S.logs.noMatch}</div>
        ) : (
          <ul className={styles.list} aria-label={S.logs.listLabel}>
            {visible.map((entry) => {
              const badge = methodBadgeFor(entry.request.method);

              return (
                <li key={entry.uuid}>
                  <button
                    type="button"
                    className={`${styles.entry}${entry.uuid === selectedUuid ? ` ${styles.selected}` : ''}`}
                    aria-current={entry.uuid === selectedUuid ? 'true' : undefined}
                    data-testid="log-entry"
                    onClick={() => select(entry.uuid)}
                  >
                    <span className={badge.className}>{badge.label}</span>
                    <span className={`${styles.path} truncate`}>{entry.request.urlPath}</span>
                    {entry.proxied && <span className="badge">{S.logs.proxied}</span>}
                    {!entry.routeUUID && !entry.proxied && (
                      <span className="badge">{S.logs.noRoute}</span>
                    )}
                    <strong className={statusClass(entry.response.statusCode)}>
                      {entry.response.statusCode}
                    </strong>
                    <span className={`${styles.time} muted`}>{formatTime(entry.timestampMs)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className={styles.details}>
        {selected ? (
          <LogDetails
            key={selected.uuid}
            entry={selected}
            envUuid={envUuid}
            routeExists={
              environment?.routes.some((route) => route.uuid === selected.routeUUID) ?? false
            }
          />
        ) : (
          <div className="center">{entries.length > 0 ? S.logs.selectEntry : null}</div>
        )}
      </div>
    </div>
  );
}

function Pairs({ title, rows }: { title: string; rows: [string, unknown][] }) {
  return (
    <section className={styles.block}>
      <h3 className={styles.blockTitle}>{title}</h3>
      {rows.length === 0 ? (
        <div className="muted">{S.logs.none}</div>
      ) : (
        <table className="kv-table" aria-label={title}>
          <tbody>
            {rows.map(([name, value], index) => (
              <tr key={`${name}-${index}`}>
                <th scope="row" className="mono">
                  {name}
                </th>
                {/* nested values are shown as JSON */}
                <td className="mono">
                  {typeof value === 'string' ? value : JSON.stringify(value)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function Body({ body, truncated }: { body: unknown; truncated: boolean }) {
  const limit = useAppStore((store) => store.state?.settings.logBodyLimitBytes ?? 0);
  const [raw, setRaw] = useState(false);
  const text =
    body === undefined || body === null
      ? ''
      : typeof body === 'string'
        ? body
        : JSON.stringify(body);

  const pretty = useMemo(() => {
    try {
      const parsed: unknown = JSON.parse(text);

      return typeof parsed === 'object' && parsed !== null ? JSON.stringify(parsed, null, 2) : null;
    } catch {
      return null;
    }
  }, [text]);

  return (
    <section className={styles.block}>
      <div className="row">
        <h3 className={`${styles.blockTitle} grow`}>{S.logs.body}</h3>
        {text !== '' && text !== BINARY_BODY && (
          <>
            {pretty !== null && (
              <div className="segmented" role="radiogroup" aria-label={S.logs.body}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={!raw}
                  onClick={() => setRaw(false)}
                >
                  {S.logs.pretty}
                </button>
                <button type="button" role="radio" aria-checked={raw} onClick={() => setRaw(true)}>
                  {S.logs.raw}
                </button>
              </div>
            )}
            <CopyButton text={text} />
          </>
        )}
      </div>
      {text === '' ? (
        <div className="muted">{S.logs.noBody}</div>
      ) : text === BINARY_BODY ? (
        <div className="muted">{S.logs.binary}</div>
      ) : (
        <pre className={styles.body} data-testid="log-body">
          {pretty !== null && !raw ? pretty : text}
        </pre>
      )}
      {truncated && <div className="field-help">{S.logs.truncated(formatBytes(limit))}</div>}
    </section>
  );
}

function LogDetails({
  entry,
  envUuid,
  routeExists,
}: {
  entry: LogEntry;
  envUuid: string;
  routeExists: boolean;
}) {
  const [tab, setTab] = useState<'request' | 'response'>('request');
  const { request, response } = entry;
  const fullPath = `${request.urlPath ?? ''}${request.query ? `?${request.query}` : ''}`;
  const queryRows: [string, unknown][] =
    request.queryParams && typeof request.queryParams === 'object'
      ? Object.entries(request.queryParams as Record<string, unknown>)
      : [];

  return (
    <div className={styles.detailsInner}>
      <div className="tabs" role="tablist">
        {(['request', 'response'] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            className="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
          >
            {S.logs.tabs[id]}
          </button>
        ))}
      </div>

      {tab === 'request' ? (
        <div role="tabpanel" className={styles.panel}>
          <table className="kv-table">
            <tbody>
              <tr>
                <th scope="row">{S.logs.method}</th>
                <td>{request.method.toUpperCase()}</td>
              </tr>
              <tr>
                <th scope="row">{S.logs.url}</th>
                <td className="mono">{fullPath}</td>
              </tr>
              <tr>
                <th scope="row">{S.logs.time}</th>
                <td>{formatTime(entry.timestampMs, true)}</td>
              </tr>
              <tr>
                <th scope="row">{S.logs.matchedRoute}</th>
                <td>
                  {!entry.routeUUID ? (
                    <span className="muted">
                      {entry.proxied ? S.logs.proxied : S.logs.noRouteMatched}
                    </span>
                  ) : routeExists ? (
                    <Link
                      to={`/env/${envUuid}/routes/${entry.routeUUID}?response=${entry.routeResponseUUID}`}
                    >
                      {request.route ?? entry.routeUUID}
                    </Link>
                  ) : (
                    <span className="muted">{S.logs.routeDeleted}</span>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
          <Pairs
            title={S.logs.routeParams}
            rows={(request.params ?? []).map((param) => [param.name, param.value])}
          />
          <Pairs title={S.logs.queryParams} rows={queryRows} />
          <Pairs
            title={S.logs.headers}
            rows={(request.headers ?? []).map((header) => [header.key, header.value])}
          />
          <Body body={request.body} truncated={entry.requestBodyTruncated} />
        </div>
      ) : (
        <div role="tabpanel" className={styles.panel}>
          <table className="kv-table">
            <tbody>
              <tr>
                <th scope="row">{S.logs.status}</th>
                <td data-testid="log-status">
                  <strong className={statusClass(response.statusCode)}>
                    {response.statusCode}
                  </strong>{' '}
                  {response.statusMessage}
                </td>
              </tr>
            </tbody>
          </table>
          <Pairs
            title={S.logs.headers}
            rows={(response.headers ?? []).map((header) => [header.key, header.value])}
          />
          <Body body={response.body} truncated={entry.responseBodyTruncated} />
        </div>
      )}
    </div>
  );
}
