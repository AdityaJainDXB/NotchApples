import { test, expect, Page } from '@playwright/test';

// The GitHub API is blocked so the page is the same every run.
async function load(page: Page) {
  await page.route('https://api.github.com/**', (r) => r.abort());
  await page.goto('/index.html');
}

const pauseTour = (page: Page) => page.locator('#demoPause').click();

test('closed states are out of the keyboard order', async ({ page }) => {
  await load(page);
  for (const sel of ['#toTop', '#lb', '#pmenu', '#mobileMenu', '#notchPanel']) {
    const r = await page.evaluate((s) => {
      const c = document.querySelector(s)!;
      const t = (c.matches('button,a') ? c : c.querySelector('a,button')) as HTMLElement;
      t.focus();
      return { visible: c.checkVisibility({ visibilityProperty: true }), focused: document.activeElement === t };
    }, sel);
    expect(r, sel).toEqual({ visible: false, focused: false });
  }
});

test('the demo notch opens from the keyboard and gives focus back', async ({ page }) => {
  await load(page);
  await pauseTour(page);
  const trigger = page.locator('#notchBtn');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#notch')).toHaveClass(/open/);
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#tabs [role=tab][aria-selected=true]')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#notch')).not.toHaveClass(/open/);
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(trigger).toBeFocused();
});

test('demo tabs are a tablist with arrow-key navigation', async ({ page }) => {
  await load(page);
  await pauseTour(page);
  await page.locator('#notchBtn').focus();
  await page.keyboard.press('Enter');
  const tabs = page.locator('#tabs [role=tab]');
  expect(await tabs.count()).toBeGreaterThan(5);
  await expect(page.locator('#tabs')).toHaveAttribute('role', 'tablist');
  await expect(page.locator('#tabs [role=tab][aria-selected=true]')).toHaveCount(1);
  await expect(page.locator('#tabs [role=tab][tabindex="0"]')).toHaveCount(1);
  await page.keyboard.press('ArrowRight');
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(tabs.nth(1)).toBeFocused();
  await page.keyboard.press('End');
  await expect(tabs.last()).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
  // every tab controls a labelled panel
  const wired = await page.evaluate(() =>
    [...document.querySelectorAll('#tabs [role=tab]')].every((t) => {
      const p = document.getElementById(t.getAttribute('aria-controls')!);
      return p?.getAttribute('role') === 'tabpanel' && p.getAttribute('aria-labelledby') === t.id;
    }));
  expect(wired).toBe(true);
});

test('the first tab is fully visible when the notch opens', async ({ page }) => {
  await load(page);
  await pauseTour(page);
  await page.locator('#notchBtn').click();
  await expect(page.locator('#notch')).toHaveClass(/open/);
  await expect.poll(() => page.evaluate(() => document.querySelector<HTMLElement>('#tabs')!.scrollLeft)).toBe(0);
});

test('snap zones are labelled buttons, and focusing one snaps the window', async ({ page }) => {
  await load(page);
  await pauseTour(page);
  await page.locator('#notchBtn').click();
  await expect(page.locator('#notch')).toHaveClass(/open/);
  const zones = page.locator('#snaps .sz');
  await expect(zones).toHaveCount(16);
  expect(await zones.evaluateAll((z) => z.every((e) => e.tagName === 'BUTTON' && /^Snap window: /.test(e.getAttribute('aria-label') || '')))).toBe(true);
  await page.evaluate(() => {
    const i = [...document.querySelectorAll('.view')].findIndex((v) => v.contains(document.querySelector('#snaps')));
    (document.querySelectorAll('#tabs [role=tab]')[i] as HTMLElement).click();
  });
  const before = await page.locator('#w1').getAttribute('style');
  await zones.nth(1).focus();
  await expect.poll(() => page.locator('#w1').getAttribute('style')).not.toBe(before);
});

test('the lightbox opens from the keyboard, traps focus and restores it', async ({ page }) => {
  await load(page);
  await page.locator('#gal').scrollIntoViewIfNeeded();
  const shot = page.locator('#gal .shot').first();
  await expect(shot).toBeVisible();
  await shot.focus();
  await page.keyboard.press('Enter');
  const lb = page.locator('#lb');
  await expect(lb).toHaveClass(/on/);
  await expect(lb.locator('.lb-x')).toBeFocused();
  expect(await page.evaluate(() => document.querySelector('header')!.inert)).toBe(true);
  await page.keyboard.press('Tab');
  await expect(lb.locator('.lb-x')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(lb).not.toHaveClass(/on/);
  await expect(shot).toBeFocused();
  expect(await page.evaluate(() => document.querySelector('header')!.inert)).toBe(false);
});

test('the mobile menu takes focus, closes on Escape and gives it back', async ({ page }) => {
  await load(page);
  const btn = page.locator('#menuBtn');
  test.skip(!(await btn.isVisible()), 'the menu button only shows on narrow screens');
  await btn.click();
  await expect(page.locator('#mobileMenu')).toHaveClass(/on/);
  await expect(page.locator('#mobileMenu a').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#mobileMenu')).not.toHaveClass(/on/);
  await expect(btn).toBeFocused();
});

test('the tour can be paused', async ({ page }) => {
  await load(page);
  await expect(page.locator('#demoPause')).toBeVisible();
  await pauseTour(page);
  await expect(page.locator('#demoPause')).toBeHidden();
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });
  test('the tour stays off and has no pause button', async ({ page }) => {
    await load(page);
    await page.waitForTimeout(3000);
    await expect(page.locator('#notch')).not.toHaveClass(/open/);
    await expect(page.locator('#demoPause')).toBeHidden();
  });
});
