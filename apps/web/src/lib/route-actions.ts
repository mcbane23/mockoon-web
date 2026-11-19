import {
  ReorderActionType,
  findRouteOrFolderContainer,
  reorderRoutesMutator,
  routesFromFolder,
  type Environment,
  type FolderChild,
} from '@mockoon/commons';
import { findNode, folderWithDescendants, routeOrder, type TreeNode } from './routes-tree';

/**
 * Delete a folder but keep what is inside: its children take the folder's place in the parent,
 * in the same order.
 *
 * removeFolderMutator from @mockoon/commons only removes the folder itself and leaves its routes
 * and subfolders unreferenced (the schema repair then re-attaches them at the end of the root
 * level). Doing the move explicitly keeps the result predictable and identical on client and
 * server.
 */
export function removeFolderKeepChildren(
  environment: Environment,
  folderUuid: string,
): Environment {
  const folder = environment.folders.find((item) => item.uuid === folderUuid);
  const containerId = findRouteOrFolderContainer(folderUuid, environment);
  if (!folder || !containerId) {
    return environment;
  }
  const replace = (children: FolderChild[]): FolderChild[] =>
    children.flatMap((child) => (child.uuid === folderUuid ? folder.children : [child]));

  return {
    ...environment,
    rootChildren:
      containerId === 'root' ? replace(environment.rootChildren) : environment.rootChildren,
    folders: environment.folders
      .filter((item) => item.uuid !== folderUuid)
      .map((item) =>
        item.uuid === containerId ? { ...item, children: replace(item.children) } : item,
      ),
  };
}

/** Count what a folder contains, recursively. */
export function folderContent(
  environment: Environment,
  folderUuid: string,
): { routes: number; folders: number } {
  const folder = environment.folders.find((item) => item.uuid === folderUuid);
  if (!folder) {
    return { routes: 0, folders: 0 };
  }

  return {
    routes: routesFromFolder(folder.children, environment.folders, environment.routes).length,
    folders: folderWithDescendants(environment.folders, folderUuid).size - 1,
  };
}

/**
 * Enable or disable every route of a folder (recursively). When all of them are already
 * disabled they are enabled; otherwise all are disabled.
 */
export function toggleFolderRoutes(
  environment: Environment,
  folderUuid: string,
  disabledRoutes: string[],
): string[] {
  const folder = environment.folders.find((item) => item.uuid === folderUuid);
  if (!folder) {
    return disabledRoutes;
  }
  const uuids = routesFromFolder(folder.children, environment.folders, environment.routes).map(
    (route) => route.uuid,
  );
  if (uuids.length === 0) {
    return disabledRoutes;
  }
  const disabled = new Set(disabledRoutes);
  if (uuids.every((uuid) => disabled.has(uuid))) {
    return disabledRoutes.filter((uuid) => !uuids.includes(uuid));
  }

  return [...new Set([...disabledRoutes, ...uuids])];
}

/** Route to select after deleting one: the next one in display order, else the previous one. */
export function neighborRoute(tree: TreeNode[], routeUuid: string): string | null {
  const order = routeOrder(tree);
  const index = order.indexOf(routeUuid);
  if (index === -1) {
    return order[0] ?? null;
  }

  return order[index + 1] ?? order[index - 1] ?? null;
}

export type DropPosition = 'before' | 'after' | 'inside';

/** A folder cannot be dropped into itself or into one of its descendants. */
export function canDrop(
  environment: Environment,
  tree: TreeNode[],
  sourceUuid: string,
  targetUuid: string,
  position: DropPosition,
): boolean {
  if (sourceUuid === targetUuid) {
    return false;
  }
  const source = findNode(tree, sourceUuid);
  const target = findNode(tree, targetUuid);
  if (!source || !target) {
    return false;
  }
  if (position === 'inside' && target.kind !== 'folder') {
    return false;
  }
  if (source.kind === 'folder') {
    const forbidden = folderWithDescendants(environment.folders, sourceUuid);
    if (forbidden.has(targetUuid) || forbidden.has(target.parentId)) {
      return false;
    }
  }

  return true;
}

const ACTION_TYPES: Record<DropPosition, ReorderActionType> = {
  before: ReorderActionType.BEFORE,
  after: ReorderActionType.AFTER,
  inside: ReorderActionType.INSIDE,
};

/** Move a route or folder before, after or inside another one. */
export function moveNode(
  environment: Environment,
  tree: TreeNode[],
  sourceUuid: string,
  targetUuid: string,
  position: DropPosition,
): Environment {
  if (!canDrop(environment, tree, sourceUuid, targetUuid, position)) {
    return environment;
  }
  const source = findNode(tree, sourceUuid)!;
  const target = findNode(tree, targetUuid)!;

  return reorderRoutesMutator(environment, {
    sourceId: sourceUuid,
    sourceParentId: source.parentId,
    targetId: targetUuid,
    targetParentId: target.parentId,
    reorderActionType: ACTION_TYPES[position],
    isSourceContainer: source.kind === 'folder',
    isTargetContainer: target.kind === 'folder',
  });
}

/** Sibling to swap with when moving up or down inside the same parent. */
export function siblingOf(tree: TreeNode[], uuid: string, direction: 'up' | 'down'): string | null {
  const find = (nodes: TreeNode[]): string | null | undefined => {
    const index = nodes.findIndex((node) => node.uuid === uuid);
    if (index !== -1) {
      return nodes[direction === 'up' ? index - 1 : index + 1]?.uuid ?? null;
    }
    for (const node of nodes) {
      const nested = find(node.children);
      if (nested !== undefined) {
        return nested;
      }
    }

    return undefined;
  };

  return find(tree) ?? null;
}
