import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/index.html');
});

test('no horizontal scroll and no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.waitForTimeout(800);
  const sw = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(sw).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

test('nav logo is not truncated and download is visible', async ({ page }) => {
  const logo = page.locator('.nn .logo');
  const dl = page.locator('.nn a.btn');
  await expect(dl).toBeVisible();
  const [l, d] = await Promise.all([logo.boundingBox(), dl.boundingBox()]);
  expect(l!.x + l!.width).toBeLessThanOrEqual(d!.x + 1);
});

test('main CTAs exist', async ({ page }) => {
  await expect(page.locator('#heroDl')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Windows' }).first()).toBeVisible();
});

test('in-page anchors resolve', async ({ page }) => {
  const missing = await page.evaluate(() =>
    [...document.querySelectorAll('a[href^="#"]')]
      .map((a) => a.getAttribute('href')!)
      .filter((h) => h.length > 1 && !document.querySelector(h)));
  expect(missing).toEqual([]);
});

test('mobile menu opens and navigates', async ({ page, isMobile }) => {
  test.skip(!isMobile);
  await page.locator('#menuBtn').click();
  await expect(page.locator('#mobileMenu')).toHaveClass(/on/);
  await page.locator('#mobileMenu a[href="#pro"]').click();
  await expect(page.locator('#pro')).toBeInViewport();
});

test('desktop nav links scroll to sections', async ({ page, isMobile }) => {
  test.skip(isMobile);
  await page.locator('.nl a[href="#features"]').click();
  await expect(page.locator('#features')).toBeInViewport();
});

test('demo notch opens on click and tabs switch', async ({ page }) => {
  await page.locator('#demo').scrollIntoViewIfNeeded();
  await page.locator('#notch').click();
  await expect(page.locator('#notch')).toHaveClass(/open/);
  await page.locator('#tabs button').nth(1).click();
  await expect(page.locator('#tabs button').nth(1)).toHaveClass(/on/);
  await page.keyboard.press('Escape');
  await expect(page.locator('#notch')).not.toHaveClass(/open/);
});

test('FAQ items toggle', async ({ page }) => {
  const d = page.locator('details').first();
  await d.scrollIntoViewIfNeeded();
  await d.locator('summary').click();
  await expect(d).toHaveAttribute('open', '');
});

test('images load', async ({ page }) => {
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 700) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); }
  });
  await expect.poll(() => page.evaluate(() =>
    [...document.images].filter((i) => i.src && i.complete && !i.naturalWidth).map((i) => i.src)),
    { timeout: 15000 }).toEqual([]);
});

for (const path of ['/pro.html', '/terms.html']) {
  test(`${path} loads`, async ({ page }) => {
    const r = await page.goto(path);
    expect(r!.status()).toBe(200);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  });
}

test('progress bar and back-to-top work', async ({ page }) => {
  const top = page.locator('#toTop');
  await expect(top).not.toHaveClass(/on/);
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight / 2));
  await expect(top).toHaveClass(/on/);
  // Browsers with native scroll timelines draw the bar themselves; the rest get it from the script (--p). Read what is drawn.
  const filled = () => page.locator('#prog').evaluate((e) => new DOMMatrix(getComputedStyle(e).transform).a);
  await expect.poll(filled).toBeGreaterThan(0.2);
  await top.click();
  await expect.poll(() => page.evaluate(() => scrollY)).toBeLessThan(5);
});
