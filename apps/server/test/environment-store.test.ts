import fs from 'node:fs/promises';
import path from 'node:path';
import { BuildDemoEnvironment, CloneObject, type Environment } from '@mockoon/commons';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/errors.js';
import { fixturesDir, makeApp, tempDir } from './helpers.js';

const apiError = async (promise: Promise<unknown>): Promise<ApiError> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) {
      return error;
    }
    throw error;
  }
  throw new Error('Expected an ApiError');
};

const listFiles = async (directory: string) => (await fs.readdir(directory)).sort();

describe('EnvironmentStore', () => {
  it('create writes a file in the data directory and picks a free port', async () => {
    const app = await makeApp({ port: 3001 });
    const first = await app.store.create({ name: 'Users API' });
    const second = await app.store.create({});

    // 3001 is the UI port in this test
    expect(first.environment.port).toBe(3002);
    expect(second.environment.port).toBe(3003);
    expect(first.environment.name).toBe('Users API');
    expect(first.summary.managed).toBe(true);
    expect(path.basename(first.summary.path)).toBe(
      `users-api-${first.environment.uuid.slice(0, 8)}.json`,
    );
    expect(first.environment.routes).toHaveLength(1);

    const onDisk = JSON.parse(await fs.readFile(first.summary.path, 'utf8'));
    expect(onDisk).toEqual(first.environment);
    expect(app.settings.get().environments.map((item) => item.uuid)).toEqual([
      first.environment.uuid,
      second.environment.uuid,
    ]);
  });

  it('openFromPath keeps the file at its original path and migrates it in place', async () => {
    const app = await makeApp();
    const directory = await tempDir();
    const filePath = path.join(directory, 'old.json');
    await fs.copyFile(path.join(fixturesDir, 'old-migration.json'), filePath);

    const detail = await app.store.openFromPath(filePath);
    expect(detail.summary.path).toBe(filePath);
    expect(detail.summary.managed).toBe(false);
    expect(detail.disabledRoutes).toEqual(['9a1b2c3d-0000-4000-8000-000000000011']);
    expect(detail.collapsedFolders).toEqual(['9a1b2c3d-0000-4000-8000-000000000001']);

    const onDisk = JSON.parse(await fs.readFile(filePath, 'utf8')) as Environment;
    expect(onDisk.lastMigration).toBe(detail.environment.lastMigration);
    expect(await listFiles(path.join(app.config.dataDir, 'environments'))).toEqual([]);

    const again = await apiError(app.store.openFromPath(filePath));
    expect(again.code).toBe('ALREADY_OPEN');
  });

  it('openFromPath validates the path', async () => {
    const app = await makeApp();
    const directory = await tempDir();

    expect((await apiError(app.store.openFromPath('relative.json'))).status).toBe(400);
    expect((await apiError(app.store.openFromPath(path.join(directory, 'x.txt')))).status).toBe(
      400,
    );
    const missing = await apiError(app.store.openFromPath(path.join(directory, 'missing.json')));
    expect(missing.code).toBe('FILE_NOT_FOUND');

    const notEnvironment = path.join(directory, 'other.json');
    await fs.writeFile(notEnvironment, '{"hello":"world"}');
    expect((await apiError(app.store.openFromPath(notEnvironment))).code).toBe(
      'NOT_AN_ENVIRONMENT',
    );
  });

  it('a duplicate uuid gets a new one', async () => {
    const app = await makeApp();
    const text = JSON.stringify(BuildDemoEnvironment());
    const first = await app.store.importFromText('demo.json', text);
    const second = await app.store.importFromText('demo.json', text);

    expect(second.environment.uuid).not.toBe(first.environment.uuid);
    expect(second.summary.path).not.toBe(first.summary.path);

    const directory = await tempDir();
    const filePath = path.join(directory, 'same.json');
    await fs.writeFile(filePath, text);
    const third = await app.store.openFromPath(filePath);
    expect(third.environment.uuid).not.toBe(first.environment.uuid);
    // the new uuid is written back to the file
    expect(JSON.parse(await fs.readFile(filePath, 'utf8')).uuid).toBe(third.environment.uuid);
  });

  it('duplicate copies everything but uuid, name and port', async () => {
    const app = await makeApp();
    const source = await app.store.create({ name: 'Source' });
    app.store.setUiState(source.environment.uuid, {
      disabledRoutes: [source.environment.routes[0]!.uuid],
    });
    const copy = await app.store.duplicate(source.environment.uuid);

    expect(copy.environment.uuid).not.toBe(source.environment.uuid);
    expect(copy.environment.name).toBe('Source (copy)');
    expect(copy.environment.port).toBe(source.environment.port + 1);
    expect(copy.environment.routes).toEqual(source.environment.routes);
    expect(copy.disabledRoutes).toEqual([source.environment.routes[0]!.uuid]);
    expect(copy.summary.managed).toBe(true);
  });

  it('update with a wrong revision is rejected', async () => {
    const app = await makeApp();
    const { environment } = await app.store.create({});
    const changed = { ...CloneObject(environment), name: 'Renamed' };

    const conflict = await apiError(app.store.update(environment.uuid, changed, 7, null));
    expect(conflict.status).toBe(409);
    expect(conflict.code).toBe('REVISION_CONFLICT');
    expect(conflict.details).toEqual({ revision: 1 });

    const result = await app.store.update(environment.uuid, changed, 1, 'client-a');
    expect(result).toEqual({ revision: 2 });
    expect(app.store.summary(environment.uuid).name).toBe('Renamed');
  });

  it('update rejects a mismatching uuid and returns repaired data', async () => {
    const app = await makeApp();
    const { environment } = await app.store.create({});

    const other = { ...CloneObject(environment), uuid: 'something-else' };
    expect((await apiError(app.store.update(environment.uuid, other, 1, null))).status).toBe(400);

    const broken: any = CloneObject(environment);
    broken.latency = 'slow';
    const result = await app.store.update(environment.uuid, broken, 1, null);
    expect(result.revision).toBe(2);
    expect(result.environment?.latency).toBe(0);
  });

  it('saves atomically and leaves no temporary files', async () => {
    const app = await makeApp();
    const { environment, summary } = await app.store.create({});
    let current = environment;
    for (let index = 0; index < 5; index += 1) {
      current = { ...CloneObject(current), name: `Name ${index}` };
      await app.store.update(environment.uuid, current, index + 1, null);
    }
    await app.store.flush();

    const files = await listFiles(path.dirname(summary.path));
    expect(files).toEqual([path.basename(summary.path)]);
    const text = await fs.readFile(summary.path, 'utf8');
    expect(text.endsWith('}\n')).toBe(true);
    expect(JSON.parse(text).name).toBe('Name 4');
  });

  it('close deletes the file only inside the data directory and only when asked', async () => {
    const app = await makeApp();
    const kept = await app.store.create({ name: 'Kept' });
    const removed = await app.store.create({ name: 'Removed' });
    const directory = await tempDir();
    const externalPath = path.join(directory, 'external.json');
    await fs.writeFile(externalPath, JSON.stringify(BuildDemoEnvironment()));
    const external = await app.store.openFromPath(externalPath);

    await app.store.close(kept.environment.uuid, { deleteFile: false });
    await app.store.close(removed.environment.uuid, { deleteFile: true });
    await app.store.close(external.environment.uuid, { deleteFile: true });

    await expect(fs.access(kept.summary.path)).resolves.toBeUndefined();
    await expect(fs.access(removed.summary.path)).rejects.toThrow();
    await expect(fs.access(externalPath)).resolves.toBeUndefined();
    expect(app.store.summaries()).toEqual([]);
    expect(app.settings.get().environments).toEqual([]);
  });

  it('reorder requires a permutation', async () => {
    const app = await makeApp();
    const a = (await app.store.create({})).environment.uuid;
    const b = (await app.store.create({})).environment.uuid;

    app.store.reorder([b, a]);
    expect(app.store.summaries().map((summary) => summary.uuid)).toEqual([b, a]);
    expect(() => app.store.reorder([a])).toThrow(ApiError);
    expect(() => app.store.reorder([a, a])).toThrow(ApiError);
  });

  it('keeps environments with a missing file in the list and reloads them on demand', async () => {
    const first = await makeApp();
    const { environment, summary } = await first.store.create({ name: 'Fragile' });
    await first.close();
    await fs.rename(summary.path, `${summary.path}.moved`);

    const second = await makeApp({ dataDir: first.config.dataDir });
    const broken = second.store.summary(environment.uuid);
    expect(broken.hasData).toBe(false);
    expect(broken.fileError).toBe('File no longer exists');
    expect((await apiError(second.store.detail(environment.uuid))).status).toBe(422);
    expect(() => second.runtime.start(environment.uuid)).toThrow(ApiError);

    await fs.rename(`${summary.path}.moved`, summary.path);
    const detail = await second.store.detail(environment.uuid);
    expect(detail.environment.name).toBe('Fragile');
    expect(detail.summary.fileError).toBeNull();
  });

  it('survives a broken settings.json', async () => {
    const dataDir = await tempDir();
    await fs.writeFile(path.join(dataDir, 'settings.json'), '{ broken');
    const app = await makeApp({ dataDir });

    expect(app.settings.get().environments).toEqual([]);
    const files = await listFiles(dataDir);
    expect(files.some((file) => file.startsWith('settings.json.broken-'))).toBe(true);
    expect(files).toContain('settings.json');
  });
});
