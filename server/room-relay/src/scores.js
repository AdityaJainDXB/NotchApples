// Notch Apple friends leaderboards. The wire format and the privacy facts are in docs/LEADERBOARDS.md.
//
//   POST /s/score   { game, board, name, score, id }   → { ok, rank, changed }
//   GET  /s/top?board=<64 hex>&game=<game>              → { top: [{ name, score, at }] }   (the best 20)
//
// A board is a 6-character code that friends share. The apps send only a SHA-256 hash of it (`board`), so this server never
// sees the code itself and there is no list of boards: you can only read a board if you already know its code.
// What is stored per score: the game, the score, the display name you typed (max 20 characters, cleaned), the day it was set,
// and a hash of a random per-device id (so you update your own row instead of adding more). No accounts, no IP addresses,
// nothing personal. IP addresses are used in memory for rate limiting as a daily hash, the same way Friends does, and are
// never stored or logged. Scores are honour-system: the limits below only reject impossible values, they are not anti-cheat.

const BOARD = /^[0-9a-f]{64}$/;
const DEVICE = /^[A-Za-z0-9_-]{16,64}$/;
const MAX_BODY = 1024;
export const TOP_N = 20;
export const TTL_MS = 90 * 24 * 3600 * 1000;       // scores older than 90 days are dropped
export const MAX_PER_GAME = 100;                    // entries kept per game on one board
export const MAX_PER_BOARD = 600;                   // entries kept on one board across all games
export const NAME_MAX = 20;
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type' };

// Which games exist, which way is better, and the range a believable score falls in. Racing and plane have one table per
// track / mode, so the game id is "racing:<track>" or "plane:<mode>". Units: racing is milliseconds, plane trial is milliseconds,
// everything else is whole points, hoops or days.
const FIXED = {
  tetris: { better: 'high', min: 1, max: 5000000 },             // Tetris score
  wordle: { better: 'high', min: 1, max: 3650 },                // Daily Word streak (days)
  trivia: { better: 'high', min: 1, max: 3650 },                // Daily Trivia streak (days)
  'plane:hoops': { better: 'high', min: 1, max: 500 },          // hoops in 90 seconds
  'plane:trial': { better: 'low', min: 5000, max: 900000 },     // time trial, ms
  'plane:landing': { better: 'high', min: 1, max: 1000 },       // landing points
  'plane:war': { better: 'high', min: 1, max: 500000 },         // battle points
};
const RACING = { better: 'low', min: 5000, max: 900000 };      // best lap, 5 s to 15 min
const TRACK = /^racing:[a-z0-9_-]{1,24}$/;

/** The rules for a game id, or null if it is not one of the supported games. */
export function gameRules(game) {
  if (typeof game !== 'string') return null;
  if (Object.hasOwn(FIXED, game)) return FIXED[game];
  return TRACK.test(game) ? RACING : null;
}

/** A display name made safe: no control, formatting or markup characters, one space between words, at most 20 characters. */
export function cleanName(raw) {
  let s = String(raw ?? '').normalize('NFKC');
  s = s.replace(/[\p{C}\p{Zl}\p{Zp}<>&"'`\\]/gu, ' ').replace(/\s+/g, ' ').trim();
  s = [...s].slice(0, NAME_MAX).join('').trim();
  return s || 'Player';
}

/** Checks a posted score. Returns { ok: true, value } with the cleaned fields, or { ok: false, error }. */
export function validateScore(b) {
  if (!b || typeof b !== 'object') return { ok: false, error: 'Bad request.' };
  const rules = gameRules(b.game);
  if (!rules) return { ok: false, error: 'Unknown game.' };
  if (typeof b.board !== 'string' || !BOARD.test(b.board)) return { ok: false, error: 'Bad board.' };
  if (typeof b.id !== 'string' || !DEVICE.test(b.id)) return { ok: false, error: 'Bad id.' };
  if (typeof b.score !== 'number' || !Number.isInteger(b.score)) return { ok: false, error: 'Score must be a whole number.' };
  if (b.score < rules.min || b.score > rules.max) return { ok: false, error: 'That score is not possible in this game.' };
  return { ok: true, value: { game: b.game, board: b.board, id: b.id, score: b.score, name: cleanName(b.name) } };
}

const isBetter = (rules, a, b) => (rules.better === 'high' ? a > b : a < b);
/** Best first; on a tie, whoever got there first. */
export function rankEntries(entries, rules) {
  return entries.slice().sort((x, y) => (x.s === y.s ? x.t - y.t : rules.better === 'high' ? y.s - x.s : x.s - y.s));
}

const enc = new TextEncoder();
const hex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256hex = async (text) => hex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS } });
const fail = (status, error) => reply({ error }, status);

/** One board: every score friends on this board have posted, kept for 90 days. */
export class Board {
  constructor(state) { this.state = state; this.s = state.storage; }

  /** All entries of a game, expired ones dropped. Keys look like "e:<game>:<device hash>". */
  async entries(game, now) {
    const all = await this.s.list({ prefix: `e:${game}:` });
    const out = [];
    for (const [k, v] of all) { if (now - v.t > TTL_MS) await this.s.delete(k); else out.push({ k, ...v }); }
    return out;
  }

  async fetch(request) {
    const url = new URL(request.url), now = Date.now();
    if (request.method === 'GET') {
      const rules = gameRules(url.searchParams.get('game'));
      if (!rules) return fail(400, 'Unknown game.');
      const top = rankEntries(await this.entries(url.searchParams.get('game'), now), rules).slice(0, TOP_N);
      return reply({ top: top.map((e) => ({ name: e.n, score: e.s, at: new Date(e.t).toISOString().slice(0, 10) })) });
    }
    if (request.method !== 'POST') return fail(405, 'Not allowed');
    let body; try { body = await request.json(); } catch { return fail(400, 'Bad JSON'); }
    const v = validateScore(body);
    if (!v.ok) return fail(400, v.error);
    const { game, score, name } = v.value, rules = gameRules(game);
    const key = `e:${game}:${(await sha256hex(`dev|${v.value.id}`)).slice(0, 24)}`;
    const mine = await this.s.get(key);
    let changed = false;
    if (mine && now - mine.t <= TTL_MS) {
      // Same device: keep the better score; a new name always applies.
      const better = isBetter(rules, score, mine.s);
      const next = { s: better ? score : mine.s, n: name, t: better ? now : mine.t };
      changed = better || name !== mine.n;
      if (changed) await this.s.put(key, next);
    } else {
      const list = rankEntries(await this.entries(game, now), rules);
      if (list.length >= MAX_PER_GAME) {
        const worst = list[list.length - 1];
        if (!isBetter(rules, score, worst.s)) return fail(409, 'This board is full for this game and your score is not high enough to enter.');
        await this.s.delete(worst.k);
      }
      if ((await this.s.list({ prefix: 'e:' })).size >= MAX_PER_BOARD) return fail(409, 'This board is full.');
      await this.s.put(key, { s: score, n: name, t: now });
      changed = true;
    }
    if (!(await this.s.getAlarm())) await this.s.setAlarm(now + 24 * 3600 * 1000);
    const ranked = rankEntries(await this.entries(game, now), rules);
    const rank = ranked.findIndex((e) => e.k === key) + 1;
    return reply({ ok: true, rank, changed });
  }

  async alarm() {
    const now = Date.now(); let left = 0;
    for (const [k, v] of await this.s.list({ prefix: 'e:' })) { if (now - v.t > TTL_MS) await this.s.delete(k); else left++; }
    if (left) await this.s.setAlarm(now + 24 * 3600 * 1000);
  }
}

/** The Worker's front door for /s/…: checks the shape, applies the per-address limits, and hands the call to the board. */
export async function routeScores(request, env) {
  const url = new URL(request.url), path = url.pathname, method = request.method;
  if (method === 'OPTIONS') return new Response(null, { headers: CORS });
  let board, forward = request, bucket, max, window;
  if (method === 'POST' && path === '/s/score') {
    const text = await request.text();
    if (text.length > MAX_BODY) return fail(413, 'Too large');
    let body; try { body = JSON.parse(text); } catch { return fail(400, 'Bad JSON'); }
    const v = validateScore(body);
    if (!v.ok) return fail(400, v.error);
    board = v.value.board; bucket = 'score'; max = 30; window = 3600000;       // 30 scores an hour per address
    forward = new Request(request.url, { method, headers: { 'content-type': 'application/json' }, body: text });
  } else if (method === 'GET' && path === '/s/top') {
    board = url.searchParams.get('board') || '';
    if (!BOARD.test(board)) return fail(400, 'Bad board.');
    if (!gameRules(url.searchParams.get('game'))) return fail(400, 'Unknown game.');
    bucket = 'top'; max = 120; window = 60000;                                  // 120 looks a minute per address
  } else return fail(404, 'Not found');

  if (env.FRIEND_RATE) {
    const ip = request.headers.get('cf-connecting-ip') || 'unknown', day = new Date().toISOString().slice(0, 10);
    const net = ip.includes(':') ? ip.split(':').slice(0, 4).join(':') : ip;
    const id = env.FRIEND_RATE.idFromName(await sha256hex(`${day}|sc:${bucket}|${net}`));
    const r = await (await env.FRIEND_RATE.get(id).fetch(`https://rate/?max=${max}&w=${window}`)).json();
    if (!r.ok) return fail(429, 'Too many requests. Try again later.');
  }
  return env.BOARD.get(env.BOARD.idFromName(board)).fetch(forward);
}
