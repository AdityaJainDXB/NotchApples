// A drop target that leans towards the pointer like a magnet: the view shifts a few pixels and grows slightly
// towards a dragged file, a soft glow follows the pointer, and a small label says what happens on release.
// Files dragged onto the window arrive as Tauri events, so this listens to those and never touches the drop itself.
import { listen } from '../native.js';

export function magnet(host, label = 'Let go to add it') {
  const glow = document.createElement('div'); glow.className = 'mag-glow';
  const pill = document.createElement('div'); pill.className = 'mag-pill'; pill.textContent = label;
  host.classList.add('mag-host');
  host.append(glow, pill);
  const reduce = (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const off = [];
  // Cards drawn with dropCard() (ui.js) react to the pointer: within 180 px they lean towards it and say "Bring it closer",
  // over them they say "Let go to add it".
  function cards(e) {
    const k = window.devicePixelRatio || 1, p = e?.position;
    for (const c of document.querySelectorAll('.drop-card')) {
      const r = c.getBoundingClientRect();
      if (!p) { c.classList.remove('near', 'over'); c.style.removeProperty('--dc-x'); c.style.removeProperty('--dc-y'); c.querySelector('.dc-title').textContent = c.dataset.idle; continue; }
      const px = p.x / k, py = p.y / k, cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const dx = Math.max(Math.abs(px - cx) - r.width / 2, 0), dy = Math.max(Math.abs(py - cy) - r.height / 2, 0);
      const prox = Math.max(0, 1 - Math.hypot(dx, dy) / 180), isOver = px >= r.left && px <= r.right && py >= r.top && py <= r.bottom;
      const d = Math.max(Math.hypot(px - cx, py - cy), 1), pull = reduce || isOver ? 0 : prox * 10;
      c.classList.toggle('near', prox > 0 || isOver); c.classList.toggle('over', isOver);
      c.style.setProperty('--dc-x', `${((px - cx) / d) * pull}px`); c.style.setProperty('--dc-y', `${((py - cy) / d) * pull}px`);
      const glow = c.querySelector('.dc-glow'); glow.style.left = `${px - r.left}px`; glow.style.top = `${py - r.top}px`;
      c.querySelector('.dc-title').textContent = isOver ? c.dataset.over : prox > 0 ? c.dataset.near : c.dataset.idle;
    }
  }
  function at(e) {
    cards(e);
    const r = host.getBoundingClientRect(), k = window.devicePixelRatio || 1;
    const p = e?.position, x = (p ? p.x / k : r.left + r.width / 2) - r.left, y = (p ? p.y / k : r.top + r.height / 2) - r.top;
    const dx = x - r.width / 2, dy = y - r.height / 2, d = Math.max(Math.hypot(dx, dy), 1);
    const pull = reduce ? 0 : Math.min(d / (Math.min(r.width, r.height) / 2), 1) * 8;
    host.classList.add('mag-on');
    host.style.setProperty('--mag-x', `${(dx / d) * pull}px`);
    host.style.setProperty('--mag-y', `${(dy / d) * pull}px`);
    glow.style.left = `${x}px`; glow.style.top = `${y}px`;
  }
  const done = () => { cards(null); host.classList.remove('mag-on'); host.style.removeProperty('--mag-x'); host.style.removeProperty('--mag-y'); };
  for (const [name, fn] of [['enter', (e) => at(e.payload)], ['over', (e) => at(e.payload)], ['leave', done], ['drop', done]]) {
    listen(`tauri://drag-${name}`, fn).then((u) => off.push(u)).catch(() => {});
  }
  return () => { off.forEach((u) => u()); done(); glow.remove(); pill.remove(); host.classList.remove('mag-host'); };
}
