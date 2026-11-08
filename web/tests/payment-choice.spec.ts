import { test, expect } from '@playwright/test';

const config = (region: 'ae' | 'intl') => ({
  prices: { pro: 5, ultimate: 15, upgrade: 10 }, ultimate: true, network: 'mainnet', wallet: 'x', coins: [],
  card: {
    on: true, region, detected: true,
    ae: { cur: 'AED', prices: { pro: 4.4, ultimate: 18, upgrade: 13.6 }, fee: { pct: 3, flat: 1 } },
    intl: { cur: 'USD', prices: { pro: 5, ultimate: 15, upgrade: 10 }, fee: { pct: 5, flat: 0.3 } },
  },
});

for (const [region, tierUrl] of [['intl', 'ch_592NS3uitgEidbE'], ['ae', 'plan_ebtYN1VAJeNt8']] as const) {
  test(`pay with Whop sends a ${region} visitor to the right Whop checkout`, async ({ page }) => {
    await page.route('**/config', (r) => r.fulfill({ json: config(region), headers: { 'access-control-allow-origin': '*' } }));
    let went = '';
    await page.route(/whop\.com\/checkout\//, (r) => { went = r.request().url(); r.fulfill({ body: 'ok', contentType: 'text/html' }); });
    await page.goto('/pro.html');
    const whop = page.locator('.methodChoice button[data-method=whop]').first();
    await expect(whop).toBeVisible();
    await expect(page.locator('.methodChoice button[data-method=card]').first()).toBeVisible();
    await expect(page.locator('.methodChoice button[data-method=crypto]').first()).toBeVisible();
    await whop.click();
    await page.locator('#email').fill('buyer@example.com');
    await page.locator('#orderBtn').click();
    await page.waitForURL(/whop\.com\/checkout\//, { timeout: 5000 }).catch(() => {});
    expect(went).toContain(tierUrl);
  });
}
