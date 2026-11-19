import { BuildRouteResponse, addRouteResponseMutator } from '@mockoon/commons';
import { describe, expect, it } from 'vitest';
import { cloneRoute, duplicateRoute } from '../src/lib/clone';
import { sampleEnvironment } from './fixtures';

describe('duplicating a route', () => {
  it('gives the copy new uuids and exactly one default response', () => {
    const sample = sampleEnvironment();
    const environment = addRouteResponseMutator(sample.environment, sample.listUsers.uuid, {
      ...BuildRouteResponse(),
      statusCode: 500,
    });
    const original = environment.routes.find((route) => route.uuid === sample.listUsers.uuid)!;
    const copy = cloneRoute(original);

    expect(copy.uuid).not.toBe(original.uuid);
    expect(copy.responses).toHaveLength(2);
    copy.responses.forEach((response, index) => {
      expect(response.uuid).not.toBe(original.responses[index]!.uuid);
      expect({ ...response, uuid: '' }).toEqual({ ...original.responses[index]!, uuid: '' });
    });
    expect(copy.responses.filter((response) => response.default)).toHaveLength(1);
    expect({ ...copy, uuid: '', responses: [] }).toEqual({ ...original, uuid: '', responses: [] });
    // the original is untouched
    expect(original.responses.map((response) => response.uuid)).not.toContain(
      copy.responses[0]!.uuid,
    );
  });

  it('inserts the copy right after the original, in the same folder', () => {
    const { environment, users, listUsers, createUser, auth } = sampleEnvironment();
    const result = duplicateRoute(environment, listUsers.uuid);

    expect(result.newRouteUuid).not.toBeNull();
    expect(result.environment.routes).toHaveLength(environment.routes.length + 1);
    expect(
      result.environment.folders
        .find((folder) => folder.uuid === users.uuid)!
        .children.map((child) => child.uuid),
    ).toEqual([listUsers.uuid, result.newRouteUuid, createUser.uuid, auth.uuid]);
  });

  it('does nothing for an unknown route', () => {
    const { environment } = sampleEnvironment();
    expect(duplicateRoute(environment, 'unknown')).toEqual({ environment, newRouteUuid: null });
  });
});
