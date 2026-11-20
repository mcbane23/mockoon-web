import type { EnvironmentSummary } from '@mockpit/shared';
import { useState } from 'react';
import { errorText } from '../../api/client';
import { Button } from '../../components/Button';
import { Modal } from '../../components/Modal';
import { validateName, validatePort } from '../../lib/validation';
import { useAppStore } from '../../store/app-store';
import { S } from '../../strings';
import { closeEnvironment, createEnvironment, openEnvironment } from './actions';

type DialogProps = { onClose: () => void; onCreated: (uuid: string) => void };

export function NewEnvironmentDialog({ onClose, onCreated }: DialogProps) {
  const state = useAppStore((store) => store.state);
  const [name, setName] = useState<string>(S.dialogs.newDefaultName);
  const [port, setPort] = useState(String(state?.nextFreePort ?? 3001));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameError = validateName(name);
  const portError = validatePort(port, state?.uiPort);

  const submit = async () => {
    if (nameError || portError || busy) {
      return;
    }
    setBusy(true);
    try {
      const detail = await createEnvironment({ name: name.trim(), port: Number(port) });
      // refresh the suggested port for the next dialog
      void useAppStore
        .getState()
        .loadState()
        .catch(() => {});
      onCreated(detail.summary.uuid);
      onClose();
    } catch (caught) {
      setError(errorText(caught));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={S.dialogs.newTitle}
      onClose={onClose}
      onSubmit={() => void submit()}
      footer={
        <>
          <Button onClick={onClose}>{S.common.cancel}</Button>
          <Button type="submit" variant="primary" disabled={busy || !!nameError || !!portError}>
            {S.common.create}
          </Button>
        </>
      }
    >
      <label className="field">
        <span className="field-label">{S.dialogs.newName}</span>
        <input
          className="input"
          data-autofocus
          value={name}
          aria-invalid={nameError !== null}
          onChange={(event) => setName(event.target.value)}
        />
        {nameError && <span className="field-error">{nameError}</span>}
      </label>
      <label className="field">
        <span className="field-label">{S.dialogs.newPort}</span>
        <input
          className="input"
          inputMode="numeric"
          value={port}
          aria-invalid={portError !== null}
          onChange={(event) => setPort(event.target.value)}
        />
        {portError ? (
          <span className="field-error">{portError}</span>
        ) : (
          <span className="field-help">{S.dialogs.newPortHelp}</span>
        )}
      </label>
      {error && (
        <div className="field-error" role="alert">
          {error}
        </div>
      )}
    </Modal>
  );
}

export function OpenEnvironmentDialog({ onClose, onCreated }: DialogProps) {
  const [path, setPath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!path.trim() || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const detail = await openEnvironment(path.trim());
      onCreated(detail.summary.uuid);
      onClose();
    } catch (caught) {
      // server errors are shown below the field
      setError(errorText(caught));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={S.dialogs.openTitle}
      onClose={onClose}
      onSubmit={() => void submit()}
      footer={
        <>
          <Button onClick={onClose}>{S.common.cancel}</Button>
          <Button type="submit" variant="primary" disabled={busy || !path.trim()}>
            {S.common.open}
          </Button>
        </>
      }
    >
      <label className="field">
        <span className="field-label">{S.dialogs.openPath}</span>
        <input
          className="input mono"
          data-autofocus
          placeholder="/home/user/mocks/api.json"
          spellCheck={false}
          value={path}
          aria-invalid={error !== null}
          onChange={(event) => setPath(event.target.value)}
        />
        {error && (
          <span className="field-error" role="alert">
            {error}
          </span>
        )}
        <span className="field-help">{S.dialogs.openHelp}</span>
      </label>
    </Modal>
  );
}

export function CloseEnvironmentDialog({
  summary,
  onClose,
}: {
  summary: EnvironmentSummary;
  onClose: () => void;
}) {
  const [deleteFile, setDeleteFile] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    await closeEnvironment(summary.uuid, summary.managed && deleteFile);
    onClose();
  };

  return (
    <Modal
      title={S.dialogs.closeTitle(summary.name)}
      onClose={onClose}
      onSubmit={() => void submit()}
      footer={
        <>
          <Button onClick={onClose}>{S.common.cancel}</Button>
          <Button type="submit" variant="danger" disabled={busy} data-autofocus>
            {S.dialogs.closeConfirm}
          </Button>
        </>
      }
    >
      <p>{S.dialogs.closeBody}</p>
      {summary.managed ? (
        <label className="row">
          <input
            type="checkbox"
            checked={deleteFile}
            onChange={(event) => setDeleteFile(event.target.checked)}
          />
          {S.dialogs.closeDeleteFile}
        </label>
      ) : (
        <p className="muted" style={{ wordBreak: 'break-all' }}>
          {S.dialogs.closeFileStays(summary.path)}
        </p>
      )}
    </Modal>
  );
}
