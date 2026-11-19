// Development entry point: loopback only, so no password is needed.
process.env.MAKETA_HOST ??= '127.0.0.1';
process.env.NODE_ENV ??= 'development';

await import('./index.js');
