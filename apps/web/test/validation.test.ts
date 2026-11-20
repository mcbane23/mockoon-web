import { describe, expect, it } from 'vitest';
import { languageForContentType, prettifyJson } from '../src/lib/content-type';
import { isUnreachableFromBrowser, mockBaseUrl, mockHost, routeUrl } from '../src/lib/mock-url';
import {
  normalizePrefix,
  regexError,
  validateIntegerInRange,
  validateName,
  validateNonNegativeInteger,
  validatePort,
} from '../src/lib/validation';
import { installPolyfills } from '../src/polyfills';

describe('validation', () => {
  it('port', () => {
    expect(validatePort('3001')).toBeNull();
    expect(validatePort(1)).toBeNull();
    expect(validatePort('65535')).toBeNull();
    for (const value of ['', '0', '65536', '-1', '30.5', 'abc', '3001a', ' ']) {
      expect(validatePort(value), value).not.toBeNull();
    }
    // must not be the port of the UI
    expect(validatePort('3300', 3300)).toContain('3300');
    expect(validatePort('3301', 3300)).toBeNull();
  });

  it('name', () => {
    expect(validateName('Users API')).toBeNull();
    expect(validateName('')).not.toBeNull();
    expect(validateName('   ')).not.toBeNull();
    expect(validateName('x'.repeat(100))).toBeNull();
    expect(validateName('x'.repeat(101))).not.toBeNull();
  });

  it('prefix is stored without leading and trailing slashes', () => {
    expect(normalizePrefix('/api/v1/')).toBe('api/v1');
    expect(normalizePrefix('//api//')).toBe('api');
    expect(normalizePrefix(' api ')).toBe('api');
    expect(normalizePrefix('/')).toBe('');
  });

  it('numbers', () => {
    expect(validateNonNegativeInteger('0')).toBeNull();
    expect(validateNonNegativeInteger('250')).toBeNull();
    expect(validateNonNegativeInteger('-1')).not.toBeNull();
    expect(validateNonNegativeInteger('1.5')).not.toBeNull();
    expect(validateIntegerInRange('10', 10, 1000)).toBeNull();
    expect(validateIntegerInRange('9', 10, 1000)).not.toBeNull();
    expect(validateIntegerInRange('1001', 10, 1000)).not.toBeNull();
  });

  it('regular expressions', () => {
    expect(regexError('^Bearer\\s.+')).toBeNull();
    expect(regexError('(')).not.toBeNull();
  });
});

describe('content type', () => {
  it('picks the editor language', () => {
    expect(languageForContentType('application/json; charset=utf-8')).toBe('json');
    expect(languageForContentType('application/problem+json')).toBe('json');
    expect(languageForContentType('application/xml')).toBe('xml');
    expect(languageForContentType('text/html')).toBe('html');
    expect(languageForContentType('text/plain')).toBe('text');
    expect(languageForContentType('')).toBe('text');
    expect(languageForContentType(null)).toBe('text');
  });

  it('prettifies valid JSON only', () => {
    expect(prettifyJson('{"a":1,"b":[1,2]}')).toBe('{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}');
    // templating inside a string is still valid JSON
    expect(prettifyJson('{"id":"{{urlParam \'id\'}}"}')).toContain('{{urlParam');
    // templating outside of strings is not
    expect(prettifyJson('{"n": {{faker \'number.int\'}} }')).toBeNull();
  });
});

describe('mock URLs', () => {
  const address = { hostname: '', port: 3001, endpointPrefix: '', tlsEnabled: false };

  it('uses the address the UI was opened with when the mock listens on all interfaces', () => {
    expect(mockHost('', '192.168.1.10')).toBe('192.168.1.10');
    expect(mockHost('0.0.0.0', '192.168.1.10')).toBe('192.168.1.10');
    expect(mockHost('10.0.0.5', '192.168.1.10')).toBe('10.0.0.5');
    expect(mockHost('::1', 'server.lan')).toBe('[::1]');
    expect(mockBaseUrl(address, 'server.lan')).toBe('http://server.lan:3001');
  });

  it('includes the prefix and TLS', () => {
    const secure = { ...address, endpointPrefix: 'api/v1', tlsEnabled: true };
    expect(mockBaseUrl(secure, 'localhost')).toBe('https://localhost:3001/api/v1');
    expect(routeUrl(secure, 'users/:id', 'localhost')).toBe(
      'https://localhost:3001/api/v1/users/:id',
    );
    expect(routeUrl(address, '', 'localhost')).toBe('http://localhost:3001/');
  });

  it('warns when a loopback-only mock is viewed from another machine', () => {
    expect(isUnreachableFromBrowser('127.0.0.1', '192.168.1.10')).toBe(true);
    expect(isUnreachableFromBrowser('localhost', 'server.lan')).toBe(true);
    expect(isUnreachableFromBrowser('127.0.0.1', 'localhost')).toBe(false);
    expect(isUnreachableFromBrowser('', '192.168.1.10')).toBe(false);
  });
});

describe('polyfills', () => {
  it('provides crypto.randomUUID outside of secure contexts', () => {
    const original = globalThis.crypto.randomUUID;
    try {
      Object.defineProperty(globalThis.crypto, 'randomUUID', {
        value: undefined,
        configurable: true,
        writable: true,
      });
      installPolyfills();
      const uuid = globalThis.crypto.randomUUID();
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(globalThis.crypto.randomUUID()).not.toBe(uuid);
    } finally {
      Object.defineProperty(globalThis.crypto, 'randomUUID', {
        value: original,
        configurable: true,
        writable: true,
      });
    }
  });
});
