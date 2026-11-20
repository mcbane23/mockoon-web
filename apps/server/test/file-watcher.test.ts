import fs from 'node:fs/promises';
import { CloneObject, type Environment } from '@mockoon/commons';
import type { ServerEvent } from '@maketa/shared';
import { describe, expect, it } from 'vitest';
import { makeApp, sleep, waitForEvent } from './helpers.js';

describe('FileWatcher', () => {
  it('an external change replaces the environment and emits environment-updated', async () => {
    const app = await makeApp();
    const { environment, summary } = await app.store.create({ name: 'Before' });

    const updated = waitForEvent<Extract<ServerEvent, { type: 'environment-updated' }>>(
      app.bus,
      (event) => event.type === 'environment-updated',
    );
    const external: Environment = { ...CloneObject(environment), name: 'After' };
    await fs.writeFile(summary.path, JSON.stringify(external, null, 2));

    const event = await updated;
    expect(event.origin).toBeNull();
    expect(event.uuid).toBe(environment.uuid);
    expect(event.revision).toBe(2);
    expect(app.store.get(environment.uuid).environment?.name).toBe('After');
    expect(app.store.summary(environment.uuid).fileError).toBeNull();
  });

  it('an update that arrives while the file is being read is not reverted', async () => {
    const app = await makeApp();
    const { environment } = await app.store.create({ name: 'Before' });
    const { uuid } = environment;

    // a late watcher notification for our own earlier write starts reading the old file...
    const stale = app.store.handleExternalChange(uuid);
    // ...and the client saves a newer version before that read finishes
    const changed: Environment = { ...CloneObject(environment), name: 'After' };
    const update = app.store.update(uuid, changed, 1, 'client-a');
    await Promise.all([stale, update]);

    expect(app.store.get(uuid).environment?.name).toBe('After');
    expect(app.store.get(uuid).revision).toBe(2);
  });

  it('keeps the known uuid when the file content has another one', async () => {
    const app = await makeApp();
    const { environment, summary } = await app.store.create({});

    const updated = waitForEvent(app.bus, (event) => event.type === 'environment-updated');
    const external = { ...CloneObject(environment), uuid: 'f0f0f0f0-0000-4000-8000-000000000000' };
    await fs.writeFile(summary.path, JSON.stringify(external, null, 2));
    await updated;
    await app.store.flush();

    expect(app.store.get(environment.uuid).environment?.uuid).toBe(environment.uuid);
    expect(JSON.parse(await fs.readFile(summary.path, 'utf8')).uuid).toBe(environment.uuid);
  });

  it('our own save does not trigger an event', async () => {
    const app = await makeApp();
    const { environment } = await app.store.create({});
    const events: ServerEvent[] = [];
    app.bus.subscribe((event) => events.push(event));

    await app.store.update(
      environment.uuid,
      { ...CloneObject(environment), name: 'Mine' },
      1,
      'me',
    );
    await sleep(700);

    const updates = events.filter((event) => event.type === 'environment-updated');
    expect(updates).toEqual([
      { type: 'environment-updated', uuid: environment.uuid, revision: 2, origin: 'me' },
    ]);
    expect(app.store.get(environment.uuid).revision).toBe(2);
  });

  it('invalid content sets fileError and keeps the previous version', async () => {
    const app = await makeApp();
    const { environment, summary } = await app.store.create({ name: 'Stable' });

    const status = waitForEvent<Extract<ServerEvent, { type: 'environment-status' }>>(
      app.bus,
      (event) => event.type === 'environment-status' && event.summary.fileError !== null,
    );
    await fs.writeFile(summary.path, '{ this is not json');
    const event = await status;

    expect(event.summary.fileError).toBe('File is not valid JSON');
    expect(event.summary.hasData).toBe(true);
    expect(app.store.get(environment.uuid).environment?.name).toBe('Stable');
    expect(app.store.get(environment.uuid).revision).toBe(1);

    // the next change from the UI writes the file again
    const cleared = waitForEvent(
      app.bus,
      (item) => item.type === 'environment-status' && item.summary.fileError === null,
    );
    await app.store.update(
      environment.uuid,
      { ...CloneObject(environment), name: 'Fixed' },
      1,
      null,
    );
    await cleared;
    expect(JSON.parse(await fs.readFile(summary.path, 'utf8')).name).toBe('Fixed');
  });

  it('a deleted file is reported', async () => {
    const app = await makeApp();
    const { summary } = await app.store.create({});

    const status = waitForEvent<Extract<ServerEvent, { type: 'environment-status' }>>(
      app.bus,
      (event) => event.type === 'environment-status' && event.summary.fileError !== null,
    );
    await fs.rm(summary.path);

    expect((await status).summary.fileError).toBe('File no longer exists');
  });
});
