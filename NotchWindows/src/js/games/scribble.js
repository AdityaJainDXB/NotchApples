// Scribble for the Games tab, shared by the Mac and Windows apps: draw a word for the others to guess, and guess what they draw. Up to
// 10 players, with computer players if you like (they draw simple pictures and guess honestly from the letters shown), alone, or online in
// a room over the same live relay Capture the Flag and Rocket League use. The rules are in scribble-logic.js.
//
//   window.NotchScribbleGame.mount(hostElement, opts)  starts the game; returns a function that stops it.
//        opts (optional): { room: 'ABC234', host: true|false, name: 'Ada' } joins that online room at once (friend chats and rooms use
//        this: the one who invited is the host, everyone else joins as a guest).
//   window.NotchScribbleGame.key(k, down)               a key sent in from outside the page (the Mac app forwards its keys this way).
//   window.NotchScribbleGame.suspend() / resume()       the notch closed / opened: nothing keeps running.
//
// Online: the host runs the game and tells everybody the state a few times a second; the drawer sends their strokes straight to
// everybody. The relay shows every message to everybody in the room, so the things only one person may know (the word to draw, and
// your own guesses) travel encrypted between that player and the host (a key agreed with ECDH when they join).
(function () {
  'use strict';
  const L = window.NotchScribbleLogic;
  const RELAY = 'wss://notchapple-rooms.adityajain1225.workers.dev';
  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const COLORS = ['#222222', '#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa', '#6d4c41', '#ec407a'];
  const SIZES = [4, 9, 18];
  const LEVELS = [{ id: 0.4, name: 'Easy' }, { id: 0.65, name: 'Normal' }, { id: 0.9, name: 'Hard' }];
  const BOT_NAMES = ['Ada', 'Rex', 'Mika', 'Zed', 'Lia', 'Kai', 'Nova', 'Bo', 'Fin', 'Sky'];

  const store = {
    get(k, d) { try { const v = localStorage.getItem('scribble.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('scribble.' + k, JSON.stringify(v)); } catch { /* storage off */ } },
  };
  const newCode = () => Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  const normCode = (raw) => { const c = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); return c.length === 6 && [...c].every((ch) => CODE_CHARS.includes(ch)) ? c : null; };
  const clean = (t, n = 14) => String(t == null ? '' : t).replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const newId = () => [...crypto.getRandomValues(new Uint8Array(4))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const clock = (t) => `${Math.floor(t / 60)}:${String(Math.max(0, t) % 60).padStart(2, '0')}`;
  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  /// A link to a room on the relay (its own rooms, so Scribble never meets another game).
  class Link {
    constructor(onMessage, onState) { this.onMessage = onMessage; this.onState = onState; this.ws = null; this.state = 'off'; this.retry = 0; this.want = false; this.timer = 0; }
    async join(code) {
      this.close();
      const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`notchapple-scribble-v1|${code}`)));
      this.topic = `notchapple-v1-${[...h.slice(0, 20)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
      this.want = true; this._open();
    }
    _open() {
      if (!this.want) return;
      this._set('connecting');
      let ws; try { ws = new WebSocket(`${RELAY}/${this.topic}/ws`); } catch { this._set('failed'); return; }
      this.ws = ws;
      ws.onmessage = (e) => { let m; try { m = JSON.parse(typeof e.data === 'string' ? e.data : ''); } catch { return; } if (m && m.event === 'open') { this.retry = 0; this._set('on'); return; } if (m && typeof m.t === 'string') this.onMessage(m); };
      ws.onclose = () => { if (this.ws !== ws) return; this.ws = null; if (!this.want) return; this._set('connecting'); this.timer = setTimeout(() => this._open(), Math.min(8000, 1000 * 2 ** this.retry++)); };
      ws.onerror = () => { /* onclose follows */ };
    }
    send(o) { if (this.ws && this.state === 'on') { try { this.ws.send(JSON.stringify(o)); return true; } catch { return false; } } return false; }
    close() { this.want = false; clearTimeout(this.timer); if (this.ws) { const w = this.ws; this.ws = null; try { w.close(); } catch { /* closed */ } } this._set('off'); }
    _set(s) { if (this.state !== s) { this.state = s; this.onState && this.onState(s); } }
  }

  // ---- private messages: a key agreed between each player and the host --------------------------------------------------
  const ECDH = { name: 'ECDH', namedCurve: 'P-256' };
  async function makeKeys() {
    const k = await crypto.subtle.generateKey(ECDH, true, ['deriveKey']);
    const jwk = await crypto.subtle.exportKey('jwk', k.publicKey);
    return { priv: k.privateKey, pub: { x: jwk.x, y: jwk.y } };
  }
  async function sharedKey(priv, pub) {
    const theirs = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: pub.x, y: pub.y, ext: true }, ECDH, false, []);
    return crypto.subtle.deriveKey({ name: 'ECDH', public: theirs }, priv, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function seal(key, obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    return { iv: b64(iv), ct: b64(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)))) };
  }
  async function open(key, m) {
    try { return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(m.iv) }, key, unb64(m.ct)))); } catch { return null; }
  }

  const CSS = `
  .sc { position: relative; width: 100%; height: 100%; overflow: hidden; background: #10131c; color: #fff; font: 13px/1.35 -apple-system, "Segoe UI", system-ui, sans-serif; user-select: none; outline: none; display: flex; flex-direction: column; }
  .sc .bar { display: flex; align-items: center; gap: 12px; padding: 6px 12px 6px 64px; background: #171c29; min-height: 34px; }
  .sc .bar .hint { flex: 1; text-align: center; font-size: 20px; font-weight: 700; letter-spacing: 3px; white-space: pre; overflow: hidden; text-overflow: ellipsis; }
  .sc .bar .hint small { display: block; font-size: 10px; font-weight: 500; letter-spacing: 0; color: #9aa6bd; }
  .sc .bar .time { font: 700 16px ui-monospace, Menlo, monospace; min-width: 38px; text-align: right; }
  .sc .bar .round { color: #9aa6bd; font-size: 12px; min-width: 70px; }
  .sc .main { flex: 1; min-height: 0; display: flex; }
  .sc .left { flex: 1; min-width: 0; display: flex; flex-direction: column; padding: 8px; gap: 6px; }
  .sc .stage { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; }
  .sc canvas { background: #fff; border-radius: 8px; touch-action: none; cursor: crosshair; box-shadow: 0 2px 10px rgba(0,0,0,.4); }
  .sc .tools { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; min-height: 28px; justify-content: center; }
  .sc .tools .c { width: 22px; height: 22px; border-radius: 50%; border: 2px solid transparent; padding: 0; cursor: pointer; }
  .sc .tools .c.on { border-color: #fff; box-shadow: 0 0 0 2px #4da3ff; }
  .sc .tools .s { width: 26px; height: 26px; border-radius: 6px; background: rgba(255,255,255,.1); padding: 0; display: flex; align-items: center; justify-content: center; cursor: pointer; border: 0; }
  .sc .tools .s.on { background: rgba(255,255,255,.3); }
  .sc .tools .s i { display: block; border-radius: 50%; background: #fff; }
  .sc .side { width: 210px; display: flex; flex-direction: column; background: #151a26; border-left: 1px solid rgba(255,255,255,.07); min-height: 0; }
  .sc .players { padding: 6px 8px; display: flex; flex-direction: column; gap: 2px; max-height: 42%; overflow: auto; }
  .sc .pl { display: flex; align-items: center; gap: 6px; padding: 2px 4px; border-radius: 6px; font-size: 12px; }
  .sc .pl.draw { background: rgba(77,163,255,.2); } .sc .pl.got { color: #7be07b; } .sc .pl b { margin-left: auto; font-variant-numeric: tabular-nums; }
  .sc .chat { flex: 1; min-height: 0; overflow: auto; padding: 6px 8px; font-size: 12px; display: flex; flex-direction: column; gap: 2px; user-select: text; }
  .sc .chat .m-sys { color: #9aa6bd; } .sc .chat .m-right { color: #7be07b; font-weight: 600; } .sc .chat .name { color: #9fb6ff; }
  .sc .say { display: flex; gap: 4px; padding: 6px; border-top: 1px solid rgba(255,255,255,.07); }
  .sc .say input { flex: 1; min-width: 0; font: inherit; color: #fff; background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.18); border-radius: 8px; padding: 6px 8px; user-select: text; }
  .sc button { font: inherit; color: #fff; background: rgba(255,255,255,.12); border: 0; border-radius: 9px; padding: 6px 12px; cursor: pointer; }
  .sc button:hover { background: rgba(255,255,255,.2); } .sc button.go { background: linear-gradient(135deg,#4da3ff,#c06bff); font-weight: 600; } .sc button.on { outline: 2px solid #fff; }
  .sc .menu { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; background: rgba(10,13,22,.9); text-align: center; padding: 12px; z-index: 5; overflow: auto; }
  .sc .menu[hidden], .sc .leave[hidden] { display: none; }
  .sc h2 { margin: 0; font-size: 22px; } .sc p { margin: 0; color: #aab4c4; max-width: 470px; }
  .sc .row { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; align-items: center; }
  .sc .menu input { font: inherit; color: #fff; background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.2); border-radius: 8px; padding: 6px 9px; width: 110px; text-align: center; text-transform: uppercase; letter-spacing: 2px; }
  .sc .menu input.nm { text-transform: none; letter-spacing: 0; width: 130px; }
  .sc .code { font-size: 26px; letter-spacing: 6px; font-weight: 700; } .sc .small { font-size: 11px; color: #8d98aa; }
  .sc .words { display: flex; gap: 8px; } .sc .leave { position: absolute; left: 6px; top: 6px; opacity: .45; padding: 3px 9px; font-size: 11px; z-index: 6; } .sc .leave:hover { opacity: 1; }
  .sc .lobby { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; max-width: 440px; }
  .sc .lobby span { background: rgba(255,255,255,.1); border-radius: 12px; padding: 3px 10px; }
  `;

  function mount(host, opts = {}) {
    const style = document.createElement('style'); style.textContent = CSS;
    const root = document.createElement('div'); root.className = 'sc'; root.tabIndex = 0;
    root.innerHTML = `<div class="bar"><span class="round"></span><span class="hint"></span><span class="time"></span></div>
      <div class="main"><div class="left"><div class="stage"><canvas width="1000" height="750"></canvas></div><div class="tools"></div></div>
      <div class="side"><div class="players"></div><div class="chat"></div><div class="say"><input maxlength="60" placeholder="Type your guess" autocomplete="off" spellcheck="false"><button>Send</button></div></div></div>`;
    const menu = document.createElement('div'); menu.className = 'menu';
    const leave = document.createElement('button'); leave.className = 'leave'; leave.textContent = '← Menu'; leave.hidden = true;
    root.append(style, menu, leave); host.innerHTML = ''; host.append(root);
    const $ = (s) => root.querySelector(s);
    const canvas = $('canvas'), ctx = canvas.getContext('2d'), input = $('.say input'), chatEl = $('.chat'), playersEl = $('.players'), toolsEl = $('.tools');

    const myId = newId();
    let myName = clean(opts.name || store.get('name', ''), 14) || 'Player';
    let alive = true, raf = 0, ticker = 0, hostTimer = 0, pingTimer = 0;
    let mode = 'menu';                                  // menu | solo | host | guest | waiting-host (joining) | waiting-guest (hosting, in the lobby)
    let link = null, g = null, v = null, hostInfo = null, keysMine = null;
    const pubs = {}, shared = {}, lastSeen = {}, sentFor = {};
    let strokes = [], dirty = true, chat = [], chatSig = '', playersSig = '';
    let myWord = null, myChoices = null, lastSeenState = 0, lastBroadcast = 0, lastT = Date.now();
    let level = store.get('level', 0.65), botCount = store.get('bots', 3), color = COLORS[0], size = SIZES[1], eraser = false;
    let drawing = null, inkSeq = 0, pending = [], flushAt = 0;

    // ---------- menus
    const showMenu = (html, wire) => { menu.dataset.lobby = ''; menu.innerHTML = html; menu.hidden = false; leave.hidden = mode === 'menu'; if (wire) wire(menu); };
    function mainMenu() {
      stopAll(); mode = 'menu'; g = null; v = null; leave.hidden = true; strokes = []; chat = []; dirty = true;
      showMenu(`<h2>✏️ Scribble</h2><p>Draw the word you are given and the others guess it; guess what they draw. The faster you guess, the more you score. Three rounds.</p>
        <div class="row"><b>Your name</b><input class="nm" data-name maxlength="14" value="${esc(myName)}"></div>
        <div class="row"><b>Computers</b>${[0, 1, 2, 3, 4, 5].map((n) => `<button data-bots="${n}" class="${n === botCount ? 'on' : ''}">${n}</button>`).join('')}</div>
        <div class="row"><b>Level</b>${LEVELS.map((l) => `<button data-lv="${l.id}" class="${l.id === level ? 'on' : ''}">${l.name}</button>`).join('')}</div>
        <div class="row"><button class="go" data-a="solo">Play with the computers</button></div>
        <div class="row"><button data-a="create">Create online room</button><input data-in maxlength="7" placeholder="CODE"><button data-a="join">Join</button></div>
        <p class="small">Online you can add computer players too. The one who creates the room starts the game.</p>`, (el) => {
        const name = () => { myName = clean(el.querySelector('[data-name]').value, 14) || 'Player'; store.set('name', myName); };
        el.querySelectorAll('[data-bots]').forEach((b) => b.onclick = () => { name(); botCount = +b.dataset.bots; store.set('bots', botCount); mainMenu(); });
        el.querySelectorAll('[data-lv]').forEach((b) => b.onclick = () => { name(); level = +b.dataset.lv; store.set('level', level); mainMenu(); });
        el.querySelector('[data-a=solo]').onclick = () => { name(); startSolo(); };
        el.querySelector('[data-a=create]').onclick = () => { name(); startOnline(newCode(), true); };
        el.querySelector('[data-a=join]').onclick = () => { name(); const c = normCode(el.querySelector('[data-in]').value); if (c) startOnline(c, false); else el.querySelector('[data-in]').style.borderColor = '#ff6b5d'; };
      });
    }
    function stopAll() { clearInterval(ticker); clearInterval(hostTimer); clearInterval(pingTimer); ticker = hostTimer = pingTimer = 0; if (link) { try { link.send({ t: 'bye', id: myId }); } catch { /* gone */ } link.close(); link = null; } }

    // ---------- starting
    function newHostGame() {
      g = L.newGame(); L.addPlayer(g, { id: myId, name: myName });
      strokes = []; chat = []; v = L.publicState(g); myWord = null; myChoices = null; lastT = Date.now();
      clearInterval(ticker); ticker = setInterval(tickHost, 100);
    }
    function addBots(n) {
      const names = BOT_NAMES.filter((b) => !Object.values(g.players).some((p) => p.name === b)).sort(() => Math.random() - 0.5);
      for (let i = 0; i < n; i++) L.addPlayer(g, { id: `bot-${newId()}`, name: names[i] || `Bot${i}`, bot: true, skill: level });
    }
    function startSolo() {
      stopAll(); mode = 'solo'; newHostGame();
      if (botCount < 1) botCount = 1;
      addBots(botCount); L.startGame(g); drain(); menu.hidden = true; leave.hidden = false; root.focus();
    }
    async function startOnline(code, asHost) {
      stopAll(); mode = asHost ? 'waiting-guest' : 'waiting-host'; v = null; chat = []; strokes = [];
      try { keysMine = await makeKeys(); } catch { showMenu('<h2>Not available</h2><p>This window cannot do the encryption online play needs. You can still play with the computers.</p><div class="row"><button data-a="back">Back</button></div>', (el) => { el.querySelector('[data-a=back]').onclick = mainMenu; }); return; }
      if (!alive) return;
      link = new Link(onMessage, (s) => { if (s === 'failed') showMenu('<h2>No connection</h2><p>Could not reach the game server. You can still play with the computers.</p><div class="row"><button data-a="back">Back</button></div>', (el) => { el.querySelector('[data-a=back]').onclick = mainMenu; }); });
      link.join(code); roomCode = code;
      if (asHost) { newHostGame(); mode = 'waiting-guest'; hostTimer = setInterval(() => link && link.send({ t: 'host', id: myId, name: myName, pub: keysMine.pub }), 1500); lobby(); }
      else { hostTimer = setInterval(() => link && link.send({ t: 'join', id: myId, name: myName, pub: keysMine.pub }), 1500); joining(); }
    }
    let roomCode = '', lobbySig = '';
    function joining() { showMenu(`<h2>Joining ${esc(roomCode)}…</h2><p>Waiting for the host.</p><div class="row"><button data-a="back">Back</button></div>`, (el) => { el.querySelector('[data-a=back]').onclick = mainMenu; }); }
    function lobby() {
      if (mode !== 'waiting-guest') return;
      const sig = Object.values(g.players).map((p) => p.id + p.name).join('|');
      if (sig === lobbySig && menu.dataset.lobby === '1' && !menu.hidden) return;                 // nothing changed: leave the buttons where they are
      lobbySig = sig;
      const names = Object.values(g.players).map((p) => `<span>${p.bot ? '🤖 ' : ''}${esc(p.name)}</span>`).join('');
      showMenu(`<h2>Online room</h2><div class="code">${esc(roomCode)}</div><p>Give this code to friends. They choose “Join”. Up to ${L.MAX_PLAYERS} can play.</p><div class="lobby">${names}</div>
        <div class="row"><button data-a="bot">Add a computer</button><button class="go" data-a="start">Start the game</button></div><div class="row"><button data-a="back">Back</button></div>`, (el) => {
        el.querySelector('[data-a=bot]').onclick = () => { addBots(1); lobby(); broadcastState(); };
        el.querySelector('[data-a=start]').onclick = () => { if (Object.keys(g.players).length < 2) { addBots(1); } for (const id of Object.keys(g.players)) lastSeen[id] = Date.now(); L.startGame(g); mode = 'host'; menu.hidden = true; leave.hidden = false; root.focus(); drain(); broadcastState(); };
        el.querySelector('[data-a=back]').onclick = mainMenu;
      });
      menu.dataset.lobby = '1';
    }
    function endOnline(text) {
      stopAll(); mode = 'menu'; g = null; v = null;
      showMenu(`<h2>Game over</h2><p>${esc(text)}</p><div class="row"><button class="go" data-a="back">Menu</button></div>`, (el) => { el.querySelector('[data-a=back]').onclick = mainMenu; });
    }

    // ---------- the game on the host's side (also the whole game when playing alone)
    const isHost = () => mode === 'solo' || mode === 'host' || mode === 'waiting-guest';
    const send = (o) => { if (link) link.send(o); };
    async function toPlayer(id, obj) {
      if (id === myId) return handlePrivate(myId, obj);
      const key = shared[id]; if (!key || !link) return;
      send({ t: 'p', to: id, from: myId, ...(await seal(key, obj)) });
    }
    function log(k, text, name) { chat.push({ k, text, name }); if (chat.length > 80) chat.shift(); }
    function applyInk(e) {
      let s = e.cont ? strokes.find((x) => x.sid === e.sid) : null;
      if (!s) { s = { sid: e.sid, color: e.color || '#222', size: e.size || 6, pts: [] }; strokes.push(s); }
      for (const p of e.pts || []) s.pts.push(p);
      dirty = true;
    }
    function drain() {
      for (const e of g.events.splice(0)) {
        if (e.e === 'sys') { log('sys', e.text); send({ t: 'c', k: 'sys', text: e.text }); }
        else if (e.e === 'chat') {
          if (e.close) { const t = `${e.name} is close!`; log('sys', t); send({ t: 'c', k: 'sys', text: t }); }
          else { log('chat', e.text, e.name); send({ t: 'c', k: 'chat', text: e.text, name: e.name }); }
        } else if (e.e === 'right') { const t = `${e.name} guessed the word! (+${e.points})`; log('right', t); send({ t: 'c', k: 'right', text: t }); }
        else if (e.e === 'clear') { strokes = []; dirty = true; send({ t: 'clear', from: myId }); }
        else if (e.e === 'ink') { applyInk(e); send({ t: 'ink', from: myId, sid: e.sid, color: e.color, size: e.size, pts: e.pts, cont: e.cont }); }
        else if (e.e === 'hint' || e.e === 'turn-end' || e.e === 'over') lastBroadcast = 0;
      }
    }
    function broadcastState() { lastBroadcast = Date.now(); if (g) { v = L.publicState(g); send({ t: 's', s: v }); } }
    function tickHost() {
      if (!g || !alive) return;
      const now = Date.now(), dt = Math.min(1, (now - lastT) / 1000); lastT = now;
      L.step(g, dt);
      drain();
      v = L.publicState(g);
      // the things only one player may know
      const turnKey = `${g.round}.${g.turn}`;
      if (g.phase === 'choosing' && sentFor.choose !== turnKey) { sentFor.choose = turnKey; const d = g.players[g.drawer]; if (d && !d.bot) toPlayer(g.drawer, { k: 'choose', choices: g.choices }); }
      if (g.phase === 'drawing' && sentFor.word !== turnKey) { sentFor.word = turnKey; const d = g.players[g.drawer]; if (d && !d.bot) toPlayer(g.drawer, { k: 'word', w: g.word }); }
      if (g.phase !== 'choosing' && g.phase !== 'drawing') { if (g.drawer === myId) { myWord = null; myChoices = null; } }
      if (mode === 'host' && now - lastBroadcast > 400) broadcastState();
      if (mode === 'host') for (const p of Object.values(g.players)) if (!p.bot && p.id !== myId && now - (lastSeen[p.id] || now) > 25000) { L.removePlayer(g, p.id); delete pubs[p.id]; delete shared[p.id]; broadcastState(); }
      if (mode === 'waiting-guest') { const sig = Object.values(g.players).map((p) => p.id + p.name).join('|'); if (sig !== lobbySig) { lobbySig = sig; lobby(); } }
      if (g.phase === 'over' && menu.hidden) overMenu();
    }
    function overMenu() {
      const rank = Object.values(g.players).sort((a, b) => b.score - a.score);
      showMenu(`<h2>🏆 ${esc(rank[0] ? rank[0].name : '')} wins!</h2><div class="lobby" style="flex-direction:column;align-items:center">${rank.map((p, i) => `<span>${i + 1}. ${p.bot ? '🤖 ' : ''}${esc(p.name)} · ${p.score}</span>`).join('')}</div>
        <div class="row"><button class="go" data-a="again">Play again</button><button data-a="back">Menu</button></div>`, (el) => {
        el.querySelector('[data-a=again]').onclick = () => { strokes = []; chat = []; L.startGame(g); menu.hidden = true; drain(); broadcastState(); };
        el.querySelector('[data-a=back]').onclick = () => { if (link) { try { link.send({ t: 'bye', id: myId }); } catch { /* gone */ } } mainMenu(); };
      });
    }
    /// A guess typed by player `id` (on the host, or sent to it privately).
    function hearGuess(id, text) {
      text = clean(text, 60); if (!text || !g) return;
      const r = L.guess(g, id, text);
      if (r.result === 'ignored') {                           // not a guess: the drawer, someone who already has it, or between turns: it is just talk, unless it gives the word away
        const p = g.players[id];
        if (p && !(id === g.drawer && g.phase === 'drawing') && !(g.word && L.normalize(text).includes(g.word))) { log('chat', text, p.name); send({ t: 'c', k: 'chat', text, name: p.name }); }
      }
      drain(); if (isHost() && mode === 'host') broadcastState();
    }

    // ---------- messages from the room
    async function onMessage(m) {
      if (!alive) return;
      const t = m.t;
      const who = clean(m.from || m.id, 12);
      if (isHost() && who && g && g.players[who] && who !== myId) lastSeen[who] = Date.now();   // any message from a player shows they are still there
      if (t === 'host' && mode === 'waiting-host' && m.id !== myId && m.pub) { link.send({ t: 'join', id: myId, name: myName, pub: keysMine.pub }); return; }
      if (t === 'join' && isHost() && g && m.id !== myId && m.pub && m.pub.x && m.pub.y) {
        const id = clean(m.id, 12);
        if (!g.players[id]) { if (!L.addPlayer(g, { id, name: clean(m.name) || 'Guest' })) return; log('sys', `${clean(m.name)} joined.`); drain(); }
        pubs[id] = m.pub; lastSeen[id] = Date.now();
        try { shared[id] = await sharedKey(keysMine.priv, m.pub); } catch { return; }
        send({ t: 'welcome', to: id, host: { id: myId, name: myName, pub: keysMine.pub } });
        if (mode === 'waiting-guest') lobby();
        broadcastState();
        return;
      }
      if (t === 'welcome' && mode !== 'guest' && m.to === myId && m.host && m.host.pub && (mode === 'waiting-host')) {
        hostInfo = { id: clean(m.host.id, 12), name: clean(m.host.name), pub: m.host.pub };
        try { shared[hostInfo.id] = await sharedKey(keysMine.priv, hostInfo.pub); } catch { return; }
        clearInterval(hostTimer); mode = 'guest'; lastSeenState = Date.now();
        showMenu(`<h2>Joined ${esc(roomCode)}</h2><p>Waiting for ${esc(hostInfo.name)} to start the game.</p><div class="row"><button data-a="back">Leave</button></div>`, (el) => { el.querySelector('[data-a=back]').onclick = () => { send({ t: 'bye', id: myId }); mainMenu(); }; });
        leave.hidden = false;
        pingTimer = setInterval(() => link && link.send({ t: 'ping', id: myId }), 2500);
        link.send({ t: 'needink', id: myId });
        return;
      }
      if (t === 's' && mode === 'guest' && m.s && Array.isArray(m.s.pl)) {
        const was = v; v = m.s; lastSeenState = Date.now();
        if (v.ph !== 'lobby' && !menu.hidden && v.ph !== 'over') { menu.hidden = true; root.focus(); }
        if (v.ph === 'over' && menu.hidden) {
          const rank = v.pl.slice().sort((a, b) => b[2] - a[2]);
          showMenu(`<h2>🏆 ${esc(rank[0] ? rank[0][1] : '')} wins!</h2><div class="lobby" style="flex-direction:column;align-items:center">${rank.map((p, i) => `<span>${i + 1}. ${p[4] ? '🤖 ' : ''}${esc(p[1])} · ${p[2]}</span>`).join('')}</div><p class="small">The host can start another game.</p><div class="row"><button data-a="back">Leave</button></div>`, (el) => { el.querySelector('[data-a=back]').onclick = () => { send({ t: 'bye', id: myId }); mainMenu(); }; });
        }
        if (!was || was.dr !== v.dr || (was.ph !== v.ph && v.ph === 'choosing')) { if (v.dr !== myId) { myWord = null; myChoices = null; } }
        if (v.ph === 'reveal' || v.ph === 'over') { myWord = null; myChoices = null; }
        return;
      }
      if (t === 'c' && typeof m.text === 'string' && !isHost()) { log(m.k === 'chat' ? 'chat' : m.k === 'right' ? 'right' : 'sys', clean(m.text, 80), m.k === 'chat' ? clean(m.name) : undefined); return; }
      const from = clean(m.from, 12);
      const drawerNow = isHost() ? (g && g.drawer) : (v && v.dr);
      if (t === 'ink' && Array.isArray(m.pts) && (from === drawerNow || (hostInfo && from === hostInfo.id)) && from !== myId) {
        const pts = m.pts.slice(0, 60).map((p) => [Math.min(1000, Math.max(0, +p[0] || 0)), Math.min(750, Math.max(0, +p[1] || 0))]);
        applyInk({ sid: clean(m.sid, 24), color: /^#[0-9a-f]{6}$/i.test(m.color) ? m.color : '#222222', size: Math.min(40, Math.max(2, +m.size || 6)), pts, cont: !!m.cont });
        return;
      }
      if (t === 'clear' && (from === drawerNow || (hostInfo && from === hostInfo.id)) && from !== myId) { strokes = []; dirty = true; return; }
      if (t === 'undo' && from === drawerNow && from !== myId) { strokes.pop(); dirty = true; return; }
      if (t === 'needink' && isHost() && mode === 'host' && g) { sendInkLog(clean(m.id, 12)); return; }
      if (t === 'inklog' && m.to === myId && Array.isArray(m.strokes) && !isHost()) { if (m.first) strokes = []; for (const s of m.strokes.slice(0, 40)) applyInk({ ...s, cont: false, pts: (s.pts || []).slice(0, 400) }); return; }
      if (t === 'ping' && isHost()) { lastSeen[clean(m.id, 12)] = Date.now(); return; }
      if (t === 'bye') {
        const id = clean(m.id, 12);
        if (isHost() && g && g.players[id] && id !== myId) { L.removePlayer(g, id); delete shared[id]; delete pubs[id]; drain(); if (mode === 'waiting-guest') lobby(); else broadcastState(); }
        else if (mode === 'guest' && hostInfo && id === hostInfo.id) endOnline('The host left the game.');
        return;
      }
      if (t === 'p' && m.to === myId && m.iv && m.ct) {
        const key = shared[from]; if (!key) return;
        const obj = await open(key, m); if (!obj) return;
        handlePrivate(from, obj);
      }
    }
    function sendInkLog(to) {
      if (!to || !shared[to] && !pubs[to]) return;
      let batch = [], size = 0, first = true;
      const flush = () => { if (batch.length || first) { send({ t: 'inklog', to, strokes: batch, first }); first = false; batch = []; size = 0; } };
      for (const s of strokes) { const len = JSON.stringify(s).length; if (size + len > 11000 && batch.length) flush(); batch.push(s.pts.length > 400 ? { ...s, pts: s.pts.slice(0, 400) } : s); size += len; }
      flush();
    }
    /// Something sent only to me (already decrypted): on the host, a guess or a choice; on a guest, the word or my choices.
    function handlePrivate(from, o) {
      if (from === myId) {                                      // the host telling itself (it is the drawer): my words, or my word
        if (o.k === 'choose' && Array.isArray(o.choices)) { myChoices = o.choices.slice(0, 3); myWord = null; }
        else if (o.k === 'word' && typeof o.w === 'string') { myWord = o.w; myChoices = null; }
        return;
      }
      if (isHost() && g) {
        if (o.k === 'guess' && typeof o.text === 'string') hearGuess(from, o.text);
        else if (o.k === 'pick' && typeof o.w === 'string') { L.chooseWord(g, from, o.w); drain(); broadcastState(); }
      } else if (hostInfo && from === hostInfo.id) {
        if (o.k === 'choose' && Array.isArray(o.choices)) { myChoices = o.choices.slice(0, 3).map((w) => clean(w, 20)); myWord = null; }
        else if (o.k === 'word' && typeof o.w === 'string') { myWord = clean(o.w, 20); myChoices = null; }
      }
    }

    // ---------- what I do
    const imDrawing = () => (isHost() ? g && g.drawer === myId : v && v.dr === myId);
    const phase = () => (isHost() ? (g ? g.phase : 'lobby') : (v ? v.ph : 'lobby'));
    function submit() {
      const text = clean(input.value, 60); input.value = '';
      if (!text) return;
      if (isHost()) hearGuess(myId, text);
      else if (hostInfo && shared[hostInfo.id]) toPlayer2(hostInfo.id, { k: 'guess', text });
    }
    async function toPlayer2(id, obj) { const key = shared[id]; if (!key || !link) return; link.send({ t: 'p', to: id, from: myId, ...(await seal(key, obj)) }); }
    function pick(w) {
      if (isHost()) { L.chooseWord(g, myId, w); myChoices = null; myWord = w; drain(); if (mode === 'host') broadcastState(); }
      else if (hostInfo) { toPlayer2(hostInfo.id, { k: 'pick', w }); myChoices = null; }
    }
    $('.say button').onclick = submit;
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    input.addEventListener('keyup', (e) => e.stopPropagation());
    leave.onclick = () => { if (link) { try { link.send({ t: 'bye', id: myId }); } catch { /* gone */ } } mainMenu(); };

    // drawing with the mouse or a finger
    const toCanvas = (e) => { const r = canvas.getBoundingClientRect(); return [Math.round(Math.min(1000, Math.max(0, ((e.clientX - r.left) / r.width) * 1000))), Math.round(Math.min(750, Math.max(0, ((e.clientY - r.top) / r.height) * 750)))]; };
    function emitInk(sid, pts, cont) {
      const e = { sid, color: eraser ? '#ffffff' : color, size: eraser ? 26 : size, pts, cont };
      if (isHost()) { if (mode === 'host') send({ t: 'ink', from: myId, ...e }); }
      else send({ t: 'ink', from: myId, ...e });
    }
    function flushInk(force) {
      if (!drawing || !pending.length) return;
      if (!force && Date.now() < flushAt) return;
      emitInk(drawing.sid, pending.splice(0, 40), drawing.sent); drawing.sent = true; flushAt = Date.now() + 50;
    }
    canvas.addEventListener('pointerdown', (e) => {
      root.focus();
      if (!imDrawing() || phase() !== 'drawing') return;
      canvas.setPointerCapture(e.pointerId);
      const p = toCanvas(e); drawing = { sid: `${myId}-${++inkSeq}`, sent: false };
      applyInk({ sid: drawing.sid, color: eraser ? '#ffffff' : color, size: eraser ? 26 : size, pts: [p, p], cont: false }); pending = [p, p]; flushInk(true);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      const p = toCanvas(e), s = strokes.find((x) => x.sid === drawing.sid), last = s && s.pts[s.pts.length - 1];
      if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 3) return;
      applyInk({ sid: drawing.sid, pts: [p], cont: true }); pending.push(p); flushInk(false);
    });
    const endStroke = () => { if (drawing) { flushInk(true); drawing = null; pending = []; } };
    canvas.addEventListener('pointerup', endStroke); canvas.addEventListener('pointercancel', endStroke);
    function undo() { if (!imDrawing()) return; strokes.pop(); dirty = true; send({ t: 'undo', from: myId }); }
    function clearAll() { if (!imDrawing()) return; strokes = []; dirty = true; send({ t: 'clear', from: myId }); }

    // outside keys (the Mac forwards the keys when the page does not have the keyboard): typing goes into the guess box
    function outsideKey(k, down) {
      if (!down || menu.hidden === false) return;
      if (k === 'Enter') { submit(); return; }
      if (k === 'Backspace') { input.value = input.value.slice(0, -1); return; }
      if (k.length === 1 && input.value.length < 60) input.value += k;
    }

    // ---------- drawing the screen
    function fit() {
      const stage = $('.stage'), r = stage.getBoundingClientRect();
      if (r.width < 10 || r.height < 10) return;
      const k = Math.min(r.width / 1000, r.height / 750);
      const w = Math.floor(1000 * k), h = Math.floor(750 * k);
      if (canvas.style.width !== `${w}px`) { canvas.style.width = `${w}px`; canvas.style.height = `${h}px`; dirty = true; }
      const dpr = window.devicePixelRatio || 1, cw = Math.max(300, Math.round(w * dpr)), ch = Math.round(cw * 0.75);
      if (canvas.width !== cw) { canvas.width = cw; canvas.height = ch; dirty = true; }
    }
    function paint() {
      fit();
      if (!dirty) return;
      dirty = false;
      const k = canvas.width / 1000;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const s of strokes) {
        ctx.strokeStyle = s.color; ctx.fillStyle = s.color; ctx.lineWidth = s.size * k;
        if (s.pts.length < 2) continue;
        if (s.pts.length === 2 && s.pts[0][0] === s.pts[1][0] && s.pts[0][1] === s.pts[1][1]) { ctx.beginPath(); ctx.arc(s.pts[0][0] * k, s.pts[0][1] * k, (s.size * k) / 2, 0, Math.PI * 2); ctx.fill(); continue; }
        ctx.beginPath(); ctx.moveTo(s.pts[0][0] * k, s.pts[0][1] * k);
        for (let i = 1; i < s.pts.length; i++) ctx.lineTo(s.pts[i][0] * k, s.pts[i][1] * k);
        ctx.stroke();
      }
    }
    function ui() {
      const s = v; if (!s) return;
      const ph = s.ph, me = imDrawing();
      $('.round').textContent = ph === 'lobby' ? '' : `Round ${Math.min(s.rd, s.rds)}/${s.rds}`;
      const hint = $('.hint');
      let big = '', small = '';
      if (ph === 'choosing') { big = me ? 'Choose a word' : '…'; small = me ? '' : `${(s.pl.find((p) => p[0] === s.dr) || [0, 'Someone'])[1]} is choosing`; }
      else if (ph === 'drawing') { big = me ? (myWord || '…') : s.hint; small = me ? 'You are drawing' : `${(s.pl.find((p) => p[0] === s.dr) || [0, 'Someone'])[1]} is drawing`; }
      else if (ph === 'reveal' || ph === 'over') { big = s.word || ''; small = 'The word was'; }
      hint.innerHTML = `${esc(big)}<small>${esc(small)}</small>`;
      $('.time').textContent = ph === 'drawing' || ph === 'choosing' ? clock(s.tl) : '';
      const sig = JSON.stringify([s.pl, s.dr, ph]);
      if (sig !== playersSig) {
        playersSig = sig;
        playersEl.innerHTML = s.pl.slice().sort((a, b) => b[2] - a[2]).map((p) => `<div class="pl ${p[0] === s.dr && ph !== 'lobby' ? 'draw' : ''} ${p[3] && ph === 'drawing' ? 'got' : ''}">${p[0] === s.dr && ph !== 'lobby' ? '✏️' : p[3] && ph === 'drawing' ? '✓' : p[4] ? '🤖' : '•'} <span>${esc(p[1])}${p[0] === myId ? ' (you)' : ''}</span><b>${p[2]}</b></div>`).join('');
      }
      const csig = chat.length + (chat[chat.length - 1] ? chat[chat.length - 1].text : '');
      if (csig !== chatSig) { chatSig = csig; chatEl.innerHTML = chat.map((c) => `<div class="m-${c.k}">${c.name ? `<span class="name">${esc(c.name)}:</span> ` : ''}${esc(c.text)}</div>`).join(''); chatEl.scrollTop = chatEl.scrollHeight; }
      // my tools, or the words to choose from
      const toolsSig = `${me}|${ph}|${myChoices}|${color}|${size}|${eraser}`;
      if (toolsEl.dataset.sig !== toolsSig) {
        toolsEl.dataset.sig = toolsSig;
        if (me && ph === 'choosing' && myChoices) { toolsEl.innerHTML = `<span class="small">Pick a word to draw:</span>${myChoices.map((w) => `<button data-w="${esc(w)}" class="go">${esc(w)}</button>`).join('')}`; toolsEl.querySelectorAll('[data-w]').forEach((b) => b.onclick = () => pick(b.dataset.w)); }
        else if (me && ph === 'drawing') {
          toolsEl.innerHTML = COLORS.map((c) => `<button class="c ${!eraser && c === color ? 'on' : ''}" data-c="${c}" style="background:${c}" aria-label="Colour"></button>`).join('') +
            SIZES.map((z) => `<button class="s ${!eraser && z === size ? 'on' : ''}" data-s="${z}"><i style="width:${4 + z / 2}px;height:${4 + z / 2}px"></i></button>`).join('') +
            `<button class="${eraser ? 'on' : ''}" data-a="erase">Eraser</button><button data-a="undo">Undo</button><button data-a="clear">Clear</button>`;
          toolsEl.querySelectorAll('[data-c]').forEach((b) => b.onclick = () => { color = b.dataset.c; eraser = false; toolsEl.dataset.sig = ''; });
          toolsEl.querySelectorAll('[data-s]').forEach((b) => b.onclick = () => { size = +b.dataset.s; eraser = false; toolsEl.dataset.sig = ''; });
          toolsEl.querySelector('[data-a=erase]').onclick = () => { eraser = !eraser; toolsEl.dataset.sig = ''; };
          toolsEl.querySelector('[data-a=undo]').onclick = undo; toolsEl.querySelector('[data-a=clear]').onclick = clearAll;
        } else toolsEl.innerHTML = '';
      }
      input.disabled = me && ph === 'drawing';
      input.placeholder = me && ph === 'drawing' ? 'You are drawing' : 'Type your guess';
      canvas.style.cursor = me && ph === 'drawing' ? 'crosshair' : 'default';
    }
    function frame() {
      if (!alive) return;
      raf = requestAnimationFrame(frame);
      if (mode === 'guest' && v && Date.now() - lastSeenState > 9000) endOnline('The connection to the host was lost.');
      if (isHost() && g && mode !== 'waiting-guest') v = L.publicState(g);
      if (drawing) flushInk(false);
      ui(); paint();
    }

    const api = {
      key: (k, down) => outsideKey(k, !!down),
      suspend: () => { alive = false; cancelAnimationFrame(raf); stopAll(); },
      resume: () => { if (alive) return; alive = true; mainMenu(); raf = requestAnimationFrame(frame); },
    };
    window.NotchScribbleGame.current = api;
    const stop = () => { alive = false; cancelAnimationFrame(raf); stopAll(); host.innerHTML = ''; if (window.NotchScribbleGame.current === api) window.NotchScribbleGame.current = null; };
    if (opts.room && normCode(opts.room)) startOnline(normCode(opts.room), opts.host === true || opts.host === 1 || opts.host === '1' || opts.host === 'true'); else mainMenu();
    raf = requestAnimationFrame(frame);
    return stop;
  }

  window.NotchScribbleGame = {
    current: null,
    mount,
    key: (k, down) => { const c = window.NotchScribbleGame.current; if (c) c.key(k, down); },
    suspend: () => { const c = window.NotchScribbleGame.current; if (c) c.suspend(); },
    resume: () => { const c = window.NotchScribbleGame.current; if (c) c.resume(); },
  };
})();
