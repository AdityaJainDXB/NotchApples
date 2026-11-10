// Eagle Ride: glide over a valley, steer around trees and rocks, grab gems. The rules are in eagle-ride-logic.js (loaded first).
// Shared by the Windows app and the Mac app (a web view). Public API:
//   window.NotchEagleGame.mount(hostElement)   starts the game; returns a function that stops it.
//   window.NotchEagleGame.suspend() / resume() the notch closed / opened: the game pauses (resume leaves it paused).
//   window.NotchEagleGame.key(key, down)       a key forwarded by the Mac app when the web view has no keyboard focus.
//   window.NotchEagleGame.setSoundEnabled(on)  the Mac app's sound switch.
// Controls: ← → or A D steer, or move the mouse / drag a finger across the game; Space or Enter starts and restarts; P pauses; M sound.
// Sound is made on the spot and is off unless the Mac app's Games sound switch is on (or you press M here). The best score stays on this device.
(function () {
  'use strict';
  const L = window.NotchEagleLogic;
  const store = {
    get(k, d) { try { const v = localStorage.getItem('eagle.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('eagle.' + k, JSON.stringify(v)); } catch { /* storage off */ } },
  };

  const CSS = `
    .er { position:absolute; inset:0; overflow:hidden; background:#0d1b2a; outline:none; font:600 13px/1.2 -apple-system,"Segoe UI",system-ui,sans-serif; color:#fff; user-select:none; -webkit-user-select:none; touch-action:none; }
    .er canvas { position:absolute; inset:0; width:100%; height:100%; display:block; }
    .er-hud { position:absolute; left:0; right:0; top:0; display:flex; gap:10px; align-items:center; padding:6px 10px; pointer-events:none; text-shadow:0 1px 3px rgba(0,0,0,.55); }
    .er-hud .grow { flex:1; }
    .er-hud .best { opacity:.85; font-weight:500; }
    .er-btns { position:absolute; right:8px; top:26px; display:flex; gap:6px; }
    .er-btns button { font:inherit; font-size:11px; color:#fff; background:rgba(0,0,0,.4); border:1px solid rgba(255,255,255,.25); border-radius:8px; padding:3px 9px; cursor:pointer; }
    .er-btns button:hover { background:rgba(0,0,0,.6); }
    .er-msg { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:6px; text-align:center; background:rgba(8,16,30,.5); padding:10px; }
    .er-msg b { font-size:clamp(18px,5vmin,30px); }
    .er-msg span { font-weight:500; opacity:.9; font-size:clamp(11px,2.6vmin,14px); }
    .er-msg button { margin-top:6px; font:inherit; font-weight:700; color:#10202e; background:#ffd86b; border:0; border-radius:10px; padding:6px 16px; cursor:pointer; }
  `;
  let styled = false;
  const ensureStyle = () => { if (styled) return; styled = true; const s = document.createElement('style'); s.textContent = CSS; document.head.append(s); };

  function mount(host) {
    ensureStyle();
    host.innerHTML = '';
    const root = document.createElement('div'); root.className = 'er'; root.tabIndex = 0;
    const cv = document.createElement('canvas');
    const hud = document.createElement('div'); hud.className = 'er-hud';
    const hScore = document.createElement('span'), hLives = document.createElement('span'), hGrow = document.createElement('span'), hBest = document.createElement('span');
    hGrow.className = 'grow'; hBest.className = 'best';
    hud.append(hScore, hLives, hGrow, hBest);
    const btns = document.createElement('div'); btns.className = 'er-btns';
    const bPause = document.createElement('button'); bPause.textContent = 'Pause';
    const bSound = document.createElement('button');
    btns.append(bPause, bSound);
    const msg = document.createElement('div'); msg.className = 'er-msg';
    root.append(cv, hud, btns, msg); host.append(root);
    const ctx = cv.getContext('2d');

    let g = L.createGame(), state = 'ready';   // 'ready' | 'playing' | 'paused' | 'over'
    let best = store.get('best', 0), newBest = false;
    let alive = true, raf = 0, last = 0, W = 300, H = 200, shake = 0, flap = 0, scroll = 0;
    const held = new Set();
    let pointerX = null;                        // the mouse or finger position as -1..1, while it is over the game
    let soundOn = store.get('sound', false), actx = null;
    // The Mac app's Games sound switch sets window.NotchHostSound: false is always silent, true is sound on. Windows has no such switch, so
    // there the game is silent until you press M.
    const audible = () => window.NotchHostSound === false ? false : (soundOn || window.NotchHostSound === true);

    // ---- sound: short beeps made on the spot, only after a key press or click ----
    function beep(freq, ms, type, vol) {
      if (!audible()) return;
      try {
        actx = actx || new (window.AudioContext || window.webkitAudioContext)();
        if (actx.state === 'suspended') actx.resume();
        const o = actx.createOscillator(), a = actx.createGain(), t = actx.currentTime;
        o.type = type || 'sine'; o.frequency.value = freq;
        a.gain.setValueAtTime(vol || 0.05, t); a.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
        o.connect(a); a.connect(actx.destination); o.start(t); o.stop(t + ms / 1000 + 0.02);
      } catch { /* no audio */ }
    }
    const sfx = {
      gem: () => { beep(880, 70); setTimeout(() => beep(1320, 90), 60); },
      hit: () => { beep(150, 180, 'sawtooth', 0.07); },
      over: () => { beep(330, 160, 'triangle', 0.06); setTimeout(() => beep(220, 300, 'triangle', 0.06), 170); },
      start: () => { beep(520, 70); setTimeout(() => beep(780, 90), 70); },
    };
    const soundLabel = () => { bSound.textContent = audible() ? 'Sound on' : 'Sound off'; };

    // ---- layout ----
    function resize() {
      const r = host.getBoundingClientRect();
      W = Math.max(120, Math.floor(r.width || host.clientWidth || 300)); H = Math.max(90, Math.floor(r.height || host.clientHeight || 200));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.floor(W * dpr); cv.height = Math.floor(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw();
    }
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    if (ro) ro.observe(host);

    // ---- drawing: a perspective valley ----
    const horizon = () => H * 0.36;
    const persp = (z) => 1 / (1 + Math.max(z, -0.2) * 7);              // 1 at the eagle, small at the horizon
    const roadHalf = () => W * 0.44;
    const sx = (x, z) => W / 2 + x * roadHalf() * persp(z);
    const sy = (z) => horizon() + (H * 0.86 - horizon()) * persp(z);

    function drawSky() {
      const hz = horizon();
      const sky = ctx.createLinearGradient(0, 0, 0, hz);
      sky.addColorStop(0, '#3a8fd8'); sky.addColorStop(1, '#bfe6ff');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, W, hz + 1);
      ctx.fillStyle = '#fff7c2'; ctx.beginPath(); ctx.arc(W * 0.78, hz * 0.45, Math.max(10, H * 0.07), 0, 6.283); ctx.fill();
      // far mountains, drifting with the steering
      const off = -g.x * W * 0.08;
      ctx.fillStyle = '#7ea4c8';
      ctx.beginPath(); ctx.moveTo(0, hz);
      for (let i = 0; i <= 10; i++) ctx.lineTo(i * W / 10 + off * 0.5, hz - (14 + ((i * 37) % 23)) * H / 220);
      ctx.lineTo(W, hz); ctx.fill();
      ctx.fillStyle = '#5f8e6a';
      ctx.beginPath(); ctx.moveTo(0, hz);
      for (let i = 0; i <= 14; i++) ctx.lineTo(i * W / 14 + off, hz - (6 + ((i * 53) % 11)) * H / 220);
      ctx.lineTo(W, hz); ctx.fill();
    }

    function drawGround() {
      const hz = horizon();
      const gr = ctx.createLinearGradient(0, hz, 0, H);
      gr.addColorStop(0, '#6fae5a'); gr.addColorStop(1, '#2f6b34');
      ctx.fillStyle = gr; ctx.fillRect(0, hz, W, H - hz);
      // moving bands give the speed
      for (let i = 0; i < 14; i++) {
        const z0 = ((i / 14) + scroll) % 1, z1 = z0 + 0.035;
        if (z1 > 1) continue;
        ctx.fillStyle = i % 2 ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.06)';
        const y0 = sy(z0), y1 = sy(z1);
        ctx.fillRect(0, Math.min(y0, y1), W, Math.abs(y0 - y1) + 1);
      }
      // the river down the middle of the valley
      ctx.fillStyle = 'rgba(80,170,230,.55)';
      const wTop = W * 0.012, wBot = W * 0.2, mid = W / 2 - g.x * roadHalf() * 0.0;
      ctx.beginPath(); ctx.moveTo(mid - wTop, hz); ctx.lineTo(mid + wTop, hz); ctx.lineTo(mid + wBot, H); ctx.lineTo(mid - wBot, H); ctx.fill();
    }

    function drawObject(o) {
      const p = persp(o.z), x = sx(o.x - g.x * 0.0, o.z), y = sy(o.z);
      const s = H * 0.30 * p * (o.size || 1);
      ctx.save();
      ctx.globalAlpha = Math.min(1, (1 - o.z) * 2.2 + 0.15);
      if (o.k === 'tree') {
        ctx.fillStyle = '#4b2e1b'; ctx.fillRect(x - s * 0.06, y - s * 0.25, s * 0.12, s * 0.25);
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle = i % 2 ? '#2f7a3a' : '#276b32';
          const w = s * (0.42 - i * 0.07), top = y - s * (0.25 + i * 0.3);
          ctx.beginPath(); ctx.moveTo(x, top - s * 0.4); ctx.lineTo(x - w, top + s * 0.08); ctx.lineTo(x + w, top + s * 0.08); ctx.fill();
        }
      } else if (o.k === 'rock') {
        ctx.fillStyle = '#8a8f98';
        ctx.beginPath(); ctx.moveTo(x - s * 0.34, y); ctx.lineTo(x - s * 0.22, y - s * 0.3); ctx.lineTo(x + s * 0.05, y - s * 0.38); ctx.lineTo(x + s * 0.32, y - s * 0.16); ctx.lineTo(x + s * 0.36, y); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.22)'; ctx.beginPath(); ctx.moveTo(x - s * 0.22, y - s * 0.3); ctx.lineTo(x + s * 0.05, y - s * 0.38); ctx.lineTo(x - s * 0.02, y - s * 0.12); ctx.fill();
      } else {                                                         // a gem, floating and turning
        const r = s * 0.22, yy = y - s * 0.55 + Math.sin(g.time * 4 + o.x * 5) * s * 0.04, k = Math.abs(Math.cos(g.time * 3 + o.x * 4));
        ctx.fillStyle = '#35e8ff';
        ctx.beginPath(); ctx.moveTo(x, yy - r); ctx.lineTo(x + r * (0.35 + 0.45 * k), yy); ctx.lineTo(x, yy + r); ctx.lineTo(x - r * (0.35 + 0.45 * k), yy); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.beginPath(); ctx.moveTo(x, yy - r); ctx.lineTo(x + r * 0.2, yy - r * 0.2); ctx.lineTo(x - r * 0.3, yy); ctx.fill();
      }
      ctx.restore();
    }

    function drawEagle() {
      const x = sx(g.x, 0), y = H * 0.8, u = Math.max(10, Math.min(W, H) * 0.075);
      const bank = Math.max(-1, Math.min(1, g.vx / 2.4)), fl = Math.sin(flap) ;
      if (g.invuln > 0 && !g.over && Math.floor(g.invuln * 12) % 2) return;      // blinks after a hit
      ctx.save(); ctx.translate(x, y); ctx.rotate(bank * 0.28);
      ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.beginPath(); ctx.ellipse(0, u * 1.9, u * 1.6, u * 0.28, 0, 0, 6.283); ctx.fill();   // its shadow on the ground
      const wing = (dir) => {
        ctx.fillStyle = '#7a4a22'; ctx.beginPath();
        ctx.moveTo(dir * u * 0.3, -u * 0.1);
        ctx.quadraticCurveTo(dir * u * 1.5, -u * (0.7 + fl * 0.7), dir * u * 2.6, -u * (0.1 + fl * 1.1));
        ctx.quadraticCurveTo(dir * u * 1.7, u * 0.5, dir * u * 0.3, u * 0.7); ctx.fill();
        ctx.fillStyle = '#5a3416'; ctx.beginPath();
        ctx.moveTo(dir * u * 1.4, -u * (0.3 + fl * 0.5)); ctx.lineTo(dir * u * 2.6, -u * (0.1 + fl * 1.1)); ctx.lineTo(dir * u * 1.9, u * 0.3); ctx.fill();
      };
      wing(-1); wing(1);
      ctx.fillStyle = '#6b3d1a'; ctx.beginPath(); ctx.ellipse(0, u * 0.25, u * 0.5, u * 0.95, 0, 0, 6.283); ctx.fill();    // body
      ctx.fillStyle = '#f4f0ea'; ctx.beginPath(); ctx.arc(0, -u * 0.8, u * 0.4, 0, 6.283); ctx.fill();                       // head
      ctx.fillStyle = '#ffb830'; ctx.beginPath(); ctx.moveTo(-u * 0.12, -u * 0.95); ctx.lineTo(u * 0.12, -u * 0.95); ctx.lineTo(0, -u * 1.35); ctx.fill();   // beak
      ctx.fillStyle = '#111'; ctx.fillRect(-u * 0.22, -u * 0.9, u * 0.1, u * 0.1); ctx.fillRect(u * 0.12, -u * 0.9, u * 0.1, u * 0.1);
      ctx.fillStyle = '#f4f0ea'; ctx.beginPath(); ctx.moveTo(-u * 0.4, u * 1.0); ctx.lineTo(u * 0.4, u * 1.0); ctx.lineTo(u * 0.25, u * 1.6); ctx.lineTo(-u * 0.25, u * 1.6); ctx.fill();   // tail
      ctx.restore();
    }

    function setMsg() {
      msg.style.display = state === 'playing' ? 'none' : 'flex';
      if (state === 'ready') msg.innerHTML = '<b>🦅 Eagle Ride</b><span>← → or A D steer, or move the mouse. Dodge trees and rocks, grab gems. Three lives.</span><button>Fly</button>';
      else if (state === 'paused') msg.innerHTML = '<b>Paused</b><span>P or the button to carry on</span><button>Resume</button>';
      else if (state === 'over') msg.innerHTML = `<b>Game over</b><span>Score ${g.score}${newBest ? ' · new best!' : ` · best ${best}`}</span><button>Fly again</button>`;
      const b = msg.querySelector('button'); if (b) b.onclick = (e) => { e.stopPropagation(); primary(); root.focus(); };
      bPause.textContent = state === 'paused' ? 'Resume' : 'Pause';
      bPause.style.display = state === 'playing' || state === 'paused' ? '' : 'none';
    }

    function drawHud() {
      hScore.textContent = `Score ${g.score}`;
      hLives.textContent = '❤'.repeat(Math.max(0, g.lives)) + '♡'.repeat(Math.max(0, L.LIVES - g.lives)) + `   💎 ${g.gems}`;
      hBest.textContent = `Best ${Math.max(best, state === 'over' ? best : g.score)}`;
    }

    function draw() {
      ctx.save();
      if (shake > 0) ctx.translate((Math.random() - 0.5) * shake * 8, (Math.random() - 0.5) * shake * 8);
      drawSky(); drawGround();
      const sorted = g.objects.slice().sort((a, b) => b.z - a.z);
      for (const o of sorted) if (o.z > 0.02 || o.k !== 'gem') drawObject(o);
      drawEagle();
      ctx.restore();
      drawHud();
    }

    // ---- flow ----
    function start() {
      g = L.createGame(); newBest = false; state = 'playing'; shake = 0;
      sfx.start(); setMsg(); loop0();
    }
    function pause() { if (state === 'playing') { state = 'paused'; held.clear(); setMsg(); stopLoop(); draw(); } }
    function unpause() { if (state === 'paused') { state = 'playing'; setMsg(); loop0(); } }
    function primary() { if (state === 'playing') pause(); else if (state === 'paused') unpause(); else start(); }
    function stopLoop() { if (raf) cancelAnimationFrame(raf); raf = 0; }
    function loop0() { stopLoop(); last = 0; raf = requestAnimationFrame(frame); }

    function frame(t) {
      raf = 0;
      if (!alive || state !== 'playing') return;
      const dt = last ? (t - last) / 1000 : 0; last = t;
      const dir = (held.has('ArrowRight') || held.has('d') ? 1 : 0) - (held.has('ArrowLeft') || held.has('a') ? 1 : 0);
      L.step(g, dt, dir, dir ? null : pointerX);
      flap += dt * (7 + g.speed * 6); scroll = (scroll + g.speed * dt * 0.6) % 1; shake = Math.max(0, shake - dt * 2.5);
      for (const ev of g.events.splice(0)) {
        if (ev === 'gem') sfx.gem(); else if (ev === 'hit') { sfx.hit(); shake = 1; } else if (ev === 'over') {
          sfx.over(); state = 'over'; held.clear();
          if (g.score > best) { best = g.score; newBest = true; store.set('best', best); }
          setMsg();
        }
      }
      draw();
      if (state === 'playing') raf = requestAnimationFrame(frame);
    }

    function handleKey(k, down) {
      if (down) {
        if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'a' || k === 'd') { held.add(k); pointerX = null; return true; }
        if (k === ' ' || k === 'Enter') { if (state !== 'playing') primary(); return true; }
        if (k === 'p') { if (state === 'playing' || state === 'paused') primary(); return true; }
        if (k === 'm') { soundOn = !soundOn; store.set('sound', soundOn); soundLabel(); return true; }
        return false;
      }
      held.delete(k); return false;
    }
    const norm = (e) => (e.key.length === 1 ? e.key.toLowerCase() : e.key);
    const onDown = (e) => { if (e.metaKey || e.ctrlKey || e.altKey) return; if (handleKey(norm(e), true)) e.preventDefault(); };
    const onUp = (e) => { handleKey(norm(e), false); };
    const onVis = () => { if (document.hidden) pause(); };
    const toX = (e) => { const r = cv.getBoundingClientRect(); return Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width - 0.5) * 2 * 1.25)); };
    const onMove = (e) => { if (state === 'playing' && true) pointerX = toX(e); };
    const onLeave = () => { pointerX = null; };
    window.addEventListener('keydown', onDown); window.addEventListener('keyup', onUp);
    document.addEventListener('visibilitychange', onVis);
    cv.addEventListener('pointermove', onMove); cv.addEventListener('pointerdown', (e) => { root.focus(); if (state === 'playing') pointerX = toX(e); });
    cv.addEventListener('pointerleave', onLeave);
    bPause.onclick = () => { primary(); root.focus(); };
    bSound.onclick = () => { soundOn = !soundOn; store.set('sound', soundOn); soundLabel(); root.focus(); };

    const api = {
      suspend() { pause(); },
      resume() { /* stays paused: press P or Resume */ },
      key(k, down) { handleKey(k && k.length === 1 ? k.toLowerCase() : k, !!down); },
      setSoundEnabled() { soundLabel(); },
      state: () => ({ state, score: g.score, lives: g.lives, gems: g.gems, best, over: g.over, x: g.x, speed: g.speed }),
      dev: { get g() { return g; }, start, frame, step: (dt, dir) => { L.step(g, dt, dir); }, draw },
    };
    resize(); setMsg(); soundLabel(); draw();
    root.focus();
    const stop = () => {
      alive = false; stopLoop();
      window.removeEventListener('keydown', onDown); window.removeEventListener('keyup', onUp);
      document.removeEventListener('visibilitychange', onVis);
      if (ro) ro.disconnect();
      host.innerHTML = '';
      if (window.NotchEagleGame.current === api) window.NotchEagleGame.current = null;
    };
    window.NotchEagleGame.current = api;
    return stop;
  }

  window.NotchEagleGame = {
    current: null,
    mount,
    key: (k, down) => { const c = window.NotchEagleGame.current; if (c) c.key(k, down); },
    suspend: () => { const c = window.NotchEagleGame.current; if (c) c.suspend(); },
    resume: () => { const c = window.NotchEagleGame.current; if (c) c.resume(); },
    setSoundEnabled: (on) => { const c = window.NotchEagleGame.current; if (c) c.setSoundEnabled(on); },
    state: () => { const c = window.NotchEagleGame.current; return c ? c.state() : null; },
    get dev() { const c = window.NotchEagleGame.current; return c && c.dev; },
  };
})();
