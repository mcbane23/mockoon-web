import type { AppSettingsPatch } from '@stubhouse/shared';
import { Link } from 'react-router-dom';
import { api, errorText } from '../../api/client';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { Toggle } from '../../components/Toggle';
import { ValidatedInput } from '../../components/ValidatedInput';
import { isLoopback } from '../../lib/mock-url';
import { validateIntegerInRange } from '../../lib/validation';
import { toastError, useAppStore } from '../../store/app-store';
import { S } from '../../strings';
import { useShell } from '../environments/Shell';

export function AppSettingsPage() {
  const state = useAppStore((store) => store.state);
  const shell = useShell();

  if (!state) {
    return null;
  }
  const { settings, limits } = state;

  const save = async (patch: AppSettingsPatch) => {
    try {
      const next = await api.updateSettings(patch);
      useAppStore.setState({ state: { ...state, settings: next } });
    } catch (error) {
      toastError(errorText(error));
    }
  };

  const logout = async () => {
    try {
      await api.logout();
      shell.onLoggedOut();
    } catch (error) {
      toastError(errorText(error));
    }
  };

  const kbMin = Math.ceil(limits.logBodyLimitBytes.min / 1024);
  const kbMax = Math.floor(limits.logBodyLimitBytes.max / 1024);

  return (
    <div className="page">
      <div className="page-narrow">
        <div className="row" style={{ marginBottom: 16 }}>
          <Link to="/" className="btn btn-small" aria-label={S.appSettings.back}>
            <Icon name="back" size={14} />
            {S.appSettings.back}
          </Link>
          <h1 style={{ fontSize: 18 }}>{S.appSettings.title}</h1>
        </div>

        <section className="section" style={{ maxWidth: 420 }}>
          <ValidatedInput
            label={S.appSettings.maxLogs}
            value={String(settings.maxLogsPerEnvironment)}
            inputMode="numeric"
            commitOn="blur"
            validate={(value) =>
              validateIntegerInRange(
                value,
                limits.maxLogsPerEnvironment.min,
                limits.maxLogsPerEnvironment.max,
              )
            }
            help={S.appSettings.nextStart}
            onCommit={(value) => void save({ maxLogsPerEnvironment: Number(value) })}
          />
          <ValidatedInput
            label={S.appSettings.logBodyLimit}
            value={String(Math.round(settings.logBodyLimitBytes / 1024))}
            inputMode="numeric"
            commitOn="blur"
            validate={(value) => validateIntegerInRange(value, kbMin, kbMax)}
            help={S.appSettings.nextStart}
            onCommit={(value) => void save({ logBodyLimitBytes: Number(value) * 1024 })}
          />
          <Toggle
            checked={settings.restoreRunningOnStart}
            label={S.appSettings.restore}
            onChange={(restoreRunningOnStart) => void save({ restoreRunningOnStart })}
          />
          <div>
            <Toggle
              checked={settings.enableRandomLatency}
              label={S.appSettings.randomLatency}
              onChange={(enableRandomLatency) => void save({ enableRandomLatency })}
            />
            <p className="field-help">
              {S.appSettings.randomLatencyHelp} {S.appSettings.nextStart}
            </p>
          </div>
        </section>

        <section className="section">
          <h2 className="section-title">{S.appSettings.info}</h2>
          <table className="kv-table">
            <tbody>
              <tr>
                <th scope="row">{S.appSettings.version}</th>
                <td>{state.appVersion}</td>
              </tr>
              <tr>
                <th scope="row">{S.appSettings.engineVersion}</th>
                <td>{state.engineVersion}</td>
              </tr>
              <tr>
                <th scope="row">{S.appSettings.dataDir}</th>
                <td className="mono">{state.dataDir}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="section">
          <h2 className="section-title">{S.appSettings.auth}</h2>
          {state.authRequired ? (
            <>
              <p className="field-help">{S.appSettings.authEnabledHelp}</p>
              <div>
                <Button onClick={() => void logout()}>{S.appSettings.logout}</Button>
              </div>
            </>
          ) : (
            !isLoopback(window.location.hostname) && (
              <div className="banner banner-warning" role="note">
                {S.appSettings.authDisabled}
              </div>
            )
          )}
        </section>

        <p className="field-help">{S.shortcuts.hint}</p>
      </div>
    </div>
  );
}
