// Night Shift at Tinker's Toy Emporium, for the Games tab, shared by the Mac and Windows apps. An original night-guard horror game:
// the rules are in nightshift-logic.js, this file draws it (everything is drawn in code, nothing is downloaded) and plays the
// sounds (made on the spot with Web Audio).
//
//   window.NotchNightShift.mount(hostElement)   starts it; returns a function that stops it.
//   window.NotchNightShift.suspend() / resume()  the notch closed / opened: the night pauses.
//   window.NotchNightShift.key(key, down)        a key forwarded by the Mac app when the web view has no keyboard focus.
//   window.NotchNightShift.setSoundEnabled(on)   the Mac app's sound switch.
//
// Controls: Q left door · A left light · E right door · D right light · Space or S cameras · 1-9, 0, - pick a camera ·
// ← → look around (or move the mouse to the sides) · P pause · M sound. Everything can be clicked too.
(function () {
  'use strict';
  const N = window.NotchNightLogic;
  const W = 640, H = 360, OW = 960;           // the screen, and the office (wider: you look left and right)
  const store = {
    get(k, d) { try { const v = localStorage.getItem('nightshift.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('nightshift.' + k, JSON.stringify(v)); } catch { /* storage off */ } },
  };
  const CSS = '.ns{position:absolute;inset:0;background:#000;outline:none;user-select:none;-webkit-user-select:none;overflow:hidden;cursor:default}.ns canvas{position:absolute;display:block}';
  const KEYCAM = { 1: 'stage', 2: 'dining', 3: 'prize', 4: 'westHall', 5: 'westCorner', 6: 'closet', 7: 'eastHall', 8: 'eastCorner', 9: 'workshop', 0: 'kitchen', '-': 'restrooms' };
  // The camera map (bottom right while the cameras are up): where each camera's button sits.
  const MAP = { stage: [470, 196], dining: [470, 222], prize: [432, 236], workshop: [418, 214], closet: [436, 272], westHall: [470, 262], westCorner: [470, 296], eastHall: [560, 262], eastCorner: [560, 296], kitchen: [592, 226], restrooms: [596, 200] };
  const NAMES = { clank: 'Clank', petunia: 'Petunia', grin: 'Grin', conductor: 'The Conductor' };

  let current = null;

  // ------------------------------------------------------------------ the toys, drawn with their feet at 0,0 and about 100 tall
  function clank(g, eyes) {
    g.fillStyle = '#3c4d4a'; g.fillRect(-22, -32, 14, 32); g.fillRect(8, -32, 14, 32);           // legs
    g.fillStyle = '#5e7a76'; roundRect(g, -30, -72, 60, 44, 6); g.fill();                       // body
    g.fillStyle = '#7c4a2a'; g.fillRect(-14, -66, 9, 6); g.fillRect(6, -50, 8, 5);              // rust
    g.fillStyle = '#c9d1c4'; g.beginPath(); g.arc(0, -52, 8, 0, 6.3); g.fill();                 // the chest dial
    g.strokeStyle = '#2b2f2c'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, -52); g.lineTo(5, -57); g.stroke();
    g.fillStyle = '#4f6763'; g.fillRect(-42, -70, 12, 34); g.fillRect(30, -70, 12, 34);         // arms
    g.fillStyle = '#8f8a6c'; g.fillRect(36, -64, 16, 4); g.fillRect(50, -70, 4, 16);            // the wind-up key
    g.fillStyle = '#6d8a85'; roundRect(g, -24, -104, 48, 32, 5); g.fill();                      // head
    g.fillStyle = '#3c4d4a'; for (const [x, y] of [[-20, -100], [20, -100], [-20, -76], [20, -76]]) { g.beginPath(); g.arc(x, y, 1.6, 0, 6.3); g.fill(); }
    g.strokeStyle = '#3c4d4a'; g.beginPath(); g.moveTo(0, -104); g.lineTo(0, -116); g.stroke();
    glowDot(g, 0, -118, 3.5, eyes ? '#ff6b4a' : '#5a2a22', eyes);
    glowDot(g, -10, -90, 6, eyes ? '#ffd84a' : '#2a2a20', eyes); glowDot(g, 10, -90, 6, eyes ? '#ffd84a' : '#2a2a20', eyes);
    g.fillStyle = '#2b2f2c'; for (let i = -9; i <= 9; i += 4.5) g.fillRect(i - 1, -81, 2, 5);     // the grille mouth
  }
  function petunia(g, eyes) {
    g.fillStyle = '#e9ddd0'; g.fillRect(-10, -18, 6, 18); g.fillRect(4, -18, 6, 18);            // legs
    g.fillStyle = '#3a2a2a'; g.fillRect(-12, -3, 9, 4); g.fillRect(3, -3, 9, 4);                // shoes
    g.fillStyle = '#b5647f'; g.beginPath(); g.moveTo(-6, -64); g.lineTo(6, -64); g.lineTo(26, -16); g.lineTo(-26, -16); g.closePath(); g.fill();   // dress
    g.fillStyle = '#f2e7ea'; for (let x = -24; x <= 20; x += 8) { g.beginPath(); g.arc(x + 4, -16, 4, 0, Math.PI); g.fill(); }                    // frill
    g.strokeStyle = '#e9ddd0'; g.lineWidth = 4; g.beginPath(); g.moveTo(-6, -58); g.lineTo(-20, -34); g.moveTo(6, -58); g.lineTo(20, -34); g.stroke();
    g.fillStyle = '#efe3d6'; g.beginPath(); g.arc(0, -80, 18, 0, 6.3); g.fill();                 // the porcelain face
    g.fillStyle = '#3b2418'; g.beginPath(); g.arc(0, -84, 20, Math.PI, 0); g.fill(); g.fillRect(-20, -84, 6, 18); g.fillRect(14, -84, 6, 18);   // hair
    g.fillStyle = 'rgba(220,110,120,.6)'; g.beginPath(); g.arc(-10, -74, 4, 0, 6.3); g.arc(10, -74, 4, 0, 6.3); g.fill();
    g.fillStyle = '#111'; g.beginPath(); g.arc(-7, -81, 4.5, 0, 6.3); g.arc(7, -81, 4.5, 0, 6.3); g.fill();
    glowDot(g, -7, -81, 1.6, eyes ? '#ffffff' : '#555', eyes); glowDot(g, 7, -81, 1.6, eyes ? '#ffffff' : '#555', eyes);
    g.strokeStyle = '#8c2030'; g.lineWidth = 1.6; g.beginPath(); g.arc(0, -72, 5, 0.2, Math.PI - 0.2); g.stroke();
    g.strokeStyle = 'rgba(60,40,40,.7)'; g.lineWidth = 1; g.beginPath(); g.moveTo(4, -96); g.lineTo(9, -88); g.lineTo(6, -84); g.lineTo(12, -76); g.stroke();   // the crack
  }
  function grinBox(g, stage, eyes) {
    if (stage >= 1 && stage < 3) {
      const out = stage === 1 ? 14 : 44;
      g.strokeStyle = '#b8b8c0'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, -46);
      for (let i = 1; i <= 6; i++) g.lineTo(i % 2 ? -8 : 8, -46 - out * i / 6); g.stroke();
      grinHead(g, 0, -46 - out - 16, eyes);
    }
    g.fillStyle = '#b3262b'; g.fillRect(-32, -46, 64, 46);                                     // the box
    g.fillStyle = '#e8c33a'; for (let i = 0; i < 4; i++) g.fillRect(-32 + i * 16, -46, 8, 46);
    g.fillStyle = '#6b4c2a'; g.fillRect(32, -30, 10, 4); g.fillRect(40, -34, 4, 12);           // the crank
    g.save(); g.translate(-32, -46); g.rotate(stage === 0 ? 0 : stage === 1 ? -0.35 : -1.9);  // the lid
    g.fillStyle = '#c23a3f'; g.fillRect(0, -6, 64, 6); g.restore();
  }
  function grinHead(g, x, y, eyes) {
    g.fillStyle = '#f4f1ea'; g.beginPath(); g.arc(x, y, 17, 0, 6.3); g.fill();
    g.fillStyle = '#6a3fa8'; g.beginPath(); g.moveTo(x - 15, y - 9); g.lineTo(x + 15, y - 9); g.lineTo(x + 3, y - 38); g.closePath(); g.fill();
    g.fillStyle = '#e8c33a'; g.beginPath(); g.arc(x + 3, y - 38, 4, 0, 6.3); g.fill();
    glowDot(g, x - 7, y - 3, 3.2, eyes ? '#7df07a' : '#1d2a1d', eyes); glowDot(g, x + 7, y - 3, 3.2, eyes ? '#7df07a' : '#1d2a1d', eyes);
    g.fillStyle = '#d42a2a'; g.beginPath(); g.arc(x, y + 3, 3.5, 0, 6.3); g.fill();
    g.strokeStyle = '#3a1010'; g.lineWidth = 2; g.beginPath(); g.arc(x, y + 4, 10, 0.25, Math.PI - 0.25); g.stroke();
    g.fillStyle = '#fff'; for (let i = -6; i <= 6; i += 4) g.fillRect(x + i - 1, y + 9, 2, 3);
  }
  function grinRun(g, eyes) {                                                                  // out of its box, on its spring
    g.strokeStyle = '#b8b8c0'; g.lineWidth = 3; g.beginPath(); g.moveTo(-6, 0);
    for (let i = 1; i <= 8; i++) g.lineTo(i % 2 ? -12 : 4, -i * 8); g.stroke();
    g.fillStyle = '#b3262b'; g.fillRect(-20, -86, 40, 22);
    grinHead(g, 0, -104, eyes);
  }
  function conductor(g, eyes) {
    g.fillStyle = '#1d1d22'; for (const x of [-30, 0, 30]) { g.beginPath(); g.arc(x, -10, 10, 0, 6.3); g.fill(); }   // wheels
    g.fillStyle = '#a88a3a'; for (const x of [-30, 0, 30]) { g.beginPath(); g.arc(x, -10, 3, 0, 6.3); g.fill(); }
    g.fillStyle = '#7a1f1f'; roundRect(g, -44, -58, 64, 40, 8); g.fill();                     // the boiler
    g.fillStyle = '#a88a3a'; g.fillRect(-30, -58, 4, 40); g.fillRect(-6, -58, 4, 40);
    g.fillStyle = '#4a1414'; g.fillRect(14, -78, 30, 60);                                      // the cab
    g.fillStyle = '#1d1d22'; g.fillRect(-36, -80, 14, 22); g.fillRect(-40, -84, 22, 6);        // the smokestack hat
    g.fillStyle = '#e9e1cc'; g.beginPath(); g.arc(-44, -38, 18, 0, 6.3); g.fill();             // its face
    glowDot(g, -50, -42, 4.5, eyes ? '#fff6c8' : '#3a3a30', eyes); glowDot(g, -38, -42, 4.5, eyes ? '#fff6c8' : '#3a3a30', eyes);
    g.strokeStyle = '#3a1010'; g.lineWidth = 2; g.beginPath(); g.arc(-44, -34, 7, 0.3, Math.PI - 0.3); g.stroke();
  }
  function drawBot(g, id, x, y, scale, opts = {}) {
    g.save(); g.translate(x, y); g.scale(scale, scale);
    if (opts.dark) g.globalAlpha *= opts.dark;
    const eyes = opts.eyes !== false;
    if (id === 'clank') clank(g, eyes); else if (id === 'petunia') petunia(g, eyes);
    else if (id === 'conductor') conductor(g, eyes); else if (id === 'grin') (opts.box ? grinBox(g, opts.stage || 0, eyes) : grinRun(g, eyes));
    g.restore();
  }

  // ------------------------------------------------------------------ small drawing helpers
  function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function glowDot(g, x, y, r, col, glow) {
    if (glow) { const gr = g.createRadialGradient(x, y, 0, x, y, r * 4); gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.globalAlpha *= 0.55; g.beginPath(); g.arc(x, y, r * 4, 0, 6.3); g.fill(); g.globalAlpha /= 0.55; }
    g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, 6.3); g.fill();
  }
  function text(g, s, x, y, size, col, align = 'left', weight = 600, font = 'ui-monospace, Menlo, Consolas, monospace') { g.font = `${weight} ${size}px ${font}`; g.fillStyle = col; g.textAlign = align; g.textBaseline = 'alphabetic'; g.fillText(s, x, y); }
  const lerp = (a, b, k) => a + (b - a) * k;

  // Static: a few frames of noise made once, drawn over the cameras.
  const noise = [];
  function makeNoise() {
    if (noise.length) return;
    for (let f = 0; f < 4; f++) {
      const c = document.createElement('canvas'); c.width = 160; c.height = 90; const x = c.getContext('2d'), img = x.createImageData(160, 90);
      for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
      x.putImageData(img, 0, 0); noise.push(c);
    }
  }

  // ------------------------------------------------------------------ the rooms on the cameras (640 x 360, before the green tint)
  function wall(g, top, bottom) { const gr = g.createLinearGradient(0, 0, 0, 260); gr.addColorStop(0, top); gr.addColorStop(1, bottom); g.fillStyle = gr; g.fillRect(0, 0, W, 260); }
  function tiles(g, y0, a, b) { for (let y = y0, row = 0; y < H; y += 18, row++) for (let x = -20, c = 0; x < W + 20; x += 36, c++) { g.fillStyle = (row + c) % 2 ? a : b; g.fillRect(x + (row % 2) * 4, y, 36, 18); } }
  function hall(g) {
    g.fillStyle = '#1b2220'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#2b3531'; g.beginPath(); g.moveTo(0, 0); g.lineTo(250, 120); g.lineTo(250, 240); g.lineTo(0, H); g.fill();
    g.beginPath(); g.moveTo(W, 0); g.lineTo(390, 120); g.lineTo(390, 240); g.lineTo(W, H); g.fill();
    g.fillStyle = '#0c100f'; g.fillRect(250, 120, 140, 120);
    g.fillStyle = '#3a2f26'; g.beginPath(); g.moveTo(0, H); g.lineTo(250, 240); g.lineTo(390, 240); g.lineTo(W, H); g.fill();
    g.fillStyle = '#5b4a7a'; g.fillRect(80, 110, 50, 66); g.fillStyle = '#d8c25a'; g.fillRect(500, 104, 46, 60);   // posters
    text(g, 'PLAY!', 105, 150, 12, '#f0e9d0', 'center', 800, 'system-ui, sans-serif');
  }
  const SCENE = {
    stage(g) {
      wall(g, '#2a1a22', '#1a1216'); tiles(g, 260, '#2a2a2a', '#151515');
      g.fillStyle = '#4a2a1a'; g.fillRect(70, 230, 500, 36);                                    // the stage
      g.fillStyle = '#6e1420'; g.fillRect(40, 20, 90, 220); g.fillRect(510, 20, 90, 220);     // curtains
      g.fillStyle = '#8a1a28'; for (let x = 40; x < 130; x += 18) g.fillRect(x, 20, 6, 220); for (let x = 510; x < 600; x += 18) g.fillRect(x, 20, 6, 220);
      const flags = ['#d84a4a', '#e8c33a', '#4aa8d8', '#7ad84a']; for (let i = 0; i < 14; i++) { g.fillStyle = flags[i % 4]; g.beginPath(); g.moveTo(130 + i * 28, 30); g.lineTo(156 + i * 28, 30); g.lineTo(143 + i * 28, 48); g.fill(); }
      text(g, "TINKER'S TOYS", 320, 80, 22, '#e8c33a', 'center', 800, 'system-ui, sans-serif');
    },
    dining(g) {
      wall(g, '#22261f', '#171a15'); tiles(g, 250, '#2d2d2d', '#1a1a1a');
      for (const sx of [30, 470]) { g.fillStyle = '#3e2c1d'; g.fillRect(sx, 60, 140, 190); for (let r = 0; r < 4; r++) { g.fillStyle = '#2a1d13'; g.fillRect(sx, 96 + r * 44, 140, 6); for (let k = 0; k < 4; k++) { g.fillStyle = ['#7a3a3a', '#3a5a7a', '#6a6a3a', '#5a3a6a'][(r + k) % 4]; g.fillRect(sx + 8 + k * 33, 70 + r * 44, 24, 26); } } }
      g.fillStyle = '#4a3a2a'; g.fillRect(200, 250, 240, 14); g.fillRect(212, 264, 8, 60); g.fillRect(420, 264, 8, 60);
    },
    prize(g) {
      wall(g, '#261d2a', '#18121b'); tiles(g, 260, '#2d2733', '#19151d');
      g.fillStyle = '#3c2a46'; g.fillRect(60, 220, 520, 50); text(g, 'PRIZES', 320, 60, 26, '#e88ad8', 'center', 800, 'system-ui, sans-serif');
      for (let i = 0; i < 9; i++) { g.fillStyle = ['#c8a07a', '#7ac8c0', '#c87a9a'][i % 3]; g.beginPath(); g.arc(90 + i * 58, 120 + (i % 2) * 14, 14, 0, 6.3); g.fill(); g.strokeStyle = '#555'; g.lineWidth = 1; g.beginPath(); g.moveTo(90 + i * 58, 80); g.lineTo(90 + i * 58, 106 + (i % 2) * 14); g.stroke(); }
    },
    workshop(g) {
      wall(g, '#20221f', '#151614'); tiles(g, 262, '#262626', '#161616');
      g.fillStyle = '#5a4630'; g.fillRect(40, 70, 260, 120); g.fillStyle = '#3a2d1f'; for (let i = 0; i < 7; i++) g.fillRect(60 + i * 34, 90, 6, 40 + (i % 3) * 14);
      g.fillStyle = '#4a3a28'; g.fillRect(330, 220, 280, 18); g.fillRect(340, 238, 10, 80); g.fillRect(590, 238, 10, 80);
      g.save(); g.translate(470, 220); g.scale(0.7, 0.7); g.fillStyle = '#6d8a85'; roundRect(g, -24, -34, 48, 32, 5); g.fill(); glowDot(g, -10, -20, 6, '#2a2a20', false); glowDot(g, 10, -20, 6, '#2a2a20', false); g.restore();   // a spare robot head
    },
    closet(g) {
      g.fillStyle = '#141614'; g.fillRect(0, 0, W, H); g.fillStyle = '#262a26'; g.fillRect(140, 0, 360, H);
      for (let r = 0; r < 4; r++) { g.fillStyle = '#3a3226'; g.fillRect(150, 50 + r * 70, 340, 6); g.fillStyle = '#5a6a7a'; g.fillRect(170 + r * 30, 22 + r * 70, 26, 28); g.fillStyle = '#7a5a3a'; g.fillRect(330, 26 + r * 70, 40, 24); }
      g.strokeStyle = '#8a7a5a'; g.lineWidth = 4; g.beginPath(); g.moveTo(200, 340); g.lineTo(250, 120); g.stroke();
    },
    westHall: hall, eastHall: hall,
    westCorner(g) { wall(g, '#1e2420', '#141815'); tiles(g, 250, '#2a2a2a', '#151515'); g.fillStyle = '#0d100f'; g.fillRect(420, 30, 220, 230); g.fillStyle = '#3a5a7a'; g.fillRect(80, 70, 90, 120); text(g, 'SMILE!', 125, 140, 16, '#e8e2c8', 'center', 800, 'system-ui, sans-serif'); },
    eastCorner(g) { wall(g, '#1e2420', '#141815'); tiles(g, 250, '#2a2a2a', '#151515'); g.fillStyle = '#0d100f'; g.fillRect(0, 30, 220, 230); g.fillStyle = '#7a3a5a'; g.fillRect(470, 70, 90, 120); text(g, 'SHARE!', 515, 140, 16, '#e8e2c8', 'center', 800, 'system-ui, sans-serif'); },
    restrooms(g) {
      g.fillStyle = '#c8c8be'; g.fillRect(0, 0, W, 260); for (let x = 0; x < W; x += 24) for (let y = 0; y < 260; y += 24) { g.strokeStyle = '#a8a89e'; g.lineWidth = 1; g.strokeRect(x, y, 24, 24); }
      tiles(g, 260, '#3a3a3a', '#232323');
      g.fillStyle = '#4a5a6a'; g.fillRect(120, 70, 110, 190); g.fillRect(410, 70, 110, 190);
      text(g, 'BOYS', 175, 110, 15, '#e8e2c8', 'center', 800, 'system-ui, sans-serif'); text(g, 'GIRLS', 465, 110, 15, '#e8e2c8', 'center', 800, 'system-ui, sans-serif');
    },
  };
  // Where a toy stands on each camera: [x, feet y, scale].
  const SPOT = {
    stage: { clank: [220, 240, 1.25], petunia: [420, 240, 1.3], conductor: [320, 240, 1.3] },
    dining: { clank: [170, 330, 1.5], petunia: [470, 330, 1.6], conductor: [320, 320, 1.3] },
    workshop: { clank: [250, 330, 1.7] },
    closet: { clank: [420, 340, 2.2] },
    westHall: { clank: [320, 250, 1.0] },
    westCorner: { clank: [360, 350, 2.3] },
    eastHall: { petunia: [320, 250, 1.1], conductor: [330, 250, 0.9] },
    eastCorner: { petunia: [280, 350, 2.4], conductor: [300, 340, 1.8] },
    restrooms: { petunia: [360, 330, 1.6], conductor: [300, 330, 1.3] },
  };

  // ------------------------------------------------------------------ sounds (only after a key or click, and never with the sound off)
  function makeSound() {
    let ctx = null, hum = null, music = null;
    const hostOn = () => window.NotchHostSound !== false;
    const ok = () => S.on && hostOn() && ensure();
    function ensure() { try { if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)(); if (ctx.state === 'suspended') ctx.resume(); return true; } catch { return false; } }
    function tone(f, dur, type = 'sine', vol = 0.15, f2 = null, at = 0) {
      if (!ok()) return; const t = ctx.currentTime + at, o = ctx.createOscillator(), v = ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
      v.gain.setValueAtTime(vol, t); v.gain.exponentialRampToValueAtTime(0.001, t + dur); o.connect(v).connect(ctx.destination); o.start(t); o.stop(t + dur + 0.02);
    }
    function burst(dur, vol = 0.2, freq = 800, type = 'lowpass', at = 0) {
      if (!ok()) return; const t = ctx.currentTime + at, len = Math.max(1, Math.floor(ctx.sampleRate * dur)), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), v = ctx.createGain(); src.buffer = buf; f.type = type; f.frequency.value = freq; v.gain.value = vol;
      src.connect(f).connect(v).connect(ctx.destination); src.start(t);
    }
    const S = {
      on: store.get('sound', true),
      door() { burst(0.25, 0.35, 300); tone(70, 0.3, 'square', 0.12, 40); },
      light() { tone(120, 0.12, 'sawtooth', 0.04); },
      sting() { tone(880, 0.6, 'sawtooth', 0.08, 220); burst(0.3, 0.12, 2500, 'highpass'); },
      cams() { tone(1400, 0.05, 'square', 0.05); burst(0.12, 0.08, 3000, 'highpass'); },
      click() { tone(2000, 0.03, 'square', 0.04); },
      glitch() { burst(0.35, 0.18, 4000, 'highpass'); },
      steps() { for (let i = 0; i < 3; i++) burst(0.08, 0.25, 180, 'lowpass', i * 0.32); },
      run() { for (let i = 0; i < 8; i++) burst(0.06, 0.3, 220, 'lowpass', i * 0.16); },
      bang() { for (let i = 0; i < 3; i++) { burst(0.12, 0.6, 250, 'lowpass', i * 0.22); tone(60, 0.15, 'square', 0.15, 40, i * 0.22); } },
      jam() { tone(160, 0.15, 'square', 0.08); tone(150, 0.15, 'square', 0.08, null, 0.18); },
      scare() { tone(600, 1.2, 'sawtooth', 0.32, 120); tone(900, 1.2, 'square', 0.18, 200); burst(1.2, 0.45, 5000, 'highpass'); },
      down() { tone(300, 1.6, 'sawtooth', 0.12, 30); },
      chime() { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, 0.9, 'triangle', 0.14, null, i * 0.35)); },
      startHum() { if (!ok() || hum) return; const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1; const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), v = ctx.createGain(); src.buffer = buf; src.loop = true; f.type = 'lowpass'; f.frequency.value = 160; v.gain.value = 0.05; src.connect(f).connect(v).connect(ctx.destination); src.start(); hum = src; },
      stopHum() { if (hum) { try { hum.stop(); } catch { /* already stopped */ } hum = null; } },
      startMusic() { if (!ok() || music) return; const notes = [659, 587, 523, 587, 659, 659, 659, 0, 587, 587, 587, 0, 659, 784, 784]; let i = 0; music = setInterval(() => { const f = notes[i++ % notes.length]; if (f) tone(f, 0.35, 'triangle', 0.09); }, 380); },
      stopMusic() { if (music) { clearInterval(music); music = null; } },
      stopAll() { S.stopHum(); S.stopMusic(); },
    };
    return S;
  }

  // ------------------------------------------------------------------ the game
  function mount(host) {
    if (!document.getElementById('ns-css')) { const st = document.createElement('style'); st.id = 'ns-css'; st.textContent = CSS; document.head.appendChild(st); }
    makeNoise();
    const root = document.createElement('div'); root.className = 'ns'; root.tabIndex = 0;
    const cv = document.createElement('canvas'); root.appendChild(cv); host.appendChild(root);
    const g = cv.getContext('2d');
    const sfx = makeSound();

    let screen = 'menu';                // 'menu' | 'intro' | 'play' | 'paused' | 'scare' | 'over' | 'win'
    let s = null, pan = 160, panVel = 0, mouse = { x: -1, y: -1 }, inBar = false;
    let raf = 0, last = 0, clock = 0, screenT = 0, glitchT = 0, flipT = 0, flash = 0;
    const doorAnim = { left: 0, right: 0 };
    let scale = 1, offX = 0, offY = 0, stopped = false;
    let beaten = store.get('beaten', 0);

    function fit() {
      const r = root.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      scale = Math.max(0.1, Math.min(r.width / W, r.height / H));
      const cw = W * scale, ch = H * scale; offX = (r.width - cw) / 2; offY = (r.height - ch) / 2;
      cv.style.width = cw + 'px'; cv.style.height = ch + 'px'; cv.style.left = offX + 'px'; cv.style.top = offY + 'px';
      cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr);
    }
    const ro = window.ResizeObserver ? new ResizeObserver(fit) : null; if (ro) ro.observe(root); else window.addEventListener('resize', fit);
    fit();

    function go(next) { screen = next; screenT = 0; if (next !== 'play') sfx.stopHum(); if (next !== 'play' && next !== 'paused') sfx.stopMusic(); }
    function startNight() { s = N.newNight(1); pan = 160; doorAnim.left = doorAnim.right = 0; glitchT = 0; flipT = 0; go('intro'); }
    function pause() { if (screen === 'play') { go('paused'); } }
    function unpause() { if (screen === 'paused') { go('play'); sfx.startHum(); if (s && s.po && s.po.phase === 'music') sfx.startMusic(); } }

    // what the night's events sound and look like
    function react(evs) {
      for (const e of evs) {
        if (e.type === 'door') sfx.door();
        else if (e.type === 'light') { sfx.light(); if (e.seen && e.seen.length) sfx.sting(); }
        else if (e.type === 'cams') { sfx.cams(); flipT = 0.22; }
        else if (e.type === 'cam') { sfx.click(); glitchT = Math.max(glitchT, 0.12); }
        else if (e.type === 'move') { if (e.seen) { sfx.glitch(); glitchT = 0.9; } else if (/Corner|Door/.test(e.to)) sfx.steps(); }
        else if (e.type === 'leave') sfx.steps();
        else if (e.type === 'run') sfx.run();
        else if (e.type === 'bang') sfx.bang();
        else if (e.type === 'jammed') sfx.jam();
        else if (e.type === 'blackout') { sfx.stopHum(); sfx.down(); }
        else if (e.type === 'music') sfx.startMusic();
        else if (e.type === 'musicEnd') sfx.stopMusic();
        else if (e.type === 'scare') { sfx.stopAll(); sfx.scare(); go('scare'); }
        else if (e.type === 'six') { sfx.stopAll(); sfx.chime(); beaten = Math.max(beaten, s.night); store.set('beaten', beaten); go('win'); }
      }
    }

    function frame(ts) {
      raf = 0; if (stopped) return;
      const dt = Math.min(0.05, last ? (ts - last) / 1000 : 0); last = ts; clock += dt; screenT += dt;
      if (screen === 'intro' && screenT > 4.5) { go('play'); sfx.startHum(); }
      if (screen === 'play') {
        N.step(s, dt); react(s.events);
        if (!s.camUp) { pan = Math.max(0, Math.min(OW - W, pan + panVel * dt)); if (mouse.x >= 0) { const m = mouse.x < 110 ? -(110 - mouse.x) * 5 : mouse.x > W - 110 ? (mouse.x - (W - 110)) * 5 : 0; pan = Math.max(0, Math.min(OW - W, pan + m * dt)); } }
      }
      if (s) for (const side of ['left', 'right']) doorAnim[side] = lerp(doorAnim[side], s.doors[side] ? 1 : 0, Math.min(1, dt * 14));
      glitchT = Math.max(0, glitchT - dt); flipT = Math.max(0, flipT - dt); flash = Math.max(0, flash - dt);
      draw();
      if (screen !== 'paused' || screenT < 0.1) raf = requestAnimationFrame(frame);
    }
    function wake() { if (!raf && !stopped) { last = 0; raf = requestAnimationFrame(frame); } }

    // ---------------- drawing
    function draw() {
      const dpr = cv.width / W; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
      g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
      if (screen === 'menu') return drawMenu();
      if (screen === 'intro') return drawIntro();
      if (screen === 'scare') return drawScare();
      if (screen === 'over') return drawOver();
      if (screen === 'win') return drawWin();
      if (s.camUp && !s.powerOut) drawCams(); else drawOffice();
      if (flipT > 0) { g.fillStyle = `rgba(0,0,0,${flipT / 0.22 * 0.8})`; g.fillRect(0, 0, W, H); }
      drawHud();
      if (screen === 'paused') { g.fillStyle = 'rgba(0,0,0,.7)'; g.fillRect(0, 0, W, H); text(g, 'Paused', W / 2, 170, 26, '#fff', 'center', 700); text(g, 'Press P or click to carry on', W / 2, 200, 13, '#aaa', 'center', 500); }
    }

    function drawOffice() {
      g.save(); g.translate(-pan, 0);
      const dark = s.powerOut;
      // the walls and floor
      const gr = g.createLinearGradient(0, 0, 0, 260); gr.addColorStop(0, '#1a1f1d'); gr.addColorStop(1, '#2a302b'); g.fillStyle = gr; g.fillRect(0, 0, OW, 270);
      for (let y = 270, r = 0; y < H; y += 15, r++) for (let x = 0, c = 0; x < OW; x += 30, c++) { g.fillStyle = (r + c) % 2 ? '#2e2e2e' : '#151515'; g.fillRect(x, y, 30, 15); }
      g.fillStyle = '#24302a'; g.fillRect(0, 250, OW, 20);
      // posters and the kids' drawings
      g.fillStyle = '#5b4a7a'; g.fillRect(300, 50, 90, 120); text(g, "TINKER'S", 345, 80, 12, '#f0e2a0', 'center', 800, 'system-ui, sans-serif'); text(g, 'TOYS', 345, 96, 14, '#f0e2a0', 'center', 800, 'system-ui, sans-serif');
      drawBot(g, 'clank', 345, 160, 0.5, { eyes: false });
      for (let i = 0; i < 6; i++) { g.save(); g.translate(560 + (i % 3) * 52, 60 + Math.floor(i / 3) * 56); g.rotate((i % 2 ? 1 : -1) * 0.06); g.fillStyle = '#e8e2d0'; g.fillRect(0, 0, 44, 46); g.strokeStyle = ['#d84a4a', '#4a8ad8', '#e8c33a'][i % 3]; g.lineWidth = 2; g.beginPath(); g.arc(22, 20, 9, 0, 6.3); g.moveTo(22, 29); g.lineTo(22, 42); g.stroke(); g.restore(); }
      // the doorways, their doors and lights
      doorway(70, 'left'); doorway(OW - 70 - 140, 'right');
      // the desk: a monitor, the fan, papers, a mug
      g.fillStyle = '#3a2a1c'; g.fillRect(330, 268, 300, 30); g.fillStyle = '#2a1e14'; g.fillRect(330, 298, 300, 62);
      g.fillStyle = '#2a2d2b'; g.fillRect(420, 206, 92, 64); g.fillStyle = dark ? '#050605' : '#0f2a1c'; g.fillRect(428, 212, 76, 48);
      if (!dark) { g.fillStyle = 'rgba(80,220,140,.25)'; g.fillRect(428, 212 + (clock * 30 % 48), 76, 2); }
      g.save(); g.translate(580, 238); g.fillStyle = '#3a3d3a'; g.fillRect(-4, 0, 8, 30); g.beginPath(); g.arc(0, 0, 22, 0, 6.3); g.fillStyle = '#2b2d2b'; g.fill();
      g.rotate(dark ? 0 : clock * 18); g.fillStyle = '#6a6e6a'; for (let i = 0; i < 3; i++) { g.rotate(2.094); g.beginPath(); g.ellipse(0, -10, 5, 11, 0, 0, 6.3); g.fill(); } g.restore();
      g.fillStyle = '#d8d2c0'; g.fillRect(352, 260, 46, 10); g.save(); g.translate(366, 256); g.rotate(-0.1); g.fillRect(0, 0, 40, 8); g.restore();
      g.fillStyle = '#7a3a3a'; g.fillRect(538, 252, 16, 18);
      // a toy that got in: it stands in front of the desk
      for (const id of N.BOTS) { const b = s.bots[id]; if (b.inOffice) drawBot(g, id, 480, 360, 2.6, { eyes: true }); }
      g.restore();
      // the light: darker at the edges, flickering a little, and nearly black in a blackout
      const v = g.createRadialGradient(W / 2, H / 2, 120, W / 2, H / 2, 420); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.85)'); g.fillStyle = v; g.fillRect(0, 0, W, H);
      if (!dark && Math.sin(clock * 37) > 0.995) { g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, 0, W, H); }
      if (dark) {
        g.fillStyle = 'rgba(0,0,8,.88)'; g.fillRect(0, 0, W, H);
        if (s.po && s.po.phase === 'music') {           // the Conductor's face in the left doorway, its lamps blinking
          const on = Math.sin(clock * 6) > 0;
          g.save(); g.translate(-pan, 0); drawBot(g, 'conductor', 170, 320, 2, { eyes: on, dark: 0.6 }); g.restore();
        }
        if (s.po && s.po.phase === 'black') { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); }
      }
    }
    function doorway(x, side) {
      const shut = doorAnim[side], lit = s.lights[side] && !s.powerOut;
      g.fillStyle = '#050606'; g.fillRect(x, 70, 140, 200);
      if (lit) {
        const gr = g.createLinearGradient(0, 70, 0, 270); gr.addColorStop(0, 'rgba(255,240,200,.08)'); gr.addColorStop(1, 'rgba(255,240,200,.35)'); g.fillStyle = gr; g.fillRect(x, 70, 140, 200);
        g.fillStyle = '#3a3226'; g.fillRect(x, 250, 140, 20);
        for (const id of N.at(s, side + 'Door')) drawBot(g, id, x + 70, 272, 1.85, { eyes: true });
      }
      g.fillStyle = '#4a4f4c'; g.fillRect(x - 8, 62, 156, 10); g.fillRect(x - 8, 62, 10, 210); g.fillRect(x + 138, 62, 10, 210);
      if (shut > 0.01) {                                                                         // the shutter slides down
        const h = 200 * shut; g.fillStyle = '#5c6360'; g.fillRect(x, 70, 140, h);
        g.fillStyle = '#4a504d'; for (let y = 70 + 10; y < 70 + h; y += 16) g.fillRect(x, y, 140, 3);
        g.fillStyle = '#e8c33a'; for (let i = 0; i < 7; i++) g.fillRect(x + i * 20, 70 + h - 10, 10, 8);
      }
      // the buttons beside the doorway
      const bx = side === 'left' ? x + 160 : x - 34;
      g.fillStyle = '#2c302e'; roundRect(g, bx, 120, 26, 92, 5); g.fill();
      glowDot(g, bx + 13, 144, 9, s.doors[side] ? '#ff4a4a' : '#5a1a1a', s.doors[side] && !s.powerOut);
      glowDot(g, bx + 13, 188, 9, lit ? '#fff6dc' : '#4a4a46', lit);
      text(g, 'DOOR', bx + 13, 162, 6, '#9a9a96', 'center', 700); text(g, 'LIGHT', bx + 13, 206, 6, '#9a9a96', 'center', 700);
      if (s.jam[side]) { text(g, '✕', bx + 13, 148, 12, '#ffcc00', 'center', 800); }
    }

    function drawCams() {
      const room = s.cam;
      g.save();
      if (N.ROOMS[room].audioOnly) { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); text(g, '-CAMERA DISABLED-', W / 2, 150, 18, '#fff', 'center', 700); text(g, 'AUDIO ONLY', W / 2, 176, 14, '#ccc', 'center', 600); }
      else {
        SCENE[room](g);
        const here = N.at(s, room);
        if (room === 'prize') drawBot(g, 'grin', 320, 300, 1.5, { box: true, stage: s.bots.grin.running ? 3 : s.bots.grin.stage, eyes: s.bots.grin.stage > 0 });
        if (room === 'westHall' && s.bots.grin.running) { g.save(); g.globalAlpha = 0.85; drawBot(g, 'grin', 320 + Math.sin(clock * 30) * 6, 330, 1.8, { eyes: true }); g.restore(); }
        for (const id of here) { if (id === 'grin') continue; const p = (SPOT[room] || {})[id]; if (p) drawBot(g, id, p[0], p[1], p[2], { eyes: Math.sin(clock * 3 + p[0]) > -0.7 }); }
        g.globalCompositeOperation = 'multiply'; g.fillStyle = '#7aa58e'; g.fillRect(0, 0, W, H); g.globalCompositeOperation = 'source-over';
        g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, 0, W, H);
      }
      g.globalAlpha = 0.10 + glitchT * 0.9; g.drawImage(noise[Math.floor(clock * 30) % 4], 0, 0, W, H); g.globalAlpha = 1;
      g.fillStyle = 'rgba(0,0,0,.18)'; for (let y = 0; y < H; y += 3) g.fillRect(0, y, W, 1);
      g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 1.5; g.strokeRect(12, 12, W - 24, H - 24);
      text(g, `CAM ${N.ROOMS[room].cam}  ${N.ROOMS[room].name}`, 26, 40, 14, '#fff', 'left', 700);
      if (Math.floor(clock * 2) % 2) { g.fillStyle = '#ff3030'; g.beginPath(); g.arc(30, 58, 5, 0, 6.3); g.fill(); text(g, 'REC', 42, 62, 11, '#fff', 'left', 700); }
      // the map
      g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(400, 176, 226, 154);
      g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 2; g.beginPath(); g.moveTo(470, 200); g.lineTo(470, 300); g.moveTo(470, 222); g.lineTo(560, 222); g.lineTo(560, 300); g.moveTo(470, 310); g.lineTo(560, 310); g.stroke();
      g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(495, 300, 40, 22); text(g, 'YOU', 515, 315, 9, '#fff', 'center', 700);
      for (const r of N.CAMS) { const [x, y] = MAP[r], on = r === room; g.fillStyle = on ? '#9ad84a' : '#3a3d3a'; g.fillRect(x - 15, y - 9, 30, 18); g.strokeStyle = '#ddd'; g.lineWidth = 1; g.strokeRect(x - 15, y - 9, 30, 18); text(g, N.ROOMS[r].cam, x, y + 4, 9, on ? '#111' : '#fff', 'center', 700); }
      g.restore();
    }

    function drawHud() {
      text(g, N.clock(s.hour), W - 20, 34, 20, '#fff', 'right', 700); text(g, 'Night ' + s.night, W - 20, 52, 11, '#bbb', 'right', 600);
      text(g, `Power left: ${Math.max(0, Math.ceil(s.power))}%`, 20, H - 34, 13, '#fff', 'left', 700);
      const u = N.usage(s); text(g, 'Usage:', 20, H - 16, 11, '#ddd', 'left', 600);
      for (let i = 0; i < 5; i++) { g.fillStyle = i < u ? (i < 2 ? '#5ad84a' : i < 3 ? '#e8c33a' : '#e84a4a') : 'rgba(255,255,255,.12)'; g.fillRect(70 + i * 12, H - 26, 9, 12); }
      if (!s.powerOut) {                                                                          // the bar to raise and lower the cameras
        g.fillStyle = inBar ? 'rgba(255,255,255,.35)' : 'rgba(255,255,255,.18)'; g.fillRect(200, H - 26, 240, 18); g.strokeStyle = 'rgba(255,255,255,.6)'; g.strokeRect(200, H - 26, 240, 18);
        text(g, s.camUp ? '▼  CAMERAS  ▼' : '▲  CAMERAS (Space)  ▲', W / 2, H - 13, 10, '#fff', 'center', 700);
      }
      if (s.t < 15 && !s.camUp) text(g, 'Q / A left door and light · E / D right · Space cameras · ← → look', W / 2, H - 36, 10, 'rgba(255,255,255,.8)', 'center', 600);
    }

    function drawMenu() {
      const gr = g.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, 380); gr.addColorStop(0, '#16201b'); gr.addColorStop(1, '#000'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
      const eyes = Math.sin(clock * 2.3) > -0.6;
      drawBot(g, 'clank', 110, 360, 2.2, { eyes, dark: 0.55 }); drawBot(g, 'petunia', 540, 360, 2.3, { eyes: Math.sin(clock * 1.7 + 1) > -0.5, dark: 0.55 });
      g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(0, 0, W, H);
      g.globalAlpha = 0.05; g.drawImage(noise[Math.floor(clock * 20) % 4], 0, 0, W, H); g.globalAlpha = 1;
      text(g, 'NIGHT SHIFT', W / 2, 110, 46, '#f2efe6', 'center', 800, 'system-ui, sans-serif');
      text(g, "at Tinker's Toy Emporium", W / 2, 138, 15, '#c8c2b0', 'center', 600, 'system-ui, sans-serif');
      button(W / 2 - 90, 170, 180, 40, beaten >= 1 ? 'Night 1 again' : 'Start Night 1', true);
      text(g, 'Nights 2 to 5 are coming in an update', W / 2, 236, 11, '#8a8a84', 'center', 500);
      text(g, 'Survive from 12 AM to 6 AM. Watch the toys on the cameras,', W / 2, 270, 11, '#bbb', 'center', 500);
      text(g, 'shut a door when one is outside it, and don’t run out of power.', W / 2, 286, 11, '#bbb', 'center', 500);
      text(g, beaten >= 1 ? '★ Night 1 survived' : 'Enter or click to start · M sound', W / 2, 318, 11, '#e8c33a', 'center', 600);
    }
    function button(x, y, w, h, label, hot) {
      const over = mouse.x >= x && mouse.x <= x + w && mouse.y >= y && mouse.y <= y + h;
      g.fillStyle = over || hot ? 'rgba(232,195,58,.18)' : 'rgba(255,255,255,.08)'; roundRect(g, x, y, w, h, 8); g.fill();
      g.strokeStyle = over ? '#e8c33a' : 'rgba(255,255,255,.4)'; g.lineWidth = 1.5; roundRect(g, x, y, w, h, 8); g.stroke();
      text(g, label, x + w / 2, y + h / 2 + 5, 14, '#fff', 'center', 700, 'system-ui, sans-serif');
    }
    function drawIntro() {
      const a = Math.min(1, screenT / 0.8) * Math.min(1, (4.5 - screenT) / 0.6);
      g.globalAlpha = Math.max(0, a);
      text(g, '12:00 AM', W / 2, 150, 38, '#fff', 'center', 700);
      text(g, '1st Night', W / 2, 186, 18, '#ddd', 'center', 600);
      text(g, 'The toys wander at night. Keep them out until 6 AM.', W / 2, 230, 12, '#aaa', 'center', 500);
      g.globalAlpha = 1;
    }
    function drawScare() {
      const id = s.over.by, k = Math.min(1, screenT / 0.12), shake = (1 - Math.min(1, screenT / 1.4)) * 14;
      g.fillStyle = Math.sin(screenT * 60) > 0 ? '#1a0000' : '#000'; g.fillRect(0, 0, W, H);
      const face = { clank: [0, -90], petunia: [0, -80], grin: [0, -104], conductor: [-44, -40] }[id], sc = (id === 'conductor' ? 5.2 : 4.4) * (0.55 + 0.45 * k);
      g.save(); g.translate(W / 2 - face[0] * sc + (Math.random() - 0.5) * shake, H / 2 - face[1] * sc + (Math.random() - 0.5) * shake);
      drawBot(g, id, 0, 0, sc, { eyes: true, box: false });
      g.restore();
      g.globalAlpha = 0.3; g.drawImage(noise[Math.floor(clock * 40) % 4], 0, 0, W, H); g.globalAlpha = 1;
      if (screenT > 1.4) go('over');
    }
    function drawOver() {
      g.globalAlpha = 0.25; g.drawImage(noise[Math.floor(clock * 25) % 4], 0, 0, W, H); g.globalAlpha = 1;
      text(g, 'GAME OVER', W / 2, 120, 34, '#e84a4a', 'center', 800, 'system-ui, sans-serif');
      text(g, `${NAMES[s.over.by]} got you at ${N.clock(s.hour)} on night ${s.night}.`, W / 2, 152, 13, '#ccc', 'center', 600);
      text(g, tip(s.over.by), W / 2, 176, 11, '#999', 'center', 500);
      button(W / 2 - 160, 210, 150, 38, 'Try again', true); button(W / 2 + 10, 210, 150, 38, 'Menu', false);
    }
    function tip(id) {
      return id === 'grin' ? 'Tip: check the Prize Corner (CAM 1C) often. When Grin is gone, shut the left door.'
        : id === 'conductor' ? 'Tip: save power. Shut doors only when a light shows a toy there.'
          : id === 'clank' ? 'Tip: Clank comes to the left door. Use the left light, and shut the door if it is there.'
            : 'Tip: Petunia comes to the right door. Use the right light, and shut the door if she is there.';
    }
    function drawWin() {
      const k = Math.min(1, Math.max(0, (screenT - 0.6) / 1.2));
      g.save(); g.beginPath(); g.rect(0, 120, W, 60); g.clip();
      text(g, '5', W / 2 - 30, 168 - 50 * k, 48, '#fff', 'right', 800); text(g, '6', W / 2 - 30, 218 - 50 * k, 48, '#fff', 'right', 800);
      g.restore(); text(g, 'AM', W / 2 - 18, 168, 48, '#fff', 'left', 800);
      if (screenT > 2.2) {
        text(g, 'Night 1 survived!', W / 2, 220, 16, '#e8c33a', 'center', 700, 'system-ui, sans-serif');
        text(g, 'Nights 2 to 5 are coming in an update.', W / 2, 244, 12, '#bbb', 'center', 500);
        button(W / 2 - 160, 266, 150, 38, 'Play again', true); button(W / 2 + 10, 266, 150, 38, 'Menu', false);
      }
    }

    // ---------------- input
    const toLocal = (e) => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H }; };
    const inRect = (p, x, y, w, h) => p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h;
    function onMove(e) {
      mouse = toLocal(e); wake();
      if (screen === 'play' && !s.powerOut) {
        const bar = inRect(mouse, 200, H - 30, 240, 26);
        if (bar && !inBar) N.setCams(s, !s.camUp), react(s.events);                            // like the real thing: sweep over the bar
        inBar = bar;
      }
    }
    function onLeave() { mouse = { x: -1, y: -1 }; inBar = false; }
    function onDown(e) {
      root.focus(); const p = toLocal(e); mouse = p; wake();
      if (screen === 'menu') { if (inRect(p, W / 2 - 90, 170, 180, 40)) startNight(); return; }
      if (screen === 'intro') { go('play'); sfx.startHum(); return; }
      if (screen === 'paused') { unpause(); return; }
      if (screen === 'over' || screen === 'win') {
        const y = screen === 'over' ? 210 : 266;
        if (inRect(p, W / 2 - 160, y, 150, 38)) startNight(); else if (inRect(p, W / 2 + 10, y, 150, 38)) go('menu');
        return;
      }
      if (screen !== 'play') return;
      if (s.camUp) { for (const r of N.CAMS) { const [x, y] = MAP[r]; if (inRect(p, x - 15, y - 9, 30, 18)) { N.selectCam(s, r); react(s.events); return; } } return; }
      const wx = p.x + pan;
      for (const [side, x] of [['left', 70], ['right', OW - 70 - 140]]) {
        const bx = side === 'left' ? x + 160 : x - 34;
        if (inRect({ x: wx, y: p.y }, bx, 130, 26, 30)) { N.toggleDoor(s, side); react(s.events); return; }
        if (inRect({ x: wx, y: p.y }, bx, 174, 26, 30)) { N.toggleLight(s, side); react(s.events); return; }
      }
    }
    function key(k, down, repeat) {
      wake();
      if (!down) { if (k === 'ArrowLeft' || k === 'ArrowRight') panVel = 0; return false; }
      if (k === 'm' || k === 'M') { if (!repeat) { sfx.on = !sfx.on; store.set('sound', sfx.on); if (!sfx.on) sfx.stopAll(); else if (screen === 'play') sfx.startHum(); } return true; }
      if (screen === 'menu') { if (k === 'Enter' || k === ' ') { startNight(); return true; } return false; }
      if (screen === 'intro') { if (k === 'Enter' || k === ' ') { go('play'); sfx.startHum(); return true; } return false; }
      if (screen === 'over' || screen === 'win') { if (k === 'Enter' || k === ' ') { startNight(); return true; } if (k === 'Escape') return false; return false; }
      if (k === 'p' || k === 'P') { if (!repeat) (screen === 'paused' ? unpause : pause)(); return true; }
      if (screen === 'paused') { if (k === ' ' || k === 'Enter') { unpause(); return true; } return false; }
      if (screen !== 'play' || repeat) return k === 'ArrowLeft' || k === 'ArrowRight' || k === ' ';
      const l = k.toLowerCase();
      if (l === ' ' || l === 's') N.setCams(s, !s.camUp);
      else if (l === 'q') N.toggleDoor(s, 'left'); else if (l === 'a') N.toggleLight(s, 'left');
      else if (l === 'e') N.toggleDoor(s, 'right'); else if (l === 'd') N.toggleLight(s, 'right');
      else if (KEYCAM[k] && s.camUp) N.selectCam(s, KEYCAM[k]);
      else if (k === 'ArrowLeft') panVel = -520; else if (k === 'ArrowRight') panVel = 520;
      else return false;
      react(s.events); return true;
    }
    const onKey = (e) => { if (e.metaKey || e.ctrlKey || e.altKey) return; if (key(e.key, e.type === 'keydown', e.repeat)) e.preventDefault(); };
    const onVis = () => { if (document.hidden) pause(); };
    cv.addEventListener('mousemove', onMove); cv.addEventListener('mouseleave', onLeave); cv.addEventListener('mousedown', onDown);
    root.addEventListener('keydown', onKey); root.addEventListener('keyup', onKey);
    document.addEventListener('visibilitychange', onVis);
    wake(); setTimeout(() => root.focus(), 0);

    const api = {
      stop() { stopped = true; if (raf) cancelAnimationFrame(raf); raf = 0; sfx.stopAll(); if (ro) ro.disconnect(); else window.removeEventListener('resize', fit); document.removeEventListener('visibilitychange', onVis); root.remove(); },
      suspend() { pause(); sfx.stopAll(); },
      resume() { wake(); },
      key(k, down) { return key(k, down, false); },
      setSound(on) { if (!on) sfx.stopAll(); },
      state: () => ({ screen, night: s }),          // for the tests: the live night
      go,
    };
    current = api;
    return () => { api.stop(); if (current === api) current = null; };
  }

  window.NotchNightShift = {
    mount,
    suspend() { if (current) current.suspend(); },
    resume() { if (current) current.resume(); },
    key(k, down) { return current ? current.key(k, down) : false; },
    setSoundEnabled(on) { window.NotchHostSound = !!on; if (current) current.setSound(on); },
    _state() { return current ? current.state() : null; },
  };
})();
