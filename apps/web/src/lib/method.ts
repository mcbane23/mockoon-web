import type { Route } from '@mockoon/commons';

const COLORED = new Set(['get', 'post', 'put', 'patch', 'delete']);

/** Label and CSS class for the method badge of a route. */
export function methodBadge(route: Pick<Route, 'type' | 'method'>): {
  label: string;
  className: string;
} {
  if (route.type === 'crud') {
    return { label: 'CRUD', className: 'badge method' };
  }
  if (route.type === 'ws') {
    return { label: 'WS', className: 'badge method' };
  }

  return methodBadgeFor(route.method);
}

export function methodBadgeFor(method: string): { label: string; className: string } {
  const value = method.toLowerCase();

  return {
    label: value.toUpperCase() || '—',
    className: `badge method${COLORED.has(value) ? ` method-${value}` : ''}`,
  };
}

export const statusClass = (status: number): string =>
  status >= 500
    ? 'status-5xx'
    : status >= 400
      ? 'status-4xx'
      : status >= 300
        ? 'status-3xx'
        : status >= 200
          ? 'status-2xx'
          : '';
