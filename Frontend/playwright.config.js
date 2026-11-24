// End-to-end tests: real browsers clicking through the website (Frontend/e2e). See Frontend/e2e/README.md.
//
// Playwright starts what it needs: the backend (FastAPI, port 8000) and the website as it is deployed (a production
// build served by `vite preview`, port 4173). Servers already running locally are reused.
//   npm run test:e2e            all browsers and sizes
//   npm run test:e2e -- --project=desktop-chrome
//   npx playwright show-report  the HTML report of the last run
import { defineConfig, devices } from '@playwright/test'

const CI = !!process.env.CI
// Python that runs the backend: set E2E_PYTHON locally if it isn't "python3" (e.g. Backend/.venv/bin/python)
const PYTHON = process.env.E2E_PYTHON || 'python3'
// Locally, PW_CHROME_CHANNEL=chrome uses the installed Google Chrome instead of Playwright's own Chromium
const chromeChannel = process.env.PW_CHROME_CHANNEL ? { channel: process.env.PW_CHROME_CHANNEL } : {}

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.js',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  workers: CI ? 2 : 3,
  retries: CI ? 1 : 0,
  forbidOnly: CI,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: 'http://localhost:4173',
    // a screenshot of any failure; on GitHub also a step-by-step trace and a video when a test is retried
    screenshot: 'only-on-failure',
    trace: CI ? 'on-first-retry' : 'off',
    video: CI ? 'on-first-retry' : 'off',
  },
  projects: [
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'], ...chromeChannel, viewport: { width: 1440, height: 900 } } },
    { name: 'desktop-firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 900 } } },
    { name: 'desktop-safari', use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'], ...chromeChannel } },
    { name: 'mobile-safari', use: { ...devices['iPhone 14'] } },
  ],
  webServer: [
    {
      command: `${PYTHON} -m uvicorn app:app --host 127.0.0.1 --port 8000`,
      cwd: '../Backend',
      url: 'http://127.0.0.1:8000/health',
      reuseExistingServer: !CI,
      timeout: 180_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: 'npm run build && npx vite preview --port 4173 --strictPort',
      url: 'http://localhost:4173',
      // no Google Maps key in the test build (as on GitHub): the district page uses its own map, which these tests
      // know. The Google map is checked separately, on an address the key allows.
      env: { VITE_API_URL: 'http://127.0.0.1:8000', VITE_GOOGLE_MAPS_API_KEY: '' },
      reuseExistingServer: !CI,
      timeout: 180_000,
    },
  ],
})
