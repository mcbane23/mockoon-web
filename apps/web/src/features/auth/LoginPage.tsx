import { useState } from 'react';
import { ApiClientError, api, errorText } from '../../api/client';
import { Button } from '../../components/Button';
import { S } from '../../strings';
import styles from './LoginPage.module.css';

export function LoginPage({ onLoggedIn }: { onLoggedIn: () => Promise<void> | void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      await onLoggedIn();
    } catch (caught) {
      if (caught instanceof ApiClientError && caught.status === 401) {
        setError(S.login.wrong);
      } else if (caught instanceof ApiClientError && caught.status === 429) {
        setError(S.login.tooMany);
      } else {
        setError(errorText(caught));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className={styles.wrap}>
      <form className={styles.card} onSubmit={(event) => void submit(event)}>
        <h1 className={styles.title}>{S.login.title}</h1>
        <label className="field">
          <span className="field-label">{S.login.password}</span>
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            aria-invalid={error !== null}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error && (
          <div className="field-error" role="alert">
            {error}
          </div>
        )}
        <Button type="submit" variant="primary" disabled={busy || password === ''}>
          {S.login.submit}
        </Button>
        <p className="field-help">{S.login.hint}</p>
      </form>
    </main>
  );
}
