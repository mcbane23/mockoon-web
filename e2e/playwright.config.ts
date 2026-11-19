import { defineConfig, devices } from '@playwright/test';

/**
 * Every test starts its own built server (see tests/server.ts) with a temporary data directory
 * and free ports, so the tests are independent of each other. Run `pnpm build` first.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1360, height: 820 },
    trace: 'retain-on-failure',
  },
});
