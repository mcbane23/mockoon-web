import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { buildRoutesTree, routeOrder } from '../../lib/routes-tree';
import { useEnvironmentStore } from '../../store/environment-store';
import { S } from '../../strings';
import { RouteEditor } from '../route-editor/RouteEditor';
import styles from './RoutesPage.module.css';
import { RoutesTree } from './RoutesTree';

const WIDTH_KEY = 'stubhouse.routesWidth';
const MIN_WIDTH = 200;
const MAX_WIDTH = 640;
const DEFAULT_WIDTH = 300;

/** Last selected route per environment, to come back to it when returning to the tab. */
const lastRoute = new Map<string, string>();

const readWidth = (): number => {
  try {
    const stored = Number(localStorage.getItem(WIDTH_KEY));

    return stored >= MIN_WIDTH && stored <= MAX_WIDTH ? stored : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
};

export function RoutesPage() {
  const { envUuid = '', routeUuid } = useParams();
  const navigate = useNavigate();
  const environment = useEnvironmentStore((store) => store.environment);
  const [width, setWidth] = useState(readWidth);
  const dragging = useRef(false);

  const tree = useMemo(() => (environment ? buildRoutesTree(environment) : []), [environment]);
  const route = environment?.routes.find((item) => item.uuid === routeUuid);

  // no route (or a deleted one) in the URL: select the last used or the first route
  useEffect(() => {
    if (!environment || route) {
      if (route) {
        lastRoute.set(envUuid, route.uuid);
      }

      return;
    }
    const order = routeOrder(tree);
    const remembered = lastRoute.get(envUuid);
    const target = remembered && order.includes(remembered) ? remembered : order[0];
    if (target) {
      navigate(`/env/${envUuid}/routes/${target}`, { replace: true });
    } else if (routeUuid) {
      navigate(`/env/${envUuid}/routes`, { replace: true });
    }
  }, [environment, route, routeUuid, tree, envUuid, navigate]);

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const resize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) {
      return;
    }
    const left = event.currentTarget.parentElement?.getBoundingClientRect().left ?? 0;
    setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, event.clientX - left)));
  };
  const endResize = () => {
    dragging.current = false;
    try {
      localStorage.setItem(WIDTH_KEY, String(width));
    } catch {
      // storage may be unavailable
    }
  };

  if (!environment) {
    return null;
  }

  return (
    <div className={styles.page}>
      <div className={styles.tree} style={{ width }}>
        <RoutesTree
          environment={environment}
          envUuid={envUuid}
          tree={tree}
          selectedUuid={route?.uuid ?? null}
        />
      </div>
      <div
        className={styles.resizer}
        role="separator"
        aria-orientation="vertical"
        aria-label={S.routes.resize}
        aria-valuenow={width}
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        tabIndex={0}
        onPointerDown={startResize}
        onPointerMove={resize}
        onPointerUp={endResize}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            setWidth((current) =>
              Math.min(
                MAX_WIDTH,
                Math.max(MIN_WIDTH, current + (event.key === 'ArrowLeft' ? -16 : 16)),
              ),
            );
          }
        }}
      />
      <div className={styles.editor}>
        {route ? (
          <RouteEditor key={route.uuid} environment={environment} envUuid={envUuid} route={route} />
        ) : (
          <div className="center">
            {environment.routes.length === 0 ? S.routes.emptyTitle : S.routes.selectRoute}
          </div>
        )}
      </div>
    </div>
  );
}
