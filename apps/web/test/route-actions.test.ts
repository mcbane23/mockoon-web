import { removeFolderMutator, repairRefs } from '@mockoon/commons';
import { describe, expect, it } from 'vitest';
import {
  canDrop,
  folderContent,
  moveNode,
  neighborRoute,
  removeFolderKeepChildren,
  siblingOf,
  toggleFolderRoutes,
} from '../src/lib/route-actions';
import { buildRoutesTree, routeOrder } from '../src/lib/routes-tree';
import { sampleEnvironment } from './fixtures';

const children = (list: { uuid: string }[]) => list.map((child) => child.uuid);

describe('removing a folder', () => {
  it('documents what the commons mutator does: the content is left unreferenced', () => {
    const { environment, users, auth } = sampleEnvironment();
    const result = removeFolderMutator(environment, users.uuid);

    // routes and the nested folder still exist but nothing points to them any more
    expect(result.routes).toHaveLength(environment.routes.length);
    expect(result.folders.map((folder) => folder.uuid)).toEqual([auth.uuid]);
    expect(children(result.rootChildren)).not.toContain(auth.uuid);
    // ...until the schema repair re-attaches the orphans at the end of the root level
    expect(children(repairRefs(result).rootChildren)).toHaveLength(4);
  });

  it('removeFolderKeepChildren moves the content up, in place and in order', () => {
    const { environment, users, auth, listUsers, createUser, login, health } = sampleEnvironment();
    const result = removeFolderKeepChildren(environment, users.uuid);

    expect(children(result.rootChildren)).toEqual([
      listUsers.uuid,
      createUser.uuid,
      auth.uuid,
      health.uuid,
    ]);
    expect(result.folders.map((folder) => folder.uuid)).toEqual([auth.uuid]);
    expect(result.routes).toEqual(environment.routes);
    // nothing left for the repair to fix
    expect(repairRefs(result)).toEqual(result);

    const nested = removeFolderKeepChildren(environment, auth.uuid);
    expect(children(nested.folders.find((folder) => folder.uuid === users.uuid)!.children)).toEqual(
      [listUsers.uuid, createUser.uuid, login.uuid],
    );
    expect(removeFolderKeepChildren(environment, 'unknown')).toBe(environment);
  });

  it('counts the content of a folder', () => {
    const { environment, users, auth } = sampleEnvironment();
    expect(folderContent(environment, users.uuid)).toEqual({ routes: 3, folders: 1 });
    expect(folderContent(environment, auth.uuid)).toEqual({ routes: 1, folders: 0 });
  });
});

describe('toggleFolderRoutes', () => {
  it('disables all routes of the folder recursively, and enables them when all are disabled', () => {
    const { environment, users, listUsers, createUser, login, health } = sampleEnvironment();
    const all = [listUsers.uuid, createUser.uuid, login.uuid];

    const disabled = toggleFolderRoutes(environment, users.uuid, [health.uuid, login.uuid]);
    expect([...disabled].sort()).toEqual([health.uuid, ...all].sort());

    expect(toggleFolderRoutes(environment, users.uuid, disabled)).toEqual([health.uuid]);
  });
});

describe('moving routes and folders (reorderRoutesMutator)', () => {
  it('reorders inside the same parent', () => {
    const { environment, users, listUsers, createUser, auth } = sampleEnvironment();
    const tree = buildRoutesTree(environment);
    const result = moveNode(environment, tree, createUser.uuid, listUsers.uuid, 'before');

    expect(children(result.folders.find((folder) => folder.uuid === users.uuid)!.children)).toEqual(
      [createUser.uuid, listUsers.uuid, auth.uuid],
    );
  });

  it('moves a route into a folder, out of a folder and between folders', () => {
    const { environment, users, auth, listUsers, createUser, login, health } = sampleEnvironment();
    const tree = buildRoutesTree(environment);

    const into = moveNode(environment, tree, health.uuid, auth.uuid, 'inside');
    expect(children(into.rootChildren)).toEqual([users.uuid]);
    expect(children(into.folders.find((folder) => folder.uuid === auth.uuid)!.children)).toEqual([
      login.uuid,
      health.uuid,
    ]);

    const out = moveNode(environment, tree, login.uuid, health.uuid, 'after');
    expect(children(out.rootChildren)).toEqual([users.uuid, health.uuid, login.uuid]);
    expect(out.folders.find((folder) => folder.uuid === auth.uuid)!.children).toEqual([]);

    const between = moveNode(environment, tree, login.uuid, createUser.uuid, 'before');
    expect(
      children(between.folders.find((folder) => folder.uuid === users.uuid)!.children),
    ).toEqual([listUsers.uuid, login.uuid, createUser.uuid, auth.uuid]);
    // the order in the JSON is the display order
    expect(routeOrder(buildRoutesTree(between))).toEqual([
      listUsers.uuid,
      login.uuid,
      createUser.uuid,
      health.uuid,
    ]);
    // every result is consistent: the schema repair has nothing to fix
    for (const result of [into, out, between]) {
      expect(repairRefs(result)).toEqual(result);
    }
  });

  it('moves a folder with its content', () => {
    const { environment, users, auth, health } = sampleEnvironment();
    const tree = buildRoutesTree(environment);
    const result = moveNode(environment, tree, auth.uuid, health.uuid, 'after');

    expect(children(result.rootChildren)).toEqual([users.uuid, health.uuid, auth.uuid]);
    expect(result.folders.find((folder) => folder.uuid === auth.uuid)!.children).toHaveLength(1);
  });

  it('refuses to drop a folder into itself or one of its descendants', () => {
    const { environment, users, auth, login, health } = sampleEnvironment();
    const tree = buildRoutesTree(environment);

    expect(canDrop(environment, tree, users.uuid, users.uuid, 'inside')).toBe(false);
    expect(canDrop(environment, tree, users.uuid, auth.uuid, 'inside')).toBe(false);
    expect(canDrop(environment, tree, users.uuid, login.uuid, 'before')).toBe(false);
    expect(canDrop(environment, tree, users.uuid, auth.uuid, 'after')).toBe(false);
    expect(canDrop(environment, tree, users.uuid, health.uuid, 'after')).toBe(true);
    expect(canDrop(environment, tree, auth.uuid, users.uuid, 'before')).toBe(true);
    // "inside" only makes sense for folders
    expect(canDrop(environment, tree, health.uuid, login.uuid, 'inside')).toBe(false);
    expect(moveNode(environment, tree, users.uuid, auth.uuid, 'inside')).toBe(environment);
  });
});

describe('selection helpers', () => {
  it('picks the neighbour of a deleted route', () => {
    const { environment, listUsers, createUser, login, health } = sampleEnvironment();
    const tree = buildRoutesTree(environment);

    expect(neighborRoute(tree, listUsers.uuid)).toBe(createUser.uuid);
    expect(neighborRoute(tree, health.uuid)).toBe(login.uuid);
    expect(neighborRoute([], 'x')).toBeNull();
  });

  it('finds siblings inside the same parent', () => {
    const { environment, users, auth, listUsers, createUser, health } = sampleEnvironment();
    const tree = buildRoutesTree(environment);

    expect(siblingOf(tree, createUser.uuid, 'up')).toBe(listUsers.uuid);
    expect(siblingOf(tree, createUser.uuid, 'down')).toBe(auth.uuid);
    expect(siblingOf(tree, listUsers.uuid, 'up')).toBeNull();
    expect(siblingOf(tree, health.uuid, 'up')).toBe(users.uuid);
    expect(siblingOf(tree, health.uuid, 'down')).toBeNull();
  });
});
