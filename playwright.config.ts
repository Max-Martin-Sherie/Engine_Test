import { defineConfig, devices } from '@playwright/test';

// Set CHROMIUM_PATH to use an installed Chrome/Chromium instead of Playwright's own download.
const executablePath = process.env['CHROMIUM_PATH'];
// A dedicated port, never the dev server's 5173: e2e always starts its own server, so it can't
// silently test another project's (or another branch's) dev server that happens to be running.
const PORT = 5199;

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
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    // The tests check real coin amounts and prices, so they run without the dev-only full purse.
    env: { VITE_INFINITE_COINS: 'false' },
    timeout: 60_000,
  },
});
