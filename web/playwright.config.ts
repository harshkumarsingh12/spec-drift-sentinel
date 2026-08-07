import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests for the ratification dashboard.
 *
 * Chromium only, on purpose: a hackathon CI run should be fast, and cross-browser
 * coverage is not what this project is demonstrating. Add browsers later if the
 * pipeline has room.
 *
 * `webServer` builds and starts the app automatically, so `npx playwright test`
 * works from a clean clone with no manual setup — which is what a judge will try.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,

  // A stray test.only would silently narrow the suite and make CI lie.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,

  // HTML report is uploaded as a CI artifact — a scored deliverable.
  reporter: process.env.CI ? [['html'], ['list']] : [['html', { open: 'never' }], ['list']],

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    command: 'npm run build && npm run start',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
