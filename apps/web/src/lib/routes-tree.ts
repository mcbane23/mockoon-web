import type { Environment, Folder, FolderChild, Route } from '@mockoon/commons';

export type TreeNode = {
  kind: 'route' | 'folder';
  uuid: string;
  depth: number;
  /** 'root' or the uuid of the containing folder. */
  parentId: string;
  children: TreeNode[];
};

/**
 * Build the tree from rootChildren and folder.children. Entries pointing to a missing uuid are
 * skipped, and so are folders that would create a cycle.
 */
export function buildRoutesTree(
  environment: Pick<Environment, 'routes' | 'folders' | 'rootChildren'>,
): TreeNode[] {
  const routes = new Set(environment.routes.map((route) => route.uuid));
  const folders = new Map<string, Folder>(
    environment.folders.map((folder) => [folder.uuid, folder]),
  );
  const visited = new Set<string>();

  const build = (children: FolderChild[], depth: number, parentId: string): TreeNode[] => {
    const nodes: TreeNode[] = [];
    for (const child of children) {
      if (child.type === 'route') {
        if (routes.has(child.uuid)) {
          nodes.push({ kind: 'route', uuid: child.uuid, depth, parentId, children: [] });
        }
        continue;
      }
      const folder = folders.get(child.uuid);
      if (!folder || visited.has(folder.uuid)) {
        continue;
      }
      visited.add(folder.uuid);
      nodes.push({
        kind: 'folder',
        uuid: folder.uuid,
        depth,
        parentId,
        children: build(folder.children, depth + 1, folder.uuid),
      });
    }

    return nodes;
  };

  return build(environment.rootChildren, 0, 'root');
}

/** Case-insensitive substring match on path, method and documentation. */
export function routeMatchesFilter(route: Route, filter: string): boolean {
  const query = filter.trim().toLowerCase();
  if (!query) {
    return true;
  }

  return (
    `/${route.endpoint}`.toLowerCase().includes(query) ||
    route.method.toLowerCase().includes(query) ||
    route.documentation.toLowerCase().includes(query)
  );
}

/** Keep only matching routes and the folders that contain them. */
export function filterTree(nodes: TreeNode[], routes: Route[], filter: string): TreeNode[] {
  if (!filter.trim()) {
    return nodes;
  }
  const byUuid = new Map(routes.map((route) => [route.uuid, route]));
  const walk = (list: TreeNode[]): TreeNode[] =>
    list.flatMap((node) => {
      if (node.kind === 'route') {
        const route = byUuid.get(node.uuid);

        return route && routeMatchesFilter(route, filter) ? [node] : [];
      }
      const children = walk(node.children);

      return children.length > 0 ? [{ ...node, children }] : [];
    });

  return walk(nodes);
}

/** Rows in display order; children of collapsed folders are left out. */
export function flattenTree(nodes: TreeNode[], collapsed: ReadonlySet<string>): TreeNode[] {
  const rows: TreeNode[] = [];
  const walk = (list: TreeNode[]) => {
    for (const node of list) {
      rows.push(node);
      if (node.kind === 'folder' && !collapsed.has(node.uuid)) {
        walk(node.children);
      }
    }
  };
  walk(nodes);

  return rows;
}

/** Route uuids in display order (all folders expanded). */
export function routeOrder(nodes: TreeNode[]): string[] {
  return flattenTree(nodes, new Set())
    .filter((node) => node.kind === 'route')
    .map((node) => node.uuid);
}

/**
 * HTTP routes whose method + path combination exists on another HTTP route. The engine only ever
 * serves the first one.
 */
export function findDuplicateRoutes(routes: Route[]): Set<string> {
  const seen = new Map<string, string[]>();
  for (const route of routes) {
    if (route.type !== 'http') {
      continue;
    }
    const key = `${route.method} ${route.endpoint}`;
    seen.set(key, [...(seen.get(key) ?? []), route.uuid]);
  }
  const duplicates = new Set<string>();
  for (const uuids of seen.values()) {
    if (uuids.length > 1) {
      uuids.forEach((uuid) => duplicates.add(uuid));
    }
  }

  return duplicates;
}

/** uuids of a folder and of every folder nested in it. */
export function folderWithDescendants(folders: Folder[], folderUuid: string): Set<string> {
  const byUuid = new Map(folders.map((folder) => [folder.uuid, folder]));
  const result = new Set<string>();
  const walk = (uuid: string) => {
    if (result.has(uuid)) {
      return;
    }
    result.add(uuid);
    for (const child of byUuid.get(uuid)?.children ?? []) {
      if (child.type === 'folder') {
        walk(child.uuid);
      }
    }
  };
  walk(folderUuid);

  return result;
}

export function findNode(nodes: TreeNode[], uuid: string): TreeNode | null {
  for (const node of nodes) {
    if (node.uuid === uuid) {
      return node;
    }
    const nested = findNode(node.children, uuid);
    if (nested) {
      return nested;
    }
  }

  return null;
}
