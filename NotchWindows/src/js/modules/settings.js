// Settings: appearance, modules, AI keys, access code and shortcuts.
import { el, load, save } from '../store.js';
import { THEMES, applyTheme, currentThemeId } from '../themes.js';
import { MODULES, isEnabled, setEnabled, invoke, show } from '../app.js';
import { PROVIDERS, setKey } from './ai.js';
import { tier, TIERS, maskedCode, deactivate } from '../license.js';
import { keyField, BUY_URL } from './activation.js';

export function render(root) {
  const body = el('div', { class: 'col', style: 'overflow:auto;flex:1;min-height:0;padding-right:4px' });
  const panes = {
    Appearance: paneAppearance, Modules: paneModules, AI: paneAI,
    Access: paneAccess, Shortcuts: paneShortcuts, About: paneAbout,
  };
  let current = load('settings.pane', 'Appearance');
  if (!panes[current]) current = 'Appearance';

  const nav = el('div', { style: 'display:flex;gap:4px;flex-wrap:wrap' },
    ...Object.keys(panes).map((name) => el('button', {
      class: `tab${name === current ? ' active' : ''}`,
      onclick: () => { current = name; save('settings.pane', name); paint(); },
    }, name)));

  function paint() {
    [...nav.children].forEach((b) => b.classList.toggle('active', b.textContent === current));
    body.replaceChildren(panes[current]());
  }

  paint();
  root.append(el('div', { class: 'col', style: 'height:100%' }, nav, body));
}

// ---- panes ----

function paneAppearance() {
  const wrap = el('div', { class: 'col' });
  const byCategory = new Map();
  for (const t of THEMES) {
    if (!byCategory.has(t.category)) byCategory.set(t.category, []);
    byCategory.get(t.category).push(t);
  }
  for (const [category, list] of byCategory) {
    wrap.append(el('div', { class: 'section-title' }, category));
    wrap.append(el('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fill,minmax(120px,1fr))' },
      ...list.map((t) => {
        const active = t.id === currentThemeId();
        return el('div', {
          class: 'tile', style: active ? 'border-color:var(--accent);background:rgba(255,255,255,.13)' : '',
          onclick: () => { applyTheme(t.id); paneRefresh(); },
        },
          el('div', { style: `width:34px;height:34px;border-radius:50%;background:${t.bg};`
            + `border:2px solid ${t.primary};display:grid;place-items:center` },
            el('div', { style: `width:13px;height:13px;border-radius:50%;background:${t.primary}` })),
          el('div', { class: 'name' }, t.name));
      })));
  }
  return wrap;
}

function paneRefresh() {
  // Re-render the whole Settings page so swatches and colours update.
  const page = document.getElementById('page');
  page.replaceChildren();
  render(page);
}

function paneModules() {
  return el('div', { class: 'col' },
    el('div', { class: 'small dim' }, 'Every module is optional. Turning one off removes its tab straight away.'),
    ...MODULES.filter((m) => m.id !== 'settings').map((m) => {
      const on = isEnabled(m.id);
      return el('div', { class: 'card', style: 'display:flex;gap:10px;align-items:center;padding:9px 12px' },
        el('div', { style: 'font-size:17px' }, m.icon),
        el('div', { style: 'flex:1' }, m.name),
        el('button', { class: `btn ${on ? '' : 'quiet'}`, onclick: (e) => {
          setEnabled(m.id, !on);
          paneRefresh();
        } }, on ? 'On' : 'Off'));
    }));
}

function paneAI() {
  return el('div', { class: 'col' },
    el('div', { class: 'small dim' },
      'Keys are stored on this PC only and sent only to that provider. Gemini and OpenRouter have free tiers.'),
    ...Object.entries(PROVIDERS).filter(([id]) => id !== 'ollama').map(([id, p]) => {
      const field = el('input', { class: 'field', type: 'password', placeholder: 'Paste key…',
        value: load(`ai.key.${id}`, '') });
      field.addEventListener('change', () => { setKey(id, field.value.trim()); });
      return el('div', { class: 'card col', style: 'gap:6px' },
        el('div', { style: 'display:flex;align-items:center' },
          el('div', { class: 'section-title' }, p.name),
          el('div', { class: 'small dim', style: 'margin-left:auto' }, p.free)),
        field,
        el('button', { class: 'btn quiet', style: 'align-self:flex-start',
          onclick: () => invoke('open_url', { url: p.keyUrl }) }, 'Get a key →'));
    }));
}

function paneAccess() {
  const t = tier();
  const removeBox = el('div', { class: 'card col', style: 'gap:8px' });

  function askFirst() {
    removeBox.replaceChildren(
      el('div', { class: 'section-title' }, 'Remove the key from this PC'),
      el('div', { class: 'small dim' },
        'Notch apple goes back to Free here and this PC no longer counts towards your 3 devices. '
        + 'You can enter the key again any time.'),
      el('button', { class: 'btn quiet', style: 'align-self:flex-start', onclick: confirmStep }, 'Remove key…'));
  }
  function confirmStep() {
    removeBox.replaceChildren(
      el('div', { class: 'section-title warn' }, 'Remove the key?'),
      el('div', { style: 'display:flex;gap:8px' },
        el('button', { class: 'btn', onclick: async () => { await deactivate(); paneRefresh(); } }, 'Yes, remove it'),
        el('button', { class: 'btn quiet', onclick: askFirst }, 'Cancel')));
  }
  askFirst();

  return el('div', { class: 'col' },
    el('div', { class: 'card col' },
      el('div', { style: 'display:flex' }, el('div', { class: 'section-title' }, 'Your plan'),
        el('div', { class: t ? 'ok' : 'dim', style: 'margin-left:auto;font-weight:600' }, TIERS[t])),
      t ? el('div', { class: 'mono small dim' }, maskedCode()) : null,
      el('div', { class: 'small dim' },
        'Free has Today, AI, Sports, Browser, Search, To-do, Notes, World Clock and Tools. '
        + 'Pro ($1, one time) adds Launcher, Clipboard, Focus, Translator, PC Stats and Shelf. '
        + 'Keys work on the Mac app too, on up to 3 devices.')),
    t < 2 ? el('div', { class: 'card col', style: 'align-items:center' },
      el('div', { class: 'section-title', style: 'align-self:flex-start' }, t ? 'Enter a different key' : 'Enter a key'),
      keyField(() => paneRefresh()),
      el('button', { class: 'btn quiet', onclick: () => invoke('open_url', { url: BUY_URL }) }, 'Buy or recover a key →')) : null,
    t ? removeBox : null,
    el('div', { class: 'small dim' }, 'Lost your key or need help? notchapples.support@gmail.com'));
}

function paneShortcuts() {
  return el('div', { class: 'col' },
    el('div', { class: 'card col' },
      el('div', { class: 'section-title' }, 'Global shortcuts'),
      row('Ctrl + Alt + N', 'Open or close the notch from any app'),
      row('Ctrl + Alt + O', 'Hide or show the notch completely'),
      row('Ctrl + K', 'Command palette: jump to any tab or action'),
      row('Esc', 'Close the notch when it is open')),
    el('div', { class: 'small dim' },
      'Windows reserves most Win-key combinations, so Notch apple uses Ctrl + Alt. '
      + 'These are registered system-wide and need no extra permission.'));

  function row(keys, what) {
    return el('div', { style: 'display:flex;gap:10px;align-items:center' },
      el('kbd', { class: 'mono', style: 'background:var(--surface);border:1px solid var(--border);'
        + 'border-radius:6px;padding:3px 8px;font-size:12px' }, keys),
      el('div', { class: 'small dim' }, what));
  }
}

function paneAbout() {
  return el('div', { class: 'col' },
    el('div', { class: 'card col' },
      el('div', { class: 'big' }, 'Notch apple for Windows'),
      el('div', { class: 'small dim' }, 'A port of the macOS Notch apple. Version 1.24.0. Open source; your notes, to-dos and keys stay on this PC.'),
      el('div', { class: 'small dim' }, 'Windows PCs have no camera notch, so the panel sits at the top centre of your screen.'),
      el('button', { class: 'btn quiet', style: 'align-self:flex-start',
        onclick: () => invoke('open_url', { url: 'https://github.com/AdityaJainDXB/NotchApples' }) }, 'GitHub →'),
      el('div', { class: 'small dim' }, 'Support: notchapples.support@gmail.com')),
    el('div', { class: 'card col' },
      el('div', { class: 'section-title' }, "What's new in 1.24"),
      el('div', { class: 'small dim' }, '• Free, Pro and Ultimate plans; the app no longer needs a code to open.'),
      el('div', { class: 'small dim' }, '• Keys bought on the website (NTCH-PRO-… / NTCH-ULTM-…) work here and on the Mac.'),
      el('div', { class: 'small dim' }, '• New To-do tab, unit converter in Tools, and a Ctrl+K command palette.')),
    el('div', { class: 'card col' },
      el('div', { class: 'section-title' }, 'Privacy'),
      el('div', { class: 'small dim' }, 'No accounts and no tracking. Entering a key sends only the key and a random ID for this PC to the license server, to enforce the 3-device limit.')),
    el('button', { class: 'btn quiet', style: 'align-self:flex-start',
      onclick: () => invoke('quit_app') }, 'Quit Notch apple'));
}
