import { describe, expect, it } from 'vitest';
import {
  buildRoutesTree,
  filterTree,
  findDuplicateRoutes,
  flattenTree,
  folderWithDescendants,
  routeMatchesFilter,
  routeOrder,
} from '../src/lib/routes-tree';
import { sampleEnvironment } from './fixtures';

describe('buildRoutesTree', () => {
  it('builds the tree from nested folders', () => {
    const { environment, users, auth, listUsers, createUser, login, health } = sampleEnvironment();
    const tree = buildRoutesTree(environment);

    expect(tree.map((node) => [node.kind, node.uuid, node.depth, node.parentId])).toEqual([
      ['folder', users.uuid, 0, 'root'],
      ['route', health.uuid, 0, 'root'],
    ]);
    expect(
      tree[0]?.children.map((node) => [node.kind, node.uuid, node.depth, node.parentId]),
    ).toEqual([
      ['route', listUsers.uuid, 1, users.uuid],
      ['route', createUser.uuid, 1, users.uuid],
      ['folder', auth.uuid, 1, users.uuid],
    ]);
    expect(tree[0]?.children[2]?.children).toEqual([
      { kind: 'route', uuid: login.uuid, depth: 2, parentId: auth.uuid, children: [] },
    ]);
    expect(routeOrder(tree)).toEqual([listUsers.uuid, createUser.uuid, login.uuid, health.uuid]);
  });

  it('skips references to missing routes and folders, and cycles', () => {
    const { environment, users, health } = sampleEnvironment();
    const broken = {
      ...environment,
      rootChildren: [
        { type: 'route' as const, uuid: 'missing-route' },
        { type: 'folder' as const, uuid: 'missing-folder' },
        ...environment.rootChildren,
      ],
      folders: environment.folders.map((folder) =>
        folder.uuid === users.uuid
          ? {
              ...folder,
              children: [...folder.children, { type: 'folder' as const, uuid: users.uuid }],
            }
          : folder,
      ),
    };
    const tree = buildRoutesTree(broken);

    expect(tree.map((node) => node.uuid)).toEqual([users.uuid, health.uuid]);
    expect(tree[0]?.children).toHaveLength(3);
  });

  it('hides the content of collapsed folders', () => {
    const { environment, users, auth, listUsers, createUser, health } = sampleEnvironment();
    const tree = buildRoutesTree(environment);

    expect(flattenTree(tree, new Set([users.uuid])).map((node) => node.uuid)).toEqual([
      users.uuid,
      health.uuid,
    ]);
    expect(flattenTree(tree, new Set([auth.uuid])).map((node) => node.uuid)).toEqual([
      users.uuid,
      listUsers.uuid,
      createUser.uuid,
      auth.uuid,
      health.uuid,
    ]);
  });
});

describe('filter', () => {
  it('matches path, method and documentation without case sensitivity', () => {
    const { listUsers, login } = sampleEnvironment();

    expect(routeMatchesFilter(listUsers, 'USERS')).toBe(true);
    expect(routeMatchesFilter(listUsers, 'get')).toBe(true);
    expect(routeMatchesFilter(listUsers, 'list us')).toBe(true);
    expect(routeMatchesFilter(listUsers, '/users')).toBe(true);
    expect(routeMatchesFilter(login, 'users')).toBe(false);
    expect(routeMatchesFilter(login, '  ')).toBe(true);
  });

  it('keeps only matching routes and their folders', () => {
    const { environment, users, auth, login, createUser } = sampleEnvironment();
    const tree = buildRoutesTree(environment);

    const byPath = flattenTree(filterTree(tree, environment.routes, 'login'), new Set());
    expect(byPath.map((node) => node.uuid)).toEqual([users.uuid, auth.uuid, login.uuid]);

    const byMethod = flattenTree(filterTree(tree, environment.routes, 'post'), new Set());
    expect(byMethod.map((node) => node.uuid)).toEqual([
      users.uuid,
      createUser.uuid,
      auth.uuid,
      login.uuid,
    ]);

    expect(filterTree(tree, environment.routes, 'nothing-matches')).toEqual([]);
    expect(filterTree(tree, environment.routes, '')).toBe(tree);
  });
});

describe('helpers', () => {
  it('finds HTTP routes with the same method and path', () => {
    const { environment, listUsers, createUser, health } = sampleEnvironment();
    expect(findDuplicateRoutes(environment.routes).size).toBe(0);

    const twin = { ...health, uuid: 'twin', endpoint: 'users', method: 'get' as const };
    const duplicates = findDuplicateRoutes([...environment.routes, twin]);
    expect([...duplicates].sort()).toEqual([listUsers.uuid, 'twin'].sort());
    expect(duplicates.has(createUser.uuid)).toBe(false);
  });

  it('lists a folder with its nested folders', () => {
    const { environment, users, auth } = sampleEnvironment();
    expect(folderWithDescendants(environment.folders, users.uuid)).toEqual(
      new Set([users.uuid, auth.uuid]),
    );
    expect(folderWithDescendants(environment.folders, auth.uuid)).toEqual(new Set([auth.uuid]));
  });
});
