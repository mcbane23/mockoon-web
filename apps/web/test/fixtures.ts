import {
  BuildEnvironment,
  BuildFolder,
  BuildHTTPRoute,
  addFolderMutator,
  addRouteMutator,
  type Environment,
  type Folder,
  type Route,
} from '@mockoon/commons';

export type Sample = {
  environment: Environment;
  health: Route;
  listUsers: Route;
  createUser: Route;
  login: Route;
  users: Folder;
  auth: Folder;
};

const route = (method: Route['method'], endpoint: string, documentation = ''): Route => ({
  ...BuildHTTPRoute(true, { endpoint, body: '{}' }),
  method,
  documentation,
});

/**
 * root
 * ├─ users (folder)
 * │  ├─ GET  users
 * │  ├─ POST users
 * │  └─ auth (folder)
 * │     └─ POST auth/login
 * └─ GET health
 */
export function sampleEnvironment(): Sample {
  let environment = BuildEnvironment({
    hasDefaultRoute: false,
    hasContentTypeHeader: true,
    hasCorsHeaders: false,
    port: 3001,
  });
  const users = { ...BuildFolder(), name: 'users' };
  const auth = { ...BuildFolder(), name: 'auth' };
  const listUsers = route('get', 'users', 'List users');
  const createUser = route('post', 'users');
  const login = route('post', 'auth/login', 'Sign in');
  const health = route('get', 'health');

  environment = addFolderMutator(environment, users, 'root');
  environment = addRouteMutator(environment, listUsers, users.uuid);
  environment = addRouteMutator(environment, createUser, users.uuid);
  environment = addFolderMutator(environment, auth, users.uuid);
  environment = addRouteMutator(environment, login, auth.uuid);
  environment = addRouteMutator(environment, health, 'root');

  return { environment, health, listUsers, createUser, login, users, auth };
}
