import os from 'node:os';
import path from 'node:path';
import { createApp } from './app.js';
import { ConfigError, isLoopbackHost, loadConfig } from './config.js';
import { consoleLogger as logger } from './logger.js';

function uiAddresses(host: string, port: number): string[] {
  if (host !== '0.0.0.0' && host !== '::') {
    return [`http://${host.includes(':') ? `[${host}]` : host}:${port}`];
  }
  const addresses: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const item of list ?? []) {
      if (item.family === 'IPv4' && !item.internal) {
        addresses.push(`http://${item.address}:${port}`);
      }
    }
  }

  return addresses.length > 0 ? addresses : [`http://localhost:${port}`];
}

type ListenError = { code: string; syscall: string; address: string; port: number };

const isListenDenied = (error: unknown): error is ListenError =>
  (error as Partial<ListenError> | null)?.code === 'EACCES' &&
  (error as Partial<ListenError>).syscall === 'listen';

async function main(): Promise<void> {
  const config = loadConfig();
  config.webDistDir = path.resolve(import.meta.dirname, '../../web/dist');

  const app = await createApp(config);
  await app.fastify.listen({ port: config.port, host: config.host });

  logger.info(`Stubhouse ${app.appVersion} (engine ${app.engineVersion})`);
  for (const address of uiAddresses(config.host, config.port)) {
    logger.info(`UI: ${address}`);
  }
  logger.info(`Data directory: ${config.dataDir}`);
  logger.info(
    app.restored.length > 0
      ? `Starting environments: ${app.restored.join(', ')}`
      : 'No environments to start automatically',
  );
  if (app.auth.generatedPassword) {
    logger.info(`Generated password: ${app.auth.generatedPassword}`);
    logger.info(`The password is stored in ${app.auth.authFilePath}`);
  }
  if (config.auth === 'off' && !isLoopbackHost(config.host)) {
    logger.warn(
      'Authentication is disabled: anyone on the network can edit environments and write files on this machine',
    );
  }

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) {
      // second signal: leave immediately
      process.exit(1);
    }
    shuttingDown = true;
    logger.info(`${signal} received, shutting down`);
    app
      .close()
      .then(() => process.exit(0))
      .catch((error) => {
        logger.error('Error during shutdown', error);
        process.exit(1);
      });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
  if (error instanceof ConfigError) {
    logger.error(error.message);
  } else if ((error as { code?: string } | null)?.code === 'EADDRINUSE') {
    logger.error('The UI port is already in use. Set STUBHOUSE_PORT to another port.');
  } else if (isListenDenied(error)) {
    logger.error(
      `The system does not allow listening on ${error.address}:${error.port}. ` +
        'Set STUBHOUSE_PORT to another port. On Windows the port may be in a reserved range ' +
        '(see "netsh interface ipv4 show excludedportrange protocol=tcp"); ' +
        'on Linux and macOS ports below 1024 need elevated rights.',
    );
  } else {
    logger.error('Stubhouse could not start', error);
  }
  process.exit(1);
});
