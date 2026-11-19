import {
  BuildRouteResponse,
  CloneRouteResponse,
  Methods,
  RemoveLeadingSlash,
  ResponseMode,
  RouteType,
  addRouteResponseMutator,
  removeRouteResponseMutator,
  reorderRouteResponseMutator,
  updateRouteMutator,
  updateRouteResponseMutator,
  type Environment,
  type Route,
  type RouteResponse,
} from '@mockoon/commons';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { Button } from '../../components/Button';
import { ConfirmButton } from '../../components/ConfirmButton';
import { CopyButton } from '../../components/CopyButton';
import { KeyValueList } from '../../components/KeyValueList';
import { Segmented } from '../../components/Segmented';
import { Toggle } from '../../components/Toggle';
import { ValidatedInput } from '../../components/ValidatedInput';
import { mockBaseUrl, routeUrl } from '../../lib/mock-url';
import { validateNonNegativeInteger } from '../../lib/validation';
import { useAppStore } from '../../store/app-store';
import { useEnvironmentStore } from '../../store/environment-store';
import { S } from '../../strings';
import { ResponseSelector } from './ResponseSelector';
import styles from './RouteEditor.module.css';
import { RulesEditor } from './RulesEditor';
import { StatusBodyTab } from './StatusBodyTab';

type Props = { environment: Environment; envUuid: string; route: Route };
type Tab = 'body' | 'headers' | 'rules' | 'settings';

const METHODS = Object.values(Methods) as (keyof typeof Methods)[];

const MODES: { value: ResponseMode | null; label: string; hint: string }[] = [
  { value: null, ...S.route.modes.rules },
  { value: ResponseMode.RANDOM, ...S.route.modes.random },
  { value: ResponseMode.SEQUENTIAL, ...S.route.modes.sequential },
  { value: ResponseMode.DISABLE_RULES, ...S.route.modes.disableRules },
  { value: ResponseMode.FALLBACK, ...S.route.modes.fallback },
];

export function RouteEditor({ environment, envUuid, route }: Props) {
  const mutate = useEnvironmentStore((store) => store.mutate);
  const disabledRoutes = useEnvironmentStore((store) => store.disabledRoutes);
  const setDisabledRoutes = useEnvironmentStore((store) => store.setDisabledRoutes);
  const status = useAppStore(
    (store) => store.summaries.find((item) => item.uuid === envUuid)?.status ?? 'stopped',
  );
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const [tab, setTab] = useState<Tab>('body');
  const pathRef = useRef<HTMLInputElement>(null);

  const isHttp = route.type === RouteType.HTTP;
  const isCrud = route.type === RouteType.CRUD;
  const enabled = !disabledRoutes.includes(route.uuid);

  const response: RouteResponse | undefined =
    route.responses.find((item) => item.uuid === searchParams.get('response')) ??
    route.responses.find((item) => item.default) ??
    route.responses[0];

  // a freshly added route: put the cursor in the path field
  useEffect(() => {
    if ((location.state as { focusPath?: boolean } | null)?.focusPath) {
      pathRef.current?.focus();
    }
  }, [location.state]);

  const selectResponse = (uuid: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('response', uuid);
    setSearchParams(next, { replace: true });
  };

  const updateRoute = (patch: Partial<Route>) =>
    mutate((current) => updateRouteMutator(current, route.uuid, patch));

  const updateResponse = (patch: Partial<RouteResponse>) => {
    if (response) {
      mutate((current) => updateRouteResponseMutator(current, route.uuid, response.uuid, patch));
    }
  };

  const addResponse = () => {
    const created = BuildRouteResponse();
    if (route.responses.length === 0) {
      created.default = true;
    }
    mutate((current) => addRouteResponseMutator(current, route.uuid, created, response?.uuid));
    selectResponse(created.uuid);
  };

  const duplicateResponse = () => {
    if (!response) {
      return;
    }
    // the copy is never the default response
    const copy = CloneRouteResponse(response);
    mutate((current) => addRouteResponseMutator(current, route.uuid, copy, response.uuid));
    selectResponse(copy.uuid);
  };

  const deleteResponse = () => {
    if (!response) {
      return;
    }
    const index = route.responses.findIndex((item) => item.uuid === response.uuid);
    const neighbor = route.responses[index + 1] ?? route.responses[index - 1];
    // the mutator moves the default flag to the first remaining response
    mutate((current) => removeRouteResponseMutator(current, route.uuid, response.uuid));
    if (neighbor) {
      selectResponse(neighbor.uuid);
    }
  };

  const address = {
    hostname: environment.hostname,
    port: environment.port,
    endpointPrefix: environment.endpointPrefix,
    tlsEnabled: environment.tlsOptions?.enabled === true,
  };
  const url = routeUrl(address, route.endpoint);
  const canOpen =
    isHttp && (route.method === 'get' || route.method === 'all') && status === 'running';
  const defaultHint =
    route.responseMode === ResponseMode.FALLBACK
      ? S.responses.defaultHintFallback
      : route.responseMode === ResponseMode.DISABLE_RULES
        ? S.responses.defaultHintDisableRules
        : null;

  return (
    <div className={styles.editor}>
      {!isHttp && (
        <div className="banner" role="note">
          {S.route.limitedRoute(isCrud ? S.route.crud : S.route.websocket)}
        </div>
      )}

      <section className={styles.routeHeader} aria-label={S.header.tabs.routes}>
        <div className={styles.pathRow}>
          {isHttp && (
            <label className="field" style={{ flex: '0 0 130px' }}>
              <span className="field-label">{S.route.method}</span>
              <select
                className="select"
                value={route.method}
                onChange={(event) =>
                  updateRoute({ method: event.target.value as keyof typeof Methods })
                }
              >
                {METHODS.map((method) => (
                  <option key={method} value={method}>
                    {method === 'all' ? S.route.allMethods : method.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field grow">
            <span className="field-label">{S.route.path}</span>
            <span className={styles.pathField}>
              <span className={`${styles.pathPrefix} truncate`} title={mockBaseUrl(address)}>
                {mockBaseUrl(address)}/
              </span>
              <input
                ref={pathRef}
                className={`input mono ${styles.pathInput}`}
                placeholder={S.route.pathPlaceholder}
                spellCheck={false}
                value={route.endpoint}
                onChange={(event) =>
                  updateRoute({ endpoint: RemoveLeadingSlash(event.target.value) })
                }
              />
            </span>
          </label>
          <div className={styles.pathActions}>
            <CopyButton text={url} label={S.route.copyUrl} />
            {canOpen && (
              <a className="btn btn-small" href={url} target="_blank" rel="noreferrer noopener">
                {S.route.openUrl}
              </a>
            )}
            <Toggle
              checked={enabled}
              label={S.common.enabled}
              onChange={(checked) =>
                setDisabledRoutes(
                  checked
                    ? disabledRoutes.filter((item) => item !== route.uuid)
                    : [...disabledRoutes, route.uuid],
                )
              }
            />
          </div>
        </div>
        <p className="field-help">{S.route.pathHelp}</p>

        <label className="field">
          <span className="sr-only">{S.route.documentation}</span>
          <input
            className="input"
            placeholder={S.route.documentationPlaceholder}
            value={route.documentation}
            onChange={(event) => updateRoute({ documentation: event.target.value })}
          />
        </label>

        {!isCrud && (
          <div className="row-wrap">
            <span className="field-label">{S.route.responseMode}</span>
            <Segmented
              label={S.route.responseMode}
              value={route.responseMode}
              options={MODES}
              onChange={(responseMode) => updateRoute({ responseMode })}
            />
          </div>
        )}
      </section>

      <section className={styles.responses} aria-label={S.responses.title}>
        {!response ? (
          <div className="center" style={{ height: 'auto' }}>
            <p>{S.responses.noResponse}</p>
            <Button variant="primary" icon="plus" onClick={addResponse}>
              {S.responses.add}
            </Button>
          </div>
        ) : (
          <>
            <div className={styles.responseBar}>
              <ResponseSelector
                route={route}
                selected={response}
                onSelect={selectResponse}
                onReorder={(sourceId, targetId, reorderActionType) =>
                  mutate((current) =>
                    reorderRouteResponseMutator(current, route.uuid, {
                      sourceId,
                      targetId,
                      reorderActionType,
                      sourceParentId: route.uuid,
                      targetParentId: route.uuid,
                      isSourceContainer: false,
                      isTargetContainer: false,
                    }),
                  )
                }
              />
              <Button icon="plus" iconOnly label={S.responses.add} onClick={addResponse} />
              <Button
                icon="copy"
                iconOnly
                label={S.responses.duplicate}
                onClick={duplicateResponse}
              />
              <ConfirmButton
                icon="trash"
                iconOnly
                label={S.responses.delete}
                disabled={isCrud && response.default}
                onConfirm={deleteResponse}
              />
              {response.default
                ? defaultHint && (
                    <span className="muted" title={defaultHint}>
                      {S.responses.isDefault} ⓘ
                    </span>
                  )
                : !isCrud && (
                    <Button icon="flag" onClick={() => updateResponse({ default: true })}>
                      {S.responses.setDefault}
                    </Button>
                  )}
            </div>

            <div className="tabs" role="tablist">
              {(
                [
                  ['body', S.responses.tabs.body],
                  ['headers', S.responses.tabs.headers(response.headers.length)],
                  ['rules', S.responses.tabs.rules(response.rules.length)],
                  ['settings', S.responses.tabs.settings],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  className="tab"
                  aria-selected={tab === id}
                  onClick={() => setTab(id)}
                >
                  {label}
                </button>
              ))}
            </div>

            <div role="tabpanel">
              {tab === 'body' && (
                <StatusBodyTab
                  key={response.uuid}
                  environment={environment}
                  response={response}
                  onChange={updateResponse}
                />
              )}

              {tab === 'headers' && (
                <div className={styles.tabContent}>
                  <KeyValueList
                    items={response.headers}
                    onChange={(headers) => updateResponse({ headers })}
                  />
                  {environment.headers.some((header) => header.key) && (
                    <div className="note">
                      <div className="row" style={{ marginBottom: 4 }}>
                        <span className="grow">{S.headers.environmentHeaders}</span>
                        <Link to={`/env/${envUuid}/settings`}>
                          {S.headers.editEnvironmentHeaders}
                        </Link>
                      </div>
                      {environment.headers
                        .filter((header) => header.key)
                        .map((header, index) => (
                          <div key={index} className="mono">
                            {header.key}: {header.value}
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              )}

              {tab === 'rules' && (
                <div className={styles.tabContent}>
                  <RulesEditor
                    rules={response.rules}
                    rulesOperator={response.rulesOperator}
                    responseMode={route.responseMode}
                    onChange={updateResponse}
                  />
                </div>
              )}

              {tab === 'settings' && (
                <div className={styles.tabContent} style={{ maxWidth: 420 }}>
                  <ValidatedInput
                    key={response.uuid}
                    label={S.responseSettings.latency}
                    value={String(response.latency)}
                    inputMode="numeric"
                    validate={validateNonNegativeInteger}
                    help={S.responseSettings.latencyHelp}
                    onCommit={(value) => updateResponse({ latency: Number(value) })}
                  />
                  <div>
                    <Toggle
                      checked={response.disableTemplating}
                      label={S.responseSettings.disableTemplating}
                      onChange={(disableTemplating) => updateResponse({ disableTemplating })}
                    />
                    <p className="field-help">{S.responseSettings.disableTemplatingHelp}</p>
                  </div>
                  {isCrud && (
                    <label className="field">
                      <span className="field-label">{S.responseSettings.crudKey}</span>
                      <input className="input mono" value={response.crudKey} readOnly />
                    </label>
                  )}
                  {response.callbacks.length > 0 && (
                    <div className="note">
                      {S.responseSettings.callbacks(response.callbacks.length)}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
