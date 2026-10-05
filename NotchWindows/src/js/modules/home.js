// Home (Pro): your own dashboard of widgets in small, medium and large sizes.
import { el, load, save, fmtClock } from '../store.js';
import { menu } from '../ui.js';
import { show } from '../app.js';

const WIDGETS = {
  clock: { name: 'Clock', render: () => el('div', {}, el('div', { class: 'big num' }, new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })), el('div', { class: 'small dim' }, new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }))) },
  weather: { name: 'Weather', async render() { const W = await import('../services/weather.js'); const w = await W.here(); const d = W.describe(w.current.code, w.current.day); return el('div', {}, el('div', { class: 'big' }, `${d.icon} ${Math.round(w.current.temp)}°`), el('div', { class: 'small dim' }, `${d.text} · ${w.place}`)); } },
  match: { name: 'Next match', async render() { const S = await import('../services/sports.js'); const d = S.cached('team') || await S.loadTeam(); const m = d?.upcoming?.[0]; return m ? el('div', {}, el('div', { class: 'small dim' }, S.team().name), el('div', { style: 'font-weight:700' }, `${m.home.abbr} ${m.state === 'pre' ? 'vs' : `${m.home.score}–${m.away.score}`} ${m.away.abbr}`), el('div', { class: 'tiny dim' }, m.live ? `LIVE ${m.detail}` : m.date.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }))) : el('div', { class: 'small dim' }, 'No match'); } },
  todo: { name: 'To-do', async render() { const R = await import('../services/reminders.js'); const l = R.todos().filter((t) => !t.done).slice(0, 5); return el('div', { class: 'col gap-4' }, ...l.map((t) => el('div', { class: 'small ellipsis' }, `○ ${t.text}`)), l.length ? null : el('div', { class: 'small dim' }, 'All done')); } },
  music: { name: 'Now Playing', async render() { const M = await import('../services/media.js'); const m = M.now(); return m ? el('div', { class: 'hstack' }, m.art ? el('img', { src: m.art, style: 'width:40px;height:40px;border-radius:6px' }) : '🎵', el('div', { style: 'min-width:0' }, el('div', { class: 'ellipsis', style: 'font-weight:600' }, m.title), el('div', { class: 'tiny dim ellipsis' }, m.artist))) : el('div', { class: 'small dim' }, 'Nothing playing'); } },
  stats: { name: 'PC Stats', async render() { const { invoke } = await import('../native.js'); const s = await invoke('system_stats'); return el('div', { class: 'small' }, el('div', {}, `CPU ${Math.round(s.cpu_percent)}%`), el('div', {}, `RAM ${Math.round(s.ram_used / s.ram_total * 100)}%`), el('div', {}, s.battery_percent == null ? '' : `🔋 ${s.battery_percent}%`)); } },
  focus: { name: 'Focus', async render() { const F = await import('../services/focus.js'); return el('div', {}, el('div', { class: 'big num' }, fmtClock(F.secondsLeft())), el('div', { class: 'small dim' }, `${F.sessionsToday()} sessions today`)); } },
  markets: { name: 'Markets', async render() { const M = await import('../services/markets.js'); const l = M.watchlist().slice(0, 4); await M.loadQuotes(l); return el('div', { class: 'col gap-4' }, ...l.map((s) => { const q = M.quote(s); return el('div', { class: 'hstack small' }, el('span', { class: 'grow' }, s), el('span', { class: q?.changePct >= 0 ? 'ok' : 'bad' }, q ? `${q.changePct.toFixed(1)}%` : '—')); })); } },
};
const SPAN = { small: 1, medium: 2, large: 3 };

export function render(root) {
  const grid = el('div', { class: 'grid scroll', style: 'grid-template-columns:repeat(3,1fr);grid-auto-rows:minmax(96px,auto);flex:1' });
  const layout = () => load('home.widgets', [{ id: 'clock', size: 'small' }, { id: 'weather', size: 'small' }, { id: 'match', size: 'small' }, { id: 'todo', size: 'medium' }, { id: 'music', size: 'small' }]);
  async function paint() {
    const l = layout();
    grid.replaceChildren(...l.map((w, i) => {
      const body = el('div', {}, el('div', { class: 'skel', style: 'height:40px' }));
      const card = el('div', { class: 'card col gap-6', style: `grid-column:span ${SPAN[w.size]}` }, el('div', { class: 'tiny faint' }, WIDGETS[w.id]?.name || w.id), body);
      card.addEventListener('contextmenu', (e) => menu(e, [
        ...Object.keys(SPAN).map((s) => ({ label: `Size: ${s}`, run: () => { const x = layout(); x[i].size = s; save('home.widgets', x); paint(); } })),
        { label: 'Remove', danger: true, run: () => { const x = layout(); x.splice(i, 1); save('home.widgets', x); paint(); } }]));
      Promise.resolve(WIDGETS[w.id]?.render()).then((n) => body.replaceChildren(n || '')).catch((e) => body.replaceChildren(el('div', { class: 'tiny dim' }, e.message)));
      return card;
    }));
  }
  const add = el('select', { class: 'field auto' }, el('option', { value: '' }, '+ Add widget'), ...Object.entries(WIDGETS).map(([id, w]) => el('option', { value: id }, w.name)));
  add.onchange = () => { if (add.value) { save('home.widgets', [...layout(), { id: add.value, size: 'small' }]); add.value = ''; paint(); } };
  root.append(el('div', { class: 'col fill' }, el('div', { class: 'hstack' }, el('div', { class: 'section-title grow' }, 'Home · right-click a widget to resize or remove'), add), grid));
  paint();
  const t = setInterval(paint, 30000);
  return () => clearInterval(t);
}
export { show };
