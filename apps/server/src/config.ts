import path from 'node:path';

export type Config = {
  /** Port of the UI and API. */
  port: number;
  /** Address the UI listens on. */
  host: string;
  /** Absolute path of the data directory. */
  dataDir: string;
  /** Value of MAKETA_PASSWORD, or null when not set. */
  envPassword: string | null;
  /** MAKETA_AUTH. */
  auth: 'on' | 'off';
  /** MAKETA_ALLOWED_HOSTS, lower-cased. */
  allowedHosts: string[];
  /** Development mode: also accepts requests coming through the Vite dev server. */
  dev: boolean;
  /** Directory of the built web UI, or null to not serve it. */
  webDistDir: string | null;
};

export const LOOPBACK_HOSTS = ['127.0.0.1', '::1', 'localhost'];

export const isLoopbackHost = (host: string): boolean =>
  LOOPBACK_HOSTS.includes(host.toLowerCase()) || /^127\.\d+\.\d+\.\d+$/.test(host);

export class ConfigError extends Error {}

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
  cwd: string = process.cwd(),
): Config {
  const rawPort = env.MAKETA_PORT?.trim();
  const port = rawPort ? Number(rawPort) : 4400;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError(`MAKETA_PORT must be an integer between 1 and 65535 (got "${rawPort}")`);
  }

  const auth = (env.MAKETA_AUTH?.trim() || 'on').toLowerCase();
  if (auth !== 'on' && auth !== 'off') {
    throw new ConfigError(`MAKETA_AUTH must be "on" or "off" (got "${env.MAKETA_AUTH}")`);
  }

  return {
    port,
    host: env.MAKETA_HOST?.trim() || '0.0.0.0',
    dataDir: path.resolve(cwd, env.MAKETA_DATA_DIR?.trim() || './data'),
    envPassword: env.MAKETA_PASSWORD ? env.MAKETA_PASSWORD : null,
    auth,
    allowedHosts: (env.MAKETA_ALLOWED_HOSTS ?? '')
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
    dev: env.NODE_ENV === 'development',
    webDistDir: null,
  };
}

export const environmentsDir = (config: Config) => path.join(config.dataDir, 'environments');
