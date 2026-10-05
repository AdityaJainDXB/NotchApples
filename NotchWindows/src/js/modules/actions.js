// Actions: one-click buttons you set up (Windows' answer to Apple Shortcuts):
// open apps, files and websites, run commands, and system shortcuts.
import { el, load, save, uid } from '../store.js';
import { invoke, openUrl } from '../native.js';
import { modal, button, toast, menu, select } from '../ui.js';
import { collapse } from '../app.js';

const SYSTEM = [
  ['🔒', 'Lock the PC', 'cmd', 'rundll32.exe user32.dll,LockWorkStation'], ['🌙', 'Sleep', 'cmd', 'rundll32.exe powrprof.dll,SetSuspendState 0,1,0'],
  ['🗑', 'Empty the Recycle Bin', 'cmd', 'powershell -NoProfile -Command "Clear-RecycleBin -Force"'], ['📸', 'Snipping Tool', 'url', 'ms-screenclip:'],
  ['🔕', 'Notifications & Do Not Disturb', 'url', 'ms-settings:notifications'], ['🔊', 'Sound settings', 'url', 'ms-settings:sound'],
  ['📶', 'Wi-Fi', 'url', 'ms-settings:network-wifi'], ['🖥', 'Display', 'url', 'ms-settings:display'],
];
export function render(root) {
  const grid = el('div', { class: 'grid scroll', style: 'grid-template-columns:repeat(auto-fill,minmax(120px,1fr));flex:1' });
  const mine = () => load('actions.items', []);
  async function run(a) {
    try {
      if (a.kind === 'url') { if (a.target.startsWith('ms-')) await invoke('open_url', { url: a.target.startsWith('ms-settings:') ? a.target : a.target }).catch(() => invoke('run_command', { command: `start "" "${a.target}"` })); else await openUrl(a.target); }
      else if (a.kind === 'open') await invoke('open_path', { path: a.target });
      else { await collapse(); const out = await invoke('run_command', { command: a.target }); if (out.trim() && !a.quiet) toast(out.trim().slice(0, 200)); }
    } catch (e) { toast(e.message, { error: true }); }
  }
  function edit(a = { id: uid(), icon: '⚡', name: '', kind: 'url', target: '' }) {
    const name = el('input', { class: 'field', placeholder: 'Name', value: a.name }), icon = el('input', { class: 'field', value: a.icon, style: 'width:60px' });
    let kind = a.kind; const target = el('input', { class: 'field', placeholder: 'Website, file path or command', value: a.target });
    const m = modal('Action', [el('div', { class: 'hstack' }, icon, name), select([{ value: 'url', label: 'Open a website' }, { value: 'open', label: 'Open a file, folder or app' }, { value: 'cmd', label: 'Run a command' }], kind, (v) => { kind = v; }), target,
      el('button', { class: 'btn small quiet', onclick: async () => { const p = await invoke('pick_file'); if (p) { target.value = p; kind = 'open'; } } }, 'Choose a file…')],
    { actions: [button('Save', () => { if (!target.value.trim()) return; save('actions.items', [...mine().filter((x) => x.id !== a.id), { ...a, name: name.value || target.value, icon: icon.value || '⚡', kind, target: target.value.trim() }]); m.close(); paint(); })] });
  }
  function paint() {
    grid.replaceChildren(...mine().map((a) => { const t = el('div', { class: 'tile', title: a.target, onclick: () => run(a) }, el('div', { class: 'glyph' }, a.icon), el('div', { class: 'name' }, a.name));
      t.addEventListener('contextmenu', (e) => menu(e, [{ label: 'Edit', run: () => edit(a) }, { label: 'Delete', danger: true, run: () => { save('actions.items', mine().filter((x) => x.id !== a.id)); paint(); } }])); return t; }),
    el('div', { class: 'tile', onclick: () => edit() }, el('div', { class: 'glyph' }, '＋'), el('div', { class: 'name' }, 'New action')),
    ...SYSTEM.map(([icon, name, kind, target]) => el('div', { class: 'tile', style: 'opacity:.85', onclick: () => run({ kind, target, quiet: true }) }, el('div', { class: 'glyph' }, icon), el('div', { class: 'name' }, name))));
  }
  root.append(el('div', { class: 'col fill' }, el('div', { class: 'small dim' }, 'Your actions first, then built-in ones. Right-click yours to edit.'), grid));
  paint();
}
