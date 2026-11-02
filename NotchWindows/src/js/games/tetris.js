// Tetris for the Games tab, shared by the Mac and Windows apps. The rules are in tetris-logic.js.
//
//   window.NotchTetrisGame.mount(hostElement)   starts the game; returns a function that stops it.
//   window.NotchTetrisGame.suspend() / resume() the notch closed / opened: the game pauses (resume leaves it paused).
//   window.NotchTetrisGame.key(key, down)       a key forwarded by the Mac app when the web view has no keyboard focus.
//   window.NotchTetrisGame.setSoundEnabled(on)  the Mac app's sound switch.
//
// Light on purpose: there is no animation loop. The board is drawn when something changes, and the only timer is the next
// gravity step, which is cleared when the game is paused, over, closed or the page is hidden.
(function () {
  'use strict';
  const L = window.NotchTetrisLogic;
  const store = {
    get(k, d) { try { const v = localStorage.getItem('tetris.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('tetris.' + k, JSON.stringify(v)); } catch { /* storage off */ } },
  };
  const COLORS = { I: '#4dd8ff', O: '#ffd84d', T: '#b36bff', S: '#5ce08a', Z: '#ff6b6b', J: '#5b8cff', L: '#ffa14d' };
  const CELL = 20, WELL_X = 120, WELL_Y = 20, SIZE = 440, SCALE = 2, LOCK_MS = 500, MAX_RESETS = 15;

  const CSS = `
  .tt { position: relative; width: 100%; height: 100%; overflow: hidden; background: #0d0b14; color: #f1ecff; font: 13px/1.35 -apple-system, "Segoe UI", system-ui, sans-serif; user-select: none; display: flex; flex-direction: column; align-items: center; padding: 8px; box-sizing: border-box; outline: none; }
  .tt .tt-wrap { flex: 1 1 auto; min-height: 0; width: 100%; display: flex; align-items: center; justify-content: center; }
  .tt canvas { height: 100%; max-width: 100%; aspect-ratio: 1; border-radius: 10px; }
  .tt .tt-row { display: flex; gap: 6px; align-items: center; justify-content: center; padding-top: 6px; flex: 0 0 auto; }
  .tt button { font: inherit; font-weight: 700; padding: 4px 11px; border-radius: 9px; border: 1px solid rgba(255,255,255,.22); background: rgba(255,255,255,.07); color: #fff; cursor: pointer; }
  .tt button:hover { background: rgba(255,255,255,.15); }
  .tt .tt-keys { color: #9d93b8; font-size: 11px; }
  `;
  let styled = false;
  const ensureStyle = () => { if (styled) return; styled = true; const s = document.createElement('style'); s.textContent = CSS; document.head.append(s); };

  function mount(host) {
    ensureStyle();
    host.innerHTML = '';
    const root = document.createElement('div'); root.className = 'tt'; root.tabIndex = 0;
    const wrap = document.createElement('div'); wrap.className = 'tt-wrap';
    const cv = document.createElement('canvas'); cv.width = SIZE * SCALE; cv.height = SIZE * SCALE;
    wrap.append(cv);
    const row = document.createElement('div'); row.className = 'tt-row';
    const bPause = document.createElement('button'); bPause.textContent = 'Pause';
    const bNew = document.createElement('button'); bNew.textContent = 'New game';
    const keys = document.createElement('span'); keys.className = 'tt-keys'; keys.textContent = '← → move · ↑ rotate · ↓ soft drop · Space drop · C hold · P pause · M sound';
    row.append(bPause, bNew, keys);
    root.append(wrap, row); host.append(root);
    const ctx = cv.getContext('2d');
    ctx.scale(SCALE, SCALE);

    let g = L.createGame();
    let state = 'ready';                 // 'ready' | 'playing' | 'paused' | 'over'
    let timer = 0, alive = true, best = store.get('best', 0);
    let soundOn = store.get('sound', true), actx = null;
    const hostSound = () => window.NotchHostSound !== false;

    // ---- sound: a few short beeps, made on the spot (nothing to download), only after a key press ----
    function beep(freq, ms, type, vol) {
      if (!soundOn || !hostSound()) return;
      try {
        actx = actx || new (window.AudioContext || window.webkitAudioContext)();
        if (actx.state === 'suspended') actx.resume();
        const o = actx.createOscillator(), a = actx.createGain(), t = actx.currentTime;
        o.type = type || 'square'; o.frequency.value = freq;
        a.gain.setValueAtTime(vol || 0.04, t); a.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
        o.connect(a); a.connect(actx.destination); o.start(t); o.stop(t + ms / 1000 + 0.02);
      } catch { /* no audio */ }
    }
    const sfx = {
      turn: () => beep(520, 40), lock: () => beep(180, 60, 'triangle', 0.06), hold: () => beep(380, 60),
      clear: (n) => { for (let i = 0; i < Math.min(n, 4) + 1; i++) setTimeout(() => beep(440 + i * 110, 90, 'square', 0.05), i * 70); },
      over: () => { beep(300, 160, 'sawtooth', 0.05); setTimeout(() => beep(200, 260, 'sawtooth', 0.05), 170); },
    };

    // ---- drawing ----
    function block(x, y, color, alpha) {
      ctx.globalAlpha = alpha == null ? 1 : alpha;
      ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect(x + 1, y + 1, CELL - 2, CELL - 2, 4); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.28)'; ctx.fillRect(x + 3, y + 3, CELL - 6, 3);
      ctx.globalAlpha = 1;
    }
    function miniPiece(t, cx, cy, size) {                       // a piece drawn small and centred on (cx, cy)
      if (!t) return;
      const cells = L.SHAPES[t][0], xs = cells.map((c) => c[0]), ys = cells.map((c) => c[1]);
      const w = Math.max(...xs) - Math.min(...xs) + 1, h = Math.max(...ys) - Math.min(...ys) + 1;
      for (const [x, y] of cells) {
        const px = cx + (x - Math.min(...xs) - w / 2) * size, py = cy + (y - Math.min(...ys) - h / 2) * size;
        ctx.fillStyle = COLORS[t]; ctx.beginPath(); ctx.roundRect(px + 1, py + 1, size - 2, size - 2, 3); ctx.fill();
      }
    }
    function text(s, x, y, size, color, align, weight) { ctx.font = `${weight || 700} ${size}px -apple-system, "Segoe UI", system-ui, sans-serif`; ctx.fillStyle = color; ctx.textAlign = align || 'left'; ctx.fillText(s, x, y); }
    function panel(x, y, w, h, title) {
      ctx.fillStyle = 'rgba(255,255,255,.06)'; ctx.beginPath(); ctx.roundRect(x, y, w, h, 10); ctx.fill();
      text(title, x + w / 2, y + 15, 10, '#9d93b8', 'center');
    }
    function draw() {
      if (!alive) return;
      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.fillStyle = '#16121f'; ctx.fillRect(0, 0, SIZE, SIZE);
      // the well
      ctx.fillStyle = '#0b0912'; ctx.fillRect(WELL_X, WELL_Y, L.W * CELL, L.H * CELL);
      ctx.strokeStyle = 'rgba(255,255,255,.05)'; ctx.lineWidth = 1; ctx.beginPath();
      for (let x = 1; x < L.W; x++) { ctx.moveTo(WELL_X + x * CELL + .5, WELL_Y); ctx.lineTo(WELL_X + x * CELL + .5, WELL_Y + L.H * CELL); }
      for (let y = 1; y < L.H; y++) { ctx.moveTo(WELL_X, WELL_Y + y * CELL + .5); ctx.lineTo(WELL_X + L.W * CELL, WELL_Y + y * CELL + .5); }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(179,107,255,.6)'; ctx.strokeRect(WELL_X - .5, WELL_Y - .5, L.W * CELL + 1, L.H * CELL + 1);
      g.rows.forEach((r, y) => r.forEach((c, x) => { if (c) block(WELL_X + x * CELL, WELL_Y + y * CELL, COLORS[c]); }));
      if (!g.over && state !== 'ready') {
        const gy = L.ghostY(g);
        for (const [x, y] of L.cellsOf({ ...g.piece, y: gy })) if (y >= 0) block(WELL_X + x * CELL, WELL_Y + y * CELL, COLORS[g.piece.t], 0.22);
        for (const [x, y] of L.cellsOf(g.piece)) if (y >= 0) block(WELL_X + x * CELL, WELL_Y + y * CELL, COLORS[g.piece.t]);
      }
      // hold (left) and next (right)
      panel(10, 20, 100, 78, 'HOLD'); miniPiece(g.hold, 60, 62, 16);
      if (g.hold && !g.canHold) { ctx.fillStyle = 'rgba(13,11,20,.45)'; ctx.beginPath(); ctx.roundRect(10, 20, 100, 78, 10); ctx.fill(); }
      panel(330, 20, 100, 176, 'NEXT');
      L.upcoming(g).forEach((t, i) => miniPiece(t, 380, 62 + i * 46, 16));
      // score and level, under hold and next
      panel(10, 110, 100, 150, 'SCORE'); text(String(g.score), 60, 150, 20, '#fff', 'center');
      text('LEVEL', 60, 176, 10, '#9d93b8', 'center'); text(String(g.level), 60, 198, 20, '#fff', 'center');
      text('LINES', 60, 224, 10, '#9d93b8', 'center'); text(String(g.lines), 60, 246, 20, '#fff', 'center');
      panel(330, 210, 100, 60, 'BEST'); text(String(Math.max(best, g.score)), 380, 250, 20, '#ffd84d', 'center');
      if (g.b2b) text('BACK-TO-BACK', 380, 290, 10, '#5ce08a', 'center');
      // messages
      const msg = state === 'ready' ? ['Tetris', 'Press Space to start'] : state === 'paused' ? ['Paused', 'Press P to resume'] : state === 'over' ? ['Game over', `Score ${g.score} · Space for a new game`] : null;
      if (msg) {
        ctx.fillStyle = 'rgba(13,11,20,.78)'; ctx.fillRect(WELL_X, WELL_Y, L.W * CELL, L.H * CELL);
        text(msg[0], WELL_X + L.W * CELL / 2, 200, 24, '#fff', 'center');
        text(msg[1], WELL_X + L.W * CELL / 2, 226, 11, '#c9bfe8', 'center', 600);
      }
      bPause.textContent = state === 'paused' ? 'Resume' : 'Pause';
    }

    // ---- the game loop: one timer for the next gravity step ----
    function schedule() {
      clearTimeout(timer); timer = 0;
      if (state !== 'playing' || !alive) return;
      const on = L.grounded(g);
      timer = setTimeout(step, on ? (g.resets >= MAX_RESETS ? 30 : LOCK_MS) : L.gravityMs(g.level));
    }
    function afterLock(res) {
      if (res && res.cleared) sfx.clear(res.cleared); else sfx.lock();
      if (g.over) finish();
    }
    function step() {
      timer = 0;
      if (state !== 'playing') return;
      const r = L.tick(g);
      if (r && r !== 'moved') afterLock(r);
      draw(); schedule();
    }
    function finish() {
      state = 'over'; clearTimeout(timer); timer = 0;
      if (g.score > best) { best = g.score; store.set('best', best); }
      sfx.over();
    }
    function start() { g = L.createGame(); state = 'playing'; draw(); schedule(); }
    function pause() { if (state === 'playing') { state = 'paused'; clearTimeout(timer); timer = 0; draw(); } }
    function unpause() { if (state === 'paused') { state = 'playing'; draw(); schedule(); } }

    function act(fn) {                                         // a player action: redraw, and restart the timer only when needed
      const was = L.grounded(g);
      const r = fn();
      if (g.over && state === 'playing') finish();
      draw();
      if (state === 'playing' && (was || L.grounded(g) || r === 'new')) schedule();
    }

    function handleKey(k, repeat) {
      if (!alive) return false;
      if (k === 'm') { if (!repeat) { soundOn = !soundOn; store.set('sound', soundOn); if (soundOn) sfx.turn(); } return true; }
      if (state === 'ready' || state === 'over') { if (k === ' ' || k === 'Enter') { if (!repeat) start(); return true; } return false; }
      if (k === 'p' || k === 'P') { if (!repeat) (state === 'paused' ? unpause : pause)(); return true; }
      if (state === 'paused') { if (k === ' ' || k === 'Enter') { if (!repeat) unpause(); return true; } return false; }
      switch (k) {
        case 'ArrowLeft': case 'a': act(() => L.move(g, -1)); return true;
        case 'ArrowRight': case 'd': act(() => L.move(g, 1)); return true;
        case 'ArrowDown': case 's': act(() => L.softDrop(g)); return true;
        case 'ArrowUp': case 'w': case 'x': if (!repeat) act(() => { const ok = L.rotate(g, 1); if (ok) sfx.turn(); return ok; }); return true;
        case 'z': if (!repeat) act(() => { const ok = L.rotate(g, -1); if (ok) sfx.turn(); return ok; }); return true;
        case 'c': case 'Shift': if (!repeat) act(() => { const ok = L.holdPiece(g); if (ok) { sfx.hold(); } return ok ? 'new' : false; }); return true;
        case ' ': if (!repeat) act(() => { const res = L.hardDrop(g); afterLock(res); return 'new'; }); return true;
        default: return false;
      }
    }
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (handleKey(k, e.repeat)) e.preventDefault();
    };
    const onVis = () => { if (document.hidden) pause(); };
    window.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onVis);
    bPause.onclick = () => { if (state === 'playing') pause(); else if (state === 'paused') unpause(); else start(); root.focus(); };
    bNew.onclick = () => { start(); root.focus(); };
    cv.onclick = () => root.focus();

    const api = {
      suspend() { pause(); },
      resume() { /* stays paused: the player presses P or Resume */ },
      key(k, down) { if (down) handleKey(k && k.length === 1 ? k.toLowerCase() : k, false); },
      setSoundEnabled() { /* the host's switch is read from window.NotchHostSound on every beep */ },
      state: () => ({ state, score: g.score, lines: g.lines, level: g.level, best, over: g.over, hold: g.hold, piece: g.piece && g.piece.t, timer: !!timer }),
      dev: { get g() { return g; }, start, handleKey, step },
    };
    draw();
    root.focus();
    const stop = () => {
      alive = false; clearTimeout(timer); timer = 0;
      window.removeEventListener('keydown', onKey); document.removeEventListener('visibilitychange', onVis);
      host.innerHTML = '';
      if (window.NotchTetrisGame.current === api) window.NotchTetrisGame.current = null;
    };
    window.NotchTetrisGame.current = api;
    return stop;
  }

  window.NotchTetrisGame = {
    current: null,
    mount,
    key: (k, down) => { const c = window.NotchTetrisGame.current; if (c) c.key(k, down); },
    suspend: () => { const c = window.NotchTetrisGame.current; if (c) c.suspend(); },
    resume: () => { const c = window.NotchTetrisGame.current; if (c) c.resume(); },
    setSoundEnabled: (on) => { const c = window.NotchTetrisGame.current; if (c) c.setSoundEnabled(on); },
    state: () => { const c = window.NotchTetrisGame.current; return c ? c.state() : null; },
    get dev() { const c = window.NotchTetrisGame.current; return c && c.dev; },
  };
})();
