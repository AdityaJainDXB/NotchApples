import { test, expect } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });   // a first-time visitor

const GH = 'https://api.github.com/**';

test('first visit: the banner offers Reject, Manage and Accept equally, and nothing optional runs before a choice', async ({ page }) => {
  const hits: string[] = [];
  await page.route(GH, (r) => { hits.push(r.request().url()); r.abort(); });
  await page.route('**/latest.json', (r) => r.abort());            // force the GitHub fallback path
  await page.goto('/');
  const banner = page.locator('#na-cc');
  await expect(banner).toBeVisible();
  for (const name of ['Reject optional', 'Manage', 'Accept all']) await expect(banner.getByRole('button', { name })).toBeVisible();
  await page.waitForTimeout(1500);
  expect(hits, 'GitHub is not contacted before a choice').toEqual([]);
  expect(await page.evaluate(() => document.cookie)).toBe('');
});

test('rejecting keeps GitHub off and is remembered; settings can change it later', async ({ page }) => {
  const hits: string[] = [];
  await page.route(GH, (r) => { hits.push(r.request().url()); r.abort(); });
  await page.route('**/latest.json', (r) => r.abort());
  await page.goto('/');
  await page.getByRole('button', { name: 'Reject optional' }).click();
  await expect(page.locator('#na-cc')).toHaveCount(0);
  await page.reload(); await page.waitForTimeout(1200);
  await expect(page.locator('#na-cc')).toHaveCount(0);
  expect(hits).toEqual([]);
  expect(await page.evaluate(() => (window as any).naConsent.allowed('thirdparty'))).toBe(false);
  // withdraw/update later from the footer
  await page.locator('footer [data-cookie-settings]').first().click();
  await page.locator('#na-tp').check();
  await page.getByRole('button', { name: 'Save choices' }).click();
  expect(await page.evaluate(() => (window as any).naConsent.allowed('thirdparty'))).toBe(true);
});

test('withdrawing consent deletes what the optional category stored', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Accept all' }).click();
  await page.evaluate(() => localStorage.setItem('gh:/releases/latest', '{"t":1,"d":{}}'));
  await page.evaluate(() => (window as any).naConsent.open());
  await page.getByRole('button', { name: 'Reject optional' }).click();
  expect(await page.evaluate(() => localStorage.getItem('gh:/releases/latest'))).toBeNull();
});

test('the cookie policy page exists and can reopen the settings', async ({ page }) => {
  await page.goto('/cookie-policy.html');
  await expect(page.getByRole('heading', { name: 'Cookie policy' })).toBeVisible();
  for (const h of ['Strictly necessary', 'Analytics', 'Marketing']) await expect(page.getByRole('heading', { name: new RegExp(h) })).toBeVisible();
  await page.getByRole('button', { name: 'Open cookie settings' }).click();
  await expect(page.locator('#na-tp')).toBeVisible();
});
