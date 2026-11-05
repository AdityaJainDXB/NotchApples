// Scribble, two real players (a host and a guest, in two browser pages) over the live room relay: the words go only to the drawer, the
// strokes appear on both screens, wrong and right guesses, early end of a turn, and both players drawing in turn. It needs network access
// to the relay, so it is not part of `node --test`. Run: node NotchWindows/tests/manual/scribble-e2e.mjs
// (uses Playwright and its Chromium from web/node_modules, and serves the game's two files itself).
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const games = resolve(here, '../../src/js/games');
const { chromium } = await import(new URL('../../../web/node_modules/playwright/index.mjs', import.meta.url).href);
const PAGE = '<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%}#game{position:absolute;inset:0}</style><div id="game"></div><script src="/scribble-logic.js"></script><script src="/scribble.js"></script><script>window.NotchScribbleGame.mount(document.getElementById("game"), Object.fromEntries(new URLSearchParams(location.search)));</script>';
const server = http.createServer((req, res) => {
  const f = req.url.split('?')[0];
  if (f === '/' || f === '/index.html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(PAGE); }
  else if (f === '/scribble.js' || f === '/scribble-logic.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(readFileSync(resolve(games, f.slice(1)))); }
  else { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://localhost:${server.address().port}/index.html`;
const ROOM = [...'ABCDEFGHJKMNPQRSTUVWXYZ23456789'].sort(() => Math.random() - 0.5).slice(0, 6).join('');
const out = [];
const ok = (c, m) => { out.push((c ? 'ok   ' : 'FAIL ') + m); };
const browser = await chromium.launch();
const mk = async (name, host) => { const ctx = await browser.newContext({ viewport: { width: 1000, height: 640 } }); const p = await ctx.newPage(); p.on('pageerror', (e) => out.push('PAGEERROR ' + name + ': ' + e.message)); await p.goto(`${BASE}?room=${ROOM}&host=${host}&name=${name}`); return p; };
const A = await mk('Hosty', 1);
await A.waitForSelector('text=Online room', { timeout: 8000 });
const B = await mk('Guesty', 0);
try {
  await A.waitForSelector('.lobby >> text=Guesty', { timeout: 10000 });
  ok(true, 'the guest appears in the host\'s lobby');
  await B.waitForSelector('text=Waiting for Hosty', { timeout: 10000 });
  ok(true, 'the guest is told it joined');
  await A.click('text=Start the game');
  const pages = { Hosty: A, Guesty: B };
  const scores = {};
  for (let turn = 1; turn <= 2; turn++) {
    // who is choosing?
    let drawer = null;
    for (let i = 0; i < 60 && !drawer; i++) { for (const [n, p] of Object.entries(pages)) if (await p.locator('.tools [data-w]').count()) drawer = n; if (!drawer) await A.waitForTimeout(200); }
    ok(!!drawer, `turn ${turn}: someone is offered three words (${drawer})`);
    const other = drawer === 'Hosty' ? 'Guesty' : 'Hosty';
    const dp = pages[drawer], gp = pages[other];
    ok((await dp.locator('.tools [data-w]').count()) === 3, 'the drawer is offered exactly three words');
    ok((await gp.locator('.tools [data-w]').count()) === 0, 'the other player is not offered any');
    const word = (await dp.locator('.tools [data-w]').first().innerText()).trim();
    await dp.locator('.tools [data-w]').first().click();
    await dp.waitForFunction((w) => document.querySelector('.hint').innerText.toLowerCase().includes(w), word, { timeout: 8000 });
    ok(true, `the drawer sees the word "${word}" (private message arrived)`);
    await gp.waitForFunction(() => /^[_ \n]+/.test(document.querySelector('.hint').innerText) && document.querySelector('.hint').innerText.includes('_'), null, { timeout: 8000 });
    const hintText = (await gp.locator('.hint').innerText());
    const bodyText = (await gp.evaluate(() => document.body.innerText)).toLowerCase();
    ok(!bodyText.includes(word) || word.length < 3 && false, `the other player's page never shows the word (hint: ${JSON.stringify(hintText.split('\n')[0])})`);
    // the drawer draws a stroke; the other page must show ink
    const box = await dp.locator('canvas').boundingBox();
    await dp.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.3);
    await dp.mouse.down();
    for (let i = 1; i <= 12; i++) await dp.mouse.move(box.x + box.width * (0.2 + i * 0.05), box.y + box.height * (0.3 + (i % 3) * 0.1));
    await dp.mouse.up();
    await gp.waitForTimeout(800);
    const ink = async (p) => p.evaluate(() => { const c = document.querySelector('canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 200 || d[i + 1] < 200 || d[i + 2] < 200) n++; return n; });
    const mine = await ink(dp), theirs = await ink(gp);
    ok(mine > 200 && theirs > 200, `the stroke shows on both screens (drawer ${mine} px, guesser ${theirs} px)`);
    // a wrong guess, then the right one
    await gp.fill('.say input', 'qqqzz'); await gp.press('.say input', 'Enter');
    await dp.waitForFunction(() => document.querySelector('.chat').innerText.includes('qqqzz'), null, { timeout: 8000 });
    ok(true, 'a wrong guess shows in everybody\'s chat');
    await gp.fill('.say input', word); await gp.press('.say input', 'Enter');
    await dp.waitForFunction(() => /guessed the word/.test(document.querySelector('.chat').innerText), null, { timeout: 8000 });
    await gp.waitForFunction(() => /guessed the word/.test(document.querySelector('.chat').innerText), null, { timeout: 8000 });
    ok(true, 'the right guess is announced to both, without typing the word in the chat');
    const chatB = (await gp.locator('.chat').innerText()).toLowerCase();
    ok(!chatB.split('\n').some((l) => l.includes(word) && !/was|word/.test(l) ), 'the chat never shows the word as a message');
    await gp.waitForFunction(() => document.querySelector('.hint').innerText.includes('The word was'), null, { timeout: 8000 });
    ok(true, 'the turn ends early (everybody guessed) and the word is revealed');
    const sc = await gp.locator('.players').innerText();
    scores[turn] = sc.replace(/\n/g, ' ');
    // wait for the next turn
    if (turn < 2) await A.waitForTimeout(6500);
  }
  ok(/\d{3}/.test(scores[2]), `scores are on the board: ${scores[2]}`);
} catch (e) { out.push('ERROR ' + e.message.split('\n')[0]); }
console.log(out.join('\n'));
await browser.close();
server.close();
process.exit(out.some((l) => /^(FAIL|ERROR|PAGEERROR)/.test(l)) ? 1 : 0);
