import { test, expect } from '@playwright/test';

test('the Instagram button opens a menu with the profile and a direct message, and closes on Escape', async ({ page }) => {
  await page.goto('/');
  const btn = page.getByRole('button', { name: 'Notch Apple on Instagram' });
  await expect(btn).toBeVisible();
  await expect(page.locator('#na-ig-m')).toBeHidden();
  await btn.click();
  await expect(page.getByRole('link', { name: /Open our profile/ })).toHaveAttribute('href', 'https://www.instagram.com/notchapples/');
  await expect(page.getByRole('link', { name: /Send us a message/ })).toHaveAttribute('href', 'https://ig.me/m/notchapples');
  await page.keyboard.press('Escape');
  await expect(page.locator('#na-ig-m')).toBeHidden();
});
