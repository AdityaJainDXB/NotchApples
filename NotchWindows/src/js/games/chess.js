// Chess for the Games tab, shared by the Mac and Windows apps: play the computer (four levels) or a friend in an online room
// that uses the same 6-character codes and the same live relay as the Plane, Racing and Capture the Flag games.
// The rules and the computer player are in chess-logic.js.
//
//   window.NotchChessGame.mount(hostElement)   starts the game; returns a function that stops it.
//   window.NotchChessGame.suspend() / resume() the notch closed / opened: the computer stops thinking.
//
// Online: whoever opens the room is White (or picks a side); the other player joins with the code. Both sides check every
// move against the rules, so a move that is not legal is ignored. A reconnecting player gets the whole game again.
(function () {
  'use strict';
  const L = window.NotchChessLogic;
  const RELAY = 'wss://notchapple-rooms.adityajain1225.workers.dev';
  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const newCode = () => Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  const normCode = (raw) => { const c = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); return c.length === 6 && [...c].every((ch) => CODE_CHARS.includes(ch)) ? c : null; };
  const store = {
    get(k, d) { try { const v = localStorage.getItem('chess.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('chess.' + k, JSON.stringify(v)); } catch { /* storage off */ } },
  };
  const myId = (() => { let id = store.get('id', ''); if (!id) { id = [...crypto.getRandomValues(new Uint8Array(4))].map((b) => b.toString(16).padStart(2, '0')).join(''); store.set('id', id); } return id; })();
  const GLYPH = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙', k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
  const LEVELS = ['Beginner', 'Casual', 'Club', 'Strong'];

  /// A link to a room on the relay (rooms of its own, so Chess never meets the other games).
  class Link {
    constructor(onMessage, onState) { this.onMessage = onMessage; this.onState = onState; this.ws = null; this.state = 'off'; this.retry = 0; this.want = false; this.timer = 0; }
    async join(code) {
      this.close();
      const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`notchapple-chess-v1|${code}`)));
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
  .ch { position: relative; width: 100%; height: 100%; overflow: hidden; background: #14110d; color: #f3ece0; font: 13px/1.35 -apple-system, "Segoe UI", system-ui, sans-serif; user-select: none; display: flex; gap: 12px; padding: 10px; box-sizing: border-box; }
  .ch * { box-sizing: border-box; }
  .ch .ch-boardwrap { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; justify-content: center; }
  .ch .ch-board { display: grid; grid-template-columns: repeat(8, 1fr); grid-template-rows: repeat(8, 1fr); aspect-ratio: 1; height: 100%; max-width: 100%; max-height: 100%; border-radius: 6px; overflow: hidden; box-shadow: 0 8px 30px rgba(0,0,0,.5); }
  .ch .ch-sq { position: relative; display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: min(7.2vh, 6vw); line-height: 1; }
  .ch .ch-sq.l { background: #e8d3a8; } .ch .ch-sq.d { background: #a9794d; }
  .ch .ch-sq.sel { background: #f6d860 !important; } .ch .ch-sq.last { box-shadow: inset 0 0 0 100px rgba(255,214,70,.38); }
  .ch .ch-sq.chk { background: radial-gradient(circle, #ff4d4d 0, #d63a3a 40%, transparent 75%), var(--bg, #a9794d); }
  .ch .ch-sq.dot::after { content: ''; position: absolute; width: 28%; height: 28%; border-radius: 50%; background: rgba(20,60,20,.42); }
  .ch .ch-sq.cap::after { content: ''; position: absolute; inset: 4%; border-radius: 50%; border: 4px solid rgba(20,60,20,.45); }
  .ch .ch-p { text-shadow: 0 1px 2px rgba(0,0,0,.35); pointer-events: none; }
  .ch .ch-p.w { color: #fffaf0; -webkit-text-stroke: 1px #3a2a14; } .ch .ch-p.b { color: #1a1510; }
  .ch .ch-co { position: absolute; font-size: 9px; font-weight: 700; opacity: .7; color: #3a2a14; pointer-events: none; } .ch .ch-co.f { right: 3px; bottom: 1px; } .ch .ch-co.r { left: 3px; top: 1px; }
  .ch .ch-side { flex: 0 0 168px; display: flex; flex-direction: column; gap: 6px; min-height: 0; }
  .ch h1 { margin: 0; font-size: 17px; }
  .ch .ch-hint { color: #bfae93; font-size: 11.5px; }
  .ch .ch-status { font-weight: 700; padding: 6px 8px; border-radius: 9px; background: rgba(255,255,255,.08); }
  .ch .ch-status.over { background: #ffb347; color: #1b1300; }
  .ch .ch-moves { flex: 1 1 auto; min-height: 40px; overflow: auto; font-size: 12px; background: rgba(255,255,255,.05); border-radius: 9px; padding: 5px 8px; font-variant-numeric: tabular-nums; }
  .ch .ch-moves b { color: #bfae93; font-weight: 600; }
  .ch .ch-row { display: flex; gap: 5px; flex-wrap: wrap; align-items: center; }
  .ch button { font: inherit; font-weight: 700; padding: 5px 9px; border-radius: 9px; border: 1px solid rgba(255,255,255,.22); background: rgba(255,255,255,.07); color: #fff; cursor: pointer; }
  .ch button:hover { background: rgba(255,255,255,.15); }
  .ch button.on { border-color: #ffb347; box-shadow: 0 0 0 1px #ffb347 inset; background: rgba(255,179,71,.16); }
  .ch button.go { background: #ffb347; color: #1b1300; border-color: #ffb347; }
  .ch input { font: inherit; width: 90px; padding: 5px 8px; border-radius: 9px; border: 1px solid rgba(255,255,255,.25); background: rgba(255,255,255,.08); color: #fff; outline: none; text-transform: uppercase; letter-spacing: .12em; }
  .ch .ch-menu { position: absolute; inset: 0; z-index: 4; background: rgba(10,8,5,.86); display: flex; align-items: center; justify-content: center; padding: 10px; overflow: auto; }
  .ch .ch-card { width: min(430px, 100%); max-height: 100%; overflow: auto; background: #211b14; border: 1px solid rgba(255,255,255,.16); border-radius: 16px; padding: 14px 16px; }
  .ch h2 { margin: 10px 0 5px; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #bfae93; }
  .ch .ch-code { font-size: 20px; font-weight: 800; letter-spacing: .18em; color: #ffb347; }
  .ch .ch-promo { position: absolute; inset: 0; z-index: 5; background: rgba(0,0,0,.55); display: flex; align-items: center; justify-content: center; }
  .ch .ch-promo .ch-card { width: auto; display: flex; gap: 8px; } .ch .ch-promo button { font-size: 34px; padding: 4px 12px; }
  @media (max-width: 460px) { .ch { flex-direction: column; } .ch .ch-side { flex: 0 0 auto; } }
  `;
  let styled = false;
  const ensureStyle = () => { if (styled) return; styled = true; const s = document.createElement('style'); s.textContent = CSS; document.head.append(s); };
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  function mount(host) {
    ensureStyle();
    host.innerHTML = '';
    const root = document.createElement('div'); root.className = 'ch'; root.tabIndex = 0;
    host.append(root);

    let g = L.newGame();
    const moves = [];                    // the moves played, as text like e2e4 (q on the end for a promotion)
    const sans = [];
    let mode = 'menu';                   // 'menu' | 'cpu' | 'online'
    let mySide = 'white';                // the side I move for (cpu and online)
    let level = store.get('level', 2);
    let pickSide = store.get('side', 'white');
    let selected = -1, targets = [], last = null, over = null, thinking = 0, suspended = false, resigned = null, pendingPromo = null;
    let net = null;                      // { link, code, role: 'host' | 'guest', peer: id | null, status, note }
    let alive = true, flipped = false;

    const myTurn = () => !over && (mode === 'cpu' || mode === 'online') && (g.white ? 'white' : 'black') === mySide && (mode !== 'online' || (net && net.peer));
    const turnName = () => (g.white ? 'White' : 'Black');

    function resetGame() { g = L.newGame(); moves.length = 0; sans.length = 0; selected = -1; targets = []; last = null; over = null; resigned = null; pendingPromo = null; clearTimeout(thinking); }

    function play(m, fromNet) {
      const text = L.moveText(m);
      sans.push(L.san(g, m));
      g = L.apply(g, m); moves.push(text); last = [m.from, m.to]; selected = -1; targets = [];
      const st = L.status(g);
      if (st.over) over = { result: st.result, reason: st.reason };
      if (mode === 'online' && !fromNet && net) net.link.send({ t: 'move', from: myId, n: moves.length, m: text });
      render();
      maybeCpu();
    }

    function maybeCpu() {
      clearTimeout(thinking);
      if (mode !== 'cpu' || over || suspended) return;
      if ((g.white ? 'white' : 'black') === mySide) return;
      const snapshot = g;
      thinking = setTimeout(() => {
        if (!alive || g !== snapshot || over) return;
        const m = L.bestMove(g, level, Math.random, Date.now() + 2500);
        if (m) play(m, false);
      }, 350);
    }

    function click(sq) {
      if (!myTurn() || pendingPromo) return;
      const p = g.b[sq];
      if (selected >= 0) {
        const ms = targets.filter((m) => m.to === sq);
        if (ms.length) {
          if (ms[0].promo) { pendingPromo = ms; render(); return; }
          play(ms[0], false); return;
        }
      }
      if (p !== '.' && L.isWhite(p) === g.white) { selected = sq; targets = L.legalFrom(g, sq); } else { selected = -1; targets = []; }
      render();
    }

    // ---- online -------------------------------------------------------------------------------------------------------
    function leaveRoom() { if (net) { try { net.link.send({ t: 'bye', from: myId }); } catch { /* gone */ } net.link.close(); net = null; } }
    function openRoom(role, code) {
      leaveRoom();
      mode = 'online'; resetGame();
      const link = new Link((m) => onNet(m), (st) => { if (!net) return; net.status = st; if (st === 'on') hello(); render(); });
      net = { link, code, role, peer: null, status: 'connecting', note: '' };
      if (role === 'host') mySide = pickSide === 'random' ? (Math.random() < 0.5 ? 'white' : 'black') : pickSide;
      link.join(code);
      render();
    }
    const hello = () => { if (net) net.link.send({ t: 'hello', from: myId, role: net.role }); };
    function sendState() { if (net && net.role === 'host') net.link.send({ t: 'state', from: myId, to: net.peer, side: mySide === 'white' ? 'black' : 'white', moves: moves.slice(), resigned }); }
    function onNet(m) {
      if (!net || m.from === myId || typeof m.from !== 'string') return;
      if (m.t === 'hello' && net.role === 'host') {
        if (!net.peer || net.peer === m.from) { net.peer = m.from; sendState(); render(); }
        else net.link.send({ t: 'full', from: myId, to: m.from });
      } else if (m.t === 'full' && m.to === myId) { net.note = 'That room already has two players.'; render(); }
      else if (m.t === 'state' && net.role === 'guest' && m.to === myId && Array.isArray(m.moves)) {
        net.peer = m.from; mySide = m.side === 'black' ? 'black' : 'white';
        resetGame();
        for (const text of m.moves.slice(0, 600)) { const mv = L.findMove(g, String(text)); if (!mv) break; sans.push(L.san(g, mv)); g = L.apply(g, mv); moves.push(L.moveText(mv)); last = [mv.from, mv.to]; }
        const st = L.status(g); if (st.over) over = { result: st.result, reason: st.reason };
        if (m.resigned) over = { result: m.resigned === 'white' ? 'black' : 'white', reason: `${m.resigned} resigned` };
        render();
      } else if (m.t === 'move' && m.from === net.peer) {
        if (m.n !== moves.length + 1 || over) { if (m.n > moves.length + 1 && net.role === 'guest') hello(); return; }   // a gap: ask the host to send it all again
        const mv = L.findMove(g, String(m.m)); if (mv) play(mv, true);
      } else if (m.t === 'resign' && m.from === net.peer) {
        over = { result: mySide, reason: 'your opponent resigned' }; resigned = mySide === 'white' ? 'black' : 'white'; render();
      } else if (m.t === 'again' && m.from === net.peer && net.role === 'host') { /* the host decides when to restart */ }
      else if (m.t === 'new' && m.from === net.peer) { resetGame(); if (net.role === 'guest') mySide = m.side === 'black' ? 'black' : 'white'; render(); }
      else if (m.t === 'bye' && m.from === net.peer) { net.peer = null; net.note = 'Your opponent left. The room stays open for them to come back.'; render(); }
    }

    function newOnlineGame() {
      if (!net || net.role !== 'host') return;
      resetGame();
      if (pickSide === 'random') mySide = Math.random() < 0.5 ? 'white' : 'black';
      else mySide = mySide === 'white' ? 'black' : 'white';             // swap colours for the next game
      net.link.send({ t: 'new', from: myId, side: mySide === 'white' ? 'black' : 'white' });
      render();
    }

    function startCpu(side) {
      leaveRoom(); mode = 'cpu'; resetGame();
      mySide = side === 'random' ? (Math.random() < 0.5 ? 'white' : 'black') : side;
      store.set('level', level); store.set('side', side);
      flipped = mySide === 'black';
      render(); maybeCpu();
    }

    function resign() {
      if (over) return;
      if (mode === 'online' && net) net.link.send({ t: 'resign', from: myId });
      over = { result: mySide === 'white' ? 'black' : 'white', reason: 'you resigned' }; resigned = mySide;
      clearTimeout(thinking); render();
    }
    function undo() {
      if (mode !== 'cpu' || !moves.length) return;
      clearTimeout(thinking);
      const keep = moves.slice(0, Math.max(0, moves.length - ((g.white ? 'white' : 'black') === mySide ? 2 : 1)));
      const all = keep; resetGame();
      for (const text of all) { const mv = L.findMove(g, text); sans.push(L.san(g, mv)); g = L.apply(g, mv); moves.push(text); last = [mv.from, mv.to]; }
      render(); maybeCpu();
    }

    // ---- drawing ------------------------------------------------------------------------------------------------------
    function statusText() {
      if (mode === 'menu') return '';
      if (over) {
        if (over.result === 'draw') return `Draw: ${over.reason}.`;
        const who = over.result === 'white' ? 'White' : 'Black';
        return over.reason === 'checkmate' ? `Checkmate. ${who} wins.` : `${who} wins: ${over.reason}.`;
      }
      if (mode === 'online' && net && !net.peer) return net.status === 'on' ? 'Waiting for your friend…' : net.status === 'failed' ? 'Could not reach the room server.' : 'Connecting…';
      const chk = L.inCheck(g) ? ' Check!' : '';
      if (mode === 'cpu' && (g.white ? 'white' : 'black') !== mySide) return `Computer is thinking…${chk}`;
      return `${turnName()} to move${(g.white ? 'white' : 'black') === mySide ? ' (you)' : ''}.${chk}`;
    }

    function render() {
      if (!alive) return;
      const dark = (s) => ((s >> 3) + (s & 7)) & 1;
      const kingHot = L.inCheck(g) && !over ? g.b.indexOf(g.white ? 'K' : 'k') : -1;
      const order = flipped ? [...Array(64).keys()].reverse() : [...Array(64).keys()];
      const tset = new Map(targets.map((m) => [m.to, m]));
      let h = '<div class="ch-boardwrap"><div class="ch-board">';
      for (const s of order) {
        const p = g.b[s], tm = tset.get(s), cls = ['ch-sq', dark(s) ? 'd' : 'l'];
        if (s === selected) cls.push('sel'); if (last && (s === last[0] || s === last[1])) cls.push('last');
        if (s === kingHot) cls.push('chk');
        if (tm) cls.push(p !== '.' || tm.ep ? 'cap' : 'dot');
        const f = s & 7, r = s >> 3, showFile = (flipped ? r === 0 : r === 7), showRank = (flipped ? f === 7 : f === 0);
        h += `<div class="${cls.join(' ')}" data-s="${s}" style="--bg:${dark(s) ? '#a9794d' : '#e8d3a8'}">${p !== '.' ? `<span class="ch-p ${L.isWhite(p) ? 'w' : 'b'}">${GLYPH[p]}</span>` : ''}${showFile ? `<span class="ch-co f">${'abcdefgh'[f]}</span>` : ''}${showRank ? `<span class="ch-co r">${8 - r}</span>` : ''}</div>`;
      }
      h += '</div></div><div class="ch-side"><h1>♞ Chess</h1>';
      h += `<div class="ch-status${over ? ' over' : ''}">${esc(statusText())}</div>`;
      if (mode === 'cpu') h += `<div class="ch-hint">You are ${mySide}. Level: ${LEVELS[level - 1]}.</div>`;
      if (mode === 'online' && net) h += `<div class="ch-hint">Room <span class="ch-code" style="font-size:14px">${net.code}</span> · you are ${mySide}${net.note ? '<br>' + esc(net.note) : ''}</div>`;
      let mv = '';
      for (let i = 0; i < sans.length; i += 2) mv += `<b>${i / 2 + 1}.</b> ${esc(sans[i])} ${sans[i + 1] ? esc(sans[i + 1]) : ''}<br>`;
      h += `<div class="ch-moves" id="chmoves">${mv || '<span class="ch-hint">No moves yet.</span>'}</div>`;
      h += '<div class="ch-row">';
      if (mode === 'cpu') h += '<button data-a="undo" title="Take back your last move">Undo</button>';
      if (mode !== 'menu') h += '<button data-a="flip" title="Turn the board around">Flip</button>';
      if (mode !== 'menu' && !over) h += '<button data-a="resign">Resign</button>';
      if (over && mode === 'cpu') h += '<button class="go" data-a="again">Play again</button>';
      if (over && mode === 'online' && net && net.role === 'host') h += '<button class="go" data-a="again">Rematch</button>';
      h += '<button data-a="menu">Menu</button></div></div>';
      if (pendingPromo) h += `<div class="ch-promo"><div class="ch-card">${pendingPromo.map((m) => `<button data-promo="${m.promo}">${GLYPH[g.white ? m.promo.toUpperCase() : m.promo]}</button>`).join('')}</div></div>`;
      if (mode === 'menu') h += menuHtml();
      root.innerHTML = h;
      const box = root.querySelector('#chmoves'); if (box) box.scrollTop = box.scrollHeight;
    }

    function menuHtml() {
      const sideBtn = (v, label) => `<button data-side="${v}" class="${pickSide === v ? 'on' : ''}">${label}</button>`;
      return `<div class="ch-menu"><div class="ch-card"><h1>♞ Chess</h1>
        <div class="ch-hint">Play the computer, or a friend online with a room code (the same kind of code the Plane and Racing games use).</div>
        <h2>You play</h2><div class="ch-row">${sideBtn('white', '♔ White')}${sideBtn('black', '♚ Black')}${sideBtn('random', 'Random')}</div>
        <h2>Against the computer</h2><div class="ch-row">${LEVELS.map((n, i) => `<button data-level="${i + 1}" class="${level === i + 1 ? 'on' : ''}">${n}</button>`).join('')}</div>
        <div class="ch-row" style="margin-top:8px"><button class="go" data-a="cpu">Play the computer</button></div>
        <h2>With a friend</h2>
        <div class="ch-row"><button class="go" data-a="host">Open a room</button> <span class="ch-hint">then share the code</span></div>
        <div class="ch-row" style="margin-top:6px"><input id="chcode" maxlength="7" placeholder="CODE" autocomplete="off" spellcheck="false"><button data-a="join">Join</button></div>
        <div class="ch-hint" id="chmsg" style="margin-top:6px;color:#ffb347">${esc(menuNote)}</div></div></div>`;
    }
    let menuNote = '';

    root.addEventListener('click', (e) => {
      const t = e.target.closest('[data-s],[data-a],[data-side],[data-level],[data-promo]');
      if (!t) return;
      if (t.dataset.s != null) { click(Number(t.dataset.s)); return; }
      if (t.dataset.promo) { const m = pendingPromo && pendingPromo.find((x) => x.promo === t.dataset.promo); pendingPromo = null; if (m) play(m, false); else render(); return; }
      if (t.dataset.side) { pickSide = t.dataset.side; store.set('side', pickSide); render(); return; }
      if (t.dataset.level) { level = Number(t.dataset.level); store.set('level', level); render(); return; }
      const a = t.dataset.a;
      if (a === 'cpu') startCpu(pickSide);
      else if (a === 'host') { menuNote = ''; openRoom('host', newCode()); }
      else if (a === 'join') { const c = normCode(root.querySelector('#chcode').value); if (!c) { menuNote = 'Codes are 6 letters or numbers.'; render(); return; } menuNote = ''; openRoom('guest', c); }
      else if (a === 'menu') { leaveRoom(); clearTimeout(thinking); mode = 'menu'; resetGame(); render(); }
      else if (a === 'flip') { flipped = !flipped; render(); }
      else if (a === 'undo') undo();
      else if (a === 'resign') resign();
      else if (a === 'again') { if (mode === 'cpu') startCpu(pickSide === 'random' ? 'random' : mySide === 'white' ? 'black' : 'white'); else newOnlineGame(); }
    });
    root.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'chcode') { const b = root.querySelector('[data-a="join"]'); if (b) b.click(); } });

    const api = {
      suspend() { suspended = true; clearTimeout(thinking); },
      resume() { suspended = false; maybeCpu(); },
      state: () => ({ mode, mySide, plies: moves.length, over, online: !!net, code: net && net.code, peer: net && net.peer, fen: L.toFen(g) }),
      dev: { startCpu, openRoom, click, play, get g() { return g; }, set level(v) { level = v; }, resign, newOnlineGame },
    };
    render();
    const stop = () => { alive = false; clearTimeout(thinking); leaveRoom(); host.innerHTML = ''; if (window.NotchChessGame.current === api) window.NotchChessGame.current = null; };
    window.NotchChessGame.current = api;
    return stop;
  }

  window.NotchChessGame = {
    current: null,
    mount,
    key: () => {},
    suspend: () => { const c = window.NotchChessGame.current; if (c) c.suspend(); },
    resume: () => { const c = window.NotchChessGame.current; if (c) c.resume(); },
    state: () => { const c = window.NotchChessGame.current; return c ? c.state() : null; },
    get dev() { const c = window.NotchChessGame.current; return c && c.dev; },
  };
})();
