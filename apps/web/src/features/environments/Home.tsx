import { Navigate } from 'react-router-dom';
import { Button } from '../../components/Button';
import { useAppStore } from '../../store/app-store';
import { S } from '../../strings';
import { useShell } from './Shell';

/** "/" redirects to the first environment, or shows the empty state of the application. */
export function Home() {
  const summaries = useAppStore((store) => store.summaries);
  const shell = useShell();
  const first = summaries[0];

  if (first) {
    return <Navigate to={`/env/${first.uuid}/routes`} replace />;
  }

  return (
    <div className="center">
      <h1 style={{ color: 'var(--text)', fontSize: 22 }}>{S.empty.title}</h1>
      <p style={{ maxWidth: 520 }}>{S.empty.description}</p>
      <div className="row-wrap" style={{ justifyContent: 'center' }}>
        <Button variant="primary" size="large" icon="plus" onClick={shell.newEnvironment}>
          {S.empty.newEnvironment}
        </Button>
        <Button size="large" icon="file" onClick={shell.openEnvironment}>
          {S.empty.openFile}
        </Button>
        <Button size="large" icon="upload" onClick={() => shell.importEnvironment()}>
          {S.empty.importFile}
        </Button>
      </div>
      <Button variant="ghost" onClick={shell.createDemo}>
        {S.empty.demo}
      </Button>
    </div>
  );
}
