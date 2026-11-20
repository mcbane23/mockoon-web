import path from 'node:path';

export type Config = {
  /** Port of the UI and API. */
  port: number;
  /** Address the UI listens on. */
  host: string;
  /** Absolute path of the data directory. */
  dataDir: string;
  /** Value of MOCKPIT_PASSWORD, or null when not set. */
  envPassword: string | null;
  /** MOCKPIT_AUTH. */
  auth: 'on' | 'off';
  /** MOCKPIT_ALLOWED_HOSTS, lower-cased. */
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
 * Reads the MOCKPIT_* variables. The application used to be called Maketa, so a MAKETA_*
 * variable is still accepted when its MOCKPIT_* counterpart is not set.
 */
function readEnv(env: Record<string, string | undefined>) {
  const values: Record<string, string | undefined> = {};
  for (const name of ENV_NAMES) {
    values[`MOCKPIT_${name}`] = env[`MOCKPIT_${name}`] ?? env[`MAKETA_${name}`];
  }
  return values;
}

export function loadConfig(
  processEnv: Record<string, string | undefined> = process.env,
  cwd: string = process.cwd(),
): Config {
  const env = readEnv(processEnv);
  const rawPort = env.MOCKPIT_PORT?.trim();
  const port = rawPort ? Number(rawPort) : 3300;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError(`MOCKPIT_PORT must be an integer between 1 and 65535 (got "${rawPort}")`);
  }

  const auth = (env.MOCKPIT_AUTH?.trim() || 'on').toLowerCase();
  if (auth !== 'on' && auth !== 'off') {
    throw new ConfigError(`MOCKPIT_AUTH must be "on" or "off" (got "${env.MOCKPIT_AUTH}")`);
  }

  return {
    port,
    host: env.MOCKPIT_HOST?.trim() || '0.0.0.0',
    dataDir: path.resolve(cwd, env.MOCKPIT_DATA_DIR?.trim() || './data'),
    envPassword: env.MOCKPIT_PASSWORD ? env.MOCKPIT_PASSWORD : null,
    auth,
    allowedHosts: (env.MOCKPIT_ALLOWED_HOSTS ?? '')
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
    dev: processEnv.NODE_ENV === 'development',
    webDistDir: null,
  };
}

export const environmentsDir = (config: Config) => path.join(config.dataDir, 'environments');
