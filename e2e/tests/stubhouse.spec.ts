import fs from 'node:fs/promises';
import path from 'node:path';
import {
  FIXTURES_DIR,
  addRoute,
  createEnvironment,
  expect,
  expectSaved,
  freePort,
  startOpenEnvironment,
  test,
} from './server';

test('basic flow: create, add a route, start, call it and see the log', async ({
  page,
  server,
}) => {
  const mockPort = await freePort();
  await page.goto(server.url);

  // empty state
  await expect(page.getByRole('heading', { name: 'Mock APIs in your browser' })).toBeVisible();
  await page.getByRole('button', { name: 'New environment' }).click();
  await createEnvironment(page, 'Basic', mockPort);

  await addRoute(page, 'hello', `{"msg":"hi {{queryParam 'name'}}"}`);
  await startOpenEnvironment(page);

  const response = await page.request.get(`http://127.0.0.1:${mockPort}/hello?name=Ana`);
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ msg: 'hi Ana' });

  await page.getByRole('link', { name: /Logs/ }).click();
  const entry = page.getByTestId('log-entry');
  await expect(entry).toHaveCount(1);
  await expect(entry).toContainText('/hello');
  await entry.click();

  // the request tab shows the query parameter
  const queryParams = page.getByRole('table', { name: 'Query params' });
  await expect(queryParams).toContainText('name');
  await expect(queryParams).toContainText('Ana');

  await page.getByRole('tab', { name: 'Response' }).click();
  await expect(page.getByTestId('log-status')).toContainText('200');
  await expect(page.getByTestId('log-body')).toContainText('hi Ana');
});

test('rules: a response with a rule is served only when the rule matches', async ({
  page,
  server,
}) => {
  const mockPort = await freePort();
  await page.goto(server.url);
  await page.getByRole('button', { name: 'New environment' }).click();
  await createEnvironment(page, 'Rules', mockPort);
  await addRoute(page, 'secure', '{"ok":true}');

  // second response: 401 when the Authorization header is missing
  await page.getByRole('button', { name: 'Add response' }).click();
  const status = page.getByLabel('Status code');
  await status.fill('401');
  await status.blur();
  await page.getByRole('tab', { name: /^Rules/ }).click();
  await page.getByRole('button', { name: 'Add rule' }).click();
  const rule = page.getByTestId('rule-row');
  await expect(rule).toHaveCount(1);
  await rule.getByLabel('Target').selectOption('header');
  await rule.getByLabel('Modifier').fill('Authorization');
  await rule.getByLabel('Operator').selectOption('null');
  await expectSaved(page);

  await startOpenEnvironment(page);

  const url = `http://127.0.0.1:${mockPort}/secure`;
  const anonymous = await page.request.get(url);
  expect(anonymous.status()).toBe(401);

  const authorised = await page.request.get(url, { headers: { Authorization: 'Bearer token' } });
  expect(authorised.status()).toBe(200);
  expect(await authorised.json()).toEqual({ ok: true });
});

test('import and export keep everything, including features that cannot be edited', async ({
  page,
  server,
}) => {
  const fixturePath = path.join(FIXTURES_DIR, 'with-out-of-scope.json');
  await page.goto(server.url);

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import' }).first().click();
  await (await chooser).setFiles(fixturePath);

  const item = page.getByTestId('environment-item').filter({ hasText: 'Out of scope features' });
  await expect(item).toBeVisible();
  await expect(page.getByRole('treeitem', { name: 'GET /hello' })).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Actions for Out of scope features' }).click();
  await page.getByRole('menuitem', { name: 'Export' }).click();
  const exportedPath = await (await download).path();

  const exported: unknown = JSON.parse(await fs.readFile(exportedPath, 'utf8'));
  const fixture: unknown = JSON.parse(await fs.readFile(fixturePath, 'utf8'));
  // the fixture is already on the current schema version, so no migration changes it
  expect(exported).toEqual(fixture);
});

test('persistence: changes survive a page reload and a server restart', async ({
  page,
  server,
}) => {
  const mockPort = await freePort();
  await page.goto(server.url);
  await page.getByRole('button', { name: 'New environment' }).click();
  await createEnvironment(page, 'Persistent', mockPort);
  await addRoute(page, 'kept', '{"kept":true}');
  await startOpenEnvironment(page);

  await page.reload();
  await expect(page.getByRole('treeitem', { name: 'GET /kept' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();

  await server.restart();
  await page.reload();

  await expect(
    page.getByTestId('environment-item').filter({ hasText: 'Persistent' }),
  ).toBeVisible();
  await expect(page.getByRole('treeitem', { name: 'GET /kept' })).toBeVisible();
  // it was running before the restart, so it runs again
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  const response = await page.request.get(`http://127.0.0.1:${mockPort}/kept`);
  expect(await response.json()).toEqual({ kept: true });
});

test('port conflict: the second environment on the same port does not start', async ({
  page,
  server,
}) => {
  const mockPort = await freePort();
  await page.goto(server.url);
  await page.getByRole('button', { name: 'New environment' }).click();
  await createEnvironment(page, 'First', mockPort);
  await startOpenEnvironment(page);

  await createEnvironment(page, 'Second', mockPort);
  await page.getByRole('button', { name: 'Start', exact: true }).click();

  await expect(page.getByRole('alert').filter({ hasText: String(mockPort) })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'First' }).first()).toBeVisible();
  // still stopped
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeHidden();
});

test('login: a password protects the interface and the session survives a reload', async ({
  page,
  startServer,
}) => {
  const server = await startServer({ STUBHOUSE_PASSWORD: 'test' });
  await page.goto(server.url);

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Log in to Stubhouse' })).toBeVisible();

  await page.getByLabel('Password').fill('wrong');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('alert')).toHaveText('Wrong password');

  await page.getByLabel('Password').fill('test');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { name: 'Mock APIs in your browser' })).toBeVisible();
  await expect(page).not.toHaveURL(/\/login/);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Mock APIs in your browser' })).toBeVisible();
  await expect(page).not.toHaveURL(/\/login/);
});
