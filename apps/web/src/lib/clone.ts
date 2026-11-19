import {
  CloneObject,
  addRouteMutator,
  generateUUID,
  getRouteOrFolderInsertPosition,
  type Environment,
  type Route,
} from '@mockoon/commons';

/** Deep copy with a new uuid for the route and for each response. "default" flags are kept. */
export function cloneRoute(route: Route): Route {
  const copy = CloneObject(route);
  copy.uuid = generateUUID();
  copy.responses = copy.responses.map((response) => ({ ...response, uuid: generateUUID() }));

  return copy;
}

/** Insert a copy of the route right after the original, in the same folder. */
export function duplicateRoute(
  environment: Environment,
  routeUuid: string,
): { environment: Environment; newRouteUuid: string | null } {
  const route = environment.routes.find((item) => item.uuid === routeUuid);
  if (!route) {
    return { environment, newRouteUuid: null };
  }
  const copy = cloneRoute(route);
  const { parentId } = getRouteOrFolderInsertPosition(environment, routeUuid);

  return {
    environment: addRouteMutator(environment, copy, parentId, routeUuid),
    newRouteUuid: copy.uuid,
  };
}
