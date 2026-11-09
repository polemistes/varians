import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests against a dev server on a fixed port, with .env.test
 * (the varians_test database). Set E2E_BUILD=1 to test the production build
 * through `vite build && vite preview` instead.
 */
const port = 4173;
const build = process.env.E2E_BUILD === '1';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 30_000,
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: build
      ? `pnpm exec vite build --mode test && pnpm exec vite preview --mode test --port ${port} --strictPort`
      : `pnpm exec vite dev --mode test --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
