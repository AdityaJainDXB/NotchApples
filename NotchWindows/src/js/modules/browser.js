// Browser, ported from BrowserModel.swift: type a website or a search and the page opens INSIDE the notch, like the Mac
// (the panel grows to 1100 x 700 while a page is open). The page is a separate frameless window with no access to the app,
// laid exactly over the notch's page area; it hides when you change tab or the notch closes. "Own window" pops it out.
// Your own quick links and recent pages are one click away.

import { el, load, save, timeAgo } from '../store.js';
import { invoke } from '../native.js';
import { bigBrowser, holdOpen } from '../app.js';
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

/// A page is open in the notch (it stays open across tab switches, like the Mac's browser).
let pageOpen = false;

export function render(root) {
  let engine = load('browser.engine', 'duckduckgo');
  const bar = el('input', { class: 'field', style: 'flex:1', placeholder: `Search ${ENGINES[engine].name} or type a website` });
  const status = el('div', { class: 'small dim', style: 'min-height:15px' });
  const linksGrid = el('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fill,minmax(84px,1fr))' });
  const recent = el('div', { class: 'col gap-4' });

  const stage = el('div', { class: 'card', style: 'flex:1;min-height:0;display:none;align-items:center;justify-content:center' }, el('div', { class: 'small dim' }, 'Loading the page…'));
  const startPage = el('div', { class: 'row', style: 'flex:1;min-height:0' });
  let held = false, ro = null;
  const rectOf = () => { const r = stage.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
  const place = () => { if (pageOpen && stage.isConnected) invoke('browser_place', { rect: rectOf() }).catch(() => {}); };
  function showStage(on) {
    stage.style.display = on ? 'flex' : 'none';
    startPage.style.display = on ? 'none' : 'flex';
    navRow.style.display = on ? 'flex' : 'none';
    if (on && !held) { held = true; holdOpen(true); }
    if (!on && held) { held = false; holdOpen(false); }
    bigBrowser(on);
    if (on) { setTimeout(place, 120); setTimeout(place, 450); setTimeout(place, 900); }   // the panel grows first; the page follows
  }
  const navBtn = (label, title, action) => el('button', { class: 'btn small quiet', title, onclick: () => invoke('browser_nav', { action }).catch(() => {}) }, label);
  const navRow = el('div', { class: 'hstack', style: 'display:none' },
    navBtn('←', 'Back', 'back'), navBtn('→', 'Forward', 'forward'), navBtn('↻', 'Reload', 'reload'),
    el('div', { class: 'small dim grow ellipsis', id: 'browser-host' }, ''),
    el('button', { class: 'btn small quiet', title: 'Show this page in its own window', onclick: async () => {
      const u = recentUrl; if (!u) return;
      await invoke('browser_close').catch(() => {}); pageOpen = false; showStage(false);
      invoke('open_browser', { url: u }).catch((e) => toast(e.message || String(e), { error: true }));
    } }, 'Own window'),
    el('button', { class: 'btn small quiet', onclick: () => closePage() }, 'Close page'));
  let recentUrl = '';
  async function closePage() { await invoke('browser_close').catch(() => {}); pageOpen = false; showStage(false); }

  async function open(what) {
    const url = resolve(what, engine);
    if (!url) return;
    status.textContent = `Opening ${host(url)}…`;
    try {
      recentUrl = url;
      showStage(true); pageOpen = true;
      navRow.querySelector('#browser-host').textContent = host(url);
      await new Promise((r) => setTimeout(r, 60));     // let the panel start growing, then measure
      await invoke('open_browser', { url, rect: rectOf() });
      const hist = load('browser.history', []).filter((h) => h.url !== url);
      save('browser.history', [{ url, title: /[?&]q=/.test(url) ? `Search: ${what}` : host(url), at: Date.now() }, ...hist].slice(0, 30));
      status.textContent = '';
      bar.value = '';
      paintRecent();
    } catch (e) { pageOpen = false; showStage(false); status.replaceChildren(el('span', { class: 'err' }, e.message || String(e))); }
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
  startPage.append(
    el('div', { class: 'card col', style: 'flex:1.3' }, el('div', { class: 'section-title' }, 'Quick links'), el('div', { class: 'scroll' }, linksGrid),
      el('div', { class: 'tiny faint' }, 'Right-click a link to rename or remove it.')),
    el('div', { class: 'card col scroll', style: 'flex:1' }, recent));
  startPage.style.display = 'flex';
  root.append(el('div', { class: 'col fill' },
    el('div', { class: 'hstack' }, bar, el('button', { class: 'btn', onclick: () => open(bar.value) }, 'Go'), engineSel),
    status, navRow, startPage, stage));
  // Coming back to the tab with a page still open: show it again where it belongs.
  if (pageOpen) { showStage(true); }
  ro = new ResizeObserver(place); ro.observe(stage);
  setTimeout(() => bar.focus(), 40);
  // Leaving the tab (or the notch closing) hides the page and gives the panel its normal size back.
  return () => {
    ro?.disconnect();
    if (held) { held = false; holdOpen(false); }
    bigBrowser(false);
    invoke('browser_hide').catch(() => {});
  };
}
