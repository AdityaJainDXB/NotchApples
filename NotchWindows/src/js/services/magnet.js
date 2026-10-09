// A drop target that leans towards the pointer like a magnet: the view shifts a few pixels and grows slightly
// towards a dragged file, a soft glow follows the pointer, and a small label says what happens on release.
// Files dragged onto the window arrive as Tauri events, so this listens to those and never touches the drop itself.
import { listen } from '../native.js';

export function magnet(host, label = 'Let go to add it') {
  const glow = document.createElement('div'); glow.className = 'mag-glow';
  const pill = document.createElement('div'); pill.className = 'mag-pill'; pill.textContent = label;
  host.classList.add('mag-host');
  host.append(glow, pill);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const off = [];
  function at(e) {
    const r = host.getBoundingClientRect(), k = window.devicePixelRatio || 1;
    const p = e?.position, x = (p ? p.x / k : r.left + r.width / 2) - r.left, y = (p ? p.y / k : r.top + r.height / 2) - r.top;
    const dx = x - r.width / 2, dy = y - r.height / 2, d = Math.max(Math.hypot(dx, dy), 1);
    const pull = reduce ? 0 : Math.min(d / (Math.min(r.width, r.height) / 2), 1) * 8;
    host.classList.add('mag-on');
    host.style.setProperty('--mag-x', `${(dx / d) * pull}px`);
    host.style.setProperty('--mag-y', `${(dy / d) * pull}px`);
    glow.style.left = `${x}px`; glow.style.top = `${y}px`;
  }
  const done = () => { host.classList.remove('mag-on'); host.style.removeProperty('--mag-x'); host.style.removeProperty('--mag-y'); };
  for (const [name, fn] of [['enter', (e) => at(e.payload)], ['over', (e) => at(e.payload)], ['leave', done], ['drop', done]]) {
    listen(`tauri://drag-${name}`, fn).then((u) => off.push(u)).catch(() => {});
  }
  return () => { off.forEach((u) => u()); done(); glow.remove(); pill.remove(); host.classList.remove('mag-host'); };
}
