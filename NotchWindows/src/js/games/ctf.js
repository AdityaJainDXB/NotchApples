// Capture the Flag for the Games tab, shared by the Mac and Windows apps: two teams, a flag each, walls and crates to fight
// round. Play against computer teams, or online with friends over the same live relay the Battle and Racing use.
// The rules and the computer players are in ctf-logic.js.
//
//   window.NotchCtfGame.mount(hostElement)      starts the game; returns a function that stops it.
//   window.NotchCtfGame.key(k, down)            a key sent in from outside the page (the Mac app forwards its keys this way).
//   window.NotchCtfGame.suspend() / resume()    the notch closed / opened: nothing keeps running or makes a noise.
//
// Online: the host runs the flags, the score and the computer players. Everyone moves and shoots their own player and is
// the one who decides when they are hit; positions and shots are passed on through the relay. With no connection, Start
// plays against the computer after a few seconds, so it always works.
(function () {
  'use strict';
  const C = window.NotchCtfLogic;
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const RELAY = 'wss://notchapple-rooms.adityajain1225.workers.dev';
  const PV = 1;
  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const PUBLIC_ROOM = 'PUBCTF';
  const TEAM = [{ name: 'Blue', col: '#4da3ff', dark: '#1d5fb0' }, { name: 'Red', col: '#ff6b5d', dark: '#b0332a' }];
  const LEVELS = [{ id: 0.5, name: 'Easy' }, { id: 0.72, name: 'Normal' }, { id: 0.92, name: 'Hard' }];
  const BOT_NAMES = ['Ada', 'Rex', 'Mika', 'Jo', 'Zed', 'Lia', 'Kai', 'Nova', 'Bo', 'Fin', 'Sky', 'Max'];

  const store = {
    get(k, d) { try { const v = localStorage.getItem('ctf.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('ctf.' + k, JSON.stringify(v)); } catch { /* storage off */ } },
  };
  const newCode = () => Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  const normCode = (raw) => { const c = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); return c.length === 6 && [...c].every((ch) => CODE_CHARS.includes(ch)) ? c : null; };
  const clean = (t, n = 14) => String(t == null ? '' : t).replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const myId = (() => { let id = store.get('id', ''); if (!id) { id = [...crypto.getRandomValues(new Uint8Array(4))].map((b) => b.toString(16).padStart(2, '0')).join(''); store.set('id', id); } return id; })();
  const clock = (t) => { t = Math.max(0, Math.ceil(t)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };

  /// A link to a room on the relay (rooms of its own, so Capture the Flag never meets Battle or Racing).
  class Link {
    constructor(onMessage, onState) { this.onMessage = onMessage; this.onState = onState; this.ws = null; this.state = 'off'; this.retry = 0; this.want = false; this.timer = 0; }
    async join(code) {
      this.close();
      const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`notchapple-ctf-v1|${code}`)));
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

  const CSS = `
  .cf { position: relative; width: 100%; height: 100%; overflow: hidden; background: #0b0f16; color: #fff; font: 13px/1.35 -apple-system, "Segoe UI", system-ui, sans-serif; user-select: none; outline: none; }
  .cf canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; cursor: crosshair; }
  .cf .cf-ui { position: absolute; inset: 0; overflow: auto; display: flex; align-items: center; justify-content: center; background: rgba(6,9,16,.8); padding: 10px; }
  .cf .cf-card { width: min(540px, 100%); max-height: 100%; overflow: auto; background: rgba(20,26,40,.97); border: 1px solid rgba(255,255,255,.14); border-radius: 16px; padding: 14px 16px; }
  .cf h1 { margin: 0 0 6px; font-size: 20px; }
  .cf h2 { margin: 12px 0 6px; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #9fb0c8; font-weight: 700; }
  .cf .cf-row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin: 4px 0; }
  .cf button { font: inherit; font-weight: 700; padding: 6px 11px; border-radius: 10px; border: 1px solid rgba(255,255,255,.22); background: rgba(255,255,255,.07); color: #fff; cursor: pointer; }
  .cf button:hover { background: rgba(255,255,255,.14); }
  .cf button.on { border-color: #ffb347; box-shadow: 0 0 0 1px #ffb347 inset; background: rgba(255,179,71,.16); }
  .cf button.go { background: #ffb347; color: #1b1300; border-color: #ffb347; }
  .cf button.go:hover { background: #ffc470; }
  .cf input { font: inherit; padding: 6px 9px; border-radius: 9px; border: 1px solid rgba(255,255,255,.25); background: rgba(255,255,255,.08); color: #fff; outline: none; }
  .cf .cf-hint { color: #9fb0c8; font-size: 11.5px; }
  .cf .cf-warn { color: #ffb347; font-size: 12px; margin: 4px 0; }
  .cf .cf-top { position: absolute; right: 8px; top: 8px; display: flex; gap: 6px; z-index: 3; }
  .cf .cf-top button { padding: 3px 8px; font-size: 12px; background: rgba(10,14,28,.7); }
  .cf .cf-person { display: flex; justify-content: space-between; padding: 3px 8px; border-radius: 8px; background: rgba(255,255,255,.06); margin: 2px 0; }
  .cf .cf-teams { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  `;
  let styled = false;
  const ensureStyle = () => { if (styled) return; styled = true; const s = document.createElement('style'); s.textContent = CSS; document.head.append(s); };

  function makeAudio() {
    let ac = null, gain = null, held = false;
    const on = () => store.get('sound', true) && !held;
    const start = () => { if (ac || !on()) return; try { ac = new (window.AudioContext || window.webkitAudioContext)(); gain = ac.createGain(); gain.gain.value = 0.5; gain.connect(ac.destination); } catch { ac = null; } };
    return {
      beep(freq, dur = 0.12, vol = 0.1, type = 'square') {
        if (!on()) return; if (!ac) start(); if (!ac) return;
        const o = ac.createOscillator(), g = ac.createGain(); o.type = type; o.frequency.value = freq; g.gain.setValueAtTime(vol, ac.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
        o.connect(g); g.connect(gain); o.start(); o.stop(ac.currentTime + dur);
      },
      kill() { if (!ac) return; const old = ac; ac = null; gain = null; try { old.close(); } catch { /* closed */ } },
      hold(v) { held = v; if (v) this.kill(); },
      get active() { return !!ac; },
    };
  }

  function mount(host) {
    ensureStyle();
    host.innerHTML = '';
    const box = document.createElement('div'); box.className = 'cf'; box.tabIndex = 0; host.append(box);
    const cv = document.createElement('canvas'), ctx = cv.getContext('2d');
    const ui = document.createElement('div'); ui.className = 'cf-ui';
    const top = document.createElement('div'); top.className = 'cf-top';
    box.append(cv, top, ui);
    const audio = makeAudio();
    let alive = true, W = 0, H = 0, dpr = 1, raf = 0, last = performance.now();
    const keys = new Set(), mouse = { x: 0, y: 0, down: false, moved: 0 };
    let cfg = { size: store.get('size', 3), level: store.get('level', 0.72), to: store.get('to', 3) };
    let name = clean(store.get('name', ''));
    let screen = 'menu', online = false;                // menu, play, over
    let m = null, me = null, net = null, isHost = true, bullets = [], parts = [], toastText = '', toastT = 0, camX = 0, camY = 0, flash = 0, hitFlash = 0, overAt = 0, lastShot = 0, feedLocal = [], spectate = 0;
    const flagsView = [{ state: 'home', x: 0, y: 0, carrier: null }, { state: 'home', x: 0, y: 0, carrier: null }];

    const fit = () => { const r = box.getBoundingClientRect(); dpr = Math.min(window.devicePixelRatio || 1, 2); W = Math.max(200, Math.round(r.width)); H = Math.max(150, Math.round(r.height)); cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); };
    const ro = new ResizeObserver(fit); ro.observe(box); fit();
    const toast = (t, s = 2) => { toastText = t; toastT = s; };

    // ---------- menus
    const chip = (key, val, label) => `<button data-set="${key}:${val}" class="${String(cfg[key]) === String(val) ? 'on' : ''}">${label}</button>`;
    function renderTop() { top.innerHTML = `<button data-a="snd">${store.get('sound', true) ? '🔊' : '🔇'}</button>${screen !== 'menu' ? '<button data-a="menu">☰ Menu</button>' : ''}`; }
    function menuHtml() {
      const off = navigator.onLine === false ? '<div class="cf-warn">You are offline: games are against the computer. Online games with friends need the internet.</div>' : '';
      return `<div class="cf-card"><h1>🚩 Capture the Flag</h1>${off}
        <div class="cf-hint">Steal the other team's flag and carry it home. Your own flag has to be at your base to score.</div>
        <h2>Players per team (you included)</h2><div class="cf-row">${[2, 3, 4, 5].map((n) => chip('size', n, String(n))).join('')}</div>
        <h2>Computer players</h2><div class="cf-row">${LEVELS.map((l) => chip('level', l.id, l.name)).join('')}</div>
        <h2>First team to</h2><div class="cf-row">${[2, 3, 5].map((n) => chip('to', n, n + ' captures')).join('')}</div>
        <h2>Your name</h2><div class="cf-row"><input data-name maxlength="14" placeholder="Shown to other players" value="${esc(name)}"></div>
        <div class="cf-row" style="margin-top:12px"><button class="go" data-a="solo">Play against the computer (Enter)</button><button data-a="online">Play with friends online…</button></div>
        <div class="cf-hint" style="margin-top:8px">W A S D move · mouse aims · click or Space shoots · arrows ← → aim without a mouse · M mute</div></div>`;
    }
    function onlineHtml() {
      return `<div class="cf-card"><h1>🚩 Play with friends</h1>
        <div class="cf-row"><button class="go" data-a="quick">Quick match: join an open game</button></div>
        <div class="cf-hint">Meets whoever else is waiting. If nobody is, you start one yourself (or play the computer if you are offline).</div>
        <h2>Private game</h2><div class="cf-row"><button data-a="host">Host a game</button><span class="cf-hint">or join one:</span><input data-code maxlength="8" placeholder="Room code" style="width:110px;text-transform:uppercase" value="${esc(api.joinDraft || '')}"><button data-a="join">Join</button></div>
        <div class="cf-row" style="margin-top:12px"><button data-a="back">← Back</button></div></div>`;
    }
    function lobbyHtml() {
      const host = net.role === 'host', people = host ? [{ id: myId, n: name || 'You' }, ...[...net.peers.values()]] : net.roster || [];
      const note = net.status !== 'on' ? '<div class="cf-hint">Connecting…</div>' : !host && !net.hostSeen ? '<div class="cf-hint">Looking for the game…</div>' : '';
      const col = (t) => people.filter((p, i) => i % 2 === t).map((p) => `<div class="cf-person"><b>${esc(clean(p.n) || 'Player')}${p.id === myId ? ' (you)' : ''}</b></div>`).join('') || '<div class="cf-hint">–</div>';
      const c = net.cfg;
      return `<div class="cf-card"><h1>🚩 Game room · ${net.code}</h1>${note}<div class="cf-hint">Share the code. Friends join and are put on teams. Empty places are filled by the computer.</div>
        <div class="cf-teams"><div><h2 style="color:${TEAM[0].col}">Blue</h2>${col(0)}</div><div><h2 style="color:${TEAM[1].col}">Red</h2>${col(1)}</div></div>
        <h2>Game</h2>${host ? `<div class="cf-row">${[2, 3, 4, 5].map((n) => `<button data-h="size:${n}" class="${c.size === n ? 'on' : ''}">${n} a side</button>`).join('')}</div><div class="cf-row">${LEVELS.map((l) => `<button data-h="level:${l.id}" class="${c.level === l.id ? 'on' : ''}">${l.name}</button>`).join('')}${[2, 3, 5].map((n) => `<button data-h="to:${n}" class="${c.to === n ? 'on' : ''}">${n} captures</button>`).join('')}</div>`
          : `<div class="cf-hint">${c.size} a side · first to ${c.to} captures (the host chooses)</div>`}
        <div class="cf-row" style="margin-top:12px">${host ? '<button class="go" data-a="start">Start the game (Enter)</button>' : '<span class="cf-hint">Waiting for the host to start…</span>'}<button data-a="leave">Leave</button></div></div>`;
    }
    function overHtml() {
      const w = m.winner, mine = me ? me.team : 0;
      const title = w < 0 ? '🤝 A draw' : w === mine ? '🏆 Your team won!' : '💥 The other team won';
      const rows = m.players.slice().sort((a, b) => b.caps * 5 + b.kills - (a.caps * 5 + a.kills)).map((p) => `<tr><td style="color:${TEAM[p.team].col}">●</td><td>${esc(clean(p.name))}${p === me ? ' (you)' : ''}</td><td style="text-align:right">${p.caps}</td><td style="text-align:right">${p.kills}</td><td style="text-align:right">${p.deaths}</td></tr>`).join('');
      return `<div class="cf-card"><h1>${title}</h1><div class="cf-hint">Blue ${m.score[0]} – ${m.score[1]} Red</div>
        <table style="width:100%;border-collapse:collapse;margin-top:8px"><tr style="color:#9fb0c8;font-size:11px"><td></td><td>Player</td><td style="text-align:right">Caps</td><td style="text-align:right">Kills</td><td style="text-align:right">Deaths</td></tr>${rows}</table>
        <div class="cf-row" style="margin-top:12px">${net ? (net.role === 'host' ? '<button class="go" data-a="again">Play again (Enter)</button>' : '<span class="cf-hint">The host can start another game.</span>') : '<button class="go" data-a="again">Play again (Enter)</button>'}<button data-a="menu">Menu</button></div></div>`;
    }
    function showUi() {
      renderTop();
      if (screen === 'menu') ui.innerHTML = net ? lobbyHtml() : (api.online ? onlineHtml() : menuHtml());
      else if (screen === 'over' && m) ui.innerHTML = overHtml();
      else ui.innerHTML = '';
      ui.style.display = ui.innerHTML ? 'flex' : 'none';
      bindUi();
    }
    function bindUi() {
      ui.querySelectorAll('[data-set]').forEach((b) => b.onclick = () => { const [k, v] = b.dataset.set.split(':'); cfg[k] = Number(v); store.set(k, cfg[k]); showUi(); });
      ui.querySelectorAll('[data-h]').forEach((b) => b.onclick = () => { const [k, v] = b.dataset.h.split(':'); net.cfg = { ...net.cfg, [k]: Number(v) }; sendLobby(); showUi(); });
      ui.querySelectorAll('[data-name]').forEach((n) => { n.oninput = () => { name = clean(n.value); store.set('name', name); }; n.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') startSolo(); }; });
      ui.querySelectorAll('[data-code]').forEach((n) => { n.oninput = () => { api.joinDraft = n.value.toUpperCase(); }; n.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') act('join'); }; });
      top.querySelectorAll('button').forEach((b) => b.onclick = () => act(b.dataset.a));
      ui.querySelectorAll('[data-a]').forEach((b) => b.onclick = () => act(b.dataset.a));
    }
    function act(a) {
      if (a === 'snd') { const v = !store.get('sound', true); store.set('sound', v); if (!v) audio.kill(); renderTop(); bindUi(); }
      else if (a === 'solo') startSolo();
      else if (a === 'online') { api.online = true; showUi(); }
      else if (a === 'back') { api.online = false; showUi(); }
      else if (a === 'quick') openRoom('client', PUBLIC_ROOM, true);
      else if (a === 'host') openRoom('host', newCode(), false);
      else if (a === 'join') { const c = normCode(api.joinDraft); if (!c) { toast('A room code is 6 letters and numbers', 2.4); return; } openRoom('client', c, false); }
      else if (a === 'start') hostStart();
      else if (a === 'leave') { leaveRoom(); showUi(); }
      else if (a === 'again') { if (net) { if (net.role === 'host') hostStart(); } else startSolo(); }
      else if (a === 'menu') { leaveRoom(); screen = 'menu'; api.online = false; m = null; me = null; showUi(); }
    }

    // ---------- starting a game
    /// Builds a match from a list of players ({ id, name, team, bot }) and starts it. `authority` is true for a solo game or the host.
    function begin(c, players, authority) {
      isHost = authority;
      m = C.newMatch({ to: c.to, limit: c.limit || 300 });
      players.forEach((p) => { const q = C.addPlayer(m, { id: p.id, name: p.name, team: p.team, bot: !!p.bot, skill: c.level + (Math.random() - 0.5) * 0.1 }); q.remote = !p.bot && p.id !== myId; q.rbot = !!p.bot && !authority; });
      me = m.players.find((p) => p.id === myId) || m.players[0];
      bullets = []; parts = []; flash = 0; overAt = 0; feedLocal = []; spectate = 0; mouse.down = false;
      camX = me.x; camY = me.y; screen = 'play'; keys.clear(); showUi(); box.focus(); toast('Take their flag and bring it home!', 3);
    }
    function fillBots(humans, c) {
      const players = humans.map((h, i) => ({ id: h.id, name: h.name, team: i % 2 }));
      const count = [0, 0]; players.forEach((p) => count[p.team]++);
      let b = 0;
      for (const team of [0, 1]) while (count[team] < c.size) { players.push({ id: 'bot' + (b++), name: BOT_NAMES[(b + team * 6) % BOT_NAMES.length], team, bot: true }); count[team]++; }
      return players;
    }
    function startSolo() {
      if (net) leaveRoom();
      begin(cfg, fillBots([{ id: myId, name: name || 'You' }], cfg), true);
    }

    // ---------- online
    function openRoom(role, code, auto) {
      leaveRoom();
      if (navigator.onLine === false) { toast('No connection: playing the computer', 2.6); startSolo(); return; }
      net = { role, code, auto, link: null, status: 'connecting', peers: new Map(), roster: [], hostSeen: 0, hostId: role === 'host' ? myId : '', cfg: { ...cfg }, joined: Date.now(), running: false, timer: 0, helloT: 0, lobbyT: 0, sendT: 0, flagT: 0 };
      net.link = new Link(onNet, (st) => { if (!net) return; net.status = st; if (st === 'on') { net.joined = Date.now(); hello(); if (net.role === 'host') sendLobby(); } if (screen === 'menu') showUi(); });
      net.link.join(code);
      net.timer = setInterval(netHouse, 400);
      screen = 'menu'; showUi();
    }
    function leaveRoom() { if (!net) return; try { net.link.send({ t: 'bye', id: myId }); } catch { /* gone */ } clearInterval(net.timer); net.link.close(); net = null; }
    const hello = () => net && net.role === 'client' && net.link.send({ t: 'hi', id: myId, n: name || 'Player', pv: PV });
    function sendLobby() { if (net && net.role === 'host') { net.roster = [{ id: myId, n: name || 'Host' }, ...[...net.peers.values()]]; net.link.send({ t: 'lobby', host: myId, cfg: net.cfg, roster: net.roster, running: net.running, pv: PV }); } }
    function netHouse() {
      if (!net) return;
      const now = Date.now();
      if (net.auto && net.status !== 'on' && now - net.joined > 5000) { toast('No connection: playing the computer', 2.6); startSolo(); return; }
      if (net.role === 'client' && net.auto && !net.hostSeen && net.status === 'on' && now - net.joined > 5500) { const code = net.code; openRoom('host', code, true); net.autoStart = true; return; }
      if (net.role === 'host' && net.autoStart && net.status === 'on' && !net.running && now - net.joined > 5000) { net.autoStart = false; hostStart(); return; }
      if (net.role === 'host') { if (now - net.lobbyT > 1500) { net.lobbyT = now; sendLobby(); } for (const [id, p] of net.peers) if (now - p.last > 9000) { net.peers.delete(id); if (screen === 'menu') showUi(); else if (m) { const q = m.players.find((x) => x.id === id); if (q && !q.bot) { if (q.carrying >= 0) { q.alive = false; C.stepFlags(m); } m.players.splice(m.players.indexOf(q), 1); } } } }
      else if (!net.running && now - net.helloT > 1800) { net.helloT = now; hello(); }
      if (screen === 'menu') showUi();
    }
    function hostStart() {
      if (!net || net.role !== 'host' || net.status !== 'on') return;
      net.running = true;
      const humans = [{ id: myId, name: name || 'Host' }, ...[...net.peers.values()].map((p) => ({ id: p.id, name: p.n }))].slice(0, net.cfg.size * 2);
      const players = fillBots(humans, net.cfg), msg = { t: 'start', cfg: net.cfg, players, pv: PV };
      net.link.send(msg); begin(net.cfg, players, true);
    }
    function onNet(g) {
      if (!net || g.id === myId) return;
      if (net.role === 'host') { const pe = net.peers.get(String(g.id)); if (pe) pe.last = Date.now(); }      // any message shows they are still here
      if (g.t === 'hi') {
        if (net.role !== 'host' || (g.pv || 0) !== PV) return;
        const isNew = !net.peers.has(g.id); net.peers.set(g.id, { id: String(g.id), n: clean(g.n) || 'Player', last: Date.now() });
        if (isNew) { sendLobby(); if (screen === 'menu') showUi(); }
        return;
      }
      if (g.t === 'lobby') {
        if ((g.pv || 0) !== PV) return;
        if (net.role === 'host' && net.autoStart === undefined && g.host !== myId && String(g.host) < myId) { net.role = 'client'; net.hostId = g.host; }
        if (net.role !== 'client') return;
        net.hostSeen = Date.now(); net.hostId = String(g.host); net.cfg = g.cfg || net.cfg; net.roster = Array.isArray(g.roster) ? g.roster.slice(0, 10) : []; if (screen === 'menu') showUi();
        return;
      }
      if (g.t === 'start') {
        if (net.role !== 'client' || !Array.isArray(g.players) || !g.cfg) return;
        net.running = true; net.cfg = g.cfg;
        begin(g.cfg, g.players.map((p) => ({ id: String(p.id), name: clean(p.name) || 'Player', team: p.team === 1 ? 1 : 0, bot: !!p.bot })), false); return;
      }
      if (!m || screen === 'menu') return;
      if (g.t === 'p') {                                   // someone's position (a player, or one of the host's computer players)
        const q = m.players.find((x) => x.id === String(g.id)); if (!q || q === me) return;
        if (q.bot && isHost) return;
        q.tx = +g.x; q.ty = +g.y; q.a = +g.a; q.vx = +g.vx || 0; q.vy = +g.vy || 0; q.hp = +g.hp; q.alive = !!g.al; q.rt = performance.now();
        if (q.x === 0 && q.y === 0 || !q.seen) { q.x = q.tx; q.y = q.ty; q.seen = true; }
        if (!isHost) { q.carrying = g.c == null ? -1 : g.c; }
      } else if (g.t === 'b') {                            // a shot
        const q = m.players.find((x) => x.id === String(g.o)); if (!q || q === me) return;
        bullets.push({ id: -1, owner: q.id, team: q.team, x: +g.x, y: +g.y, dx: +g.dx, dy: +g.dy, t: 0, life: C.PLAYER.range / C.PLAYER.bullet, dmg: C.PLAYER.dmg });
        if (bullets.length > 300) bullets.shift();
      } else if (g.t === 'k') {                            // someone died (they say so themselves)
        const v = m.players.find((x) => x.id === String(g.v)); if (!v) return;
        if (isHost && v !== me && !v.bot) { v.shield = 0; C.damage(m, v, 1e9, String(g.by)); m.events.length = 0; }
        else if (!isHost) { v.alive = false; const killer = m.players.find((x) => x.id === String(g.by)); if (killer && killer.team !== v.team) killer.kills++; v.deaths++; pushFeed(`${killer ? killer.name : 'Someone'} ▸ ${v.name}`, killer ? killer.team : -1); }
      } else if (g.t === 'f') {                            // the flags, the score and the clock (from the host)
        if (isHost) return;
        m.score = [g.s[0] | 0, g.s[1] | 0]; m.t = +g.tm || m.t; m.to = g.to | 0 || m.to;
        for (let i = 0; i < 2; i++) { const f = m.flags[i], s = g.f[i]; f.state = s[0] === 'h' ? 'home' : s[0] === 'c' ? 'carried' : 'dropped'; f.x = +s[1]; f.y = +s[2]; f.carrier = s[3] || null; }
        for (const p of m.players) { const holds = m.flags.findIndex((f) => f.state === 'carried' && f.carrier === p.id); p.carrying = holds; }
        if (Array.isArray(g.st)) for (const [id, k, d, c] of g.st) { const p = m.players.find((x) => x.id === String(id)); if (p) { p.kills = k | 0; p.deaths = d | 0; p.caps = c | 0; } }
        if (g.o && !m.over) { m.over = true; m.winner = g.w; overAt = 0; }
      } else if (g.t === 'ev') {                           // something happened: a sound and a line in the feed
        if (!isHost) onEvent(g.e);
      }
    }
    const pushFeed = (text, team) => { feedLocal.unshift({ text, team, t: 6 }); feedLocal.length = Math.min(feedLocal.length, 5); };
    function onEvent(e) {
      const who = m.players.find((p) => p.id === e.by), nm = who ? who.name : 'Someone';
      if (e.k === 'take') { pushFeed(`${nm} took the ${TEAM[e.team].name} flag!`, who ? who.team : -1); audio.beep(660, 0.12); if (me && e.team === me.team) toast('Your flag was taken!', 2); }
      else if (e.k === 'drop') { pushFeed(`The ${TEAM[e.team].name} flag was dropped`, -1); }
      else if (e.k === 'return') pushFeed(`The ${TEAM[e.team].name} flag is back home`, -1);
      else if (e.k === 'capture') { pushFeed(`${nm} captured the flag!`, who ? who.team : -1); audio.beep(880, 0.25); toast(who && me && who.team === me.team ? 'Your team scored!' : 'The other team scored!', 2.4); }
    }
    function sendNet(dt) {
      if (!net || !net.running || screen === 'menu' || !m) return;
      net.sendT -= dt;
      if (net.sendT <= 0) {
        net.sendT = 0.125;
        const send = (p) => net.link.send({ t: 'p', id: p.id, x: +p.x.toFixed(1), y: +p.y.toFixed(1), a: +p.a.toFixed(2), vx: +p.vx.toFixed(1), vy: +p.vy.toFixed(1), hp: Math.round(p.hp), al: p.alive ? 1 : 0, c: p.carrying });
        send(me);
        if (isHost) for (const p of m.players) if (p.bot) send(p);
      }
      if (isHost) {
        net.flagT -= dt;
        const evs = m.events.splice(0);
        for (const e of evs) { if (e.k !== 'kill') { onEvent(e); net.link.send({ t: 'ev', e }); net.flagT = 0; } }
        if (net.flagT <= 0 || m.over) { net.flagT = 0.3; net.link.send({ t: 'f', s: m.score, tm: +m.t.toFixed(1), to: m.to, o: m.over ? 1 : 0, w: m.winner, st: m.over ? m.players.map((p) => [p.id, p.kills, p.deaths, p.caps]) : undefined, f: m.flags.map((f) => [f.state[0], +f.x.toFixed(1), +f.y.toFixed(1), f.carrier]) }); }
      }
    }

    // ---------- playing
    function myInput() {
      const k = (n) => keys.has(n);
      return { dx: (k('d') || k('ArrowRight') && false ? 1 : 0) - (k('a') ? 1 : 0), dy: (k('s') || k('ArrowDown') ? 1 : 0) - (k('w') || k('ArrowUp') ? 1 : 0), fire: mouse.down || k(' ') };
    }
    function stepPlay(dt) {
      // My player.
      if (me.alive && api.auto) {
        // (tests: the computer plays my player too)
        const a = C.think(m, me, dt); C.move(m, me, a.dx, a.dy, dt);
        if (a.shoot) { const b = C.fire(m, me, me.a); if (b) { me.fireT = 0.3; bullets.push(b); if (net && net.running) net.link.send({ t: 'b', o: myId, x: +b.x.toFixed(1), y: +b.y.toFixed(1), dx: +b.dx.toFixed(3), dy: +b.dy.toFixed(3) }); } }
      } else if (me.alive) {
        const inp = myInput();
        C.move(m, me, inp.dx, inp.dy, dt);
        // Aim: the mouse if it moved lately, else the arrow keys.
        if (performance.now() - mouse.moved < 4000) me.a = Math.atan2(mouse.y - H / 2, mouse.x - W / 2);
        else me.a = C.wrap(me.a + ((keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0)) * 3.4 * dt);
        if (keys.has('ArrowLeft') || keys.has('ArrowRight')) mouse.moved = 0;
        if (inp.fire) { const b = C.fire(m, me, me.a); if (b) { bullets.push(b); if (net && net.running) net.link.send({ t: 'b', o: myId, x: +b.x.toFixed(1), y: +b.y.toFixed(1), dx: +b.dx.toFixed(3), dy: +b.dy.toFixed(3) }); if (performance.now() - lastShot > 90) { lastShot = performance.now(); audio.beep(190, 0.04, 0.05, 'sawtooth'); } } }
      }
      // The match: the host (or a solo game) runs the computer players and the flags; a guest only keeps its own timers.
      if (isHost) {
        for (const p of m.players) {
          if (!p.alive || !p.bot) continue;
          const a = C.think(m, p, dt); C.move(m, p, a.dx, a.dy, dt);
          p.firing = a.shoot && p.skill > 0.2; if (p.firing) { const b = C.fire(m, p, p.a); if (b) { p.fireT = 0.34 - 0.12 * p.skill; bullets.push(b); if (net && net.running) net.link.send({ t: 'b', o: p.id, x: +b.x.toFixed(1), y: +b.y.toFixed(1), dx: +b.dx.toFixed(3), dy: +b.dy.toFixed(3) }); } }
        }
        // Humans that are not me are placed from their messages; the host still keeps their timers off.
        C.tick(m, dt, { only: me, onSpawn: (p) => { if (p === me) toast('Back in the fight!', 1.2); } });
      } else C.tick(m, dt, { client: true, only: me, onSpawn: (p) => { if (p === me) toast('Back in the fight!', 1.2); } });
      // Others: glide to where they were last reported.
      for (const p of m.players) {
        if (p === me) continue;
        if (p.remote || (p.bot && !isHost)) { if (p.tx != null) { const k = Math.min(1, dt * 12); p.x += (p.tx + p.vx * Math.min(0.25, (performance.now() - (p.rt || 0)) / 1000) - p.x) * k; p.y += (p.ty + p.vy * Math.min(0.25, (performance.now() - (p.rt || 0)) / 1000) - p.y) * k; } p.fireT = 0; }
      }
      // Bullets: I decide when I am hit; the host also decides for its computer players.
      const before = me.hp;
      C.stepBullets({ players: m.players, bullets }, dt, (b, v) => {
        if (v === me) { if (C.damage(m, me, b.dmg, b.owner)) { me.alive = false; if (net && net.running) net.link.send({ t: 'k', v: myId, by: b.owner }); if (!isHost) { me.deaths++; const killer = m.players.find((x) => x.id === b.owner); if (killer && killer.team !== me.team) killer.kills++; pushFeed(`${killer ? killer.name : 'Someone'} ▸ ${me.name}`, killer ? killer.team : -1); } audio.beep(110, 0.25, 0.12, 'sawtooth'); } }
        else if (isHost && v.bot) C.damage(m, v, b.dmg, b.owner);
        for (let i = 0; i < 4; i++) parts.push({ x: b.x, y: b.y, vx: (Math.random() - 0.5) * 14, vy: (Math.random() - 0.5) * 14, t: 0, life: 0.35, c: TEAM[1 - b.team].col });
      });
      bullets = m.bullets = bullets.filter((b) => !b.dead);
      if (me.hp < before) hitFlash = 0.25;
      // The host's own events go to its feed, sounds and the guests.
      if (isHost && !(net && net.running)) for (const e of m.events.splice(0)) if (e.k !== 'kill') onEvent(e);
      for (const f of feedLocal) f.t -= dt; feedLocal = feedLocal.filter((f) => f.t > 0);
      if (isHost) { for (const f of m.feed.splice(0)) pushFeed(f.text, f.team); }
      for (const p of parts) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; } parts = parts.filter((p) => p.t < p.life);
      sendNet(dt);
      if (m.over && screen === 'play') { overAt += dt; if (overAt > 1.2) { screen = 'over'; showUi(); audio.beep(m.winner === me.team ? 880 : 220, 0.4); } }
      camX += (me.x + me.vx * 0.25 - camX) * Math.min(1, dt * 6); camY += (me.y + me.vy * 0.25 - camY) * Math.min(1, dt * 6);
    }

    // ---------- drawing
    function draw() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#0b0f16'; ctx.fillRect(0, 0, W, H);
      if (!m || !me) return;
      const sc = Math.min(W / 100, H / 58);
      ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(sc, sc); ctx.translate(-camX, -camY);
      const A = C.ARENA;
      // The ground, the two bases and the middle line.
      ctx.fillStyle = '#26402b'; ctx.fillRect(-A.w / 2, -A.h / 2, A.w, A.h);
      ctx.fillStyle = '#2c4a31'; for (let x = -A.w / 2; x < A.w / 2; x += 20) for (let y = -A.h / 2; y < A.h / 2; y += 20) if (((x + A.w / 2) / 20 + (y + A.h / 2) / 20) % 2 === 0) ctx.fillRect(x, y, 20, 20);
      for (const t of [0, 1]) { const s = C.STAND(t); ctx.fillStyle = TEAM[t].col + '33'; ctx.beginPath(); ctx.arc(s.x, s.y, C.CAPTURE_R + 2, 0, TAU); ctx.fill(); ctx.strokeStyle = TEAM[t].col; ctx.lineWidth = 0.5; ctx.stroke(); }
      ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.setLineDash([3, 3]); ctx.lineWidth = 0.4; ctx.beginPath(); ctx.moveTo(0, -A.h / 2); ctx.lineTo(0, A.h / 2); ctx.stroke(); ctx.setLineDash([]);
      // Walls, with a shadow.
      for (const b of C.WALLS) { ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fillRect(b.x + 1, b.y + 1.4, b.w, b.h); ctx.fillStyle = '#6b7380'; ctx.fillRect(b.x, b.y, b.w, b.h); ctx.fillStyle = '#8a93a1'; ctx.fillRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1); }
      ctx.strokeStyle = '#d7dee9'; ctx.lineWidth = 0.9; ctx.strokeRect(-A.w / 2, -A.h / 2, A.w, A.h);
      // Flags (at home, carried or on the ground).
      for (const f of m.flags) { const p = f.state === 'carried' ? m.players.find((q) => q.id === f.carrier) : null, fx = p ? p.x : f.x, fy = p ? p.y : f.y; drawFlag(fx, fy, f.team, f.state === 'carried'); }
      for (const p of parts) { ctx.fillStyle = p.c; ctx.globalAlpha = 1 - p.t / p.life; ctx.fillRect(p.x - 0.3, p.y - 0.3, 0.6, 0.6); } ctx.globalAlpha = 1;
      // Bullets.
      ctx.lineWidth = 0.45; for (const b of bullets) { ctx.strokeStyle = b.team === me.team ? '#9cd2ff' : '#ffb0a6'; ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - b.dx * 2.8, b.y - b.dy * 2.8); ctx.stroke(); }
      // Players (the dead are not drawn), mine on top.
      for (const p of m.players) if (p !== me && p.alive) drawPlayer(p);
      if (me.alive) drawPlayer(me);
      ctx.restore();
      drawHud(sc);
    }
    function drawFlag(x, y, team, carried) {
      ctx.save(); ctx.translate(x, y - (carried ? 1.2 : 0));
      ctx.strokeStyle = '#e8e8e8'; ctx.lineWidth = 0.45; ctx.beginPath(); ctx.moveTo(0, 1.2); ctx.lineTo(0, -4.2); ctx.stroke();
      ctx.fillStyle = TEAM[team].col; ctx.beginPath(); ctx.moveTo(0, -4.2); ctx.lineTo(3.8, -3.1 + Math.sin(performance.now() / 160) * 0.3); ctx.lineTo(0, -1.9); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(0, 1.2, 1.1, 0.5, 0, 0, TAU); ctx.fill(); ctx.restore();
    }
    function drawPlayer(p) {
      ctx.save(); ctx.translate(p.x, p.y);
      ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(0.3, 0.5, 1.3, 1.1, 0, 0, TAU); ctx.fill();
      if (p.shield > 0) { ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 0.35; ctx.beginPath(); ctx.arc(0, 0, 1.9, 0, TAU); ctx.stroke(); }
      ctx.rotate(p.a); ctx.fillStyle = '#2a2f38'; ctx.fillRect(0.4, -0.3, 1.9, 0.6);
      ctx.fillStyle = TEAM[p.team].col; ctx.beginPath(); ctx.arc(0, 0, C.PLAYER.r, 0, TAU); ctx.fill(); ctx.strokeStyle = TEAM[p.team].dark; ctx.lineWidth = 0.3; ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.beginPath(); ctx.arc(0.35, 0, 0.4, 0, TAU); ctx.fill();
      ctx.restore();
      if (p !== me) { ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.font = '700 2.2px system-ui'; ctx.textAlign = 'center'; ctx.fillText(clean(p.name, 8), p.x, p.y - 2.9); }
      const w = 3.4; ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(p.x - w / 2, p.y - 2.5, w, 0.55); ctx.fillStyle = p.hp > 50 ? '#6fd16f' : p.hp > 25 ? '#ffd24d' : '#ff6b5d'; ctx.fillRect(p.x - w / 2, p.y - 2.5, w * clamp(p.hp / C.PLAYER.hp, 0, 1), 0.55);
    }
    function drawHud(sc) {
      const s = Math.min(1, W / 640);
      ctx.textAlign = 'center';
      // Scores and the clock.
      const bw = 210 * s + 40, bx = W / 2 - bw / 2;
      ctx.fillStyle = 'rgba(8,12,22,.7)'; ctx.fillRect(bx, 6, bw, 36 * s + 6);
      ctx.font = `800 ${Math.round(24 * s + 4)}px system-ui`; ctx.fillStyle = TEAM[0].col; ctx.textAlign = 'left'; ctx.fillText(String(m.score[0]), bx + 14, 6 + 28 * s + 4);
      ctx.fillStyle = TEAM[1].col; ctx.textAlign = 'right'; ctx.fillText(String(m.score[1]), bx + bw - 14, 6 + 28 * s + 4);
      ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.font = `700 ${Math.round(13 * s + 3)}px system-ui`; ctx.fillText(clock(m.limit - m.t), W / 2, 6 + 18 * s + 4);
      ctx.fillStyle = '#9fb0c8'; ctx.font = `600 ${Math.round(10 * s + 2)}px system-ui`; ctx.fillText(`first to ${m.to}`, W / 2, 6 + 33 * s + 5);
      // Flag status for each team.
      for (const f of m.flags) { const left = f.team === 0, x = left ? bx - 58 * s - 6 : bx + bw + 6; ctx.fillStyle = 'rgba(8,12,22,.7)'; ctx.fillRect(x, 6, 58 * s, 36 * s + 6); ctx.fillStyle = TEAM[f.team].col; ctx.font = `700 ${Math.round(10 * s + 2)}px system-ui`; ctx.textAlign = 'center'; ctx.fillText('🚩 ' + (f.state === 'home' ? 'home' : f.state === 'carried' ? 'TAKEN' : 'dropped'), x + 29 * s, 6 + 24 * s + 4); }
      // My health, and what I am carrying.
      ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(8,12,22,.7)'; ctx.fillRect(8, H - 46 * s - 8, 150 * s + 20, 40 * s + 4);
      ctx.fillStyle = 'rgba(255,255,255,.15)'; ctx.fillRect(16, H - 20 * s - 8, 134 * s, 9 * s + 2); ctx.fillStyle = me.hp > 50 ? '#6fd16f' : me.hp > 25 ? '#ffd24d' : '#ff6b5d'; ctx.fillRect(16, H - 20 * s - 8, 134 * s * clamp(me.hp / C.PLAYER.hp, 0, 1), 9 * s + 2);
      ctx.fillStyle = '#fff'; ctx.font = `700 ${Math.round(12 * s + 2)}px system-ui`; ctx.fillText(me.carrying >= 0 ? '🚩 You have the flag: run home!' : `${TEAM[me.team].name} team`, 16, H - 32 * s - 6);
      // Kill feed.
      ctx.textAlign = 'right'; ctx.font = `600 ${Math.round(11 * s + 2)}px system-ui`; feedLocal.slice(0, 5).forEach((f, i) => { ctx.globalAlpha = clamp(f.t, 0, 1); ctx.fillStyle = 'rgba(8,12,22,.65)'; const w = ctx.measureText(f.text).width + 12; ctx.fillRect(W - w - 8, 48 + i * (18 * s + 4) + 0, w, 16 * s + 3); ctx.fillStyle = f.team >= 0 ? TEAM[f.team].col : '#cfe0ff'; ctx.fillText(f.text, W - 14, 48 + i * (18 * s + 4) + 12 * s + 2); ctx.globalAlpha = 1; });
      // Minimap.
      { const mw = 150 * s + 10, mh = mw * (C.ARENA.h / C.ARENA.w) + 6, mx = W - mw - 8, my = H - mh - 8, k = (mw - 8) / C.ARENA.w;
        ctx.fillStyle = 'rgba(8,12,22,.7)'; ctx.fillRect(mx, my, mw, mh); const ox = mx + mw / 2, oy = my + mh / 2;
        ctx.fillStyle = 'rgba(255,255,255,.35)'; for (const b of C.WALLS) ctx.fillRect(ox + b.x * k, oy + b.y * k, b.w * k, b.h * k);
        for (const f of m.flags) { const p = f.state === 'carried' ? m.players.find((q) => q.id === f.carrier) : null; ctx.fillStyle = TEAM[f.team].col; ctx.fillRect(ox + (p ? p.x : f.x) * k - 2, oy + (p ? p.y : f.y) * k - 2, 4, 4); }
        for (const p of m.players) if (p.alive) { ctx.fillStyle = TEAM[p.team].col; ctx.beginPath(); ctx.arc(ox + p.x * k, oy + p.y * k, p === me ? 3 : 2, 0, TAU); ctx.fill(); if (p === me) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke(); } } }
      // Arrow to the flag I should go for.
      if (me.alive) { const f = me.carrying >= 0 ? C.STAND(me.team) : m.flags[1 - me.team]; const tx = f.x, ty = f.y, d = Math.hypot(tx - me.x, ty - me.y); if (d > 14) { const a = Math.atan2(ty - me.y, tx - me.x), r = Math.min(W, H) * 0.34; ctx.save(); ctx.translate(W / 2 + Math.cos(a) * r, H / 2 + Math.sin(a) * r); ctx.rotate(a); ctx.fillStyle = me.carrying >= 0 ? TEAM[me.team].col : TEAM[1 - me.team].col; ctx.globalAlpha = 0.85; ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(-6, -7); ctx.lineTo(-6, 7); ctx.fill(); ctx.restore(); ctx.globalAlpha = 1; } }
      ctx.textAlign = 'center';
      if (!me.alive && !m.over) { ctx.fillStyle = 'rgba(120,0,0,.25)'; ctx.fillRect(0, 0, W, H); ctx.font = `800 ${Math.round(30 * s + 6)}px system-ui`; ctx.fillStyle = '#fff'; ctx.fillText('You were knocked out', W / 2, H * 0.4); ctx.font = `700 ${Math.round(16 * s + 3)}px system-ui`; ctx.fillStyle = '#ffd24d'; ctx.fillText(`Back in ${Math.max(1, Math.ceil(me.respawnT))}…`, W / 2, H * 0.4 + 30 * s + 8); }
      if (hitFlash > 0) { ctx.fillStyle = `rgba(255,40,40,${hitFlash})`; ctx.fillRect(0, 0, W, H); }
      if (toastT > 0 && toastText) { ctx.font = `700 ${Math.round(15 * s + 3)}px system-ui`; const w = ctx.measureText(toastText).width + 26; ctx.fillStyle = 'rgba(8,12,22,.82)'; ctx.fillRect(W / 2 - w / 2, H * 0.14, w, 30 * s + 8); ctx.fillStyle = '#ffd24d'; ctx.fillText(toastText, W / 2, H * 0.14 + 21 * s + 5); }
    }

    // ---------- the loop
    function frame(now) {
      if (!alive) return;
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (toastT > 0) toastT -= dt; if (hitFlash > 0) hitFlash -= dt * 1.5;
      if ((screen === 'play' || screen === 'over') && m && me) stepPlay(dt);
      draw();
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    // ---------- input
    const api = { joinDraft: '', online: false };
    api.key = (k, down) => {
      if (!alive) return; if (k.length === 1) k = k.toLowerCase();
      if (down) {
        if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
        if (k === 'm') { const v = !store.get('sound', true); store.set('sound', v); if (!v) audio.kill(); renderTop(); bindUi(); }
        if (k === 'Enter') { if (screen === 'menu') { if (net) { if (net.role === 'host') hostStart(); } else if (!api.online) startSolo(); } else if (screen === 'over') act('again'); }
        keys.add(k);
      } else keys.delete(k);
    };
    const kd = (e) => { if (e.target && e.target.tagName === 'INPUT') return; const k = e.key.length === 1 ? e.key.toLowerCase() : e.key; if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(k)) e.preventDefault(); if (e.repeat) return; api.key(k, true); };
    const ku = (e) => { const k = e.key.length === 1 ? e.key.toLowerCase() : e.key; api.key(k, false); };
    box.addEventListener('keydown', kd); box.addEventListener('keyup', ku); window.addEventListener('blur', () => { keys.clear(); mouse.down = false; });
    const mpos = (e) => { const r = cv.getBoundingClientRect(); mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top; mouse.moved = performance.now(); };
    cv.addEventListener('mousemove', mpos);
    cv.addEventListener('mousedown', (e) => { mpos(e); if (e.button === 0) mouse.down = true; box.focus(); });
    window.addEventListener('mouseup', () => { mouse.down = false; });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    api.suspend = () => { audio.hold(true); keys.clear(); mouse.down = false; cancelAnimationFrame(raf); raf = 0; };
    api.resume = () => { audio.hold(false); last = performance.now(); if (!raf && alive) raf = requestAnimationFrame(frame); };
    api.state = () => ({ screen, online: !!net, role: net && net.role, status: net && net.status, running: net && net.running, peers: net ? net.peers.size : 0, roster: net ? net.roster.length : 0, hostSeen: !!(net && net.hostSeen), score: m && m.score.slice(), t: m && +m.t.toFixed(1), over: m && m.over, winner: m && m.winner, players: m && m.players.map((p) => ({ id: p.id, name: p.name, team: p.team, bot: p.bot, alive: p.alive, x: +p.x.toFixed(0), y: +p.y.toFixed(0), caps: p.caps, kills: p.kills, deaths: p.deaths, carrying: p.carrying })), flags: m && m.flags.map((f) => [f.state, f.carrier]), audio: audio.active });
    api.dev = { startSolo, act, openRoom, hostStart, get m() { return m; }, get me() { return me; }, keys, get cfg() { return cfg; }, set cfg(v) { cfg = v; }, setAutoPlay(v) { api.auto = !!v; } };
    // For tests: the computer plays my player too.
    showUi();
    const stop = () => { alive = false; cancelAnimationFrame(raf); ro.disconnect(); leaveRoom(); audio.hold(true); host.innerHTML = ''; if (window.NotchCtfGame.current === api) window.NotchCtfGame.current = null; };
    window.NotchCtfGame.current = api;
    return stop;
  }

  window.NotchCtfGame = {
    current: null,
    mount,
    key: (k, down) => { const c = window.NotchCtfGame.current; if (c) c.key(k, down); },
    suspend: () => { const c = window.NotchCtfGame.current; if (c) c.suspend(); },
    resume: () => { const c = window.NotchCtfGame.current; if (c) c.resume(); },
    state: () => { const c = window.NotchCtfGame.current; return c ? c.state() : null; },
    get dev() { const c = window.NotchCtfGame.current; return c && c.dev; },
  };
})();
