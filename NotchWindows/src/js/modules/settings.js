// Settings: appearance, modules, AI keys, licence and shortcuts.
import { el, load, save } from '../store.js';
import { THEMES, applyTheme, currentThemeId } from '../themes.js';
import { MODULES, isEnabled, setEnabled, invoke } from '../app.js';
import { PROVIDERS, setKey } from './ai.js';
import { isActivated, maskedCode, deactivate } from '../license.js';

export function render(root) {
  const body = el('div', { class: 'col', style: 'overflow:auto;flex:1;min-height:0;padding-right:4px' });
  const panes = {
    Appearance: paneAppearance, Modules: paneModules, AI: paneAI,
    Licence: paneLicence, Shortcuts: paneShortcuts, About: paneAbout,
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

function paneLicence() {
  const on = isActivated();
  return el('div', { class: 'col' },
    el('div', { class: 'card col' },
      el('div', { style: 'display:flex' }, el('div', { class: 'section-title' }, 'Status'),
        el('div', { class: on ? 'ok' : 'warn', style: 'margin-left:auto;font-weight:600' },
          on ? '✅ Licensed & Activated' : '⚠️ Not activated')),
      on ? el('div', { class: 'mono small dim' }, maskedCode()) : null,
      el('div', { class: 'small dim' },
        'An access code unlocks AI, Messenger, Audio, Now Playing and VPN. Everything else is free. '
        + 'The same codes work on the Mac version.')),
    on ? el('button', { class: 'btn quiet', style: 'align-self:flex-start',
      onclick: () => { deactivate(); paneRefresh(); } }, 'Deactivate / Reset licence') : null);
}

function paneShortcuts() {
  return el('div', { class: 'col' },
    el('div', { class: 'card col' },
      el('div', { class: 'section-title' }, 'Global shortcuts'),
      row('Ctrl + Alt + N', 'Open or close the notch from any app'),
      row('Ctrl + Alt + O', 'Hide or show the notch completely'),
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
      el('div', { class: 'small dim' }, 'A port of the macOS Notch apple. Free, open source and local.'),
      el('div', { class: 'small dim' }, 'Windows PCs have no camera notch, so the panel sits at the top centre of your screen.'),
      el('button', { class: 'btn quiet', style: 'align-self:flex-start',
        onclick: () => invoke('open_url', { url: 'https://github.com/AdityaJainDXB/NotchApples' }) }, 'GitHub →')),
    el('button', { class: 'btn quiet', style: 'align-self:flex-start',
      onclick: () => invoke('quit_app') }, 'Quit Notch apple'));
}
