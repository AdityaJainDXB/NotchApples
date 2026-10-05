// Markets (Pro): stock prices from Yahoo Finance and crypto from CoinGecko, the
// same free sources as the Mac app. One symbol can be pinned to the pill.

import { load, save } from '../store.js';
import { getJSON } from '../native.js';
import { provide, refresh } from '../activity.js';
import { canUse } from '../features.js';

export const DEFAULT_LIST = ['AAPL', 'MSFT', 'NVDA', 'BTC', 'ETH'];
const CRYPTO = { BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', LTC: 'litecoin', DOGE: 'dogecoin', XRP: 'ripple', ADA: 'cardano', BNB: 'binancecoin', TON: 'the-open-network', AVAX: 'avalanche-2', DOT: 'polkadot', TRX: 'tron', MATIC: 'matic-network', SHIB: 'shiba-inu', LINK: 'chainlink' };

export const watchlist = () => load('markets.list', DEFAULT_LIST);
export const setWatchlist = (l) => save('markets.list', l);
export const pinned = () => load('markets.pin', '');
export const setPinned = (s) => { save('markets.pin', s); refresh(); poll(); };
export const isCrypto = (sym) => !!CRYPTO[sym.toUpperCase()];

const quotes = new Map(); // SYMBOL -> { price, change, changePct, currency, name, spark: [], at }
export const quote = (s) => quotes.get(s.toUpperCase());

async function stock(sym) {
  const j = await getJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1d&interval=15m`, { timeout: 12000 });
  const r = j.chart?.result?.[0];
  if (!r) throw new Error(j.chart?.error?.description || `${sym} not found`);
  const m = r.meta;
  const prev = m.chartPreviousClose ?? m.previousClose;
  const price = m.regularMarketPrice;
  return { price, change: price - prev, changePct: prev ? ((price - prev) / prev) * 100 : 0, currency: m.currency || 'USD',
    name: m.shortName || m.longName || sym, spark: (r.indicators?.quote?.[0]?.close || []).filter((v) => v != null) };
}

async function crypto(syms) {
  const ids = syms.map((s) => CRYPTO[s]).join(',');
  const j = await getJSON(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`, { timeout: 12000 });
  const out = {};
  for (const s of syms) {
    const v = j[CRYPTO[s]];
    if (v) out[s] = { price: v.usd, changePct: v.usd_24h_change ?? 0, change: v.usd * ((v.usd_24h_change ?? 0) / 100), currency: 'USD', name: CRYPTO[s][0].toUpperCase() + CRYPTO[s].slice(1), spark: [] };
  }
  return out;
}

export async function loadQuotes(list = watchlist()) {
  const syms = list.map((s) => s.toUpperCase());
  const c = syms.filter(isCrypto);
  const s = syms.filter((x) => !isCrypto(x));
  const errors = [];
  await Promise.all([
    ...s.map(async (sym) => { try { quotes.set(sym, { ...(await stock(sym)), at: Date.now() }); } catch (e) { errors.push(`${sym}: ${e.message}`); } }),
    (async () => { if (!c.length) return; try { for (const [k, v] of Object.entries(await crypto(c))) quotes.set(k, { ...v, at: Date.now() }); } catch (e) { errors.push(`crypto: ${e.message}`); } })(),
  ]);
  refresh();
  return errors;
}

export const fmtPrice = (q) => {
  if (!q) return '—';
  const p = q.price;
  const digits = p >= 1000 ? 0 : p >= 1 ? 2 : 4;
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: q.currency || 'USD', maximumFractionDigits: digits, minimumFractionDigits: digits }).format(p); }
  catch { return p.toFixed(digits); }
};

async function poll() {
  clearTimeout(poll.t);
  const pin = pinned();
  if (pin && canUse('markets')) await loadQuotes([pin]);
  poll.t = setTimeout(poll, 60_000);
}

export function start() {
  poll();
  provide('markets', 20, () => {
    const pin = pinned();
    if (!pin || !canUse('markets')) return null;
    const q = quote(pin);
    if (!q) return null;
    const up = q.changePct >= 0;
    return { icon: up ? '▲' : '▼', leftText: pin, label: `${fmtPrice(q)} ${up ? '+' : ''}${q.changePct.toFixed(1)}%`, tab: 'markets', title: q.name };
  });
}
