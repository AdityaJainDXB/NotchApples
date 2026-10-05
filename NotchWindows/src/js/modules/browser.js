// Browser, ported from BrowserModel.swift: type a website or a search and it
// opens in a separate always-on-top window (the notch is too short to read a web
// page in). Your own quick links and recent pages are one click away.

import { el, load, save, timeAgo } from '../store.js';
import { invoke } from '../native.js';
import { menu, prompt, toast } from '../ui.js';

export const ENGINES = {
  duckduckgo: { name: 'DuckDuckGo', base: 'https://duckduckgo.com/' },
  google: { name: 'Google', base: 'https://www.google.com/search' },
  bing: { name: 'Bing', base: 'https://www.bing.com/search' },
  brave: { name: 'Brave Search', base: 'https://search.brave.com/search' },
  ecosia: { name: 'Ecosia', base: 'https://www.ecosia.org/search' },
  perplexity: { name: 'Perplexity', base: 'https://www.perplexity.ai/search' },
};

/// Encode everything except unreserved characters so "+" and "&" survive.
const encodeQuery = (q) => encodeURIComponent(q).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

/// What was typed → a page to open: a web address stays one, anything else is a
/// search. Mirrors BrowserModel.resolve in Swift.
export function resolve(input, engineId = load('browser.engine', 'duckduckgo')) {
  const engine = ENGINES[engineId] || ENGINES.duckduckgo;
  const search = (q) => `${engine.base}?q=${encodeQuery(q)}`;
  const text = (input || '').trim();
  if (!text) return null;
  const schemeAt = text.indexOf('://');
  if (schemeAt > 0) {
    const name = text.slice(0, schemeAt).toLowerCase();
    return (name === 'http' || name === 'https') && !text.includes(' ') ? text : search(text);
  }
  if (text.includes(' ')) return search(text);
  const host = '[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?';
  if (new RegExp('^(localhost|\\d{1,3}(?:\\.\\d{1,3}){3})(?::\\d+)?(?:[/?#].*)?$').test(text)) return `http://${text}`;
  if (new RegExp(`^${host}(?:\\.${host})+(?::\\d+)?(?:[/?#].*)?$`).test(text)) return `https://${text}`;
  return search(text);
}

const DEFAULT_LINKS = [
  { name: 'Google', icon: '🔍', url: 'https://www.google.com' }, { name: 'YouTube', icon: '▶️', url: 'https://www.youtube.com' },
  { name: 'Wikipedia', icon: '📖', url: 'https://www.wikipedia.org' }, { name: 'GitHub', icon: '💻', url: 'https://github.com' },
  { name: 'News', icon: '📰', url: 'https://news.google.com' }, { name: 'Maps', icon: '🗺', url: 'https://maps.google.com' },
  { name: 'Gmail', icon: '✉️', url: 'https://mail.google.com' }, { name: 'ChatGPT', icon: '🤖', url: 'https://chatgpt.com' },
];

const host = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };

export function render(root) {
  let engine = load('browser.engine', 'duckduckgo');
  const bar = el('input', { class: 'field', style: 'flex:1', placeholder: `Search ${ENGINES[engine].name} or type a website` });
  const status = el('div', { class: 'small dim', style: 'min-height:15px' });
  const linksGrid = el('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fill,minmax(84px,1fr))' });
  const recent = el('div', { class: 'col gap-4' });

  async function open(what) {
    const url = resolve(what, engine);
    if (!url) return;
    status.textContent = `Opening ${host(url)}…`;
    try {
      await invoke('open_browser', { url });
      const hist = load('browser.history', []).filter((h) => h.url !== url);
      save('browser.history', [{ url, title: /[?&]q=/.test(url) ? `Search: ${what}` : host(url), at: Date.now() }, ...hist].slice(0, 30));
      status.textContent = '';
      bar.value = '';
      paintRecent();
    } catch (e) { status.replaceChildren(el('span', { class: 'err' }, e.message)); }
  }

  bar.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(bar.value); });

  const engineSel = el('select', { class: 'field auto' }, ...Object.entries(ENGINES).map(([id, v]) => el('option', { value: id, selected: id === engine }, v.name)));
  engineSel.addEventListener('change', () => { engine = engineSel.value; save('browser.engine', engine); bar.placeholder = `Search ${ENGINES[engine].name} or type a website`; });

  function paintLinks() {
    const links = load('browser.links', DEFAULT_LINKS);
    linksGrid.replaceChildren(...links.map((l, i) => {
      const t = el('div', { class: 'tile', title: l.url, onclick: () => open(l.url) },
        el('img', { src: `https://www.google.com/s2/favicons?sz=64&domain=${host(l.url)}`, style: 'width:24px;height:24px', alt: '', onerror: (e) => e.target.replaceWith(el('div', { class: 'glyph', style: 'font-size:20px;line-height:24px;height:24px' }, l.icon || '🌐')) }),
        el('div', { class: 'name' }, l.name));
      t.addEventListener('contextmenu', (e) => menu(e, [
        { label: 'Rename', run: async () => { const n = await prompt('Name', { value: l.name }); if (n) { links[i] = { ...l, name: n }; save('browser.links', links); paintLinks(); } } },
        { label: 'Remove', danger: true, run: () => { links.splice(i, 1); save('browser.links', links); paintLinks(); } },
      ]));
      return t;
    }), el('div', { class: 'tile', title: 'Add a site', onclick: async () => {
      const url = await prompt('Add a site', { placeholder: 'e.g. bbc.co.uk', ok: 'Add' });
      if (!url) return;
      const full = resolve(url, engine);
      if (!full || /[?&]q=/.test(full)) return toast('That doesn’t look like a website.', { error: true });
      save('browser.links', [...links, { name: host(full).split('.')[0].replace(/^./, (c) => c.toUpperCase()), url: full }]);
      paintLinks();
    } }, el('div', { class: 'glyph', style: 'font-size:22px;line-height:24px;height:24px' }, '＋'), el('div', { class: 'name' }, 'Add')));
  }

  function paintRecent() {
    const hist = load('browser.history', []).slice(0, 6);
    recent.replaceChildren(...(hist.length ? [el('div', { class: 'hstack' }, el('div', { class: 'section-title grow' }, 'Recent'),
      el('button', { class: 'btn small ghost', onclick: () => { save('browser.history', []); paintRecent(); } }, 'Clear'))] : []),
      ...hist.map((h) => el('div', { class: 'item clickable', onclick: () => open(h.url) },
        el('img', { src: `https://www.google.com/s2/favicons?sz=32&domain=${host(h.url)}`, style: 'width:16px;height:16px', alt: '' }),
        el('div', { class: 'main ellipsis' }, h.title), el('span', { class: 'tiny faint' }, timeAgo(h.at)))));
    if (!hist.length) recent.append(el('div', { class: 'section-title' }, 'Recent'), el('div', { class: 'small dim' }, 'Pages you open appear here.'));
  }

  paintLinks();
  paintRecent();
  root.append(el('div', { class: 'col fill' },
    el('div', { class: 'hstack' }, bar, el('button', { class: 'btn', onclick: () => open(bar.value) }, 'Go'), engineSel),
    status,
    el('div', { class: 'row', style: 'flex:1;min-height:0' },
      el('div', { class: 'card col', style: 'flex:1.3' }, el('div', { class: 'section-title' }, 'Quick links'), el('div', { class: 'scroll' }, linksGrid),
        el('div', { class: 'tiny faint' }, 'Right-click a link to rename or remove it.')),
      el('div', { class: 'card col scroll', style: 'flex:1' }, recent))));
  setTimeout(() => bar.focus(), 40);
}
