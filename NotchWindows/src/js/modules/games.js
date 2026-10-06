// Games: 2048, Snake, a reaction test, and (as on the Mac) Cookie Clicker, Runner, Breakout and Memory.
// Best scores stay on this PC.
import { el, load, save } from '../store.js';
import { segmented } from '../ui.js';
import { cookie, runner, breakout, memory } from './games-extra.js';

export function render(root) {
  let game = load('games.last', '2048'), stop = () => {};
  const board = el('div', { class: 'center', style: 'flex:1' });
  const pick = (g) => { stop(); game = g; save('games.last', g); stop = ({ 2048: g2048, snake, reaction, cookie, runner, breakout, memory })[g](board) || (() => {}); };
  root.append(el('div', { class: 'col fill' }, segmented([{ value: '2048', label: '2048' }, { value: 'snake', label: 'Snake' }, { value: 'reaction', label: 'Reaction' }, { value: 'cookie', label: 'Cookie Clicker' }, { value: 'runner', label: 'Runner' }, { value: 'breakout', label: 'Breakout' }, { value: 'memory', label: 'Memory' }], game, pick), board));
  pick(game);
  return () => stop();
}
function best(key, v) { const b = load(`games.best.${key}`, 0); if (v !== undefined && v > b) { save(`games.best.${key}`, v); return v; } return b; }

function g2048(host) {
  let grid = Array(16).fill(0), score = 0;
  const cells = el('div', { style: 'display:grid;grid-template-columns:repeat(4,64px);gap:6px' });
  const info = el('div', { class: 'small dim' });
  const add = () => { const e = grid.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0); if (e.length) grid[e[Math.floor(Math.random() * e.length)]] = Math.random() < 0.9 ? 2 : 4; };
  const colors = { 0: 'rgba(255,255,255,.05)', 2: '#3a3456', 4: '#4b3f78', 8: '#7a4fd6', 16: '#9e6bff', 32: '#c06bff', 64: '#e26bff', 128: '#ff6bcf', 256: '#ff6b9a', 512: '#ff8a6b', 1024: '#ffb36b', 2048: '#ffd36b' };
  const paint = () => { cells.replaceChildren(...grid.map((v) => el('div', { style: `height:64px;border-radius:9px;display:grid;place-items:center;font-weight:800;font-size:${v > 512 ? 18 : 22}px;background:${colors[v] || '#ffd36b'}` }, v || ''))); info.textContent = `Score ${score} · Best ${best('2048', score)}`; };
  const slide = (row) => { const r = row.filter(Boolean); for (let i = 0; i < r.length - 1; i++) if (r[i] === r[i + 1]) { r[i] *= 2; score += r[i]; r.splice(i + 1, 1); } while (r.length < 4) r.push(0); return r; };
  const move = (dir) => {
    const before = grid.join();
    for (let k = 0; k < 4; k++) {
      const idx = [0, 1, 2, 3].map((j) => (dir === 'left' ? k * 4 + j : dir === 'right' ? k * 4 + 3 - j : dir === 'up' ? j * 4 + k : (3 - j) * 4 + k));
      const r = slide(idx.map((i) => grid[i])); idx.forEach((i, j) => { grid[i] = r[j]; });
    }
    if (grid.join() !== before) add();
    paint();
  };
  const key = (e) => { const d = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', a: 'left', d: 'right', w: 'up', s: 'down' }[e.key]; if (d) { e.preventDefault(); move(d); } };
  add(); add(); paint();
  host.replaceChildren(el('div', { class: 'col', style: 'align-items:center;gap:8px' }, cells, info, el('button', { class: 'btn small quiet', onclick: () => { grid = Array(16).fill(0); score = 0; add(); add(); paint(); } }, 'New game'), el('div', { class: 'tiny faint' }, 'Arrow keys or WASD')));
  addEventListener('keydown', key);
  return () => removeEventListener('keydown', key);
}
function snake(host) {
  const N = 20, S = 14, cv = el('canvas', { width: N * S, height: N * S, style: 'border-radius:10px;background:rgba(255,255,255,.04)' }), ctx = cv.getContext('2d'), info = el('div', { class: 'small dim' });
  let body, dir, food, alive, score, t;
  const reset = () => { body = [[10, 10], [9, 10], [8, 10]]; dir = [1, 0]; score = 0; alive = true; place(); };
  const place = () => { do food = [Math.floor(Math.random() * N), Math.floor(Math.random() * N)]; while (body.some(([x, y]) => x === food[0] && y === food[1])); };
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#9e6bff';
  const step = () => {
    if (!alive) return;
    const h = [(body[0][0] + dir[0] + N) % N, (body[0][1] + dir[1] + N) % N];
    if (body.some(([x, y]) => x === h[0] && y === h[1])) { alive = false; best('snake', score); }
    else { body.unshift(h); if (h[0] === food[0] && h[1] === food[1]) { score++; place(); } else body.pop(); }
    ctx.clearRect(0, 0, N * S, N * S); ctx.fillStyle = '#ff6b9a'; ctx.fillRect(food[0] * S + 2, food[1] * S + 2, S - 4, S - 4);
    ctx.fillStyle = accent; body.forEach(([x, y]) => ctx.fillRect(x * S + 1, y * S + 1, S - 2, S - 2));
    info.textContent = alive ? `Score ${score} · Best ${best('snake')}` : `Game over — ${score}. Press Space to play again.`;
  };
  const key = (e) => { const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key]; if (d && (d[0] !== -dir[0] || d[1] !== -dir[1])) { dir = d; e.preventDefault(); } if (e.key === ' ' && !alive) { reset(); e.preventDefault(); } };
  reset(); t = setInterval(step, 110);
  host.replaceChildren(el('div', { class: 'col', style: 'align-items:center;gap:8px' }, cv, info));
  addEventListener('keydown', key);
  return () => { clearInterval(t); removeEventListener('keydown', key); };
}
function reaction(host) {
  let state = 'idle', start = 0, timer;
  const pad = el('div', { style: 'width:340px;height:200px;border-radius:16px;display:grid;place-items:center;font-size:18px;font-weight:700;cursor:pointer;text-align:center' });
  const set = (s, text, bg) => { state = s; pad.textContent = text; pad.style.background = bg; };
  set('idle', 'Click to start', 'var(--surface)');
  pad.onclick = () => {
    if (state === 'idle' || state === 'done') { set('wait', 'Wait for green…', '#7a2b3a'); timer = setTimeout(() => { set('go', 'Click!', '#2f9e5b'); start = performance.now(); }, 1200 + Math.random() * 2500); }
    else if (state === 'wait') { clearTimeout(timer); set('done', 'Too soon! Click to try again', 'var(--surface)'); }
    else if (state === 'go') { const ms = Math.round(performance.now() - start); const b = load('games.best.reaction', 0); if (!b || ms < b) save('games.best.reaction', ms); set('done', `${ms} ms (best ${load('games.best.reaction', ms)} ms)\nClick to go again`, 'var(--surface)'); }
  };
  host.replaceChildren(pad);
  return () => clearTimeout(timer);
}
