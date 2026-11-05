// Rocket League for the Games tab, shared by the Mac and Windows apps: side-on car soccer. Drive, jump, dash with a second jump
// and boost to knock the ball into the other team's goal. Play against computer players, or online against a friend over the
// same live relay Capture the Flag and Racing use. The rules, physics and computer players are in rocket-logic.js.
//
//   window.NotchRocketGame.mount(hostElement, opts)   starts the game; returns a function that stops it.
//        opts (optional): { room: 'ABC234', host: true|false, name: 'Ada' } joins that online room at once (used by friend chats:
//        the one who invited is the host and plays Blue, the other is the guest and plays Orange).
//   window.NotchRocketGame.key(k, down)                a key sent in from outside the page (the Mac app forwards its keys this way).
//   window.NotchRocketGame.suspend() / resume()        the notch closed / opened: nothing keeps running.
//
// Online: the host runs the match (60 steps a second) and sends a small snapshot 30 times a second; the guest sends its keys and
// draws what it is sent, smoothed. With no connection, "Play the computer" always works.
(function () {
  'use strict';
  const L = window.NotchRocketLogic;
  const RELAY = 'wss://notchapple-rooms.adityajain1225.workers.dev';
  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const TEAM = [{ name: 'Blue', col: '#4da3ff', dark: '#1d5fb0' }, { name: 'Orange', col: '#ff9a3d', dark: '#b8601a' }];
  const LEVELS = [{ id: 0.5, name: 'Easy' }, { id: 0.75, name: 'Normal' }, { id: 1, name: 'Hard' }];
  const BOT_NAMES = ['Ada', 'Rex', 'Mika', 'Zed', 'Lia', 'Kai', 'Nova', 'Bo'];
  const STEP = 1 / 60;

  const store = {
    get(k, d) { try { const v = localStorage.getItem('rocket.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('rocket.' + k, JSON.stringify(v)); } catch { /* storage off */ } },
  };
  const newCode = () => Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  const normCode = (raw) => { const c = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); return c.length === 6 && [...c].every((ch) => CODE_CHARS.includes(ch)) ? c : null; };
  const clean = (t, n = 14) => String(t == null ? '' : t).replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  /// A fresh id for every match window (not saved), so two windows on one machine are two players.
  const newId = () => [...crypto.getRandomValues(new Uint8Array(4))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const clock = (t) => { t = Math.max(0, Math.ceil(t)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };

  /// A link to a room on the relay (its own rooms, so Rocket League never meets another game).
  class Link {
    constructor(onMessage, onState) { this.onMessage = onMessage; this.onState = onState; this.ws = null; this.state = 'off'; this.retry = 0; this.want = false; this.timer = 0; }
    async join(code) {
      this.close();
      const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`notchapple-rocket-v1|${code}`)));
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
  .rl { position: relative; width: 100%; height: 100%; overflow: hidden; background: #0a0e17; color: #fff; font: 13px/1.35 -apple-system, "Segoe UI", system-ui, sans-serif; user-select: none; outline: none; }
  .rl canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
  .rl .menu { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; background: rgba(8,12,20,.82); text-align: center; padding: 12px; }
  .rl h2 { margin: 0; font-size: 22px; letter-spacing: .4px; }
  .rl p { margin: 0; color: #aab4c4; max-width: 460px; }
  .rl .row { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; align-items: center; }
  .rl button { font: inherit; color: #fff; background: rgba(255,255,255,.12); border: 0; border-radius: 9px; padding: 7px 14px; cursor: pointer; }
  .rl button:hover { background: rgba(255,255,255,.2); } .rl button.go { background: linear-gradient(135deg,#4da3ff,#ff9a3d); font-weight: 600; } .rl button.on { outline: 2px solid #fff; }
  .rl input { font: inherit; color: #fff; background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.2); border-radius: 8px; padding: 6px 9px; width: 96px; text-align: center; letter-spacing: 2px; text-transform: uppercase; }
  .rl .code { font-size: 26px; letter-spacing: 6px; font-weight: 700; }
  .rl .small { font-size: 11px; color: #8d98aa; }
  .rl .menu[hidden], .rl .leave[hidden] { display: none; }
  .rl .leave { position: absolute; left: 6px; top: 6px; opacity: .35; padding: 3px 9px; font-size: 11px; } .rl .leave:hover { opacity: 1; }
  `;

  function mount(host, opts = {}) {
    const style = document.createElement('style'); style.textContent = CSS;
    const root = document.createElement('div'); root.className = 'rl'; root.tabIndex = 0;
    const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d');
    const menu = document.createElement('div'); menu.className = 'menu';
    const leave = document.createElement('button'); leave.className = 'leave'; leave.textContent = '← Menu'; leave.hidden = true;
    root.append(style, canvas, menu, leave); host.innerHTML = ''; host.append(root);

    const myId = newId();
    let alive = true, held = false, raf = 0, last = 0, acc = 0, tick = 0;
    let m = null;                    // the match being drawn (the host's own, or the guest's picture of it)
    let mode = 'menu';               // menu | solo | host | guest | waiting-host | waiting-guest
    let link = null, meId = myId, myName = clean(opts.name || store.get('name', ''), 14) || 'Player';
    let guestId = null, target = null, targetAt = 0, lastSnap = 0, lastIn = 0, lastGuestIn = 0, sentKeys = '';
    let level = store.get('level', 0.75), size = store.get('size', 1), guestKeys = { l: false, r: false, j: false, b: false };
    const keys = { l: false, r: false, j: false, b: false };
    let banner = '', bannerT = 0, hostCode = null, hostTimer = 0, joinedMsg = '';

    // ---------- menus
    function showMenu(html, wire) { menu.innerHTML = html; menu.style.background = ''; menu.hidden = false; leave.hidden = mode === 'menu'; if (wire) wire(menu); }
    function mainMenu() {
      closeLink(); mode = 'menu'; m = null; leave.hidden = true;
      showMenu(`<h2>🚀 Rocket League</h2><p>Knock the ball into the other goal. Space or W jumps (press again in the air to dash), Shift or X boosts, A D or the arrows drive and spin.</p>
        <div class="row"><b>Computer level</b>${LEVELS.map((l) => `<button data-lv="${l.id}" class="${l.id === level ? 'on' : ''}">${l.name}</button>`).join('')}</div>
        <div class="row"><button data-sz="1" class="${size === 1 ? 'on' : ''}">1 v 1</button><button data-sz="2" class="${size === 2 ? 'on' : ''}">2 v 2</button></div>
        <div class="row"><button class="go" data-a="solo">Play the computer</button></div>
        <div class="row"><button data-a="create">Create online room</button><input data-in maxlength="7" placeholder="CODE" value=""><button data-a="join">Join</button></div>
        <p class="small">Online is one against one. The one who creates the room plays Blue.</p>`, (el) => {
        el.querySelectorAll('[data-lv]').forEach((b) => b.onclick = () => { level = +b.dataset.lv; store.set('level', level); mainMenu(); });
        el.querySelectorAll('[data-sz]').forEach((b) => b.onclick = () => { size = +b.dataset.sz; store.set('size', size); mainMenu(); });
        el.querySelector('[data-a=solo]').onclick = startSolo;
        el.querySelector('[data-a=create]').onclick = () => startOnline(newCode(), true);
        el.querySelector('[data-a=join]').onclick = () => { const c = normCode(el.querySelector('[data-in]').value); if (c) startOnline(c, false); else el.querySelector('[data-in]').style.borderColor = '#ff6b5d'; };
      });
    }

    // ---------- solo
    function newBotMatch() {
      const mm = L.newMatch({ time: 180 });
      return mm;
    }
    function startSolo() {
      closeLink(); mode = 'solo'; m = newBotMatch(); meId = myId;
      L.addCar(m, { id: myId, name: myName, team: 0 });
      const names = BOT_NAMES.slice().sort(() => Math.random() - 0.5);
      if (size === 2) L.addCar(m, { id: 'bot-mate', name: names.pop(), team: 0, bot: true, skill: level });
      L.addCar(m, { id: 'bot-o1', name: names.pop(), team: 1, bot: true, skill: level });
      if (size === 2) L.addCar(m, { id: 'bot-o2', name: names.pop(), team: 1, bot: true, skill: level });
      menu.hidden = true; leave.hidden = false; root.focus();
    }

    // ---------- online
    function closeLink() { clearInterval(hostTimer); if (link) { try { link.send({ t: 'bye', id: myId }); } catch { /* gone */ } link.close(); link = null; } guestId = null; hostCode = null; }
    function startOnline(code, asHost) {
      closeLink(); hostCode = code; mode = asHost ? 'waiting-guest' : 'waiting-host'; m = null;
      link = new Link(onMessage, (s) => { if (s === 'failed') showMenu(`<h2>No connection</h2><p>Could not reach the game server. You can still play the computer.</p><div class="row"><button data-a="back">Back</button></div>`, (el) => { el.querySelector('[data-a=back]').onclick = mainMenu; }); });
      link.join(code);
      renderWaiting();
      if (asHost) { hostTimer = setInterval(() => link && link.send({ t: 'host', id: myId, name: myName }), 1500); }
      else hostTimer = setInterval(() => link && link.send({ t: 'join', id: myId, name: myName }), 1500);
    }
    function renderWaiting() {
      if (mode === 'waiting-guest') showMenu(`<h2>Online room</h2><div class="code">${esc(hostCode)}</div><p>Give this code to a friend. They choose “Join”. You play Blue.</p><div class="small">${esc(joinedMsg) || 'Waiting for them…'}</div><div class="row"><button data-a="solo">Play the computer instead</button><button data-a="back">Back</button></div>`,
        (el) => { el.querySelector('[data-a=solo]').onclick = startSolo; el.querySelector('[data-a=back]').onclick = mainMenu; });
      else showMenu(`<h2>Joining ${esc(hostCode)}…</h2><p>Waiting for the host to start the match.</p><div class="row"><button data-a="back">Back</button></div>`, (el) => { el.querySelector('[data-a=back]').onclick = mainMenu; });
    }
    function hostBegin() {
      if (!guestId) return;
      clearInterval(hostTimer);
      m = L.newMatch({ time: 180 }); mode = 'host'; meId = myId;
      L.addCar(m, { id: myId, name: myName, team: 0 });
      L.addCar(m, { id: guestId.id, name: guestId.name, team: 1 });
      link.send({ t: 'start', host: { id: myId, name: myName }, guest: guestId });
      menu.hidden = true; leave.hidden = false; lastGuestIn = performance.now(); root.focus();
    }
    function guestBegin(msg) {
      m = L.newMatch({ time: 180 }); target = L.newMatch({ time: 180 }); mode = 'guest'; meId = myId;
      for (const mm of [m, target]) { L.addCar(mm, { id: msg.host.id, name: clean(msg.host.name), team: 0 }); L.addCar(mm, { id: msg.guest.id, name: clean(msg.guest.name), team: 1 }); }
      targetAt = performance.now(); lastSnap = performance.now();
      menu.hidden = true; leave.hidden = false; root.focus();
    }
    function onMessage(msg) {
      if (!alive) return;
      if (msg.t === 'host' && mode === 'waiting-host' && msg.id !== myId) link.send({ t: 'join', id: myId, name: myName });
      else if (msg.t === 'join' && (mode === 'waiting-guest' || mode === 'host') && msg.id !== myId) {
        if (mode === 'waiting-guest' && !guestId) { guestId = { id: clean(msg.id, 12), name: clean(msg.name) || 'Guest' }; joinedMsg = `${guestId.name} joined.`; hostBegin(); }
        else if (mode === 'host' && guestId && msg.id === guestId.id) link.send({ t: 'start', host: { id: myId, name: myName }, guest: guestId, again: 1 });     // they missed the start
      } else if (msg.t === 'start' && msg.guest && msg.guest.id === myId && (mode === 'waiting-host' || mode === 'guest')) { clearInterval(hostTimer); guestBegin(msg); }
      else if (msg.t === 'snap' && mode === 'guest' && msg.s) { applyTarget(msg.s); }
      else if (msg.t === 'in' && mode === 'host' && guestId && msg.id === guestId.id && Array.isArray(msg.k)) { guestKeys = { l: !!msg.k[0], r: !!msg.k[1], j: !!msg.k[2], b: !!msg.k[3] }; lastGuestIn = performance.now(); }
      else if (msg.t === 'bye') {
        if (mode === 'host' && guestId && msg.id === guestId.id) endOnline('Your opponent left the match.');
        else if (mode === 'guest') endOnline('The host left the match.');
      }
    }
    function endOnline(text) {
      mode = 'menu'; clearInterval(hostTimer); if (link) { link.close(); link = null; } m = null;
      showMenu(`<h2>Match over</h2><p>${esc(text)}</p><div class="row"><button class="go" data-a="back">Menu</button></div>`, (el) => { el.querySelector('[data-a=back]').onclick = mainMenu; });
    }
    function applyTarget(s) {
      L.applySnapshot(target, s); targetAt = performance.now(); lastSnap = targetAt;
    }

    // ---------- keys
    const KEYMAP = { a: 'l', arrowleft: 'l', d: 'r', arrowright: 'r', w: 'j', arrowup: 'j', ' ': 'j', shift: 'b', x: 'b', z: 'b' };
    function setKey(k, down) { const a = KEYMAP[String(k).toLowerCase()]; if (!a) return false; keys[a] = down; return true; }
    const onKeyDown = (e) => { if (mode !== 'solo' && mode !== 'host' && mode !== 'guest') return; if (setKey(e.key, true)) e.preventDefault(); };
    const onKeyUp = (e) => { if (setKey(e.key, false)) e.preventDefault(); };
    root.addEventListener('keydown', onKeyDown); root.addEventListener('keyup', onKeyUp);
    canvas.addEventListener('mousedown', () => { keys.b = true; root.focus(); }); window.addEventListener('mouseup', () => { keys.b = false; });
    root.addEventListener('blur', () => { keys.l = keys.r = keys.j = keys.b = false; });
    leave.onclick = () => { if (mode === 'host' || mode === 'guest') { try { link.send({ t: 'bye', id: myId }); } catch { /* gone */ } } mainMenu(); };

    // ---------- the loop
    function frame(now) {
      if (!alive) return;
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
      if (m && (mode === 'solo' || mode === 'host')) {
        acc += dt;
        let n = 0;
        while (acc >= STEP && n++ < 5) {
          const ctl = { [myId]: keys };
          if (mode === 'host' && guestId) ctl[guestId.id] = guestKeys;
          L.step(m, ctl, STEP); acc -= STEP; tick++;
          if (mode === 'host' && tick % 2 === 0 && link) link.send({ t: 'snap', s: L.snapshot(m) });
          for (const ev of m.events) onEvent(ev);
          m.events.length = 0;
        }
        if (acc > 0.25) acc = 0;
        if (mode === 'host' && guestId && performance.now() - lastGuestIn > 6000) endOnline('The connection to your opponent was lost.');
      } else if (mode === 'guest' && m) {
        const k = `${+keys.l}${+keys.r}${+keys.j}${+keys.b}`;
        if ((k !== sentKeys || now - lastIn > 40) && link && now - lastIn > 16) { link.send({ t: 'in', id: myId, k: [keys.l, keys.r, keys.j, keys.b] }); sentKeys = k; lastIn = now; }
        smooth(performance.now());
        if (performance.now() - lastSnap > 5000) endOnline('The connection to the host was lost.');
      }
      if (bannerT > 0) bannerT -= dt;
      draw();
    }
    function onEvent(ev) {
      if (ev.e === 'goal' && m) { banner = `GOAL! ${TEAM[ev.team].name} scores`; bannerT = 2.4; }
      else if (ev.e === 'overtime') { banner = 'OVERTIME: next goal wins'; bannerT = 2.5; }
      else if (ev.e === 'go') { banner = 'GO!'; bannerT = 0.7; }
    }
    /// The guest eases what it draws toward the host's latest picture, carried forward by how old it is.
    function smooth(now) {
      const age = Math.min(0.12, (now - targetAt) / 1000);
      const ease = (v, tx, ty) => { if (Math.hypot(tx - v.x, ty - v.y) > 260) { v.x = tx; v.y = ty; } else { v.x += (tx - v.x) * 0.45; v.y += (ty - v.y) * 0.45; } };
      ease(m.ball, target.ball.x + target.ball.vx * age, target.ball.y + target.ball.vy * age);
      m.ball.vx = target.ball.vx; m.ball.vy = target.ball.vy;
      for (const c of m.cars) {
        const t = target.cars.find((k) => k.id === c.id); if (!t) continue;
        ease(c, t.x + t.vx * age, t.y + t.vy * age);
        let d = t.a - c.a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
        c.a += d * 0.5; c.vx = t.vx; c.vy = t.vy; c.boost = t.boost; c.boosting = t.boosting; c.ground = t.ground; c.flip = t.flip; c.flipDir = t.flipDir; c.goals = t.goals;
      }
      const prevState = m.state, prevScore = m.score.join();
      m.state = target.state; m.stateT = target.stateT; m.clock = target.clock; m.overtime = target.overtime; m.score = target.score; m.winner = target.winner; m.pads = target.pads;
      if (m.score.join() !== prevScore && m.state === 'goal') onEvent({ e: 'goal', team: m.score[0] > +prevScore[0] ? 0 : 1 });
      if (prevState !== 'play' && m.state === 'play') onEvent({ e: 'go' });
    }

    // ---------- drawing
    function fit() {
      const r = root.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      const w = Math.max(200, Math.round(r.width * dpr)), h = Math.max(120, Math.round(r.height * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      return { w, h, dpr };
    }
    function draw() {
      const { w, h } = fit();
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, w, h);
      const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#101a2e'); g.addColorStop(1, '#0a0e17'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      if (!m) return;
      const hud = Math.max(28, h * 0.1), worldW = L.W + 2 * L.GOAL_DEPTH + 40, worldH = L.H;
      const s = Math.min(w / worldW, (h - hud) / worldH);
      ctx.setTransform(s, 0, 0, s, (w - worldW * s) / 2 + (L.GOAL_DEPTH + 20) * s, hud + ((h - hud) - worldH * s) / 2);
      drawArena(); drawPads(); drawBall(); for (const c of m.cars) drawCar(c);
      ctx.setTransform(1, 0, 0, 1, 0, 0); drawHud(w, h, hud);
    }
    function drawArena() {
      // field
      const f = ctx.createLinearGradient(0, 0, 0, L.FLOOR); f.addColorStop(0, '#16243d'); f.addColorStop(1, '#1d3354'); ctx.fillStyle = f; ctx.fillRect(0, 0, L.W, L.FLOOR);
      ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(L.W / 2, 0); ctx.lineTo(L.W / 2, L.FLOOR); ctx.stroke();
      ctx.beginPath(); ctx.arc(L.W / 2, L.FLOOR, 190, Math.PI, 0); ctx.stroke();
      // goals
      for (const t of [0, 1]) {
        const x0 = t === 0 ? -L.GOAL_DEPTH : L.W, col = TEAM[t].col;
        const gg = ctx.createLinearGradient(t === 0 ? x0 : x0 + L.GOAL_DEPTH, 0, t === 0 ? x0 + L.GOAL_DEPTH : x0, 0); gg.addColorStop(0, col + '66'); gg.addColorStop(1, col + '14');
        ctx.fillStyle = gg; ctx.fillRect(x0, L.GOAL_TOP, L.GOAL_DEPTH, L.GOAL_H);
        ctx.strokeStyle = col; ctx.lineWidth = 6; ctx.strokeRect(x0, L.GOAL_TOP, L.GOAL_DEPTH, L.GOAL_H);
        ctx.strokeStyle = col + '55'; ctx.lineWidth = 1.5; for (let i = 1; i < 6; i++) { const yy = L.GOAL_TOP + (L.GOAL_H / 6) * i; ctx.beginPath(); ctx.moveTo(x0, yy); ctx.lineTo(x0 + L.GOAL_DEPTH, yy); ctx.stroke(); }
      }
      // floor and walls
      ctx.fillStyle = '#2b4570'; ctx.fillRect(-L.GOAL_DEPTH - 10, L.FLOOR, L.W + 2 * L.GOAL_DEPTH + 20, 60);
      ctx.fillStyle = '#4d79b8'; ctx.fillRect(-L.GOAL_DEPTH - 10, L.FLOOR, L.W + 2 * L.GOAL_DEPTH + 20, 6);
      ctx.fillStyle = '#2b4570'; ctx.fillRect(-14, 0, 14, L.GOAL_TOP); ctx.fillRect(L.W, 0, 14, L.GOAL_TOP);
    }
    function drawPads() {
      L.PADS.forEach((p, i) => {
        const ready = !m.pads[i]; ctx.fillStyle = ready ? (p.big ? '#ffd24d' : '#ffe9a8') : 'rgba(255,255,255,.15)';
        const w = p.big ? 70 : 44; ctx.beginPath(); ctx.ellipse(p.x, L.FLOOR + 2, w / 2, p.big ? 9 : 6, 0, 0, Math.PI * 2); ctx.fill();
        if (ready && p.big) { ctx.strokeStyle = 'rgba(255,210,77,.5)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(p.x, L.FLOOR + 2, w / 2 + 8, 14, 0, 0, Math.PI * 2); ctx.stroke(); }
      });
    }
    function drawBall() {
      const b = m.ball, r = L.BALL.r;
      ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); ctx.ellipse(b.x, L.FLOOR + 3, r * (0.55 + 0.45 * Math.max(0, 1 - (L.FLOOR - b.y) / 700)), 7, 0, 0, Math.PI * 2); ctx.fill();
      const rot = (b.x * 0.02) % (Math.PI * 2);
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(rot);
      const bg = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r); bg.addColorStop(0, '#ffffff'); bg.addColorStop(1, '#bcc7d8');
      ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#5b6b86'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, r - 1.5, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#5b6b86'; for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; ctx.beginPath(); ctx.arc(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55, r * 0.14, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
    function drawCar(c) {
      const t = TEAM[c.team], mine = c.id === meId;
      ctx.save(); ctx.translate(c.x, c.y);
      ctx.fillStyle = 'rgba(0,0,0,.25)'; if (c.ground) { ctx.beginPath(); ctx.ellipse(0, L.CAR.r + 2, 44, 6, 0, 0, Math.PI * 2); ctx.fill(); }
      // the picture faces right with its roof up; a car pointing left is drawn mirrored so its roof stays up
      const flip = c.flip > 0 ? c.flipDir * (1 - c.flip / 0.45) * Math.PI * 2 : 0;
      if (Math.cos(c.a) >= 0) ctx.rotate(c.a + flip); else { ctx.scale(-1, 1); ctx.rotate(Math.PI - c.a + flip); }
      if (c.boosting) { ctx.fillStyle = '#ffb347'; ctx.beginPath(); ctx.moveTo(-40, -6); ctx.lineTo(-90 - Math.random() * 26, 0); ctx.lineTo(-40, 6); ctx.fill(); ctx.fillStyle = '#fff3c2'; ctx.beginPath(); ctx.moveTo(-40, -3); ctx.lineTo(-64 - Math.random() * 10, 0); ctx.lineTo(-40, 3); ctx.fill(); }
      ctx.fillStyle = t.col; ctx.beginPath(); ctx.roundRect(-44, -16, 88, 30, 9); ctx.fill();
      ctx.fillStyle = t.dark; ctx.beginPath(); ctx.roundRect(-14, -34, 44, 22, 8); ctx.fill();
      ctx.fillStyle = '#bfe3ff'; ctx.beginPath(); ctx.roundRect(-8, -31, 33, 16, 5); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillRect(38, -10, 6, 8);
      ctx.fillStyle = '#111'; for (const x of [-26, 26]) { ctx.beginPath(); ctx.arc(x, 14, 10, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#9aa3b2'; ctx.beginPath(); ctx.arc(x, 14, 4, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#111'; }
      ctx.restore();
      ctx.fillStyle = mine ? '#fff' : 'rgba(255,255,255,.75)'; ctx.font = '600 24px -apple-system, "Segoe UI", sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(c.name, c.x, c.y - 56);
    }
    function drawHud(w, h, hud) {
      const sc = m.score, f = Math.round(hud * 0.62);
      ctx.textAlign = 'center'; ctx.font = `700 ${f}px -apple-system, "Segoe UI", sans-serif`;
      ctx.fillStyle = TEAM[0].col; ctx.fillText(sc[0], w / 2 - f * 3.2, hud * 0.72);
      ctx.fillStyle = TEAM[1].col; ctx.fillText(sc[1], w / 2 + f * 3.2, hud * 0.72);
      ctx.fillStyle = '#fff'; ctx.font = `600 ${Math.round(f * 0.9)}px ui-monospace, Menlo, monospace`; ctx.fillText(m.overtime ? 'OT' : clock(m.clock), w / 2, hud * 0.72);
      const me = m.cars.find((c) => c.id === meId);
      if (me) { // my boost, bottom left
        const bw = Math.min(180, w * 0.28), bh = 9, x = 12, y = h - 18;
        ctx.fillStyle = 'rgba(255,255,255,.14)'; ctx.fillRect(x, y, bw, bh); ctx.fillStyle = me.boost > 0 ? '#ffb347' : '#555'; ctx.fillRect(x, y, bw * me.boost / 100, bh);
        ctx.fillStyle = '#aab4c4'; ctx.font = '11px -apple-system, "Segoe UI", sans-serif'; ctx.textAlign = 'left'; ctx.fillText('BOOST', x, y - 4);
      }
      let text = '';
      if (m.state === 'countdown') text = String(Math.max(1, Math.ceil(m.stateT)));
      else if (bannerT > 0) text = banner;
      if (m.state === 'over') text = `${m.winner == null ? 'Draw' : TEAM[m.winner].name + ' wins'}  ${sc[0]} – ${sc[1]}`;
      if (text) { ctx.textAlign = 'center'; ctx.font = `800 ${Math.round(h * 0.11)}px -apple-system, "Segoe UI", sans-serif`; ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.strokeText(text, w / 2, h * 0.42); ctx.fillStyle = '#fff'; ctx.fillText(text, w / 2, h * 0.42); }
      if (m.state === 'over' && menu.hidden) overMenu();
    }
    function overMenu() {
      const guest = mode === 'guest';
      showMenu(`<h2>${m.winner == null ? 'Draw' : esc(TEAM[m.winner].name) + ' wins'}</h2><p>${m.score[0]} – ${m.score[1]}</p><div class="row">${guest ? '<span class="small">Waiting for the host to start a rematch…</span>' : '<button class="go" data-a="again">Rematch</button>'}<button data-a="back">Menu</button></div>`, (el) => {
        const again = el.querySelector('[data-a=again]');
        if (again) again.onclick = () => { if (mode === 'solo') startSolo(); else if (mode === 'host') hostBegin(); };
        el.querySelector('[data-a=back]').onclick = () => { if (mode === 'host' || mode === 'guest') { try { link.send({ t: 'bye', id: myId }); } catch { /* gone */ } } mainMenu(); };
      });
      menu.style.background = 'rgba(8,12,20,.55)';
    }

    // ---------- outside controls
    const api = {
      key: (k, down) => { if (mode === 'solo' || mode === 'host' || mode === 'guest') setKey(k, !!down); },
      suspend: () => { alive = false; cancelAnimationFrame(raf); keys.l = keys.r = keys.j = keys.b = false; if (link) { try { link.send({ t: 'bye', id: myId }); } catch { /* gone */ } link.close(); link = null; } },
      resume: () => { if (alive) return; alive = true; last = 0; mainMenu(); raf = requestAnimationFrame(frame); },
    };
    window.NotchRocketGame.current = api;
    const stop = () => { alive = false; cancelAnimationFrame(raf); closeLink(); host.innerHTML = ''; if (window.NotchRocketGame.current === api) window.NotchRocketGame.current = null; };
    if (opts.room && normCode(opts.room)) startOnline(normCode(opts.room), opts.host === true || opts.host === 1 || opts.host === '1' || opts.host === 'true'); else mainMenu();
    raf = requestAnimationFrame(frame);
    return stop;
  }

  window.NotchRocketGame = {
    current: null,
    mount,
    key: (k, down) => { const c = window.NotchRocketGame.current; if (c) c.key(k, down); },
    suspend: () => { const c = window.NotchRocketGame.current; if (c) c.suspend(); },
    resume: () => { const c = window.NotchRocketGame.current; if (c) c.resume(); },
  };
})();
