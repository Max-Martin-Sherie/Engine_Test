import { defineConfig, devices } from '@playwright/test';

// Set CHROMIUM_PATH to use an installed Chrome/Chromium instead of Playwright's own download.
const executablePath = process.env['CHROMIUM_PATH'];
const PORT = 5173;

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  // One at a time: the game runs in real time, so CPU contention would make runs flaky.
  workers: 1,
  reporter: [['list']],
  use: {
    ...devices['Pixel 7'],
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    launchOptions: executablePath ? { executablePath } : {},
  },
  webServer: {
    command: 'npm run dev',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env['CI'],
    timeout: 60_000,
  },
});
