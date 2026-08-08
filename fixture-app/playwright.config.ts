import { defineConfig, devices } from '@playwright/test';

/**
 * Same shape as web/playwright.config.ts — Chromium only, server started for you.
 *
 * Port 3100 so this can run alongside the dashboard on 3000.
 *
 * `list` reporter is important here: these tests are meant to FAIL during the
 * demo, and their output is piped straight into `sentinel classify`. The
 * classifier parses the file and test name out of that text, so keep the
 * default Playwright failure format.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,

  reporter: process.env.CI ? [['html'], ['list']] : [['list']],

  use: {
    baseURL: 'http://localhost:3100',
    trace: 'on-first-retry',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    command: 'npm start',
    url: 'http://localhost:3100/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
