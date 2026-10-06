// Settings.
import { el, load, save } from '../store.js';
import { invoke, openUrl } from '../native.js';
import { THEMES, applyTheme, currentThemeId, customTheme, saveCustom } from '../themes.js';
import { MODULES } from '../modules.js';
import { pref, setPref, SHORTCUT_NAMES, DEFAULTS } from '../prefs.js';
import { canUse, FEATURES, tierLabel } from '../features.js';
import { tier, TIERS, maskedCode, deactivate } from '../license.js';
import { isEnabled, setEnabled, tabOrder, setTabOrder, appInfo, registerShortcuts } from '../app.js';
import { setting, toggle, select, segmented, toast, confirm, button, prompt, markdown } from '../ui.js';
import { icon } from '../icons.js';
import { keyField, BUY_URL, badge } from './activation.js';

export const PANES = { General, Updates, Appearance, Tabs, Shortcuts, AI, Calendar, Weather, Clipboard, Security, Rules, Automations, Access, About };
const NAV = { General: ['settings', '#8e8e93'], Updates: ['share', '#30d158'], Appearance: ['appearance', '#bf5af2'], Tabs: ['home', '#5e5ce6'], Shortcuts: ['shortcuts', '#64d2ff'], AI: ['ai', '#ff9f0a'],
  Calendar: ['calendar', '#ff453a'], Weather: ['weather', '#32ade6'], Clipboard: ['clipboard', '#ffd60a'], Security: ['security', '#ff6b6b'], Rules: ['rules', '#30d158'],
  Automations: ['automations', '#bf5af2'], Access: ['access', '#0a84ff'], About: ['about', '#5e5ce6'] };
const ICONS_UPDATES = 1;
const ICONS = { General: '⚙', Appearance: '🎨', Tabs: '🗂', Shortcuts: '⌨', AI: '✨', Calendar: '📅', Weather: '⛅', Clipboard: '📋', Security: '🔒', Rules: '🧭', Automations: '🤖', Access: '🔑', About: 'ℹ' };

export function render(root, opts = {}) {
  let current = opts.pane || load('settings.pane', 'General');
  if (!PANES[current]) current = 'General';
  const nav = el('div', { class: 'col gap-4 scroll', style: 'flex:0 0 172px;padding-right:8px;border-right:1px solid var(--border)' });
  const body = el('div', { class: 'scroll', style: 'flex:1;padding-right:6px' });
  function paint() {
    nav.replaceChildren(...Object.keys(PANES).map((n) => el('div', { class: `navrow ${n === current ? 'selected' : ''}`, onclick: () => { current = n; save('settings.pane', n); paint(); } },
      el('span', { class: 'tile-ico', style: `background:${NAV[n][1]}` }, icon(NAV[n][0], 17)), el('span', { class: 'main' }, n))));
    body.replaceChildren(el('div', { class: 'col' }, ...[].concat(PANES[current](paint, opts))));
    opts = {};
  }
  root.append(el('div', { class: 'row fill' }, nav, body));
  paint();
}
const card = (title, ...rows) => el('div', { class: 'card col', style: 'gap:0' }, title ? el('div', { class: 'section-title', style: 'margin-bottom:4px' }, title) : null, ...rows);
const prefToggle = (key, gate) => toggle(pref(key), (v) => { if (gate && !canUse(gate)) { toast(`${FEATURES[gate].title} is part of ${tierLabel(FEATURES[gate].tier)}.`); return; } setPref(key, v); });

function General(repaint, opts) {
  const auto = toggle(false, (v) => invoke('set_autostart', { on: v }).catch((e) => toast(e.message, { error: true })));
  invoke('get_autostart').then((on) => { auto.querySelector('input').checked = on; });
  const sizeSel = segmented([{ value: 'compact', label: 'Small' }, { value: 'standard', label: 'Standard' }, { value: 'large', label: 'Large' }], pref('ui.size'), (v) => { if (v !== 'standard' && !canUse('notchResize')) { toast('Notch size is part of Pro.'); sizeSel.setValue('standard'); return; } setPref('ui.size', v); });
  return [
    card('Startup',
      setting('Start with Windows', 'Notch apple opens quietly when you sign in.', auto),
      el('div', { class: 'tiny dim', style: 'padding-top:6px' }, 'Updates now have their own section.')),
    card('The notch',
      setting('Position', 'Where the pill sits on the top edge.', segmented([{ value: 'left', label: 'Left' }, { value: 'center', label: 'Centre' }, { value: 'right', label: 'Right' }], pref('ui.position'), (v) => setPref('ui.position', v))),
      setting('Size', canUse('notchResize') ? '' : 'Small and Large are part of Pro.', sizeSel),
      setting('Open when the mouse rests on the pill', '', prefToggle('ui.hoverOpen')),
      setting('Open by pushing the mouse to the top edge', 'Pro', prefToggle('ui.edgeTrigger', 'edgeTrigger')),
      setting('Close when I click somewhere else', '', prefToggle('ui.closeOnBlur')),
      setting('Hide over fullscreen videos and games', '', prefToggle('ui.hideFullscreen')),
      setting('Show the time on the pill', '', prefToggle('ui.showClock'))),
    card('Your data',
      setting('Back up your setup', 'Tabs, settings, notes, to-dos, snippets… (not keys).', button('Export…', async () => {
        const data = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (!/^(ai\.key\.|license\.)/.test(k)) data[k] = localStorage.getItem(k); }
        const p = await invoke('save_file_as', { name: `NotchApple-backup-${new Date().toISOString().slice(0, 10)}.json`, base64: btoa(unescape(encodeURIComponent(JSON.stringify(data)))) });
        if (p) toast('Backup saved');
      }, { kind: 'quiet', small: true })),
      setting('Restore a backup', '', button('Import…', async () => {
        const p = await invoke('pick_file'); if (!p) return;
        try { const f = await invoke('read_file_base64', { path: p }); const data = JSON.parse(decodeURIComponent(escape(atob(f.data))));
          if (!(await confirm('Restore this backup?', { ok: 'Restore', detail: 'Your current settings, notes and to-dos are replaced.' }))) return;
          for (const [k, v] of Object.entries(data)) localStorage.setItem(k, v); location.reload(); } catch (e) { toast(`That isn't a Notch apple backup (${e.message}).`, { error: true }); }
      }, { kind: 'quiet', small: true })),
      setting('Reset everything', 'Back to a fresh install (your key stays).', button('Reset…', async () => {
        if (!(await confirm('Reset Notch apple?', { ok: 'Reset', danger: true, detail: 'Removes all settings, notes, to-dos, clipboard history and snippets on this PC.' }))) return;
        const keep = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (/^license\./.test(k)) keep[k] = localStorage.getItem(k); }
        localStorage.clear(); for (const [k, v] of Object.entries(keep)) localStorage.setItem(k, v); location.reload();
      }, { kind: 'danger', small: true }))),
  ];
}

function Updates() {
  const status = el('div', { class: 'small dim' }, '');
  const notes = el('div', { class: 'md small', style: 'max-height:150px;overflow:auto' });
  const actions = el('div', { class: 'hstack' });
  const version = el('b', {}, '…');
  appInfo.then((i) => { version.textContent = i.version; }).catch(() => {});
  const check = async () => {
    status.textContent = 'Checking…'; notes.replaceChildren(); actions.replaceChildren(checkBtn);
    const U = await import('../services/updates.js'); const s = await U.check();
    if (s.error) { status.textContent = `Couldn’t check: ${s.error}`; return; }
    if (!s.available) { status.textContent = 'You have the latest version.'; return; }
    status.textContent = `Version ${s.available.version} is ready.`;
    notes.replaceChildren(markdown(s.available.notes || '', { onLink: (u) => invoke('open_browser', { url: u }) }));
    actions.replaceChildren(button('Install and restart', async () => {
      status.textContent = 'Downloading and checking the update…';
      try { await U.install(); status.textContent = 'Installing… Notch apple will restart.'; } catch (e) { status.textContent = e.message; }
    }), checkBtn);
  };
  const checkBtn = button('Check now', check, { kind: 'quiet' });
  actions.append(checkBtn);
  setTimeout(check, 50);
  return [card('Software update',
    el('div', { class: 'hstack' }, el('div', { class: 'grow' }, el('div', {}, 'Notch apple for Windows ', version), status), actions),
    notes,
    setting('Check for updates automatically', 'Checked at startup and every six hours; you’re told once per version.', prefToggle('updates.auto')),
    setting('Show “Update” on the pill', 'A small badge when a new version is ready.', prefToggle('updates.pill')))];
}

function Appearance(repaint) {
  const groups = {};
  for (const t of [...THEMES, customTheme()]) (groups[t.category] ||= []).push(t);
  const out = [];
  for (const [cat, list] of Object.entries(groups)) {
    out.push(el('div', { class: 'section-title hstack' }, cat, cat === 'Pro' && !canUse('proThemes') ? badge('proThemes') : null));
    out.push(el('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fill,minmax(110px,1fr))' }, ...list.map((t) => el('div', {
      class: `tile ${t.id === currentThemeId() ? 'selected' : ''}`, onclick: (ev) => {
        if (t.pro && !canUse(t.custom ? 'customColors' : 'proThemes')) return toast(`${t.name} is a Pro theme.`);
        applyTheme(t.id);
        document.querySelectorAll('.tile.selected').forEach((n) => n.classList.remove('selected'));
        ev.currentTarget.classList.add('selected');
      } }, el('div', { style: `width:32px;height:32px;border-radius:50%;background:${t.bg};border:3px solid ${t.primary};box-shadow:inset 0 0 0 4px ${t.secondary}` }), el('div', { class: 'name' }, t.name)))));
  }
  if (canUse('customColors')) {
    const c = { ...customTheme(), ...JSON.parse(localStorage.getItem('theme.custom') || '{}') };
    const col = (k, label) => el('label', { class: 'hstack small' }, el('input', { type: 'color', value: c[k], oninput: (e) => { c[k] = e.target.value; saveCustom({ name: c.name, bg: c.bg, primary: c.primary, secondary: c.secondary, glow: c.glow ?? 0.4 }); } }), label);
    out.push(card('Your theme (pick it above)', el('div', { class: 'hstack wrap', style: 'gap:14px;padding:6px 0' }, col('bg', 'Background'), col('primary', 'Accent'), col('secondary', 'Second accent'))));
  }
  out.push(card('Style',
    setting('Font', canUse('fontsAndIcons') ? '' : 'Pro', select([{ value: 'system', label: 'Segoe UI' }, { value: 'rounded', label: 'Rounded' }, { value: 'mono', label: 'Monospace' }], pref('ui.font'), (v) => (canUse('fontsAndIcons') ? setPref('ui.font', v) : toast('Fonts are part of Pro.')), { cls: 'auto' })),
    setting('Animations', canUse('animationStyles') ? '' : 'Pro', select([{ value: 'smooth', label: 'Smooth' }, { value: 'fast', label: 'Fast' }, { value: 'off', label: 'Off' }], pref('ui.animation'), (v) => (canUse('animationStyles') ? setPref('ui.animation', v) : toast('Animation styles are part of Pro.')), { cls: 'auto' })),
    setting('Glass (experimental)', 'Lets your desktop show through behind the open notch. Only looks right on PCs where Windows blurs it; on others it is clear, not blurred, so it is off by default.', select([{ value: true, label: 'On' }, { value: false, label: 'Off' }], pref('ui.glass'), (v) => setPref('ui.glass', v === true || v === 'true'), { cls: 'auto' })),
    setting('Performance', 'Auto switches to Lite on slow graphics (no glows or looping animations).', select([{ value: 'auto', label: 'Auto' }, { value: 'full', label: 'Full' }, { value: 'lite', label: 'Lite' }], pref('ui.performance'), (v) => setPref('ui.performance', v), { cls: 'auto' })),
    setting('Sounds', 'When the notch opens and timers finish (Pro).', prefToggle('ui.sounds', 'customSounds')),
    setting('Tab names', '', select([{ value: 'auto', label: 'Icons, name on the open tab' }, { value: 'names', label: 'Always show names' }], pref('ui.compactTabs'), (v) => setPref('ui.compactTabs', v), { cls: 'auto' }))));
  return out;
}

function Tabs(repaint) {
  const order = tabOrder();
  return [el('div', { class: 'small dim' }, 'Turn tabs on or off. Drag tabs in the bar to reorder them.'),
    ...order.filter((id) => id !== 'settings').map((id) => MODULES.find((m) => m.id === id)).map((m, i, arr) => el('div', { class: 'item', style: 'border:1px solid var(--border)' },
      el('span', { style: 'font-size:18px;width:24px' }, m.icon),
      el('div', { class: 'main' }, el('div', { class: 'hstack', style: 'gap:6px' }, el('b', {}, m.name), m.feature ? badge(m.feature) : null), el('div', { class: 'tiny dim' }, m.blurb)),
      el('button', { class: 'icon-btn', title: 'Move up', onclick: () => { if (i) { const o = tabOrder(); const a = o.indexOf(m.id), b = o.indexOf(arr[i - 1].id); [o[a], o[b]] = [o[b], o[a]]; setTabOrder(o); repaint(); } } }, '↑'),
      toggle(isEnabled(m.id), (v) => setEnabled(m.id, v))))];
}

function Shortcuts(repaint) {
  const s = pref('shortcuts');
  const gate = { palette: 'commandPalette', 'ai:screen': 'aiCapture', 'tab:quickadd': 'quickAdd', 'focus:toggle': 'focus' };
  return [card('Global shortcuts (work in any app)', ...Object.keys(SHORTCUT_NAMES).map((k) => {
    const f = el('input', { class: 'field mono auto', style: 'width:170px', value: s[k] || '', placeholder: 'Click, then press keys', readonly: true });
    f.addEventListener('keydown', (e) => {
      e.preventDefault();
      if (e.key === 'Escape') return f.blur();
      if (e.key === 'Backspace' || e.key === 'Delete') { f.value = ''; } else {
        if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
        const keyName = e.code.startsWith('Key') ? e.code.slice(3) : e.code.startsWith('Digit') ? e.code.slice(5) : e.code.replace('Arrow', '');
        f.value = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super', keyName].filter(Boolean).join('+');
        if (!e.ctrlKey && !e.altKey && !e.metaKey) { toast('Use Ctrl or Alt with the key.', { error: true }); f.value = s[k] || ''; return; }
      }
      setPref('shortcuts', { ...pref('shortcuts'), [k]: f.value });
    });
    return setting(SHORTCUT_NAMES[k], gate[k] && !canUse(gate[k]) ? 'Pro' : '', f);
  }), el('div', { class: 'hstack', style: 'padding-top:8px' }, button('Restore defaults', () => { setPref('shortcuts', DEFAULTS.shortcuts); repaint(); }, { kind: 'quiet', small: true }))),
  card('Inside the notch', setting('Command palette', '', el('kbd', {}, 'Ctrl+K')), setting('Switch tab', '', el('kbd', {}, 'Ctrl+1…9')), setting('Close', '', el('kbd', {}, 'Esc')))];
}

function AI() {
  return import('../services/ai.js').then(() => []), aiPane();
}
function aiPane() {
  const box = el('div', { class: 'col' }, el('div', { class: 'small dim' }, 'Keys stay on this PC and go only to that provider. Gemini and OpenRouter have free tiers.'));
  import('../services/ai.js').then((AIs) => {
    box.append(...Object.entries(AIs.PROVIDERS).map(([id, p]) => {
      const f = el('input', { class: 'field', type: 'password', placeholder: p.noKey ? 'No key needed' : 'Paste key…', value: AIs.keyOf(id), disabled: !!p.noKey });
      f.onchange = () => { AIs.setKey(id, f.value); toast(`${p.name} key saved`); };
      return el('div', { class: 'card col gap-6' }, el('div', { class: 'hstack' }, el('b', { class: 'grow' }, p.name), el('span', { class: 'tiny dim' }, p.free), el('a', { onclick: () => openUrl(p.keyUrl) }, p.noKey ? 'Get Ollama →' : 'Get a key →')), f);
    }));
  });
  return box;
}

function Calendar(repaint) {
  const url = el('input', { class: 'field', placeholder: 'https://… .ics (or webcal://…)' }), name = el('input', { class: 'field', placeholder: 'Name (e.g. Work)', style: 'width:140px' });
  const status = el('div', { class: 'small dim' });
  return [card('Calendars', el('div', { class: 'small dim', style: 'padding-bottom:6px' }, 'Paste the private iCal address of your calendar. Outlook: Settings → Calendar → Shared calendars → Publish. Google: Calendar settings → “Secret address in iCal format”. iCloud: share as Public Calendar.'),
    ...load('calendar.urls', []).map((c) => setting(c.name, c.url.replace(/^(https?:\/\/[^/]+).*/, '$1/…'), button('Remove', async () => { (await import('../services/calendar.js')).removeCalendar(c.url); repaint(); }, { kind: 'quiet', small: true }))),
    el('div', { class: 'hstack', style: 'padding-top:8px' }, name, url, button('Add', async () => {
      if (!/^(https|webcal):\/\//i.test(url.value.trim())) return toast('Paste an https:// or webcal:// address.', { error: true });
      status.textContent = 'Loading…'; const C = await import('../services/calendar.js'); await C.addCalendar(url.value, name.value || 'Calendar');
      status.textContent = C.error() || `Added: ${C.upcoming(7).length} events in the next week.`; repaint();
    })), status),
  card('Alerts', setting('Meeting alerts', 'A countdown on the pill and a notification 5 minutes before, with a Join button for Teams, Zoom and Meet (Pro).', toggle(load('calendar.alerts', true), (v) => (canUse('meetingAlert') ? save('calendar.alerts', v) : toast('Meeting alerts are part of Pro.')))))];
}

function Weather(repaint) {
  const q = el('input', { class: 'field', placeholder: 'Search a city' }), results = el('div', { class: 'col gap-4' });
  q.onkeydown = async (e) => { if (e.key !== 'Enter') return; const W = await import('../services/weather.js'); const r = await W.searchCity(q.value).catch(() => []);
    results.replaceChildren(...r.map((c) => el('div', { class: 'item clickable', onclick: () => { save('weather.city', c); toast(`Weather for ${c.name}`); repaint(); } }, el('span', { class: 'main' }, `${c.name}, ${c.region}`)))); };
  const city = load('weather.city', null);
  return [card('Location', setting('Your city', city ? city.name : 'Worked out from your internet connection', city ? button('Use my connection', () => { save('weather.city', null); repaint(); }, { kind: 'quiet', small: true }) : el('span')), el('div', { style: 'padding-top:6px' }, q), results),
    card('Units and alerts', setting('Temperature', '', segmented([{ value: 'auto', label: 'Auto' }, { value: 'c', label: '°C' }, { value: 'f', label: '°F' }], load('weather.units', 'auto'), (v) => save('weather.units', v))),
      setting('Rain alerts', 'A nudge before it starts raining (Pro).', toggle(load('weather.rainAlert', true), (v) => (canUse('rainAlert') ? save('weather.rainAlert', v) : toast('Rain alerts are part of Pro.')))))];
}

function Clipboard(repaint) {
  const limits = [50, 100, 200, 500, 1000, 2500, 5000];
  return [card('History', setting('Keep up to', '2,500 and 5,000 are Pro.', select(limits.map((n) => ({ value: n, label: `${n.toLocaleString()} items${n > 1000 && !canUse('clipboardUnlimited') ? ' (Pro)' : ''}` })), load('clipboard.limit', 200), (v) => {
    if (Number(v) > 1000 && !canUse('clipboardUnlimited')) { toast('Longer history is part of Pro.'); return repaint(); } save('clipboard.limit', Number(v)); }, { cls: 'auto' })),
    setting('Record what I copy', 'Password managers are always skipped.', toggle(!load('clipboard.paused', false), async (on) => (await import('../services/clipboard.js')).setPaused(!on)))),
  card('Never save copies from (Pro)', el('div', { class: 'small dim' }, (load('clipboard.ignoreApps', []).join(', ') || 'No apps.')),
    el('div', { class: 'hstack', style: 'padding-top:6px' }, button('Add an app…', async () => { if (!canUse('clipboardUnlimited')) return toast('This is part of Pro.'); const a = await prompt('App name, as Windows shows it', { placeholder: 'e.g. Microsoft Teams' }); if (a) { save('clipboard.ignoreApps', [...load('clipboard.ignoreApps', []), a]); repaint(); } }, { kind: 'quiet', small: true }),
      button('Clear list', () => { save('clipboard.ignoreApps', []); repaint(); }, { kind: 'ghost', small: true })))];
}

function Security(repaint) {
  const avail = el('span', { class: 'tiny dim' }, 'Checking Windows Hello…');
  invoke('hello_available').then((ok) => { avail.textContent = ok ? 'Windows Hello is set up on this PC.' : 'Windows Hello isn’t set up. Set it up in Windows Settings → Accounts → Sign-in options.'; });
  return [card('Lock', setting('Require Windows Hello to open the notch', 'Face, fingerprint or PIN.', toggle(pref('lock.enabled'), async (v) => {
    if (v && !(await invoke('hello_available').catch(() => false))) { toast('Set up Windows Hello first.', { error: true }); return repaint(); }
    if (v && !(await invoke('hello_verify', { message: 'Turn on the Notch apple lock' }).catch(() => false))) return repaint();
    setPref('lock.enabled', v);
  })), setting('Ask again after', '', select([{ value: 0, label: 'Every time' }, { value: 60, label: '1 minute' }, { value: 300, label: '5 minutes' }, { value: 3600, label: '1 hour' }], pref('lock.grace'), (v) => setPref('lock.grace', Number(v)), { cls: 'auto' })), avail)];
}

function Rules(repaint) {
  if (!canUse('appRules')) return [card('Per-app rules', el('div', { class: 'small dim' }, FEATURES.appRules.detail), el('div', { class: 'hstack', style: 'padding-top:6px' }, badge('appRules')))];
  const list = load('rules.list', []);
  const app = el('input', { class: 'field', placeholder: 'App name, e.g. PowerPoint' });
  let action = 'hide';
  return [card('When an app comes to the front', ...list.map((r, i) => setting(r.app, r.action === 'hide' ? 'Hide the pill' : `Switch to ${r.action.slice(4)}`, button('Remove', () => { list.splice(i, 1); save('rules.list', list); repaint(); }, { kind: 'quiet', small: true }))),
    el('div', { class: 'hstack', style: 'padding-top:8px' }, app, select([{ value: 'hide', label: 'Hide the pill' }, ...MODULES.map((m) => ({ value: `tab:${m.id}`, label: `Switch to ${m.name}` }))], action, (v) => { action = v; }, { cls: 'auto' }),
      button('Add', () => { if (!app.value.trim()) return; save('rules.list', [...list, { app: app.value.trim(), action }]); repaint(); })))];
}

function Automations(repaint) {
  if (!canUse('automations')) return [card('AI automations', el('div', { class: 'small dim' }, FEATURES.automations.detail), el('div', { style: 'padding-top:6px' }, badge('automations')))];
  const box = el('div', { class: 'col' });
  import('../services/automations.js').then((A) => {
    const name = el('input', { class: 'field', placeholder: 'Name, e.g. Morning briefing' }), p = el('textarea', { class: 'field', placeholder: 'What to ask, e.g. Give me one motivating quote and a tip for focus.', style: 'min-height:60px' }), time = el('input', { class: 'field auto', type: 'time', value: '08:00' });
    box.append(...A.list().map((a) => card(a.name, el('div', { class: 'tiny dim' }, `${a.time} · ${a.prompt}`), a.lastAnswer ? el('div', { class: 'small', style: 'padding:6px 0' }, a.lastAnswer.slice(0, 300)) : null,
      el('div', { class: 'hstack' }, button('Run now', async () => { toast('Running…'); try { await A.runNow(a); repaint(); } catch (e) { toast(e.message, { error: true }); } }, { kind: 'quiet', small: true }), button('Delete', () => { A.remove(a.id); repaint(); }, { kind: 'ghost', small: true })))),
      card('New automation (weekdays)', name, p, el('div', { class: 'hstack', style: 'padding-top:6px' }, time, button('Add', () => { if (!p.value.trim()) return; A.add({ name: name.value || 'Automation', prompt: p.value.trim(), time: time.value }); repaint(); }))));
  });
  return box;
}

function Access(repaint) {
  const t = tier();
  const feats = Object.entries(FEATURES);
  return [card('Your plan', el('div', { class: 'hstack', style: 'padding:4px 0' }, el('div', { class: 'big grow' }, TIERS[t]), t ? el('span', { class: 'mono small dim' }, maskedCode()) : null),
    el('div', { class: 'small dim' }, 'Pro is a one-time $1 and Ultimate $5, every future update included. One key works on up to 3 devices, Mac or Windows.')),
  t < 2 ? card(t ? 'Enter a different key' : 'Enter a key', el('div', { style: 'padding:6px 0' }, keyField(() => repaint())), el('div', { class: 'hstack' }, button('Get Pro or Ultimate →', () => openUrl(BUY_URL), { kind: 'quiet' }))) : null,
  t ? card('', setting('Remove the key from this PC', 'Back to Free here; frees one of your 3 devices.', button('Remove…', async () => { if (await confirm('Remove the key from this PC?', { ok: 'Remove', danger: true })) { await deactivate(); repaint(); } }, { kind: 'danger', small: true }))) : null,
  card('What’s included', ...feats.map(([id, f]) => el('div', { class: 'hstack small', style: 'padding:3px 0' },
    el('span', { style: 'width:16px' }, canUse(id) ? '✓' : ''), el('span', { class: 'grow' }, f.title, el('span', { class: 'tiny faint' }, ` — ${f.mac ? `Mac only: ${f.mac}` : f.detail}`)), badge(id)))),
  el('div', { class: 'small dim' }, 'Lost your key? notchapples.support@gmail.com')].filter(Boolean);
}

function About() {
  const v = el('span', {});
  appInfo.then((i) => { v.textContent = i.version; });
  return [card('', el('div', { class: 'big' }, 'Notch apple for Windows'), el('div', { class: 'small dim' }, 'Version ', v, '. Open source. Your notes, to-dos, clipboard and keys stay on this PC.'),
    el('div', { class: 'hstack', style: 'padding-top:8px' }, button('GitHub', () => openUrl('https://github.com/AdityaJainDXB/NotchApples'), { kind: 'quiet', small: true }), button('Website', () => openUrl('https://virajsinghchadha.github.io/notchapples-site/'), { kind: 'quiet', small: true }), button('Quit Notch apple', () => invoke('quit_app'), { kind: 'danger', small: true }))),
  card('Privacy', el('div', { class: 'small dim' }, 'No accounts and no tracking. Web requests go only to the services a feature needs (weather, sports, the AI provider you pick…). Entering a key sends only the key and a random ID for this PC to the license server.'))];
}
