// Friends leaderboards for the games, shared by the Mac and Windows apps. Docs: docs/LEADERBOARDS.md.
//
//   NotchLeaderboard.button(host, { games, current })  adds a small 🏆 button that opens the panel over `host`; returns a remove function.
//       games: () => [{ id, label, kind: 'points' | 'time' | 'days', best?: () => number | null }]   (time scores are milliseconds)
//   NotchLeaderboard.submit(gameId, score)             sends a score if, and only if, you turned sharing on AND joined a board.
//
// OFF by default. Nothing is sent until you switch sharing on and join a board with a code a friend gave you (or make one).
// What is sent, exactly: the game, your score, the display name you typed, a hash of the board code, and a random id made on
// this device. Never an account, an email, a device name or a location. Anyone who has the board code sees the names and scores.
// Light: no timers, no polling; the table is fetched when you open the panel or press Refresh.
(function () {
  'use strict';
  const BASE = 'https://notchapple-rooms.adityajain1225.workers.dev';
  const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', CODE_LEN = 6;

  const store = {
    get(k, d) { try { const v = localStorage.getItem('lb.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('lb.' + k, JSON.stringify(v)); } catch { /* storage off: settings last until the page closes */ } },
  };

  // ---- pure helpers (tested in Node)
  const newCode = (rnd = (n) => crypto.getRandomValues(new Uint8Array(n))) => { const b = rnd(CODE_LEN); let s = ''; for (let i = 0; i < CODE_LEN; i++) s += ALPHABET[b[i] % ALPHABET.length]; return s; };
  /** A typed code, tidied: upper case, spaces and dashes dropped. Returns null if it is not a valid 6-character code. */
  const normalizeCode = (raw) => { const s = String(raw || '').toUpperCase().replace(/[\s-]/g, ''); return s.length === CODE_LEN && [...s].every((c) => ALPHABET.includes(c)) ? s : null; };
  const cleanName = (raw) => ([...String(raw || '').replace(/[\u0000-\u001f\u007f<>&"'`\\]/g, ' ').replace(/\s+/g, ' ').trim()].slice(0, 20).join('').trim());
  /** A score as text: time in milliseconds as m:ss.mmm, days as "12 days", points with thousands separators. */
  function fmtScore(score, kind) {
    if (kind === 'time') { const m = Math.floor(score / 60000), s = (score % 60000) / 1000; return `${m}:${s.toFixed(3).padStart(6, '0')}`; }
    if (kind === 'days') return `${score} ${score === 1 ? 'day' : 'days'}`;
    return Number(score).toLocaleString('en-US');
  }
  const randomId = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
  async function boardHash(code) {
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`notchapple-board-v1|${code}`)));
    return [...h].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // ---- settings
  const state = () => ({ on: store.get('on', false) === true, code: normalizeCode(store.get('code', '')), name: cleanName(store.get('name', '')) });
  const deviceId = () => { let id = store.get('dev', ''); if (typeof id !== 'string' || id.length < 16) { id = randomId(); store.set('dev', id); } return id; };

  // ---- network
  async function call(path, opts = {}) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 10000);
    try {
      const r = await fetch(BASE + path, { ...opts, signal: ctl.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
      let j = null; try { j = await r.json(); } catch { /* no body */ }
      if (!r.ok) return { ok: false, status: r.status, error: (j && j.error) || `The leaderboard answered ${r.status}.` };
      return { ok: true, json: j };
    } catch { return { ok: false, offline: true, error: "Can't reach the leaderboard. Are you offline? Your scores still count in the game." }; }
    finally { clearTimeout(t); }
  }
  async function fetchTop(code, game) { return call(`/s/top?board=${await boardHash(code)}&game=${encodeURIComponent(game)}`); }
  async function postScore(code, game, score, name) {
    return call('/s/score', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ game, board: await boardHash(code), name: name || 'Player', score, id: deviceId() }) });
  }
  /** Called by the games when a score is set. Sends only if sharing is on and a board is joined; never throws. */
  function submit(game, score) {
    try {
      const s = state();
      if (!s.on || !s.code || !Number.isInteger(score) || score < 1) return;
      postScore(s.code, game, score, s.name).catch(() => {});
    } catch { /* a leaderboard problem never touches the game */ }
  }

  // ---- the panel
  const CSS = `
  .lb-btn { position: absolute; top: 6px; right: 6px; z-index: 30; width: 26px; height: 26px; padding: 0; border-radius: 13px; border: 1px solid rgba(255,255,255,.25); background: rgba(20,16,32,.7); color: #fff; font-size: 14px; line-height: 24px; cursor: pointer; opacity: 0; transition: opacity .2s; }
  .lb-btn.lb-show, .lb-btn:focus-visible { opacity: .9; }
  .lb-btn:hover { opacity: 1; }
  .lb { position: absolute; inset: 0; z-index: 40; overflow: auto; background: rgba(13,11,20,.97); color: #f1ecff; font: 12px/1.4 -apple-system, "Segoe UI", system-ui, sans-serif; padding: 10px 12px; box-sizing: border-box; text-align: left; user-select: text; }
  .lb h2 { margin: 0 0 6px; font-size: 14px; display: flex; align-items: center; justify-content: space-between; }
  .lb button, .lb select, .lb input[type=text] { font: inherit; padding: 4px 9px; border-radius: 8px; border: 1px solid rgba(255,255,255,.22); background: rgba(255,255,255,.07); color: #fff; }
  .lb button { cursor: pointer; font-weight: 700; } .lb button:hover { background: rgba(255,255,255,.16); }
  .lb .lb-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin: 6px 0; }
  .lb .lb-note { color: #b4abd0; font-size: 11px; } .lb .lb-err { color: #ff9a9a; }
  .lb .lb-code { font: 800 18px ui-monospace, Menlo, Consolas, monospace; letter-spacing: 3px; color: #ffd84d; }
  .lb table { width: 100%; border-collapse: collapse; margin-top: 6px; } .lb td, .lb th { padding: 2px 6px; text-align: left; border-bottom: 1px solid rgba(255,255,255,.08); }
  .lb td:last-child, .lb th:last-child { text-align: right; font-variant-numeric: tabular-nums; } .lb tr.lb-me td { color: #ffd84d; font-weight: 700; }
  .lb input[type=text] { width: 9em; } .lb .lb-switch { display: flex; gap: 8px; align-items: flex-start; }
  `;
  let styled = false;
  const ensureStyle = () => { if (styled) return; styled = true; const s = document.createElement('style'); s.textContent = CSS; document.head.append(s); };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  function openPanel(host, opts) {
    ensureStyle();
    const games = (typeof opts.games === 'function' ? opts.games() : opts.games) || [];
    if (!games.length) return () => {};
    let gi = Math.max(0, games.findIndex((g) => g.id === opts.current)), alive = true;
    const root = el('div', 'lb'); root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'Friends leaderboard');
    root.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') close(); });   // typing here must not steer the game
    root.addEventListener('keyup', (e) => e.stopPropagation());
    const close = () => { alive = false; root.remove(); try { host.focus(); } catch { /* host has no focus */ } };

    const head = el('h2'); head.append(el('span', '', '🏆 Friends leaderboard'));
    const x = el('button', '', '✕'); x.title = 'Close'; x.onclick = close; head.append(x);

    // 1. the switch and the explanation
    const sw = el('label', 'lb-switch'), box = el('input'); box.type = 'checkbox'; box.checked = state().on;
    const swText = el('span'); swText.append(el('b', '', 'Share my scores with friends'), el('br'));
    swText.append(el('span', 'lb-note', "Off until you turn it on. When on, and only after you join a board, the app sends: the game, your score, the display name you type below, and a random id made on this device (so your row updates instead of repeating). Nothing else: no account, no email, no IP address stored. Everyone with the board code can see the names and scores. Scores are on the honour system."));
    sw.append(box, swText);

    // 2. name and board
    const nameIn = el('input'); nameIn.type = 'text'; nameIn.maxLength = 20; nameIn.placeholder = 'Display name'; nameIn.value = state().name; nameIn.setAttribute('aria-label', 'Display name');
    const codeIn = el('input'); codeIn.type = 'text'; codeIn.maxLength = 12; codeIn.placeholder = 'Board code'; codeIn.autocapitalize = 'characters'; codeIn.setAttribute('aria-label', 'Board code');
    const createB = el('button', '', 'Create a board'), joinB = el('button', '', 'Join');
    const boardRow = el('div', 'lb-row'), joined = el('div', 'lb-row');
    const status = el('div', 'lb-note');
    const sel = el('select'); games.forEach((g, i) => sel.append(new Option(g.label, String(i), false, i === gi)));
    sel.onchange = () => { gi = Number(sel.value); load(); };
    const refresh = el('button', '', 'Refresh'); refresh.onclick = () => load();
    const tableHost = el('div');

    const say = (msg, err) => { status.textContent = msg || ''; status.className = 'lb-note' + (err ? ' lb-err' : ''); };
    const saveName = () => store.set('name', cleanName(nameIn.value));

    function drawBoard() {
      const s = state();
      boardRow.replaceChildren(); joined.replaceChildren();
      if (s.code) {
        const c = el('span', 'lb-code', s.code), share = el('button', '', 'Share this code'), leave = el('button', '', 'Leave');
        share.onclick = async () => { try { await navigator.clipboard.writeText(s.code); say('Code copied. Send it to your friends: they press Join and type it.'); } catch { say(`Your board code is ${s.code}. Tell your friends to press Join and type it.`); } };
        leave.onclick = () => { store.set('code', ''); say('You left the board. Nothing more will be sent.'); drawBoard(); tableHost.replaceChildren(); };
        joined.append(el('span', '', 'Board:'), c, share, leave);
        boardRow.append(el('span', 'lb-note', 'Your name here:'), nameIn);
      } else {
        boardRow.append(nameIn, codeIn, joinB, el('span', 'lb-note', 'or'), createB);
      }
    }
    const enter = async (code) => {
      saveName();
      store.set('code', code); drawBoard();
      say(box.checked ? 'Joined.' : 'Joined. Turn on "Share my scores" above to send yours; you can already see the table.');
      const g = games[gi], b = g.best && g.best();
      if (box.checked && Number.isInteger(b) && b >= 1) await postScore(code, g.id, b, cleanName(nameIn.value));   // put the score you already have on the board
      load();
    };
    joinB.onclick = () => { const c = normalizeCode(codeIn.value); if (!c) { say('A board code is 6 letters and numbers, like K7M2QX.', true); return; } enter(c); };
    createB.onclick = () => { enter(newCode()); };
    box.onchange = () => {
      store.set('on', box.checked);
      if (box.checked && !state().code) say('Sharing is on, but nothing is sent until you create or join a board.');
      else say(box.checked ? 'Sharing is on for this board.' : 'Sharing is off. Nothing will be sent.');
    };
    nameIn.onchange = () => { saveName(); const s = state(), g = games[gi], b = g.best && g.best(); if (s.on && s.code && Number.isInteger(b) && b >= 1) postScore(s.code, g.id, b, s.name); };

    async function load() {
      const s = state(), g = games[gi];
      tableHost.replaceChildren();
      if (!s.code) { say('Create a board and share its code, or join a friend\'s board, to see the top 20 for this game.'); return; }
      say('Loading…');
      const r = await fetchTop(s.code, g.id);
      if (!alive) return;
      if (!r.ok) { say(r.error, true); return; }
      const top = (r.json && r.json.top) || [];
      say(top.length ? '' : 'No scores here yet. Be the first' + (s.on ? '.' : ': turn on sharing above, then play.'));
      if (!top.length) return;
      const t = el('table'), hr = t.insertRow();
      ['#', 'Name', 'Day', g.label.length > 18 ? 'Score' : g.label].forEach((h) => hr.append(Object.assign(el('th'), { textContent: h })));
      top.forEach((e, i) => {
        const tr = t.insertRow(); if (s.name && e.name === s.name) tr.className = 'lb-me';
        [String(i + 1), e.name, e.at, fmtScore(e.score, g.kind)].forEach((v) => { tr.insertCell().textContent = v; });
      });
      tableHost.append(t);
    }

    root.append(head, sw, boardRow, joined, el('div', 'lb-row'), status, (() => { const r = el('div', 'lb-row'); if (games.length > 1) r.append(sel); r.append(refresh); return r; })(), tableHost);
    drawBoard(); host.append(root); load();
    return close;
  }

  /** A small 🏆 button in the corner of `host` that opens the panel. It is invisible until the mouse moves over the game, so it never covers play. */
  function button(host, opts) {
    ensureStyle();
    try { if (getComputedStyle(host).position === 'static') host.style.position = 'relative'; } catch { /* detached */ }
    const b = el('button', 'lb-btn', '🏆'); b.type = 'button'; b.title = 'Friends leaderboard'; b.setAttribute('aria-label', 'Friends leaderboard');
    let hide = 0;
    const show = () => { b.classList.add('lb-show'); clearTimeout(hide); hide = setTimeout(() => b.classList.remove('lb-show'), 2500); };
    b.addEventListener('mousedown', (e) => e.stopPropagation());
    b.onclick = (e) => { e.stopPropagation(); if (!host.querySelector('.lb')) openPanel(host, opts); };
    host.addEventListener('mousemove', show);
    host.append(b);
    return () => { clearTimeout(hide); host.removeEventListener('mousemove', show); b.remove(); const p = host.querySelector('.lb'); if (p) p.remove(); };
  }

  const api = { button, submit, open: openPanel, _t: { newCode, normalizeCode, cleanName, fmtScore, boardHash, ALPHABET, BASE } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.NotchLeaderboard = api;
})();
