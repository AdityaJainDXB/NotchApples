import { test, expect } from '@playwright/test';

const RELEASE = {
  tag_name: 'v9.9.9',
  published_at: '2026-10-09T10:00:00Z',
  assets: [
    { name: 'NotchApple-9.9.9.dmg', size: 52428800, browser_download_url: 'https://example.invalid/NotchApple-9.9.9.dmg' },
    { name: 'other.zip', size: 1, browser_download_url: 'https://example.invalid/other.zip' },
  ],
};
const API = 'https://api.github.com/repos/AdityaJainDXB/NotchApples';

const LATEST = {
  version: '9.9.9', published: '2026-10-09T10:00:00Z', stars: 1234, dmgSize: 52428800,
  dmg: 'https://example.invalid/NotchApple-9.9.9.dmg', page: 'https://github.com/AdityaJainDXB/NotchApples/releases/tag/v9.9.9',
};

test('the download box reads latest.json from the site and never touches the GitHub API (60 requests an hour is easy to use up)', async ({ page }) => {
  let apiCalls = 0;
  await page.route('https://api.github.com/**', (r) => { apiCalls++; return r.abort(); });
  await page.route('**/latest.json', (r) => r.fulfill({ json: LATEST }));
  await page.goto('/index.html');
  await expect(page.locator('#dlVer')).toContainText('Notch Apple 9.9.9');
  await expect(page.locator('#dlVer')).toContainText('★ 1,234 on GitHub');
  await expect(page.locator('#dlBtn')).toHaveAttribute('href', 'https://example.invalid/NotchApple-9.9.9.dmg');
  await expect(page.locator('#footVer')).toHaveText('Notch Apple 9.9.9');
  expect(apiCalls).toBe(0);
});

test('without latest.json the download box falls back to the GitHub API', async ({ page }) => {
  await page.route('**/latest.json', (r) => r.fulfill({ status: 404, body: 'no' }));
  await page.route(`${API}/releases/latest`, (r) => r.fulfill({ json: RELEASE }));
  await page.route(API, (r) => r.fulfill({ json: { stargazers_count: 1234 } }));
  await page.goto('/index.html');
  await expect(page.locator('#dlVer')).toContainText('Notch Apple 9.9.9');
  await expect(page.locator('#dlVer')).toContainText('★ 1,234 on GitHub');
  await expect(page.locator('#dlBtn')).toHaveAttribute('href', 'https://example.invalid/NotchApple-9.9.9.dmg');
});

test('a rate-limited reload still shows the last good answer', async ({ page }) => {
  await page.route('**/latest.json', (r) => r.fulfill({ status: 404, body: 'no' }));
  await page.route(`${API}/releases/latest`, (r) => r.fulfill({ json: RELEASE }));
  await page.route(API, (r) => r.fulfill({ json: { stargazers_count: 1234 } }));
  await page.goto('/index.html');
  await expect(page.locator('#dlVer')).toContainText('9.9.9');
  await page.unrouteAll();
  await page.route('**/latest.json', (r) => r.fulfill({ status: 404, body: 'no' }));
  await page.route('https://api.github.com/**', (r) => r.fulfill({ status: 403, body: '{}' }));
  await page.reload();
  await expect(page.locator('#dlVer')).toContainText('9.9.9');
});

test('with no data, no stale version number is shown and the link goes to the releases page', async ({ page }) => {
  await page.route('**/latest.json', (r) => r.abort());
  await page.route('https://api.github.com/**', (r) => r.abort());
  await page.goto('/index.html');
  await page.waitForTimeout(500);
  const text = await page.evaluate(() => document.querySelector('#dlVer')!.textContent + document.querySelector('#footVer')!.textContent);
  expect(text).not.toMatch(/\d+\.\d+/);
  await expect(page.locator('#dlBtn')).toHaveAttribute('href', /\/releases\/latest$/);
});

// Real network. Skip with OFFLINE=1.
test('every release link on the pages responds', async ({ page, request }) => {
  test.skip(!!process.env.OFFLINE, 'needs the network');
  const urls = new Set<string>();
  for (const p of ['/index.html', '/pro.html']) {
    await page.goto(p);
    for (const h of await page.evaluate(() => [...document.querySelectorAll<HTMLAnchorElement>('a[href*="github.com/AdityaJainDXB/NotchApples/releases"]')].map((a) => a.href))) urls.add(h);
  }
  expect(urls.size).toBeGreaterThan(0);
  for (const u of urls) {
    // A one-byte range keeps the big installers from downloading.
    // GitHub sometimes answers a download with a one-off 5xx or 429: try a few times before calling a link broken.
    let status = 0;
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await request.get(u, { headers: { Range: 'bytes=0-0' }, maxRedirects: 5, failOnStatusCode: false }).catch(() => null);
      status = res ? res.status() : 0;
      if (status === 200 || status === 206 || (status >= 400 && status < 500 && status !== 429)) break;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
    expect([200, 206], u).toContain(status);
  }
});
