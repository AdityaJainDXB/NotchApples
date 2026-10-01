// Browser: address bar + search, ported from BrowserModel.swift. Pages open in a
// dedicated always-on-top browser window driven by the system web engine
// (WebView2 on Windows), because the notch panel itself is only a few hundred
// pixels tall — too small to read a web page in.
import { el, load, save } from '../store.js';
import { invoke } from '../app.js';

export const ENGINES = {
  duckduckgo: { name: 'DuckDuckGo',   base: 'https://duckduckgo.com/' },
  google:     { name: 'Google',       base: 'https://www.google.com/search' },
  bing:       { name: 'Bing',         base: 'https://www.bing.com/search' },
  brave:      { name: 'Brave Search', base: 'https://search.brave.com/search' },
  ecosia:     { name: 'Ecosia',       base: 'https://www.ecosia.org/search' },
};

/// Encode everything except unreserved characters so "+" and "&" survive.
const encodeQuery = (q) => encodeURIComponent(q).replace(/[!'()*]/g, (c) =>
  '%' + c.charCodeAt(0).toString(16).toUpperCase());

/// Turns what was typed into a page to open: a web address stays one,
/// anything else becomes a search. Mirrors BrowserModel.resolve in Swift.
export function resolve(input, engineId = 'duckduckgo') {
  const engine = ENGINES[engineId] || ENGINES.duckduckgo;
  const search = (q) => `${engine.base}?q=${encodeQuery(q)}`;
  const text = (input || '').trim();
  if (!text) return null;

  const schemeAt = text.indexOf('://');
  if (schemeAt > 0) {
    const name = text.slice(0, schemeAt).toLowerCase();
    // Only web pages: never file:, javascript: or anything else typed into the bar.
    return (name === 'http' || name === 'https') && !text.includes(' ') ? text : search(text);
  }
  if (text.includes(' ')) return search(text);

  const host = '[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?';
  if (new RegExp(`^(localhost|\\d{1,3}(?:\\.\\d{1,3}){3})(?::\\d+)?(?:[/?#].*)?$`).test(text)) return `http://${text}`;
  if (new RegExp(`^${host}(?:\\.${host})+(?::\\d+)?(?:[/?#].*)?$`).test(text)) return `https://${text}`;
  return search(text);
}

const LINKS = [
  ['Google', '🔍', 'https://www.google.com'], ['YouTube', '▶️', 'https://www.youtube.com'],
  ['Wikipedia', '📖', 'https://www.wikipedia.org'], ['GitHub', '💻', 'https://github.com'],
  ['News', '📰', 'https://news.google.com'], ['Maps', '🗺', 'https://maps.google.com'],
];

export function render(root) {
  let engine = load('browser.engine', 'duckduckgo');

  const bar = el('input', { class: 'field', style: 'flex:1',
    placeholder: `Search ${ENGINES[engine].name} or enter a website` });
  const status = el('div', { class: 'small dim', style: 'min-height:15px' });

  const open = async (what) => {
    const url = resolve(what, engine);
    if (!url) return;
    status.textContent = 'Opening ' + new URL(url).hostname + '…';
    try {
      await invoke('open_browser', { url });
      save('browser.last', url);
      status.textContent = '';
    } catch (e) { status.replaceChildren(el('span', { class: 'err' }, String(e?.message ?? e))); }
  };

  bar.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(bar.value); });

  const engineSel = el('select', { class: 'field', style: 'max-width:150px' },
    ...Object.entries(ENGINES).map(([id, v]) => el('option', { value: id, selected: id === engine }, v.name)));
  engineSel.addEventListener('change', () => {
    engine = engineSel.value; save('browser.engine', engine);
    bar.placeholder = `Search ${ENGINES[engine].name} or enter a website`;
  });

  const last = load('browser.last', '');

  root.append(el('div', { class: 'col', style: 'height:100%' },
    el('div', { style: 'display:flex;gap:8px' },
      bar, el('button', { class: 'btn', onclick: () => open(bar.value) }, 'Go'), engineSel),
    status,
    el('div', { class: 'center', style: 'gap:14px' },
      el('div', { style: 'font-size:32px' }, '🌐'),
      el('div', { class: 'dim' }, 'Search the web or type a website above'),
      el('div', { class: 'grid', style: 'grid-template-columns:repeat(6,84px)' },
        ...LINKS.map(([name, icon, url]) => el('div', { class: 'tile', onclick: () => open(url) },
          el('div', { style: 'font-size:20px' }, icon), el('div', { class: 'name' }, name)))),
      last ? el('button', { class: 'btn quiet', onclick: () => open(last) },
        '↩ Reopen ' + safeHost(last)) : null)));

  setTimeout(() => bar.focus(), 40);
}

function safeHost(url) { try { return new URL(url).hostname; } catch { return 'last page'; } }
