// Markets (Pro): a watchlist of stocks and crypto; pin one to the pill.
import { el } from '../store.js';
import { toast, iconBtn, empty } from '../ui.js';
import * as M from '../services/markets.js';

export function render(root) {
  let alive = true;
  const list = el('div', { class: 'col gap-4 scroll', style: 'flex:1' }), status = el('div', { class: 'tiny faint' });
  const add = el('input', { class: 'field', placeholder: 'Add a symbol: AAPL, TSLA, ^GSPC, BTC, ETH…' });
  add.onkeydown = async (e) => { if (e.key !== 'Enter' || !add.value.trim()) return; const s = add.value.trim().toUpperCase(); if (!M.watchlist().includes(s)) M.setWatchlist([...M.watchlist(), s]); add.value = ''; await refresh(); };
  const spark = (pts, up) => { if (pts.length < 2) return el('span', { style: 'width:80px' }); const lo = Math.min(...pts), hi = Math.max(...pts), w = 80, h = 26; const d = pts.map((p, i) => `${(i / (pts.length - 1)) * w},${h - ((p - lo) / (hi - lo || 1)) * h}`).join(' '); const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('width', w); svg.setAttribute('height', h); svg.innerHTML = `<polyline fill="none" stroke="${up ? 'var(--ok)' : 'var(--bad)'}" stroke-width="1.6" points="${d}"/>`; return svg; };
  function paint() {
    const syms = M.watchlist();
    list.replaceChildren(...syms.map((s) => {
      const q = M.quote(s), up = (q?.changePct ?? 0) >= 0, pinned = M.pinned() === s;
      return el('div', { class: 'item' },
        el('div', { class: 'main' }, el('div', { style: 'font-weight:700' }, s, pinned ? ' 📌' : ''), el('div', { class: 'tiny faint ellipsis' }, q?.name || (q ? '' : 'Loading…'))),
        q ? spark(q.spark || [], up) : null,
        el('div', { style: 'text-align:right;width:120px' }, el('div', { class: 'num', style: 'font-weight:600' }, M.fmtPrice(q)), el('div', { class: `tiny num ${up ? 'ok' : 'bad'}` }, q ? `${up ? '+' : ''}${q.changePct.toFixed(2)}%` : '')),
        el('div', { class: 'actions' }, iconBtn('📌', pinned ? 'Unpin from the pill' : 'Show on the pill', () => { M.setPinned(pinned ? '' : s); paint(); }), iconBtn('✕', 'Remove', () => { M.setWatchlist(syms.filter((x) => x !== s)); paint(); })));
    }));
    if (!syms.length) list.append(empty('📈', 'Your watchlist is empty', 'Add a stock or crypto symbol above.'));
  }
  async function refresh() { paint(); const errs = await M.loadQuotes(); if (!alive) return; status.textContent = errs.length ? errs.join(' · ') : `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · Stocks: Yahoo Finance · Crypto: CoinGecko`; paint(); }
  root.append(el('div', { class: 'col fill' }, add, list, status));
  refresh();
  const t = setInterval(refresh, 60000);
  return () => { alive = false; clearInterval(t); };
}
