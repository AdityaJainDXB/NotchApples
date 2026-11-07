import { defineConfig, devices } from '@playwright/test';

// Firefox runs only when asked for (PW_FIREFOX=1): its build can't launch in every environment.
const firefox = process.env.PW_FIREFOX ? [{ name: 'firefox', use: { ...devices['Desktop Firefox'] } }] : [];

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  // The site is served by one python process; two workers and one retry stop the image-load test flaking under load.
  workers: 2,
  retries: 1,
  reporter: 'list',
  // Tests start as a visitor who already chose (so the consent banner does not cover the page); tests/consent.spec.ts starts fresh.
  use: { baseURL: 'http://localhost:8123', trace: 'on-first-retry',
    storageState: { cookies: [], origins: [{ origin: 'http://localhost:8123', localStorage: [{ name: 'na-consent', value: JSON.stringify({ v: 1, t: 1, thirdparty: true }) }] }] } },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'ipad', use: { ...devices['iPad (gen 7)'] } },
    { name: 'pixel', use: { ...devices['Pixel 7'] } },
    ...firefox,
  ],
  // The stock `http.server` listens with a backlog of 5, so a page with several stylesheets loaded by two workers at once gets connections reset. A longer backlog makes the test server behave like a real host.
  webServer: { command: `python3 -c "import http.server as h; h.ThreadingHTTPServer.request_queue_size=128; h.test(h.SimpleHTTPRequestHandler, h.ThreadingHTTPServer, port=8123)"`, url: 'http://localhost:8123', reuseExistingServer: true },
});
