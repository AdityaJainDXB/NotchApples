// Plugins: any script in the Plugins folder shows its output here.
import { el } from '../store.js';
import { invoke, openUrl } from '../native.js';
import { toast, empty } from '../ui.js';
import * as PL from '../services/plugins.js';

export function render(root) {
  const grid = el('div', { class: 'grid scroll', style: 'grid-template-columns:repeat(auto-fill,minmax(220px,1fr));flex:1' });
  let alive = true, timers = [];
  async function paint() {
    const list = await invoke('plugins_list').catch((e) => { toast(e.message, { error: true }); return []; });
    grid.replaceChildren(...list.map((p) => {
      const body = el('div', { class: 'col gap-4' }, el('div', { class: 'small dim' }, 'Running…'));
      const card = el('div', { class: 'card col gap-6' }, el('div', { class: 'tiny faint' }, `${p.name} · every ${p.interval >= 60 ? `${Math.round(p.interval / 60)} min` : `${p.interval} s`}`), body);
      const run = async () => {
        const o = await PL.run(p.file);
        if (!alive) return;
        if (o.error) { body.replaceChildren(el('div', { class: 'err' }, o.error)); return; }
        body.replaceChildren(el('div', { style: 'font-weight:700' }, o.parsed.title), ...o.parsed.lines.map((l) => (l.href ? el('a', { onclick: () => openUrl(l.href) }, l.text)
          : l.run ? el('a', { onclick: () => invoke('run_command', { command: l.run }).then((x) => toast(x.slice(0, 200) || 'Done')) }, `▶ ${l.text}`) : el('div', { class: 'small' }, l.text))));
      };
      run(); timers.push(setInterval(run, Math.max(5, p.interval) * 1000));
      return card;
    }));
    if (!list.length) grid.append(el('div', { style: 'grid-column:1/-1' }, empty('🧩', 'No plugins yet', 'Put a script (.ps1, .bat, .py, .js) in the Plugins folder. Its output appears here.')));
  }
  root.append(el('div', { class: 'col fill' }, el('div', { class: 'hstack' }, el('div', { class: 'small dim grow' }, 'Name scripts like weather.10m.ps1 to refresh every 10 minutes.'),
    el('button', { class: 'btn small quiet', onclick: async () => invoke('open_path', { path: await invoke('plugins_dir') }) }, 'Open Plugins folder'),
    el('button', { class: 'btn small quiet', onclick: () => { timers.forEach(clearInterval); timers = []; paint(); } }, 'Reload')), grid));
  paint();
  return () => { alive = false; timers.forEach(clearInterval); };
}
