import { CORSHeaders, updateEnvironmentMutator, type Environment } from '@mockoon/commons';
import { useParams } from 'react-router-dom';
import { Button } from '../../components/Button';
import { CopyButton } from '../../components/CopyButton';
import { KeyValueList } from '../../components/KeyValueList';
import { Toggle } from '../../components/Toggle';
import { ValidatedInput } from '../../components/ValidatedInput';
import {
  NAME_MAX_LENGTH,
  normalizePrefix,
  validateName,
  validateNonNegativeInteger,
  validatePort,
} from '../../lib/validation';
import { useAppStore } from '../../store/app-store';
import { useEnvironmentStore } from '../../store/environment-store';
import { S } from '../../strings';

/** Add the standard CORS headers that are not there yet (compared by key, case-insensitively). */
export function addMissingCorsHeaders(headers: Environment['headers']): Environment['headers'] {
  const existing = new Set(headers.map((header) => header.key.trim().toLowerCase()));
  const missing = CORSHeaders.filter((header) => !existing.has(header.key.toLowerCase()));

  return missing.length === 0 ? headers : [...headers, ...missing.map((header) => ({ ...header }))];
}

export function EnvSettingsPage() {
  const { envUuid = '' } = useParams();
  const environment = useEnvironmentStore((store) => store.environment);
  const mutate = useEnvironmentStore((store) => store.mutate);
  const uiPort = useAppStore((store) => store.state?.uiPort);
  const summaries = useAppStore((store) => store.summaries);
  const summary = summaries.find((item) => item.uuid === envUuid);

  if (!environment || !summary) {
    return null;
  }

  const update = (patch: Partial<Environment>) =>
    mutate((current) => updateEnvironmentMutator(current, patch));

  // a warning, not an error: an environment that is not running may share a port
  const samePort = summaries.find(
    (item) => item.uuid !== envUuid && item.hasData && item.port === environment.port,
  );

  return (
    <div className="page">
      <div className="page-narrow">
        <section className="section" aria-label={S.envSettings.title}>
          <ValidatedInput
            label={S.envSettings.name}
            value={environment.name}
            maxLength={NAME_MAX_LENGTH}
            commitOn="blur"
            validate={validateName}
            normalize={(value) => value.trim()}
            onCommit={(name) => update({ name })}
          />
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: '0 0 160px' }}>
              <ValidatedInput
                label={S.envSettings.port}
                value={String(environment.port)}
                inputMode="numeric"
                commitOn="blur"
                validate={(value) => validatePort(value, uiPort)}
                normalize={(value) => value.trim()}
                warning={samePort ? S.validation.portShared(samePort.name) : undefined}
                help={S.envSettings.portHelp}
                onCommit={(port) => update({ port: Number(port) })}
              />
            </div>
            <div className="grow">
              <ValidatedInput
                label={S.envSettings.hostname}
                value={environment.hostname}
                placeholder={S.envSettings.hostnamePlaceholder}
                commitOn="blur"
                spellCheck={false}
                normalize={(value) => value.trim()}
                help={S.envSettings.hostnameHelp}
                onCommit={(hostname) => update({ hostname })}
              />
            </div>
          </div>
          <ValidatedInput
            label={S.envSettings.prefix}
            value={environment.endpointPrefix}
            placeholder={S.envSettings.prefixPlaceholder}
            commitOn="blur"
            spellCheck={false}
            mono
            normalize={normalizePrefix}
            help={S.envSettings.prefixHelp}
            onCommit={(endpointPrefix) => update({ endpointPrefix })}
          />
          <div style={{ maxWidth: 160 }}>
            <ValidatedInput
              label={S.envSettings.latency}
              value={String(environment.latency)}
              inputMode="numeric"
              commitOn="blur"
              validate={validateNonNegativeInteger}
              normalize={(value) => value.trim()}
              help={S.envSettings.latencyHelp}
              onCommit={(latency) => update({ latency: Number(latency) })}
            />
          </div>
          <div className="field">
            <span className="field-label">{S.envSettings.cors}</span>
            <Toggle
              checked={environment.cors}
              label={S.envSettings.corsLabel}
              onChange={(cors) => update({ cors })}
            />
          </div>
        </section>

        <section className="section">
          <h2 className="section-title">{S.envSettings.headers}</h2>
          <p className="field-help">{S.envSettings.headersHelp}</p>
          <KeyValueList items={environment.headers} onChange={(headers) => update({ headers })} />
          <div>
            <Button
              size="small"
              onClick={() => update({ headers: addMissingCorsHeaders(environment.headers) })}
            >
              {S.envSettings.addCorsHeaders}
            </Button>
          </div>
        </section>

        <section className="section">
          <h2 className="section-title">{S.envSettings.file}</h2>
          <div className="row">
            <input
              className="input mono"
              readOnly
              aria-label={S.envSettings.file}
              value={summary.path}
            />
            <CopyButton text={summary.path} />
          </div>
        </section>

        <section className="section">
          <h2 className="section-title">{S.envSettings.notEditable}</h2>
          <p className="field-help">{S.envSettings.notEditableHelp}</p>
          <table className="kv-table">
            <tbody>
              <tr>
                <th scope="row">{S.envSettings.proxy}</th>
                <td>
                  {environment.proxyMode
                    ? S.envSettings.proxyOn(environment.proxyHost)
                    : S.common.disabled}
                </td>
              </tr>
              <tr>
                <th scope="row">{S.envSettings.tls}</th>
                <td>{environment.tlsOptions?.enabled ? S.common.enabled : S.common.disabled}</td>
              </tr>
              <tr>
                <th scope="row">{S.envSettings.dataBuckets}</th>
                <td>{environment.data.length}</td>
              </tr>
              <tr>
                <th scope="row">{S.envSettings.callbacks}</th>
                <td>{environment.callbacks.length}</td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
