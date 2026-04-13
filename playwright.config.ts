import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E Configuration
 *
 * Runs against the locally started dev server.
 * For CI: starts frontend + backend automatically.
 */
export default defineConfig({
  testDir: './e2e',

  // Fail fast: stop after first failure in CI, run all locally
  maxFailures: process.env.CI ? 1 : 0,

  // Give each test up to 30 seconds
  timeout: 30_000,

  // Retry failed tests once in CI
  retries: process.env.CI ? 1 : 0,

  // 1 worker in CI (sequential), parallel locally
  workers: process.env.CI ? 1 : undefined,

  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'e2e/report' }],
  ],

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  // Start backend + frontend before running tests
  webServer: [
    {
      command: 'cd backend && npm start',
      url:     'http://localhost:5001/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: {
        JWT_SECRET: 'e2e-test-secret-minimum-32-chars!!',
        NODE_ENV:   'test',
        PORT:       '5001',
      },
    },
    {
      command: 'cd frontend && npm run dev',
      url:     'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
