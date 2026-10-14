import { test, expect, Page } from '@playwright/test';

// The test server is a single simple python process that sometimes drops a connection when pages load in parallel
// (ERR_CONNECTION_RESET). The helper is a progressive extra, so load the page again if it did not arrive.
async function open(page: Page, path: string) {
  for (let i = 0; i < 4; i++) {
    await page.goto(path);
    if (await page.locator('.nc-fab').first().waitFor({ timeout: 2500 }).then(() => true, () => false)) return;
  }
}

test('the helper opens, answers from the FAQ, admits when it is unsure, and sends nothing anywhere', async ({ page }) => {
  const outside: string[] = [];
  page.on('request', (r) => { const u = new URL(r.url()); if (!['localhost', '127.0.0.1'].includes(u.hostname) && !u.protocol.startsWith('data')) outside.push(r.url()); });
  await open(page, '/index.html');
  const fab = page.getByRole('button', { name: 'Ask a question about Notch Apple' });
  await expect(fab).toBeVisible();
  await fab.click();
  const dialog = page.getByRole('dialog', { name: 'Ask about Notch Apple' });
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel('Your question')).toBeFocused();

  await page.getByLabel('Your question').fill('how much does pro cost');
  await page.keyboard.press('Enter');
  await expect(dialog).toContainText('Pro is $1 and Ultimate is $5');
  await expect(dialog.getByRole('link', { name: /Pricing page/ })).toHaveAttribute('href', 'pro.html');

  await page.getByLabel('Your question').fill('what is the weather in paris');
  await page.keyboard.press('Enter');
  await expect(dialog).toContainText('I am not sure about that one');
  await expect(dialog.getByRole('link', { name: /Open an issue/ })).toHaveAttribute('href', /github\.com\/AdityaJainDXB\/NotchApples\/issues$/);

  const before = await page.locator('.nc-msg').count();
  await page.locator('.nc-chip').first().click();
  await expect(page.locator('.nc-msg')).toHaveCount(before + 2);   // the chip asks its question and gets an answer
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(fab).toBeFocused();
  expect(outside, 'nothing leaves the page').toEqual([]);
});

test('HTML in a question or in the data is never turned into markup', async ({ page }) => {
  await open(page, '/index.html');
  await page.getByRole('button', { name: 'Ask a question about Notch Apple' }).click();
  await page.getByLabel('Your question').fill('<img src=x onerror="window.__pwned=1"> price');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => (window as any).__pwned)).toBeUndefined();
  expect(await page.locator('.nc-log img').count()).toBe(0);
});

test('the helper is on the other pages too and does not break the layout on a phone', async ({ page }) => {
  for (const p of ['/pro.html', '/terms.html']) {
    await open(page, p);
    await expect(page.getByRole('button', { name: 'Ask a question about Notch Apple' })).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
