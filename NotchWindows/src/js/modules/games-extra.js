// The Mac's other four games: Cookie Clicker, Runner, Breakout and Memory.
// Cookie Clicker uses the Mac's exact rules (CookieEngine in GameEngines.swift):
// same prices, same cookies per second, a price growth of 1.15, and up to an hour of
// away-time at half speed. Best scores and saves stay on this PC.

import { el, load, save } from '../store.js';

const accent = () => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#9e6bff';
function best(key, v, lowerIsBetter = false) {
  const b = load(`games.best.${key}`, 0);
  if (v !== undefined && (!b || (lowerIsBetter ? v < b : v > b))) { save(`games.best.${key}`, v); return v; }
  return b;
}

// ---------------------------------------------------------------- Cookie Clicker

export const BUILDINGS = [
  { id: 'cursor', name: 'Auto-clicker', glyph: '🖱️', base: 15, cps: 0.2 },
  { id: 'grandma', name: 'Grandma', glyph: '👵', base: 100, cps: 1 },
  { id: 'farm', name: 'Cookie farm', glyph: '🌾', base: 1100, cps: 8 },
  { id: 'mine', name: 'Cookie mine', glyph: '⛏️', base: 12000, cps: 47 },
  { id: 'factory', name: 'Factory', glyph: '🏭', base: 130000, cps: 260 },
];
export const CLICK_UPGRADES = [100, 500, 5000, 50000, 500000, 5000000];
const GROWTH = 1.15;

export const cookieFormat = (v) => {
  v = Math.max(0, v);
  if (v < 10000) return Math.floor(v).toLocaleString();
  if (v < 1e6) return `${(v / 1e3).toFixed(1)}K`;
  if (v < 1e9) return `${(v / 1e6).toFixed(2)}M`;
  if (v < 1e12) return `${(v / 1e9).toFixed(2)}B`;
  return `${(v / 1e12).toFixed(2)}T`;
};

/// The rules, with no screen in them, so they can be tested.
export class CookieEngine {
  constructor(s = {}) {
    this.cookies = s.cookies || 0; this.baked = s.baked || 0; this.clicks = s.clicks || 0;
    this.owned = s.owned || {}; this.clickLevel = s.clickLevel || 0; this.savedAt = s.savedAt || null;
  }
  count(id) { return this.owned[id] || 0; }
  isUnlocked(b) { return this.count(b.id) > 0 || this.baked >= b.base * 0.6; }
  cost(b) { return Math.round(b.base * GROWTH ** this.count(b.id)); }
  get clickValue() { return 2 ** this.clickLevel; }
  get cps() { return BUILDINGS.reduce((a, b) => a + this.count(b.id) * b.cps, 0); }
  get nextUpgrade() { return this.clickLevel < CLICK_UPGRADES.length ? CLICK_UPGRADES[this.clickLevel] : null; }
  click() { const g = this.clickValue; this.cookies += g; this.baked += g; this.clicks++; return g; }
  tick(dt) { if (!(dt > 0) || !Number.isFinite(dt)) return; const g = this.cps * Math.min(dt, 3600); this.cookies += g; this.baked += g; }
  buy(b) { const p = this.cost(b); if (!this.isUnlocked(b) || this.cookies < p) return false; this.cookies -= p; this.owned[b.id] = this.count(b.id) + 1; return true; }
  buyUpgrade() { const p = this.nextUpgrade; if (p === null || this.cookies < p) return false; this.cookies -= p; this.clickLevel++; return true; }
  applyOffline(now = Date.now()) {
    if (!this.savedAt) return;
    const away = Math.min(Math.max((now - this.savedAt) / 1000, 0), 3600);
    const g = this.cps * away * 0.5; this.cookies += g; this.baked += g; this.savedAt = now;
  }
  toJSON() { return { cookies: this.cookies, baked: this.baked, clicks: this.clicks, owned: this.owned, clickLevel: this.clickLevel, savedAt: Date.now() }; }
}

export function cookie(host) {
  const KEY = 'games.cookie.save';
  const e = new CookieEngine(load(KEY, {}));
  e.applyOffline();
  const total = el('div', { class: 'big num' }), rate = el('div', { class: 'dim' });
  const cookieBtn = el('button', { class: 'cookie-btn', title: 'Click!', 'aria-label': 'Cookie' }, '🍪');
  const pops = el('div', { style: 'position:absolute;inset:0;pointer-events:none;overflow:hidden' });
  const shop = el('div', { class: 'col gap-6 scroll', style: 'flex:1;min-height:0' });
  let last = Date.now(), lastSave = Date.now();

  const paint = () => {
    total.textContent = `${cookieFormat(e.cookies)} cookies`;
    rate.textContent = `${cookieFormat(e.cps)} per second · ${e.clickValue} per click`;
    const rows = [];
    const up = e.nextUpgrade;
    rows.push(el('button', { class: 'btn quiet', style: 'justify-content:space-between;width:100%', disabled: up === null || e.cookies < up, onclick: () => { e.buyUpgrade(); paint(); } },
      el('span', {}, up === null ? 'Click power maxed' : `Double click power (×${e.clickValue * 2})`), el('span', { class: 'num dim' }, up === null ? '' : cookieFormat(up))));
    for (const b of BUILDINGS) {
      if (!e.isUnlocked(b)) continue;
      rows.push(el('button', { class: 'btn quiet', style: 'justify-content:space-between;width:100%', disabled: e.cookies < e.cost(b), onclick: () => { e.buy(b); paint(); } },
        el('span', { class: 'hstack' }, el('span', {}, b.glyph), `${b.name}`, el('span', { class: 'tiny dim' }, `×${e.count(b.id)}`)), el('span', { class: 'num dim' }, cookieFormat(e.cost(b)))));
    }
    shop.replaceChildren(...rows);
  };
  const pop = (n) => {
    const p = el('div', { style: `position:absolute;left:calc(50% + ${Math.round(Math.random() * 60 - 30)}px);top:38%;font-weight:800;color:var(--accent-bright);animation:cookie-pop .9s ease-out forwards` }, `+${cookieFormat(n)}`);
    pops.append(p); setTimeout(() => p.remove(), 900);
  };
  cookieBtn.addEventListener('click', () => { pop(e.click()); total.textContent = `${cookieFormat(e.cookies)} cookies`; });
  const t = setInterval(() => {
    const now = Date.now(); e.tick((now - last) / 1000); last = now;
    if (now - lastSave > 5000) { save(KEY, e); lastSave = now; }
    paint();
  }, 100);
  paint();
  host.replaceChildren(el('div', { class: 'row fill', style: 'gap:16px;width:100%' },
    el('div', { class: 'card col', style: 'flex:1;align-items:center;justify-content:center;position:relative' }, total, rate, cookieBtn, pops),
    el('div', { class: 'card col', style: 'flex:1;min-width:0' }, el('div', { class: 'section-title' }, 'Shop'), shop)));
  return () => { clearInterval(t); save(KEY, e); };
}

// ---------------------------------------------------------------- Runner

export function runner(host) {
  const W = 520, H = 190, G = 150;
  const cv = el('canvas', { width: W, height: H, style: 'border-radius:14px;background:rgba(255,255,255,.04);max-width:100%' });
  const ctx = cv.getContext('2d'), info = el('div', { class: 'small dim' });
  let y, vy, obs, speed, score, alive, started, raf, last;
  const reset = () => { y = G; vy = 0; obs = []; speed = 240; score = 0; alive = true; started = false; last = performance.now(); };
  const jump = () => {
    if (!alive) { reset(); started = true; return; }
    started = true;
    if (y >= G) vy = -520;
  };
  const key = (e) => { if (e.key === ' ' || e.key === 'ArrowUp') { e.preventDefault(); jump(); } };
  const frame = (now) => {
    const dt = Math.min((now - last) / 1000, 0.05); last = now;
    if (started && alive) {
      vy += 1500 * dt; y = Math.min(G, y + vy * dt); if (y >= G) vy = 0;
      speed += 6 * dt; score += speed * dt / 10;
      if (!obs.length || obs[obs.length - 1].x < W - 200 - Math.random() * 220) obs.push({ x: W + 20, w: 14 + Math.random() * 14, h: 24 + Math.random() * 26 });
      for (const o of obs) o.x -= speed * dt;
      obs = obs.filter((o) => o.x > -40);
      for (const o of obs) if (o.x < 70 + 22 && o.x + o.w > 70 && y > G - o.h - 4) { alive = false; best('runner', Math.floor(score)); }
    }
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.beginPath(); ctx.moveTo(0, G + 22); ctx.lineTo(W, G + 22); ctx.stroke();
    ctx.fillStyle = accent(); ctx.fillRect(70, y, 22, 22);
    ctx.fillStyle = '#ff6b9a'; for (const o of obs) ctx.fillRect(o.x, G + 22 - o.h, o.w, o.h);
    info.textContent = !started ? 'Press Space or click to run and jump' : alive ? `Score ${Math.floor(score)} · Best ${best('runner')}` : `Crashed at ${Math.floor(score)}. Press Space to run again.`;
    raf = requestAnimationFrame(frame);
  };
  reset(); raf = requestAnimationFrame(frame);
  cv.addEventListener('mousedown', jump);
  addEventListener('keydown', key);
  host.replaceChildren(el('div', { class: 'col', style: 'align-items:center;gap:8px' }, cv, info));
  return () => { cancelAnimationFrame(raf); removeEventListener('keydown', key); };
}

// ---------------------------------------------------------------- Breakout

export function breakout(host) {
  const W = 440, H = 270, PW = 70;
  const cv = el('canvas', { width: W, height: H, style: 'border-radius:14px;background:rgba(255,255,255,.04);max-width:100%' });
  const ctx = cv.getContext('2d'), info = el('div', { class: 'small dim' });
  let px, ball, bricks, lives, score, state, raf, last, left = false, right = false;
  const build = () => { bricks = []; for (let r = 0; r < 5; r++) for (let c = 0; c < 10; c++) bricks.push({ x: 8 + c * 43, y: 28 + r * 17, w: 39, h: 13, r }); };
  const serve = () => { ball = { x: px + PW / 2, y: H - 30, vx: 150 * (Math.random() < 0.5 ? -1 : 1), vy: -230 }; };
  const reset = () => { px = (W - PW) / 2; lives = 3; score = 0; state = 'ready'; build(); serve(); last = performance.now(); };
  const colours = ['#ff6b9a', '#ff9f6b', '#ffd36b', '#6bdc9f', '#6bb7ff'];
  const key = (e) => {
    if (e.key === 'ArrowLeft') { left = e.type === 'keydown'; e.preventDefault(); }
    if (e.key === 'ArrowRight') { right = e.type === 'keydown'; e.preventDefault(); }
    if (e.type === 'keydown' && e.key === ' ') { e.preventDefault(); if (state === 'ready') state = 'play'; else if (state !== 'play') reset(); }
  };
  const move = (e) => { const r = cv.getBoundingClientRect(); px = Math.max(0, Math.min(W - PW, ((e.clientX - r.left) / r.width) * W - PW / 2)); };
  const frame = (now) => {
    const dt = Math.min((now - last) / 1000, 0.04); last = now;
    if (left) px = Math.max(0, px - 380 * dt); if (right) px = Math.min(W - PW, px + 380 * dt);
    if (state === 'ready') { ball.x = px + PW / 2; ball.y = H - 30; }
    if (state === 'play') {
      ball.x += ball.vx * dt; ball.y += ball.vy * dt;
      if (ball.x < 5 || ball.x > W - 5) { ball.vx *= -1; ball.x = Math.max(5, Math.min(W - 5, ball.x)); }
      if (ball.y < 5) { ball.vy = Math.abs(ball.vy); }
      if (ball.vy > 0 && ball.y > H - 22 && ball.y < H - 10 && ball.x > px - 4 && ball.x < px + PW + 4) {
        const off = (ball.x - (px + PW / 2)) / (PW / 2); const sp = Math.min(460, Math.hypot(ball.vx, ball.vy) * 1.02);
        ball.vx = off * sp * 0.75; ball.vy = -Math.sqrt(Math.max(sp * sp - ball.vx * ball.vx, 1));
      }
      for (const b of bricks) if (ball.x > b.x && ball.x < b.x + b.w && ball.y > b.y && ball.y < b.y + b.h) { bricks.splice(bricks.indexOf(b), 1); ball.vy *= -1; score += 10; break; }
      if (!bricks.length) { state = 'won'; best('breakout', score); }
      if (ball.y > H) { lives--; if (lives <= 0) { state = 'lost'; best('breakout', score); } else { state = 'ready'; serve(); } }
    }
    ctx.clearRect(0, 0, W, H);
    for (const b of bricks) { ctx.fillStyle = colours[b.r]; ctx.fillRect(b.x, b.y, b.w, b.h); }
    ctx.fillStyle = accent(); ctx.fillRect(px, H - 16, PW, 8);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ball.x, ball.y, 5, 0, 7); ctx.fill();
    info.textContent = state === 'ready' ? 'Move with the mouse or ← →, Space to launch' : state === 'won' ? `You cleared it! Score ${score}. Space to play again.` : state === 'lost' ? `Game over — ${score}. Space to play again.` : `Score ${score} · Lives ${lives} · Best ${best('breakout')}`;
    raf = requestAnimationFrame(frame);
  };
  reset(); raf = requestAnimationFrame(frame);
  cv.addEventListener('mousemove', move);
  addEventListener('keydown', key); addEventListener('keyup', key);
  host.replaceChildren(el('div', { class: 'col', style: 'align-items:center;gap:8px' }, cv, info));
  return () => { cancelAnimationFrame(raf); removeEventListener('keydown', key); removeEventListener('keyup', key); };
}

// ---------------------------------------------------------------- Memory

export function memory(host) {
  const FACES = ['🍎', '🚀', '🎧', '🌵', '🐙', '🎲', '🍕', '🔮'];
  let cards, open, matched, moves, lock = false, timer;
  const grid = el('div', { style: 'display:grid;grid-template-columns:repeat(4,64px);gap:8px' });
  const info = el('div', { class: 'small dim' });
  const deal = () => {
    cards = [...FACES, ...FACES].sort(() => Math.random() - 0.5); open = []; matched = new Set(); moves = 0; lock = false; paint();
  };
  const paint = () => {
    grid.replaceChildren(...cards.map((f, i) => {
      const up = open.includes(i) || matched.has(i);
      return el('button', { class: 'tile', style: `height:64px;font-size:28px;${matched.has(i) ? 'opacity:.55' : ''}`, onclick: () => flip(i) }, up ? f : '');
    }));
    info.textContent = matched.size === cards.length ? `Done in ${moves} moves (best ${best('memory', moves, true)}). Tap New game to play again.` : `Moves ${moves}${best('memory') ? ` · Best ${best('memory')}` : ''}`;
  };
  const flip = (i) => {
    if (lock || open.includes(i) || matched.has(i)) return;
    open.push(i);
    if (open.length === 2) {
      moves++; lock = true;
      if (cards[open[0]] === cards[open[1]]) { open.forEach((x) => matched.add(x)); open = []; lock = false; }
      else timer = setTimeout(() => { open = []; lock = false; paint(); }, 750);
    }
    paint();
  };
  deal();
  host.replaceChildren(el('div', { class: 'col', style: 'align-items:center;gap:8px' }, grid, info, el('button', { class: 'btn small quiet', onclick: deal }, 'New game')));
  return () => clearTimeout(timer);
}
