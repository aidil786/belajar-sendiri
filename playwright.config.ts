import { defineConfig, devices } from '@playwright/test';

// Locally you can point at a pre-installed Chromium: PW_CHROMIUM_PATH=/path/to/chrome npm run test:e2e
const executablePath = process.env.PW_CHROMIUM_PATH;
// Several checkouts can test at once: give each its own port (PW_PORT=4401 npm run test:e2e).
const port = Number(process.env.PW_PORT ?? 4322);
// Other engines (after `npx playwright install webkit firefox`): PW_BROWSER=webkit or PW_BROWSER=firefox.
const browser = process.env.PW_BROWSER;
const desktop = browser === 'webkit' ? devices['Desktop Safari'] : browser === 'firefox' ? devices['Desktop Firefox'] : devices['Desktop Chrome'];
const phone = browser === 'webkit' ? devices['iPhone 13'] : browser === 'firefox' ? { ...devices['Desktop Firefox'], isMobile: false } : devices['Pixel 7'];
const launch = executablePath && !browser ? { launchOptions: { executablePath } } : {};

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // CI runners have 4 cores; the ~300 lesson smoke tests mostly wait on the browser, so use them all.
  workers: process.env.CI ? '100%' : undefined,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
    ...launch,
  },
  projects: [
    // Tests tagged @desktop-only (e.g. the all-lessons smoke test) skip the phone run.
    {
      name: 'phone',
      grepInvert: /@desktop-only/,
      use: { ...phone, viewport: { width: 360, height: 780 }, ...launch },
    },
    { name: 'desktop', use: { ...desktop, ...launch } },
  ],
  webServer: {
    command: `npx astro preview --port ${port} --ignore-lock`,
    url: `http://localhost:${port}/en/`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
