import { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api, clientId, errorText, setUnauthorizedHandler } from './api/client';
import { Button } from './components/Button';
import { AppSettingsPage } from './features/app-settings/AppSettingsPage';
import { LoginPage } from './features/auth/LoginPage';
import { EnvSettingsPage } from './features/env-settings/EnvSettingsPage';
import { EnvironmentLayout } from './features/environments/EnvironmentLayout';
import { Home } from './features/environments/Home';
import { Shell } from './features/environments/Shell';
import { LogsPage } from './features/logs/LogsPage';
import { RoutesPage } from './features/routes/RoutesPage';
import { useAppStore } from './store/app-store';
import { startSync } from './store/sync';
import { S } from './strings';

type Boot =
  | { phase: 'loading' }
  | { phase: 'ready' }
  | { phase: 'login' }
  | { phase: 'error'; message: string };

export function App() {
  const [boot, setBoot] = useState<Boot>({ phase: 'loading' });
  const loadState = useAppStore((store) => store.loadState);
  const location = useLocation();
  const navigate = useNavigate();

  const bootstrap = useCallback(async () => {
    try {
      const status = await api.authStatus();
      if (status.authRequired && !status.authenticated) {
        setBoot({ phase: 'login' });

        return false;
      }
      await loadState();
      setBoot({ phase: 'ready' });

      return true;
    } catch (error) {
      setBoot({ phase: 'error', message: errorText(error) });

      return false;
    }
  }, [loadState]);

  useEffect(() => {
    // any 401 from the API sends the user to the login page
    setUnauthorizedHandler(() => setBoot({ phase: 'login' }));
    void bootstrap();
  }, [bootstrap]);

  // live updates only while logged in
  useEffect(() => {
    if (boot.phase !== 'ready') {
      return;
    }

    return startSync(clientId);
  }, [boot.phase]);

  if (boot.phase === 'loading') {
    return (
      <div className="center" role="status">
        <span className="spinner" />
        {S.common.loading}
      </div>
    );
  }

  if (boot.phase === 'error') {
    return (
      <div className="center" role="alert">
        <p>{boot.message}</p>
        <Button onClick={() => void bootstrap()}>{S.common.retry}</Button>
      </div>
    );
  }

  if (boot.phase === 'login') {
    if (location.pathname !== '/login') {
      const from = `${location.pathname}${location.search}`;

      return <Navigate to="/login" replace state={{ from }} />;
    }

    return (
      <LoginPage
        onLoggedIn={async () => {
          const from = (location.state as { from?: string } | null)?.from;
          if (await bootstrap()) {
            navigate(from && from !== '/login' ? from : '/', { replace: true });
          }
        }}
      />
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route element={<Shell onLoggedOut={() => setBoot({ phase: 'login' })} />}>
        <Route path="/" element={<Home />} />
        <Route path="/settings" element={<AppSettingsPage />} />
        <Route path="/env/:envUuid" element={<EnvironmentLayout />}>
          <Route index element={<Navigate to="routes" replace />} />
          <Route path="routes" element={<RoutesPage />} />
          <Route path="routes/:routeUuid" element={<RoutesPage />} />
          <Route path="logs" element={<LogsPage />} />
          <Route path="settings" element={<EnvSettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
