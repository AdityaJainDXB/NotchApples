import { test, expect } from '@playwright/test';

// The picture beside "Ask about anything on your screen" must stay in view and follow the step being read.
// It stopped doing both when the body was made an overflow container (position: sticky then sticks to the body).
test('the step preview stays in view and changes with the step, going down and back up', async ({ page, isMobile }) => {
  test.skip(isMobile || (page.viewportSize()?.width ?? 0) < 900, 'the preview is hidden on narrow screens; each step shows its own picture');
  await page.goto('/index.html');
  await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; document.querySelector('#capture')!.scrollIntoView(); });
  await page.mouse.move(400, 400);
  const state = () => page.evaluate(() => ({
    top: document.querySelector('.sa-media')!.getBoundingClientRect().top,
    img: [...document.querySelectorAll('.sa-media img')].findIndex((i) => i.classList.contains('on')),
  }));
  const seen: number[] = [];
  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(0, 250); await page.waitForTimeout(350);
    const s = await state();
    if (s.img > -1 && s.top > -50) { expect(s.top, 'the preview is on screen while its steps are read').toBeGreaterThan(-50); }
    seen.push(s.img);
  }
  expect(Math.max(...seen)).toBe(3);
  expect(new Set(seen).size).toBeGreaterThan(2);
  // And back up: the pictures return in reverse.
  const up: number[] = [];
  for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, -250); await page.waitForTimeout(350); up.push((await state()).img); }
  expect(up).toContain(1);
});
