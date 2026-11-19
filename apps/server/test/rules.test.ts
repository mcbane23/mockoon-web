import {
  BuildHTTPRoute,
  BuildResponseRule,
  BuildRouteResponse,
  CloneObject,
  ResponseMode,
  addRouteMutator,
  addRouteResponseMutator,
  updateRouteMutator,
  updateRouteResponseMutator,
  type Environment,
  type ResponseRule,
  type RouteResponse,
} from '@mockoon/commons';
import { describe, expect, it } from 'vitest';
import type { App } from '../src/app.js';
import { getFreePort, makeApp, startAndWait } from './helpers.js';

/**
 * Integration through the real engine. The goal is not to test the engine but to confirm that
 * data built the way the UI builds it behaves as expected.
 */

const rule = (partial: Partial<ResponseRule>): ResponseRule => ({
  ...BuildResponseRule(),
  ...partial,
});

type Setup = {
  app: App;
  environment: Environment;
  routeUuid: string;
  base: string;
  revision: number;
};

/** A route "check" with a default response "default" and one extra response "matched". */
async function setup(matched: Partial<RouteResponse>): Promise<Setup> {
  const app = await makeApp();
  const created = (await app.store.create({ port: await getFreePort() })).environment;
  const route = BuildHTTPRoute(true, { endpoint: 'check', body: 'default' });
  route.method = 'all';
  let environment = addRouteMutator(CloneObject(created), route, 'root');
  const response = { ...BuildRouteResponse(), body: 'matched', statusCode: 201, ...matched };
  environment = addRouteResponseMutator(environment, route.uuid, response);
  await app.store.update(environment.uuid, environment, 1, null);
  await startAndWait(app, environment.uuid);

  return {
    app,
    environment,
    routeUuid: route.uuid,
    base: `http://127.0.0.1:${environment.port}/check`,
    revision: 2,
  };
}

const text = async (input: string, init?: RequestInit) => (await fetch(input, init)).text();

describe('response rules', () => {
  it('query + equals', async () => {
    const { base } = await setup({
      rules: [rule({ target: 'query', modifier: 'plan', operator: 'equals', value: 'pro' })],
    });

    expect(await text(`${base}?plan=pro`)).toBe('matched');
    expect(await text(`${base}?plan=free`)).toBe('default');
    expect(await text(base)).toBe('default');
  });

  it('header + regex', async () => {
    const { base } = await setup({
      rules: [
        rule({
          target: 'header',
          modifier: 'Authorization',
          operator: 'regex',
          value: '^Bearer\\s.+',
        }),
      ],
    });

    expect(await text(base, { headers: { Authorization: 'Bearer abc' } })).toBe('matched');
    expect(await text(base, { headers: { Authorization: 'Basic abc' } })).toBe('default');
  });

  it('header is null (the rule used by the UI for "missing header")', async () => {
    const { base } = await setup({
      statusCode: 401,
      rules: [rule({ target: 'header', modifier: 'Authorization', operator: 'null', value: '' })],
    });

    expect((await fetch(base)).status).toBe(401);
    expect((await fetch(base, { headers: { Authorization: 'x' } })).status).toBe(200);
  });

  it('body with an object path', async () => {
    const { base } = await setup({
      rules: [rule({ target: 'body', modifier: 'user.name', operator: 'equals', value: 'Ana' })],
    });
    const post = (body: unknown) =>
      text(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

    expect(await post({ user: { name: 'Ana' } })).toBe('matched');
    expect(await post({ user: { name: 'Marko' } })).toBe('default');
  });

  it('invert', async () => {
    const { base } = await setup({
      rules: [
        rule({ target: 'query', modifier: 'plan', operator: 'equals', value: 'pro', invert: true }),
      ],
    });

    expect(await text(`${base}?plan=pro`)).toBe('default');
    expect(await text(`${base}?plan=free`)).toBe('matched');
  });

  it('AND and OR', async () => {
    const rules = [
      rule({ target: 'query', modifier: 'a', operator: 'equals', value: '1' }),
      rule({ target: 'query', modifier: 'b', operator: 'equals', value: '2' }),
    ];
    const or = await setup({ rules, rulesOperator: 'OR' });
    expect(await text(`${or.base}?a=1`)).toBe('matched');
    expect(await text(`${or.base}?b=2`)).toBe('matched');
    expect(await text(`${or.base}?a=9`)).toBe('default');

    const and = await setup({ rules, rulesOperator: 'AND' });
    expect(await text(`${and.base}?a=1`)).toBe('default');
    expect(await text(`${and.base}?a=1&b=2`)).toBe('matched');
  });

  it('SEQUENTIAL and DISABLE_RULES modes, applied without a restart', async () => {
    const { app, environment, routeUuid, base, revision } = await setup({
      rules: [rule({ target: 'query', modifier: 'plan', operator: 'equals', value: 'pro' })],
    });

    const sequential = updateRouteMutator(CloneObject(environment), routeUuid, {
      responseMode: ResponseMode.SEQUENTIAL,
    });
    await app.store.update(environment.uuid, sequential, revision, null);
    expect([await text(base), await text(base), await text(base)]).toEqual([
      'default',
      'matched',
      'default',
    ]);

    const disabled = updateRouteMutator(CloneObject(sequential), routeUuid, {
      responseMode: ResponseMode.DISABLE_RULES,
    });
    await app.store.update(environment.uuid, disabled, revision + 1, null);
    expect(await text(`${base}?plan=pro`)).toBe('default');
  });

  it('"Set as default" moves the default flag', async () => {
    const { app, environment, routeUuid, base, revision } = await setup({});
    const route = environment.routes.find((item) => item.uuid === routeUuid)!;
    const next = updateRouteResponseMutator(
      CloneObject(environment),
      routeUuid,
      route.responses[1]!.uuid,
      { default: true },
    );
    expect(
      next.routes.find((item) => item.uuid === routeUuid)!.responses.map((r) => r.default),
    ).toEqual([false, true]);

    await app.store.update(environment.uuid, next, revision, null);
    expect(await text(base)).toBe('matched');
  });
});
