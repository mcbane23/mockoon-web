export type LogLevel = 'info' | 'warn' | 'error';

export type Logger = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string, error?: unknown) => void;
};

const write = (level: LogLevel, message: string) => {
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${message}\n`;
  (level === 'error' ? process.stderr : process.stdout).write(line);
};

/** One line per event on standard output. */
export const consoleLogger: Logger = {
  info: (message) => write('info', message),
  warn: (message) => write('warn', message),
  error: (message, error) =>
    write(
      'error',
      error === undefined
        ? message
        : `${message}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    ),
};

export const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };
