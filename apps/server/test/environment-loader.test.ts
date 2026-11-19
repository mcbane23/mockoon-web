import {
  BuildDemoEnvironment,
  BuildEnvironment,
  HighestMigrationId,
  type Environment,
} from '@mockoon/commons';
import { describe, expect, it } from 'vitest';
import { loadEnvironmentFromText, validateClientEnvironment } from '../src/environment-loader.js';
import { ApiError } from '../src/errors.js';
import { readFixture } from './helpers.js';

const errorCode = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    if (error instanceof ApiError) {
      return error.code;
    }
    throw error;
  }

  return 'NO_ERROR';
};

describe('loadEnvironmentFromText', () => {
  it('loads a current environment without changing it', () => {
    // the demo environment relies on the schema to fill in a few defaults
    const demo = loadEnvironmentFromText(JSON.stringify(BuildDemoEnvironment())).environment;
    const text = JSON.stringify(demo, null, 2);
    const result = loadEnvironmentFromText(text);

    expect(result.environment).toEqual(demo);
    expect(result.environment.routes.length).toBeGreaterThan(5);
    expect(result.environment.lastMigration).toBe(HighestMigrationId);
    expect(result.migrated).toBe(false);
    expect(result.disabledRoutesFromMigration).toEqual([]);
  });

  it('migrates an older file and returns disabled routes and collapsed folders', async () => {
    const result = loadEnvironmentFromText(await readFixture('old-migration.json'));

    expect(result.migrated).toBe(true);
    expect(result.environment.lastMigration).toBe(HighestMigrationId);
    expect(result.disabledRoutesFromMigration).toEqual(['9a1b2c3d-0000-4000-8000-000000000011']);
    expect(result.collapsedFoldersFromMigration).toEqual(['9a1b2c3d-0000-4000-8000-000000000001']);
    expect(result.environment.routes).toHaveLength(2);
    expect(result.environment.routes[0]).not.toHaveProperty('enabled');
    expect(result.environment.folders[0]).not.toHaveProperty('collapsed');
    expect(result.environment.routes[0]?.streamingMode).toBeNull();
  });

  it('rejects invalid JSON', () => {
    expect(errorCode(() => loadEnvironmentFromText('{ nope'))).toBe('INVALID_JSON');
  });

  it('rejects JSON that is not an environment', () => {
    expect(errorCode(() => loadEnvironmentFromText('{"name":"x"}'))).toBe('NOT_AN_ENVIRONMENT');
    expect(errorCode(() => loadEnvironmentFromText('[1,2]'))).toBe('NOT_AN_ENVIRONMENT');
    expect(errorCode(() => loadEnvironmentFromText('"text"'))).toBe('NOT_AN_ENVIRONMENT');
  });

  it('rejects an environment saved by a newer version', () => {
    const text = JSON.stringify({
      ...BuildDemoEnvironment(),
      lastMigration: HighestMigrationId + 1,
    });
    expect(errorCode(() => loadEnvironmentFromText(text))).toBe('ENVIRONMENT_TOO_RECENT');
  });

  it('rejects the legacy export format', () => {
    const text = JSON.stringify({ source: 'mockoon:1.17.0', data: [] });
    expect(errorCode(() => loadEnvironmentFromText(text))).toBe('LEGACY_EXPORT_FORMAT');
  });

  it('keeps out-of-scope fields untouched through load and save', async () => {
    const text = await readFixture('with-out-of-scope.json');
    const original = JSON.parse(text) as Environment;
    const first = loadEnvironmentFromText(text);

    expect(first.migrated).toBe(false);
    expect(first.environment).toEqual(original);

    const saved = JSON.stringify(first.environment, null, 2) + '\n';
    const second = loadEnvironmentFromText(saved).environment;
    expect(second.proxyMode).toBe(true);
    expect(second.proxyHost).toBe(original.proxyHost);
    expect(second.proxyReqHeaders).toEqual(original.proxyReqHeaders);
    expect(second.proxyResHeaders).toEqual(original.proxyResHeaders);
    expect(second.tlsOptions).toEqual(original.tlsOptions);
    expect(second.data).toEqual(original.data);
    expect(second.callbacks).toEqual(original.callbacks);
    expect(second.routes.map((route) => route.type)).toEqual(['http', 'crud', 'ws', 'http']);
    expect(second.routes[0]?.responses[0]?.callbacks).toEqual(
      original.routes[0]?.responses[0]?.callbacks,
    );
    expect(saved).toBe(text);
  });
});

describe('validateClientEnvironment', () => {
  it('accepts a valid environment unchanged', () => {
    const demo = BuildEnvironment({
      hasDefaultRoute: true,
      hasContentTypeHeader: true,
      hasCorsHeaders: true,
    });
    const result = validateClientEnvironment(demo);
    expect(result.fixed).toBe(false);
    expect(result.environment).toEqual(demo);
  });

  it('rejects an outdated schema version', () => {
    const demo = { ...BuildDemoEnvironment(), lastMigration: HighestMigrationId - 1 };
    expect(errorCode(() => validateClientEnvironment(demo))).toBe('BAD_REQUEST');
  });

  it('reports when the schema repaired the data', () => {
    const demo: any = BuildDemoEnvironment();
    demo.port = 'not a number';
    const result = validateClientEnvironment(demo);
    expect(result.fixed).toBe(true);
    expect(typeof result.environment.port).toBe('number');
  });
});
