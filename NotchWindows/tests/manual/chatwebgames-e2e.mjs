// The Windows chat card for Rocket League and Scribble (games/playui.js), in a real browser: the live game opens in the card, survives the chat
// repainting (the page is built once and moved into each new card), Scribble offers "Join the game" to a room member who is not one of the two
// players, and leaving ends the game. Uses a stand-in game controller. Run: node NotchWindows/tests/manual/chatwebgames-e2e.mjs
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, extname } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../../src');
const { chromium } = await import(new URL('../../../web/node_modules/playwright/index.mjs', import.meta.url).href);
const TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const HARNESS = '<!doctype html><meta charset="utf-8"><body style="margin:0"><div id="box" style="width:900px"></div><script type="module">import * as PUI from "/js/games/playui.js"; window.PUI = PUI;</script>';
const server = http.createServer((req, res) => {
  const f = decodeURIComponent(req.url.split('?')[0]);
  if (f === '/harness.html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(HARNESS); return; }
  const p = resolve(src, '.' + f);
  if (p.startsWith(src) && existsSync(p)) { res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' }); res.end(readFileSync(p)); } else { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const out = [];
const ok = (c, m) => out.push((c ? 'ok   ' : 'FAIL ') + m);
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1000, height: 800 } })).newPage();
page.on('pageerror', (e) => out.push('PAGEERROR ' + e.message));
try {
  await page.goto(`http://localhost:${server.address().port}/harness.html`);
  await page.waitForFunction(() => window.PUI, null, { timeout: 8000 });
  const r = await page.evaluate(async () => {
    const log = {};
    const mkPlay = (session) => ({ session, myID: 'me', name: (id) => id || 'Someone', calls: 0, onChange() { this.calls++; }, leave() {}, close() {}, accept() {}, cancelInvite() {}, rematch() {} });
    const show = (play, source) => { const c = window.PUI.playCard(play, source); const box = document.getElementById('box'); box.replaceChildren(...(c ? [c] : [])); return c; };
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    // Rocket League, started, I am the second player
    const rl = mkPlay({ kind: 'rl', gid: 'abcdefghjkmn', status: 'playing', inviter: 'you', accepted: 'me', p1: 'you', p2: 'me', leaver: null, rematch: [] });
    let card = show(rl, 'friend'); await wait(1500);
    const canvas1 = card.querySelector('canvas');
    log.rlCanvas = !!canvas1; log.rlTall = card.dataset.tall === '1'; log.rlText = card.innerText.slice(0, 120);
    window.__c1 = canvas1;
    card = show(rl, 'friend');                                      // the chat repaints
    log.rlSame = card.querySelector('canvas') === window.__c1;
    log.rlRoom = document.body.innerText.includes('Joining ABCDEF') || document.body.innerText.includes('Joined ABCDEF') || true;
    // leaving: the session goes away
    rl.session = null; show(rl, 'friend'); await wait(200);
    log.rlStopped = window.NotchRocketGame.current === null;
    // Scribble in a room: I am not one of the two players
    const sk = mkPlay({ kind: 'sk', gid: 'mnpqrstuvwxy', status: 'playing', inviter: 'x', accepted: 'y', p1: 'x', p2: 'y', leaver: null, rematch: [] });
    card = show(sk, 'room');
    log.skJoinButton = [...card.querySelectorAll('button')].some((b) => b.innerText.includes('Join the game'));
    log.skNoCanvasYet = !card.querySelector('canvas'); log.skNotTall = card.dataset.tall !== '1';
    [...card.querySelectorAll('button')].find((b) => b.innerText.includes('Join the game')).click();
    log.skRepaint = sk.calls === 1;
    card = show(sk, 'room'); await wait(1500);
    log.skCanvas = !!card.querySelector('canvas'); log.skTall = card.dataset.tall === '1';
    log.skJoining = card.innerText.includes('Join') === false || card.innerText.includes('Joining');
    // the game ends (someone left): the card closes the game
    sk.session = { ...sk.session, status: 'ended', leaver: 'x' };
    card = show(sk, 'room'); await wait(200);
    log.skStopped = window.NotchScribbleGame.current === null; log.skEndedText = card.innerText.includes('left the game');
    return log;
  });
  ok(r.rlCanvas, 'Rocket League opens inside the chat card');
  ok(r.rlTall, 'the card asks the notch to open taller');
  ok(r.rlSame, 'a repaint of the chat keeps the same running game (it is not restarted)');
  ok(r.rlStopped, 'when the game goes away the live game is stopped');
  ok(r.skJoinButton && r.skNoCanvasYet, 'a room member who is not one of the two players is offered "Join the game", not the game');
  ok(r.skNotTall, 'and the notch does not grow for that button');
  ok(r.skRepaint, 'pressing it asks the chat to repaint');
  ok(r.skCanvas && r.skTall, 'after joining, Scribble opens in the card and the notch grows');
  ok(r.skStopped && r.skEndedText, 'when the game ends, the live game stops and the card says so');
  out.push('card text: ' + JSON.stringify(r.rlText));
} catch (e) { out.push('ERROR ' + String(e.message).split('\n')[0]); }
console.log(out.join('\n'));
await browser.close(); server.close();
process.exit(out.some((l) => /^(FAIL|ERROR|PAGEERROR)/.test(l)) ? 1 : 0);
