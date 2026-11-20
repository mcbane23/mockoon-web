import path from 'node:path';

export type Config = {
  /** Port of the UI and API. */
  port: number;
  /** Address the UI listens on. */
  host: string;
  /** Absolute path of the data directory. */
  dataDir: string;
  /** Value of STUBHOUSE_PASSWORD, or null when not set. */
  envPassword: string | null;
  /** STUBHOUSE_AUTH. */
  auth: 'on' | 'off';
  /** STUBHOUSE_ALLOWED_HOSTS, lower-cased. */
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

const ENV_NAMES = ['PORT', 'HOST', 'DATA_DIR', 'PASSWORD', 'AUTH', 'ALLOWED_HOSTS'] as const;

/**
 * Reads the STUBHOUSE_* variables. The application used to be called Maketa, so a MAKETA_*
 * variable is still accepted when its STUBHOUSE_* counterpart is not set.
 */
function readEnv(env: Record<string, string | undefined>) {
  const values: Record<string, string | undefined> = {};
  for (const name of ENV_NAMES) {
    values[`STUBHOUSE_${name}`] = env[`STUBHOUSE_${name}`] ?? env[`MAKETA_${name}`];
  }
  return values;
}

export function loadConfig(
  processEnv: Record<string, string | undefined> = process.env,
  cwd: string = process.cwd(),
): Config {
  const env = readEnv(processEnv);
  const rawPort = env.STUBHOUSE_PORT?.trim();
  const port = rawPort ? Number(rawPort) : 3300;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError(
      `STUBHOUSE_PORT must be an integer between 1 and 65535 (got "${rawPort}")`,
    );
  }

  const auth = (env.STUBHOUSE_AUTH?.trim() || 'on').toLowerCase();
  if (auth !== 'on' && auth !== 'off') {
    throw new ConfigError(`STUBHOUSE_AUTH must be "on" or "off" (got "${env.STUBHOUSE_AUTH}")`);
  }

  return {
    port,
    host: env.STUBHOUSE_HOST?.trim() || '0.0.0.0',
    dataDir: path.resolve(cwd, env.STUBHOUSE_DATA_DIR?.trim() || './data'),
    envPassword: env.STUBHOUSE_PASSWORD ? env.STUBHOUSE_PASSWORD : null,
    auth,
    allowedHosts: (env.STUBHOUSE_ALLOWED_HOSTS ?? '')
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
    dev: processEnv.NODE_ENV === 'development',
    webDistDir: null,
  };
}

export const environmentsDir = (config: Config) => path.join(config.dataDir, 'environments');
