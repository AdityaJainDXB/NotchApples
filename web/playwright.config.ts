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
  use: { baseURL: 'http://localhost:8123', trace: 'on-first-retry' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'ipad', use: { ...devices['iPad (gen 7)'] } },
    { name: 'pixel', use: { ...devices['Pixel 7'] } },
    ...firefox,
  ],
  webServer: { command: 'python3 -m http.server 8123', url: 'http://localhost:8123', reuseExistingServer: true },
});
