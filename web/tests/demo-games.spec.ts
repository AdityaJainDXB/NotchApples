import { test, expect } from '@playwright/test';

// The Games tab of the demo notch runs the real Night Shift and Tetris, loaded only when a game is picked, and stops them when you leave.
test('the demo notch plays real games, loads them only on click, and stops them when you leave the tab', async ({ page, isMobile }) => {
  test.skip(!!isMobile, 'the games need a keyboard: phones see a message instead');
  const gameFiles: string[] = [], errors: string[] = [];
  page.on('request', (r) => { if (/assets\/games\//.test(r.url())) gameFiles.push(r.url().split('/').pop()!); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route(/notchapple-licenses/, (r) => r.abort());
  await page.goto('/index.html');
  await page.waitForTimeout(1500);
  expect(gameFiles).toEqual([]);                                   // nothing loads until someone picks a game
  await page.evaluate(() => document.querySelector('#demo')!.scrollIntoView({ block: 'center' }));
  await page.click('#demoPause').catch(() => {});
  if (!(await page.evaluate(() => document.querySelector('#notch')!.classList.contains('open')))) await page.click('#notchBtn');
  await page.locator('#tabs button', { hasText: 'Games' }).click();
  await expect(page.locator('.gcard')).toHaveCount(2);
  expect(gameFiles).toEqual([]);
  await page.locator('.gcard[data-game=nightshift]').click();
  await expect(page.locator('#gbox canvas')).toHaveCount(1);
  expect(gameFiles).toEqual(['nightshift-logic.js', 'nightshift.js']);
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => (window as any).NotchNightShift._state()?.screen)).toBe('play');
  await page.locator('#gstop').click();
  await expect(page.locator('#gstage')).toBeHidden();
  await page.locator('.gcard[data-game=tetris]').click();
  await expect(page.locator('#gbox canvas')).toHaveCount(1);
  await page.locator('#tabs button', { hasText: 'Today' }).click();
  await expect(page.locator('#gstage')).toBeHidden();              // leaving the tab ends the game
  expect(await page.evaluate(() => document.querySelectorAll('#gbox canvas').length)).toBe(0);
  expect(errors).toEqual([]);
});
