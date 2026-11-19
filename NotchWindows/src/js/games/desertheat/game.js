// Desert Heat: stage 1, the roads of Dubai (docs/game/DESERT_HEAT_PROMPT.md, Part 5.3).
// Shared by the Windows app and the Mac app (NotchApple/Resources/DesertHeat.html). Needs three.js (vendor/three.min.js)
// and logic.js loaded first. Map data © OpenStreetMap contributors (ODbL), converted by tools/desertheat/osm-to-world.js.
//
//   window.NotchDesertHeat.mount(hostElement, { base: 'path/to/desertheat/' }) → returns a function that stops the game.
//
// What is here: the real road network from Deira to Dubai Marina (bridges and flyovers ramp up from the ground), lane
// markings, kerbs, pavements, barriers, street lamps, palms, overhead exit signs in English and Arabic, every building from
// the map with its real height where the map has one, the coast, the Creek and the sea, a sky and sun that follow Dubai's
// real sun path, night lighting, one drivable saloon with the full driving model, traffic that follows the lanes, a
// mini-map, a full map, and a time-of-day panel.

(function () {
  'use strict';
  if (window.NotchDesertHeat) return;
  const THREE = window.THREE, L = window.DesertHeatLogic;

  const D = window.DesertHeatData = window.DesertHeatData || {
    store: {}, waiting: {},
    put(name, data) { this.store[name] = data; const w = this.waiting[name]; if (w) { delete this.waiting[name]; w.forEach((f) => f(data)); } },
  };
  const scriptBase = (() => { const s = document.currentScript; return s && s.src ? s.src.replace(/[^/]*$/, '') : ''; })();

  function loadData(base, name, file) {
    return new Promise((resolve, reject) => {
      if (D.store[name]) return resolve(D.store[name]);
      (D.waiting[name] = D.waiting[name] || []).push(resolve);
      const s = document.createElement('script');
      s.src = base + 'data/' + file;
      s.onerror = () => reject(new Error('Missing map file ' + file));
      s.onload = () => s.remove();
      document.head.appendChild(s);
    });
  }

  // ------------------------------------------------------------------ constants

  const LANE = 3.6;
  const KIND_Y = [0.075, 0.07, 0.065, 0.055, 0.05, 0.072, 0.06];   // draw order where roads overlap: bigger roads on top
  const CHUNK = 1000;
  const VIEW = { roads: 3600, furniture: 1300, tiles: 1250, unload: 1800 };
  const TODAY = 323;   // day of the year used for the sun (19 November)

  // ------------------------------------------------------------------ procedural textures (no stock images)

  function canvasTex(size, draw, repeat = true) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    draw(c.getContext('2d'), size);
    const t = new THREE.CanvasTexture(c);
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8; t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  const rnd = (seed) => { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };

  function speckle(g, n, r, colors, rand) {
    for (let i = 0; i < n; i++) { g.fillStyle = colors[(rand() * colors.length) | 0]; const s = r * (0.3 + rand()); g.fillRect(rand() * 512, rand() * 512, s, s); }
  }

  const TEX = {};
  function makeTextures() {
    // Asphalt: grey with aggregate, tar patches, cracks and darker wheel paths (the u axis runs across the road).
    TEX.asphalt = canvasTex(512, (g) => {
      const r = rnd(7);
      g.fillStyle = '#4a4a4b'; g.fillRect(0, 0, 512, 512);
      speckle(g, 26000, 2.2, ['#3d3d3e', '#575757', '#5f5e5c', '#434344', '#6a6866'], r);
      for (let i = 0; i < 9; i++) { g.fillStyle = `rgba(20,20,22,${0.08 + r() * 0.12})`; g.beginPath(); g.ellipse(r() * 512, r() * 512, 20 + r() * 70, 10 + r() * 40, r() * 3, 0, 7); g.fill(); }
      g.strokeStyle = 'rgba(25,25,25,0.45)'; g.lineWidth = 1.2;
      for (let i = 0; i < 14; i++) { g.beginPath(); let x = r() * 512, y = r() * 512; g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (r() - 0.5) * 40; y += (r() - 0.5) * 40; g.lineTo(x, y); } g.stroke(); }
      for (const cx of [128, 384]) { const gr = g.createLinearGradient(cx - 60, 0, cx + 60, 0); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, 'rgba(15,15,15,0.16)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(cx - 60, 0, 120, 512); }
    });
    TEX.sand = canvasTex(512, (g) => {
      const r = rnd(11);
      g.fillStyle = '#c9b38c'; g.fillRect(0, 0, 512, 512);
      speckle(g, 30000, 1.8, ['#bba37a', '#d4c09b', '#c2a982', '#b59d76', '#dccaa7'], r);
      for (let i = 0; i < 40; i++) { g.strokeStyle = `rgba(150,125,90,${0.05 + r() * 0.08})`; g.lineWidth = 2 + r() * 5; g.beginPath(); const y = r() * 512; g.moveTo(0, y); g.bezierCurveTo(170, y + (r() - 0.5) * 60, 340, y + (r() - 0.5) * 60, 512, y); g.stroke(); }
      for (let i = 0; i < 20; i++) { g.fillStyle = `rgba(110,95,70,${0.05 + r() * 0.08})`; g.beginPath(); g.ellipse(r() * 512, r() * 512, 30 + r() * 80, 20 + r() * 50, r() * 3, 0, 7); g.fill(); }
    });
    TEX.paving = canvasTex(512, (g) => {
      const r = rnd(5);
      g.fillStyle = '#b9b2a4'; g.fillRect(0, 0, 512, 512);
      speckle(g, 12000, 1.5, ['#aca596', '#c4bdb0', '#a29b8d'], r);
      g.strokeStyle = 'rgba(80,75,65,0.35)'; g.lineWidth = 2;
      for (let i = 0; i <= 512; i += 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 512); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(512, i); g.stroke(); }
      for (let i = 0; i < 25; i++) { g.fillStyle = `rgba(60,55,45,${0.05 + r() * 0.1})`; g.beginPath(); g.ellipse(r() * 512, r() * 512, 10 + r() * 40, 8 + r() * 25, 0, 0, 7); g.fill(); }
    });
    // Kerbs: alternate black and yellow (no stopping) or black and white, one metre each, with dirt.
    const kerb = (c2) => canvasTex(256, (g) => { const r = rnd(3); for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? '#1c1c1c' : c2; g.fillRect(0, i * 64, 256, 64); } speckle(g, 3000, 2, ['rgba(60,50,40,0.25)', 'rgba(255,255,255,0.08)'], r); });
    TEX.kerbYellow = kerb('#d9b21f'); TEX.kerbWhite = kerb('#dcdcd6');
    TEX.concrete = canvasTex(256, (g) => { const r = rnd(9); g.fillStyle = '#bdb8ae'; g.fillRect(0, 0, 256, 256); speckle(g, 6000, 1.6, ['#aea99e', '#c9c4ba', '#9f9a90'], r); for (let i = 0; i < 6; i++) { g.fillStyle = 'rgba(70,60,50,0.12)'; g.fillRect(r() * 256, 0, 3 + r() * 10, 256); } });
    TEX.waterNormal = canvasTex(256, (g) => {
      const img = g.createImageData(256, 256); const r = rnd(21); const h = new Float32Array(256 * 256);
      for (let k = 0; k < 60; k++) { const cx = r() * 256, cy = r() * 256, f = 0.05 + r() * 0.25, a = r() * 6.28; for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) h[y * 256 + x] += Math.sin((x * Math.cos(a) + y * Math.sin(a)) * f + cx) * 0.3; }
      for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
        const i = y * 256 + x, dx = h[y * 256 + ((x + 1) & 255)] - h[i], dy = h[((y + 1) & 255) * 256 + x] - h[i];
        img.data[i * 4] = 128 + dx * 60; img.data[i * 4 + 1] = 128 + dy * 60; img.data[i * 4 + 2] = 255; img.data[i * 4 + 3] = 255;
      }
      g.putImageData(img, 0, 0);
    });
    TEX.waterNormal.colorSpace = THREE.NoColorSpace;
    TEX.glow = canvasTex(64, (g) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,230,190,0.55)'); gr.addColorStop(1, 'rgba(255,200,140,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); }, false);
  }

  // ------------------------------------------------------------------ shared shader uniforms

  const U = { uNight: { value: 0 }, uTime: { value: 0 } };

  function roadMaterial() {
    const m = new THREE.MeshStandardMaterial({ map: TEX.asphalt, roughness: 0.93, metalness: 0, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uNight = U.uNight;
      sh.fragmentShader = 'uniform float uNight;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        // Pools of sodium light under the street lamps (every 40 m along the road, the same spacing the lamps use).
        float along = vMapUv.y * 4.0;
        float ph = fract(along / 40.0); float dl = min(ph, 1.0 - ph) * 40.0;
        float pool = exp(-dl * dl / 70.0) * 0.85 + 0.15;
        totalEmissiveRadiance += vec3(1.0, 0.6, 0.28) * uNight * 0.2 * pool * diffuseColor.rgb * 3.0;`);
    };
    return m;
  }

  function buildingMaterial() {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.02 });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uNight = U.uNight;
      sh.vertexShader = 'attribute vec2 aFac;\nattribute float aStyle;\nattribute float aSeed;\nvarying vec2 vFac;\nvarying float vStyle;\nvarying float vSeed;\n' +
        sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vFac = aFac; vStyle = aStyle; vSeed = aSeed;');
      sh.fragmentShader = `uniform float uNight;
        varying vec2 vFac; varying float vStyle; varying float vSeed;
        float h3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
        ` + sh.fragmentShader
        .replace('#include <color_fragment>', `#include <color_fragment>
          float glassAmt = 0.0; float winLit = 0.0; vec3 winCol = vec3(1.0, 0.75, 0.45);
          if (vStyle < 1.5) {
            // Every building gets its own window layout from its seed: bay width, window size, ribbon windows or punched holes.
            float r1 = h3(vec3(vSeed, 1.0, 0.0)), r2 = h3(vec3(vSeed, 2.0, 0.0)), r3 = h3(vec3(vSeed, 3.0, 0.0));
            float floorH = vStyle > 0.5 ? 3.9 : 3.2 + r1 * 0.6;
            float fy = vFac.y / floorH; float fl = floor(fy); float fyf = fract(fy);
            float bay = vStyle > 0.5 ? 1.35 + r2 * 0.4 : 2.3 + r2 * 1.9;
            float fx = vFac.x / bay; float bx = floor(fx); float fxf = fract(fx);
            float win;
            if (vStyle > 0.5) {
              // curtain wall: thin mullions, a slim spandrel at each floor
              win = smoothstep(0.02, 0.04, fxf) * smoothstep(0.98, 0.96, fxf) * smoothstep(0.06 + r3 * 0.1, 0.09 + r3 * 0.1, fyf);
            } else {
              float ww = 0.14 + r3 * 0.16, wh = 0.42 + r1 * 0.22;   // half the window's width; its height as a share of the floor
              if (r2 > 0.8) ww = 0.47;   // ribbon windows running along the floor
              float x0 = 0.5 - ww, x1 = 0.5 + ww; if (r2 > 0.8) { x0 = 0.03; x1 = 0.97; }
              float y0 = 0.7 - wh, y1 = 0.82;
              win = smoothstep(x0, x0 + 0.02, fxf) * smoothstep(x1, x1 - 0.02, fxf) * smoothstep(y0, y0 + 0.03, fyf) * smoothstep(y1, y1 - 0.03, fyf);
              // weathering: darker at the base and under each sill, a little variation from floor to floor
              diffuseColor.rgb *= (0.8 + 0.2 * smoothstep(0.0, 8.0, vFac.y)) * (0.97 + 0.04 * h3(vec3(fl, vSeed, 1.0)));
              diffuseColor.rgb *= 1.0 - 0.12 * smoothstep(y0 - 0.12, y0, fyf) * (1.0 - smoothstep(y0, y0 + 0.01, fyf)) * step(x0, fxf) * step(fxf, x1);
              // shaded reveal around the window (they sit back from the wall)
              diffuseColor.rgb *= 1.0 - 0.18 * (smoothstep(x0 - 0.05, x0, fxf) * smoothstep(x1 + 0.05, x1, fxf) * smoothstep(y0 - 0.05, y0, fyf) * smoothstep(y1 + 0.05, y1, fyf) - win);
              if (vFac.y < 4.4) {   // shop fronts on the ground floor
                win = smoothstep(0.04, 0.07, fxf) * smoothstep(0.96, 0.93, fxf) * step(0.3, vFac.y) * step(vFac.y, 3.0);
                fl = -1.0;
              }
            }
            float hh = h3(vec3(bx, fl, vSeed));
            // glass: one tint per building with only a slight variation per pane, so it reads as a sheet of glass
            vec3 tint = vStyle > 0.5 ? mix(vec3(0.1, 0.15, 0.19), vec3(0.17, 0.22, 0.25), r1) : vec3(0.07, 0.08, 0.085);
            vec3 gc = tint * (0.93 + 0.14 * hh);
            diffuseColor.rgb = mix(diffuseColor.rgb, gc, win);
            glassAmt = win * (vStyle > 0.5 ? 1.0 : 0.55);
            // lights on after dark: about half the windows, in clusters by floor
            float lit = step(0.55, hh * 0.7 + 0.3 * h3(vec3(fl, vSeed, 7.0)));
            winLit = win * lit * (0.25 + 0.75 * h3(vec3(bx, fl, vSeed + 2.0)));   // some rooms bright, most dim behind curtains
            winCol = mix(vec3(1.0, 0.68, 0.38), vec3(0.82, 0.88, 1.0), step(0.75, h3(vec3(floor(bx / 3.0), fl, vSeed + 5.0))));
            if (fl < 0.0) { winLit = win * step(0.3, hh); winCol = mix(vec3(1.0, 0.84, 0.58), vec3(0.62, 0.92, 1.0), step(0.65, hh)) * 1.6; }
          } else {
            diffuseColor.rgb *= 0.78;
          }`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix(roughnessFactor, 0.12, glassAmt);')
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n metalnessFactor = mix(metalnessFactor, 0.7, glassAmt);')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += winCol * winLit * smoothstep(0.25, 0.75, uNight) * 0.42;');
    };
    return m;
  }

  // ------------------------------------------------------------------ the sky

  function makeSky() {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uSun: { value: new THREE.Vector3(0, 1, 0) }, uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uSunCol: { value: new THREE.Color() }, uNight: U.uNight },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }',
      fragmentShader: `varying vec3 vDir; uniform vec3 uSun, uZenith, uHorizon, uSunCol; uniform float uNight;
        float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164)))*43758.5453); }
        void main(){
          vec3 d = normalize(vDir);
          float y = max(d.y, 0.0);
          vec3 col = mix(uHorizon, uZenith, pow(y, 0.45));
          float s = max(dot(d, normalize(uSun)), 0.0);
          col += uSunCol * (pow(s, 6.0) * 0.35 + pow(s, 48.0) * 0.5) * (1.0 - y * 0.6);
          col += uSunCol * smoothstep(0.9993, 0.9997, s) * 6.0;
          // dust haze hugging the horizon, and the city's orange glow at night
          col = mix(col, uHorizon * 1.05, exp(-y * 9.0) * 0.6);
          col += vec3(0.32, 0.17, 0.08) * uNight * exp(-y * 7.0) * 0.5;
          // a few stars (Dubai's light pollution hides most)
          vec3 sp = floor(d * 380.0);
          col += vec3(0.8) * step(0.9985, h(sp)) * uNight * smoothstep(0.1, 0.4, y) * 0.6;
          if (d.y < 0.0) col = mix(uHorizon, uHorizon * 0.55, min(-d.y * 4.0, 1.0));
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const m = new THREE.Mesh(new THREE.SphereGeometry(30000, 32, 16), mat);
    m.frustumCulled = false; m.renderOrder = -1;
    return m;
  }

  // Sky colours by sun elevation (degrees): night, twilight, sunset, low sun, day. Dubai's day sky is a pale, dusty blue.
  const SKY_KEYS = [
    { e: -14, zen: '#05080f', hor: '#1a1720', sun: '#000000', light: 0, amb: 0.1 },
    { e: -5, zen: '#141d36', hor: '#4a3a46', sun: '#3a1d14', light: 0, amb: 0.18 },
    { e: 0, zen: '#33496f', hor: '#e0905a', sun: '#ff8a3c', light: 0.5, amb: 0.35 },
    { e: 8, zen: '#4f78a6', hor: '#e8bb8a', sun: '#ffc27a', light: 1.6, amb: 0.55 },
    { e: 25, zen: '#5d8fc2', hor: '#d9d5c6', sun: '#fff1d6', light: 2.6, amb: 0.75 },
    { e: 90, zen: '#4f86bf', hor: '#d5d6cf', sun: '#fff8ea', light: 3.0, amb: 0.85 },
  ];
  function skyAt(el) {
    let a = SKY_KEYS[0], b = SKY_KEYS[SKY_KEYS.length - 1];
    for (let i = 0; i < SKY_KEYS.length - 1; i++) if (el >= SKY_KEYS[i].e && el <= SKY_KEYS[i + 1].e) { a = SKY_KEYS[i]; b = SKY_KEYS[i + 1]; break; }
    if (el < SKY_KEYS[0].e) b = a;
    const t = b === a ? 0 : (el - a.e) / (b.e - a.e);
    const c = (x, y) => new THREE.Color(x).lerp(new THREE.Color(y), t);
    return { zen: c(a.zen, b.zen), hor: c(a.hor, b.hor), sun: c(a.sun, b.sun), light: a.light + (b.light - a.light) * t, amb: a.amb + (b.amb - a.amb) * t };
  }

  // ------------------------------------------------------------------ geometry builders

  class Builder {
    constructor() { this.pos = []; this.uv = []; this.col = []; this.nrm = []; this.idx = []; }
    get n() { return this.pos.length / 3; }
    quad(a, b, c, d, uvs, color, normal) {
      const i = this.n;
      for (const p of [a, b, c, d]) this.pos.push(p[0], p[1], p[2]);
      if (uvs) for (const u of uvs) this.uv.push(u[0], u[1]); else this.uv.push(0, 0, 1, 0, 1, 1, 0, 1);
      for (let k = 0; k < 4; k++) { this.col.push(color[0], color[1], color[2]); this.nrm.push(normal ? normal[0] : 0, normal ? normal[1] : 1, normal ? normal[2] : 0); }
      this.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
    }
    geometry() {
      if (!this.idx.length) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
      g.setIndex(this.idx);
      g.computeBoundingSphere();
      return g;
    }
  }

  /** A ribbon between two offset lines of a road, cut into one quad per segment (so it can be split across chunks). */
  function ribbon(chunkOf, key, p, hs, yOff, offA, offB, uScale, cum, color, filter) {
    const A = L.offset(p, offA), B = L.offset(p, offB), n = p.length / 2;
    for (let i = 0; i < n - 1; i++) {
      if (filter && !filter(cum[i], cum[i + 1])) continue;
      const mx = (p[i * 2] + p[i * 2 + 2]) / 2, mz = (p[i * 2 + 1] + p[i * 2 + 3]) / 2;
      const b = chunkOf(mx, mz)[key];
      const ya = hs[i] + yOff, yb = hs[i + 1] + yOff;
      b.quad([A[i * 2], ya, A[i * 2 + 1]], [B[i * 2], ya, B[i * 2 + 1]], [B[i * 2 + 2], yb, B[i * 2 + 3]], [A[i * 2 + 2], yb, A[i * 2 + 3]],
        [[0, cum[i] / uScale], [(offB - offA) / uScale, cum[i] / uScale], [(offB - offA) / uScale, cum[i + 1] / uScale], [0, cum[i + 1] / uScale]], color);
    }
  }

  /** A vertical wall along an offset line (barriers, bridge sides, parapets). */
  function wallAlong(chunkOf, key, p, hs, off, yBottom, yTop, cum, color, faceRight) {
    const A = L.offset(p, off), n = p.length / 2;
    for (let i = 0; i < n - 1; i++) {
      const mx = (p[i * 2] + p[i * 2 + 2]) / 2, mz = (p[i * 2 + 1] + p[i * 2 + 3]) / 2;
      const b = chunkOf(mx, mz)[key];
      const dx = A[i * 2 + 2] - A[i * 2], dz = A[i * 2 + 3] - A[i * 2 + 1], l = Math.hypot(dx, dz) || 1;
      const nx = (faceRight ? -dz : dz) / l, nz = (faceRight ? dx : -dx) / l;
      const a = [A[i * 2], hs[i] + yBottom, A[i * 2 + 1]], c = [A[i * 2 + 2], hs[i + 1] + yTop, A[i * 2 + 3]];
      const bq = [A[i * 2 + 2], hs[i + 1] + yBottom, A[i * 2 + 3]], d = [A[i * 2], hs[i] + yTop, A[i * 2 + 1]];
      const uv = [[cum[i] / 3, 0], [cum[i + 1] / 3, 0], [cum[i + 1] / 3, (yTop - yBottom) / 3], [cum[i] / 3, (yTop - yBottom) / 3]];
      if (faceRight) b.quad(a, bq, c, d, uv, color, [nx, 0, nz]); else b.quad(bq, a, d, c, [uv[1], uv[0], uv[3], uv[2]], color, [nx, 0, nz]);
    }
  }

  // ------------------------------------------------------------------ the car model

  function carGeometry() {
    // Side profile of a four-door saloon (x along the car, y up), extruded across its width. Front is +x.
    const body = new THREE.Shape();
    const pts = [[2.26, 0.36], [2.33, 0.55], [2.27, 0.7], [2.05, 0.79], [1.05, 0.91], [-1.65, 0.98], [-2.18, 0.95], [-2.31, 0.8], [-2.31, 0.52], [-2.22, 0.36]];
    body.moveTo(pts[0][0], pts[0][1]); for (const [x, y] of pts.slice(1)) body.lineTo(x, y); body.closePath();
    const bodyG = new THREE.ExtrudeGeometry(body, { depth: 1.66, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 2, curveSegments: 4 });
    bodyG.translate(0, 0, -0.83);
    const cab = new THREE.Shape();
    const cp = [[1.02, 0.88], [0.18, 1.38], [-0.92, 1.4], [-1.62, 0.96]];
    cab.moveTo(cp[0][0], cp[0][1]); for (const [x, y] of cp.slice(1)) cab.lineTo(x, y); cab.closePath();
    const glassG = new THREE.ExtrudeGeometry(cab, { depth: 1.42, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 2 });
    glassG.translate(0, 0, -0.71);
    const roofG = new THREE.BoxGeometry(1.0, 0.05, 1.08); roofG.translate(-0.37, 1.41, 0);
    const wheelG = new THREE.CylinderGeometry(0.32, 0.32, 0.23, 20); wheelG.rotateX(Math.PI / 2);
    const hubG = new THREE.CylinderGeometry(0.19, 0.19, 0.235, 10); hubG.rotateX(Math.PI / 2);
    const headG = new THREE.BoxGeometry(0.08, 0.1, 0.36);
    const tailG = new THREE.BoxGeometry(0.06, 0.1, 0.42);
    const plateG = new THREE.BoxGeometry(0.04, 0.13, 0.5);
    // Shape the boxes into a car: the sides lean in towards the roof (tumblehome) and the corners are rounded in plan view.
    const sculpt = (g, lean, top) => {
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i); let z = p.getZ(i);
        z *= 1 - Math.max(0, y - top) * lean;
        z *= 1 - Math.pow(Math.min(1, Math.abs(x) / 2.36), 6) * 0.16;
        p.setZ(i, z);
      }
      g.computeVertexNormals();
    };
    bodyG.dispose(); const bodyG2 = new THREE.ExtrudeGeometry(body, { depth: 1.66, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 2, curveSegments: 4, steps: 1 });
    bodyG2.translate(0, 0, -0.83);
    sculpt(bodyG2, 0.25, 0.62); sculpt(glassG, 0.42, 0.92);
    // Everything faces +x; turn it so the front faces -z (north), the game's heading 0.
    for (const g of [bodyG2, glassG, roofG, headG, tailG, plateG]) g.rotateY(Math.PI / 2);
    return { bodyG: bodyG2, glassG, roofG, wheelG, hubG, headG, tailG, plateG };
  }

  const CAR_COLORS = ['#e9e8e4', '#e9e8e4', '#f2f1ee', '#1b1c1e', '#8c9094', '#5d6166', '#b9bcbf', '#6b1d1d', '#1f2f4a', '#c9b48f', '#2d3a2e', '#e0e0dc'];

  function makePlayerCar(G, color) {
    const g = new THREE.Group();
    const paint = new THREE.MeshPhysicalMaterial({ color, metalness: 0.55, roughness: 0.38, clearcoat: 0.8, clearcoatRoughness: 0.12 });
    const glass = new THREE.MeshPhysicalMaterial({ color: '#0b1014', metalness: 0.2, roughness: 0.05, transparent: true, opacity: 0.88 });
    const tyre = new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.9 });
    const rim = new THREE.MeshStandardMaterial({ color: '#9a9ea3', metalness: 0.85, roughness: 0.35 });
    const body = new THREE.Group(); g.add(body);
    for (const [geo, mat] of [[G.bodyG, paint], [G.glassG, glass], [G.roofG, paint]]) { const m = new THREE.Mesh(geo, mat); m.castShadow = true; body.add(m); }
    const head = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff4dc', emissiveIntensity: 0 });
    const tail = new THREE.MeshStandardMaterial({ color: '#5a0c0c', emissive: '#ff1a10', emissiveIntensity: 0.3 });
    for (const side of [-1, 1]) {
      const h = new THREE.Mesh(G.headG, head); h.position.set(side * 0.6, 0.68, -2.3); body.add(h);
      const t = new THREE.Mesh(G.tailG, tail); t.position.set(side * 0.58, 0.82, 2.3); body.add(t);
    }
    const plate = new THREE.Mesh(G.plateG, new THREE.MeshStandardMaterial({ color: '#f4f4f0', roughness: 0.5 })); plate.position.set(0, 0.5, 2.36); body.add(plate);
    const wheels = [];
    for (const [x, z] of [[-0.83, -1.32], [0.83, -1.32], [-0.83, 1.42], [0.83, 1.42]]) {
      const w = new THREE.Group(); w.position.set(x, 0.31, z);
      const t = new THREE.Mesh(G.wheelG, tyre); t.castShadow = true; w.add(t);
      const r = new THREE.Mesh(G.hubG, rim); w.add(r);
      w.rotation.order = 'YXZ'; w.rotateY(Math.PI / 2);
      g.add(w); wheels.push(w);
    }
    // Headlight beam (one real light, only for the player).
    const beam = new THREE.SpotLight('#fff1d8', 0, 70, 0.5, 0.55, 1.4);
    beam.position.set(0, 0.7, -2.2); beam.target.position.set(0, 0, -20); g.add(beam, beam.target);
    return { group: g, body, wheels, head, tail, beam, paint };
  }

  // ------------------------------------------------------------------ styles for the HUD

  const CSS = `
  .dh { position:absolute; inset:0; overflow:hidden; background:#0b0b0c; font-family:"Barlow Condensed","Avenir Next Condensed","Arial Narrow",sans-serif; color:#efe9dc; user-select:none; -webkit-user-select:none;
    --gold:#c8a25a; --panel:rgba(12,12,13,0.62); --line:rgba(200,162,90,0.55); --dim:rgba(239,233,220,0.62); }
  .dh canvas.view { position:absolute; inset:0; width:100%; height:100%; display:block; outline:none; }
  .dh .speedo { position:absolute; right:28px; bottom:22px; text-align:right; line-height:0.86; }
  .dh .speedo b { font-size:64px; font-weight:600; letter-spacing:-1px; font-variant-numeric:tabular-nums; text-shadow:0 1px 8px rgba(0,0,0,0.45); }
  .dh .speedo span { display:block; font-size:13px; letter-spacing:3px; color:var(--dim); margin-top:6px; }
  .dh .speedo i { font-style:normal; font-size:22px; color:var(--gold); margin-left:10px; font-weight:600; }
  .dh .rpm { width:150px; height:3px; background:rgba(255,255,255,0.12); margin:8px 0 0 auto; }
  .dh .rpm div { height:100%; background:var(--gold); width:0; }
  .dh .mini { position:absolute; left:22px; bottom:22px; width:190px; height:190px; border-radius:50%; overflow:hidden; border:1px solid var(--line); box-shadow:0 2px 18px rgba(0,0,0,0.5); background:#151514; }
  .dh .place { position:absolute; left:24px; top:22px; padding:10px 14px 10px 12px; border-left:2px solid var(--gold); background:linear-gradient(90deg, rgba(10,10,10,0.6), rgba(10,10,10,0)); transition:opacity .4s; }
  .dh .place .en { font-size:22px; letter-spacing:1px; font-weight:600; text-transform:uppercase; }
  .dh .place .ar { font-family:"Geeza Pro","Noto Kufi Arabic","Segoe UI",sans-serif; font-size:15px; color:var(--dim); direction:rtl; margin-top:2px; }
  .dh .place .meta { font-size:12px; letter-spacing:2px; color:var(--gold); margin-top:4px; }
  .dh .clock { position:absolute; right:26px; top:22px; text-shadow:0 1px 6px rgba(0,0,0,0.7); font-size:20px; letter-spacing:2px; color:var(--dim); font-variant-numeric:tabular-nums; }
  .dh .hint { position:absolute; left:50%; bottom:24px; transform:translateX(-50%); font-size:13px; letter-spacing:1.5px; color:var(--dim); background:var(--panel); padding:8px 14px; border-top:1px solid var(--line); white-space:nowrap; transition:opacity .8s; }
  .dh .hint kbd { font-family:inherit; color:#efe9dc; font-weight:600; margin-right:4px; }
  .dh .panel { position:absolute; right:26px; top:60px; width:250px; background:var(--panel); border-top:1px solid var(--line); padding:14px; display:none; backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px); }
  .dh .panel.on { display:block; }
  .dh .panel h4 { margin:0 0 10px; font-size:13px; letter-spacing:3px; font-weight:600; color:var(--gold); }
  .dh .panel input[type=range] { width:100%; accent-color:#c8a25a; }
  .dh .panel .row { display:flex; gap:6px; margin-top:10px; flex-wrap:wrap; }
  .dh .panel button { flex:1; font:inherit; font-size:13px; letter-spacing:1px; color:#efe9dc; background:rgba(255,255,255,0.06); border:0; border-bottom:1px solid rgba(255,255,255,0.15); padding:6px 4px; cursor:pointer; }
  .dh .panel button:hover { background:rgba(200,162,90,0.2); }
  .dh .panel label { display:flex; gap:8px; align-items:center; font-size:13px; letter-spacing:1px; color:var(--dim); margin-top:10px; }
  .dh .fps { position:absolute; left:50%; top:10px; transform:translateX(-50%); font-size:12px; letter-spacing:1px; color:var(--dim); display:none; font-variant-numeric:tabular-nums; }
  .dh .bigmap { position:absolute; inset:0; background:rgba(8,8,9,0.94); display:none; cursor:crosshair; }
  .dh .bigmap.on { display:block; }
  .dh .bigmap canvas { position:absolute; inset:0; width:100%; height:100%; }
  .dh .bigmap .t { position:absolute; left:28px; top:22px; font-size:15px; letter-spacing:3px; color:var(--gold); }
  .dh .bigmap .credit { position:absolute; right:20px; bottom:14px; font-size:11px; letter-spacing:1px; color:var(--dim); }
  .dh .load { position:absolute; inset:0; background:#0b0b0c; display:flex; flex-direction:column; justify-content:flex-end; padding:0 0 64px 64px; transition:opacity .6s; }
  .dh .load h1 { margin:0; font-size:64px; letter-spacing:10px; font-weight:600; }
  .dh .load p { margin:8px 0 18px; font-size:15px; letter-spacing:3px; color:var(--dim); }
  .dh .load .bar { width:320px; height:2px; background:rgba(255,255,255,0.1); }
  .dh .load .bar div { height:100%; width:0; background:var(--gold); transition:width .2s; }
  .dh .load .credit { position:absolute; right:22px; bottom:18px; font-size:11px; letter-spacing:1px; color:var(--dim); }
  .dh .shake { animation: dhshake .25s; }
  @keyframes dhshake { 0%,100%{transform:none} 25%{transform:translate(3px,-2px)} 50%{transform:translate(-3px,2px)} 75%{transform:translate(2px,1px)} }
  `;

  // ------------------------------------------------------------------ mount

  function mount(host, opts = {}) {
    const base = opts.base || scriptBase;
    makeTextures();

    const root = document.createElement('div'); root.className = 'dh';
    const style = document.createElement('style'); style.textContent = CSS; root.appendChild(style);
    root.insertAdjacentHTML('beforeend', `
      <div class="speedo"><b>0</b><i>N</i><span>KM/H</span><div class="rpm"><div></div></div></div>
      <canvas class="mini" width="380" height="380"></canvas>
      <div class="place"><div class="en"></div><div class="ar"></div><div class="meta"></div></div>
      <div class="clock"></div>
      <div class="hint"><kbd>W A S D</kbd> drive &nbsp;·&nbsp; <kbd>SPACE</kbd> hand brake &nbsp;·&nbsp; <kbd>C</kbd> camera &nbsp;·&nbsp; <kbd>M</kbd> map &nbsp;·&nbsp; <kbd>T</kbd> time of day &nbsp;·&nbsp; <kbd>R</kbd> reset car &nbsp;·&nbsp; <kbd>F</kbd> on foot &nbsp;·&nbsp; <kbd>TAB</kbd> switch &nbsp;·&nbsp; <kbd>Q</kbd> ability &nbsp;·&nbsp; <kbd>P</kbd> phone</div>
      <div class="panel"><h4>TIME OF DAY</h4><input type="range" min="0" max="24" step="0.05"><div class="row">
        <button data-h="6.2">Dawn</button><button data-h="12">Noon</button><button data-h="17.25">Sunset</button><button data-h="21.5">Night</button></div>
        <label><input type="checkbox" class="run" checked> Time passes (48 min a day)</label></div>
      <div class="fps"></div>
      <div class="bigmap"><canvas></canvas><div class="t">DUBAI · CLICK TO SET A WAYPOINT</div><div class="credit">Map data © OpenStreetMap contributors</div></div>
      <div class="load"><h1>DESERT HEAT</h1><p class="msg">LOADING DUBAI</p><div class="bar"><div></div></div><div class="credit">Map data © OpenStreetMap contributors</div></div>`);
    host.appendChild(root);
    const $ = (s) => root.querySelector(s);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.92;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.className = 'view'; renderer.domElement.tabIndex = 0;
    root.insertBefore(renderer.domElement, root.firstChild.nextSibling);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(62, 1, 0.3, 26000);
    scene.fog = new THREE.FogExp2('#d5d3c8', 0.00028);
    const sky = makeSky(); scene.add(sky);
    const sun = new THREE.DirectionalLight('#fff3dc', 2.6);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, near: 10, far: 900 });
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6;
    scene.add(sun, sun.target);
    const hemi = new THREE.HemisphereLight('#bcd0e6', '#a08c6a', 0.7); scene.add(hemi);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene(); const envSky = makeSky(); envSky.material = sky.material; envScene.add(envSky);
    let envRT = null, envAt = -99;

    const mats = {
      road: roadMaterial(),
      mark: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 }),
      paving: new THREE.MeshStandardMaterial({ map: TEX.paving, roughness: 0.9, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
      kerbY: new THREE.MeshStandardMaterial({ map: TEX.kerbYellow, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -3 }),
      kerbW: new THREE.MeshStandardMaterial({ map: TEX.kerbWhite, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -3 }),
      concrete: new THREE.MeshStandardMaterial({ map: TEX.concrete, roughness: 0.85, vertexColors: true, side: THREE.DoubleSide }),
      grass: new THREE.MeshStandardMaterial({ map: TEX.sand, color: '#9aa564', roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
      building: buildingMaterial(),
      land: new THREE.MeshStandardMaterial({ map: TEX.sand, roughness: 1 }),
      water: new THREE.MeshStandardMaterial({ color: '#1c4f58', roughness: 0.12, metalness: 0.15, normalMap: TEX.waterNormal, normalScale: new THREE.Vector2(0.35, 0.35) }),
      pole: new THREE.MeshStandardMaterial({ color: '#8d9196', metalness: 0.7, roughness: 0.45 }),
      lampHead: new THREE.MeshStandardMaterial({ color: '#d8d4cc', emissive: '#ffb36b', emissiveIntensity: 0 }),
      trunk: new THREE.MeshStandardMaterial({ color: '#7a6248', roughness: 1 }),
      frond: new THREE.MeshStandardMaterial({ color: '#4d6131', roughness: 0.95, side: THREE.DoubleSide }),
      signBack: new THREE.MeshStandardMaterial({ color: '#7d8186', metalness: 0.6, roughness: 0.5 }),
    };
    TEX.sand.repeat.set(1, 1);

    // ---- state
    const state = {
      hour: 17.2, timeRuns: true, cam: 0, keys: new Set(), orbit: 0, orbitTarget: 0, pitch: 0,
      loaded: false, stopped: false, fpsOn: false, mapOn: false, lastPlace: '', shake: 0,
    };
    let world = null;

    // ---- input
    const down = (e) => {
      const k = e.key.toLowerCase();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
      state.keys.add(k);
      if (k === 'c') state.cam = (state.cam + 1) % 3;
      if (k === 't') $('.panel').classList.toggle('on');
      if (k === 'm') { state.mapOn = !state.mapOn; $('.bigmap').classList.toggle('on', state.mapOn); if (state.mapOn) drawBigMap(); }
      if (k === 'f3') { state.fpsOn = !state.fpsOn; $('.fps').style.display = state.fpsOn ? 'block' : 'none'; }
      if (k === 'r' && world && (typeof story === 'undefined' || story.mode === 'drive')) resetCar();
      audio.start();
    };
    const up = (e) => state.keys.delete(e.key.toLowerCase());
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    let dragging = false, lastX = 0;
    renderer.domElement.addEventListener('mousedown', (e) => { dragging = true; lastX = e.clientX; renderer.domElement.focus(); audio.start(); });
    window.addEventListener('mouseup', () => { dragging = false; });
    window.addEventListener('mousemove', (e) => { if (!dragging) return; state.orbitTarget += (e.clientX - lastX) * 0.008; lastX = e.clientX; });
    const slider = $('.panel input[type=range]');
    slider.addEventListener('input', () => { state.hour = parseFloat(slider.value); });
    root.querySelectorAll('.panel button').forEach((b) => b.addEventListener('click', () => { state.hour = parseFloat(b.dataset.h); slider.value = state.hour; }));
    $('.panel .run').addEventListener('change', (e) => { state.timeRuns = e.target.checked; });

    // ---- audio: a synthesised engine, tyre squeal and wind (no samples yet; recorded sounds come in a later stage)
    const audio = (() => {
      let ctx = null, eng, eng2, engGain, filt, noise, squeal, squealGain, wind, windGain, master;
      return {
        start() {
          if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
          try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
          master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination);
          eng = ctx.createOscillator(); eng.type = 'sawtooth'; eng2 = ctx.createOscillator(); eng2.type = 'square';
          filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 600; filt.Q.value = 3;
          engGain = ctx.createGain(); engGain.gain.value = 0.07;
          const g2 = ctx.createGain(); g2.gain.value = 0.35;
          eng.connect(filt); eng2.connect(g2); g2.connect(filt); filt.connect(engGain); engGain.connect(master);
          const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
          noise = ctx.createBufferSource(); noise.buffer = buf; noise.loop = true;
          squeal = ctx.createBiquadFilter(); squeal.type = 'bandpass'; squeal.frequency.value = 1900; squeal.Q.value = 9;
          squealGain = ctx.createGain(); squealGain.gain.value = 0;
          wind = ctx.createBiquadFilter(); wind.type = 'lowpass'; wind.frequency.value = 500;
          windGain = ctx.createGain(); windGain.gain.value = 0;
          noise.connect(squeal); squeal.connect(squealGain); squealGain.connect(master);
          noise.connect(wind); wind.connect(windGain); windGain.connect(master);
          eng.start(); eng2.start(); noise.start();
        },
        update(car, throttle) {
          if (!ctx) return;
          const t = ctx.currentTime, f = car.rpm / 30;
          eng.frequency.setTargetAtTime(f, t, 0.03); eng2.frequency.setTargetAtTime(f * 0.5, t, 0.03);
          filt.frequency.setTargetAtTime(350 + throttle * 1200 + car.rpm * 0.08, t, 0.05);
          engGain.gain.setTargetAtTime(0.045 + throttle * 0.05, t, 0.05);
          squealGain.gain.setTargetAtTime(car.skid * 0.12, t, 0.04);
          const sp = Math.abs(car.speed);
          windGain.gain.setTargetAtTime(Math.min(0.12, sp * sp * 0.00004), t, 0.2);
        },
        thump(v) { if (!ctx) return; const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = 70; g.gain.value = Math.min(0.6, v * 0.03); g.gain.setTargetAtTime(0, ctx.currentTime, 0.08); o.connect(g); g.connect(master); o.start(); o.stop(ctx.currentTime + 0.4); },
        stop() { if (ctx) ctx.close(); ctx = null; },
      };
    })();

    // ---- loading
    const setLoad = (msg, f) => { $('.load .msg').textContent = msg; $('.load .bar div').style.width = Math.round(f * 100) + '%'; };
    const frame = () => new Promise((r) => requestAnimationFrame(r));

    (async () => {
      try {
        setLoad('LOADING THE ROAD MAP', 0.05);
        const [roadsD, landD, index] = await Promise.all([loadData(base, 'roads', 'roads.js'), loadData(base, 'land', 'land.js'), loadData(base, 'index', 'index.js')]);
        if (state.stopped) return;
        world = await buildWorld(roadsD.roads, landD, index, setLoad, frame);
        if (state.stopped) return;
        resetCar(true);
        city.placeAll();
        state.loaded = true;
        { const sv = load(); if (sv && sv.done && sv.done.includes('night-fare')) { story.unlocked = sv.unlocked || { fatimah: true }; story.complete = true; story.chars.fareej.money = sv.chars.fareej.money; story.chars.fatimah.money = sv.chars.fatimah.money; war.fromJSON(sv.arms); life.fromJSON(sv.life); acts.A.done = sv.done; } else if (!opts.noStory) startMission(); }
        $('.load').style.opacity = '0'; setTimeout(() => { $('.load').style.display = 'none'; }, 700);
        setTimeout(() => { $('.hint').style.opacity = '0'; }, 14000);
        renderer.domElement.focus();
      } catch (e) {
        setLoad('COULD NOT LOAD THE MAP: ' + e.message, 0);
      }
    })();

    // ------------------------------------------------------------------ world

    async function buildWorld(roads, land, index, progress, tick) {
      const W = { roads, chunks: new Map(), roadGrid: new L.Grid(40), wallGrid: new L.Grid(25), tiles: new Map(), nodes: new Map() };
      const chunkOf = (x, z) => {
        const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK), k = cx + ',' + cz;
        let c = W.chunks.get(k);
        if (!c) W.chunks.set(k, c = { cx, cz, x: (cx + 0.5) * CHUNK, z: (cz + 0.5) * CHUNK, road: new Builder(), mark: new Builder(), pave: new Builder(), kerbY: new Builder(), kerbW: new Builder(), conc: new Builder(), grass: new Builder(), lamps: [], palms: [], pillars: [], signs: [], group: null, furn: null });
        return c;
      };

      // Which road ends meet which: used to decide where a bridge continues, and for traffic.
      const nodeKey = (x, z) => Math.round(x) + ':' + Math.round(z);
      roads.forEach((r, i) => {
        const n = r.p.length / 2;
        for (const [end, pi] of [[0, 0], [1, n - 1]]) {
          const k = nodeKey(r.p[pi * 2], r.p[pi * 2 + 1]);
          let a = W.nodes.get(k); if (!a) W.nodes.set(k, a = []); a.push({ r: i, end });
        }
      });
      const bridgeAt = (x, z, self) => (W.nodes.get(nodeKey(x, z)) || []).some((e) => e.r !== self && roads[e.r].b);

      // Order: small roads first so big roads are drawn over them where they meet.
      const order = roads.map((r, i) => i).sort((a, b) => (roads[b].k === 5 ? 1.5 : roads[b].k) - (roads[a].k === 5 ? 1.5 : roads[a].k));
      let done = 0;
      for (const i of order) {
        const r = roads[i];
        const p = r.p, n = p.length / 2;
        if (n < 2) continue;
        const cum = L.cumulative(p);
        r.cum = cum; r.len = cum[n - 1];
        r.h = L.bridgeHeights(p, r.b || 0, bridgeAt(p[0], p[1], i), bridgeAt(p[n * 2 - 2], p[n * 2 - 1], i));
        const w = r.l * LANE * (r.o ? 1 : 2);
        r.w = w;
        const half = w / 2;
        const y = KIND_Y[r.k];
        const shade = r.k === 0 || r.k === 5 ? 0.92 : r.k <= 2 ? 1.0 : 1.08;     // new black asphalt on motorways, faded grey elsewhere
        const c = [shade, shade, shade * 0.99];
        ribbon(chunkOf, 'road', p, r.h, y, -half - 0.5, half + 0.5, 4, cum, c);
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (let k = 0; k < n; k++) { const x = p[k * 2], z = p[k * 2 + 1]; if (x < minX) minX = x; if (x > maxX) maxX = x; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z; }
        r.box = [minX, minZ, maxX, maxZ];

        // Spatial index for height, the nearest road name, and traffic.
        for (let k = 0; k < n - 1; k++) W.roadGrid.addSegment(p[k * 2], p[k * 2 + 1], p[k * 2 + 2], p[k * 2 + 3], { r: i, k }, half + 2);

        // Markings: white lane lines (dashed) and edge lines; a yellow line on the inside edge of divided roads.
        if (r.k <= 6 && r.len > 25) {
          const keep = (a, b) => a > 10 && b < r.len - 10;   // leave junction mouths clear
          const ym = y + 0.012;
          const line = (off, wdt, col, dash) => {
            const filter = dash ? (a, b) => keep(a, b) && (Math.floor(a / dash) % 4 === 0) : keep;
            ribbon(chunkOf, 'mark', p, r.h, ym, off - wdt / 2, off + wdt / 2, 4, cum, col, filter);
          };
          const white = [0.86, 0.86, 0.83], yellow = [0.86, 0.66, 0.12];
          if (r.o) {
            line(-half + 0.35, 0.15, r.k <= 1 || r.k === 5 ? yellow : white, 0);
            line(half - 0.35, 0.15, white, 0);
            for (let ln = 1; ln < r.l; ln++) line(-half + ln * LANE, 0.13, white, 3);
          } else {
            line(0, r.k <= 2 ? 0.3 : 0.13, r.k <= 2 ? yellow : white, r.k <= 2 ? 0 : 3);
            line(-half + 0.35, 0.13, white, 0); line(half - 0.35, 0.13, white, 0);
            for (let ln = 1; ln < r.l; ln++) { line(-ln * LANE, 0.12, white, 3); line(ln * LANE, 0.12, white, 3); }
          }
        }

        const city = r.k >= 2 && r.k <= 4 && !r.b;
        // Pavements and kerbs on city roads.
        if (city) {
          const yellowKerb = r.k <= 2;
          for (const side of r.o ? [1] : [-1, 1]) {
            const e = side * (half + 0.5);
            ribbon(chunkOf, yellowKerb ? 'kerbY' : 'kerbW', p, r.h, 0.16, side > 0 ? e : e - 0.35, side > 0 ? e + 0.35 : e, 1, cum, [1, 1, 1]);
            ribbon(chunkOf, 'pave', p, r.h, 0.15, side > 0 ? e + 0.35 : e - 3.8, side > 0 ? e + 3.8 : e - 0.35, 4, cum, [1, 1, 1]);
          }
          if (r.o && r.k <= 3) ribbon(chunkOf, 'grass', p, r.h, 0.17, -half - 4.5, -half - 0.6, 4, cum, [1, 1, 1]);   // planted central reservation
        }
        // Motorways: a concrete barrier on the inside edge; bridges: deck sides and parapets.
        if ((r.k === 0 || r.k === 1) && r.o && !r.b) {
          wallAlong(chunkOf, 'conc', p, r.h, -half - 0.6, 0, 0.95, cum, [0.95, 0.95, 0.93], false);
          wallAlong(chunkOf, 'conc', p, r.h, -half - 0.9, 0, 0.95, cum, [0.9, 0.9, 0.88], true);
        }
        if (r.b) {
          for (const side of [-1, 1]) {
            const e = side * (half + 0.6);
            wallAlong(chunkOf, 'conc', p, r.h, e, -1.4, 1.0, cum, [0.93, 0.92, 0.9], side < 0 ? false : true);
            wallAlong(chunkOf, 'conc', p, r.h, e, -1.4, 1.0, cum, [0.85, 0.84, 0.82], side < 0 ? true : false);
          }
          ribbon(chunkOf, 'conc', p, r.h.map((v) => v - 1.4), 0, half + 0.6, -half - 0.6, 4, cum, [0.55, 0.55, 0.54]);   // underside
          for (let d = 15; d < r.len; d += 32) { const q = L.pointAt(p, cum, d), hh = heightAlong(r, d); if (hh > 3) chunkOf(q.x, q.z).pillars.push([q.x, hh - 1.4, q.z, Math.atan2(q.dx, -q.dz), w]); }
        }
        // Street lamps every 40 m (in step with the light pools painted on the road), palms on planted reservations.
        if (r.k <= 4 && r.len > 30) {
          const side = r.o ? -1 : 1;                    // divided roads: lamps on the central reservation; others: kerbside
          const off = side * (half + (r.o ? 1.0 : 1.6));
          for (let d = 0; d < r.len; d += 40) { const q = L.pointAt(p, cum, d); const nx = -q.dz, nz = q.dx; chunkOf(q.x, q.z).lamps.push([q.x + nx * off, heightAlong(r, d), q.z + nz * off, Math.atan2(q.dx, -q.dz), -side]); }   // the arm reaches over the road
          if (city && r.o && r.k <= 3) for (let d = 20; d < r.len; d += 24) { const q = L.pointAt(p, cum, d); const o = -half - 2.6; chunkOf(q.x, q.z).palms.push([q.x - q.dz * o, 0.17, q.z + q.dx * o, (d * 7.3) % 6.28]); }
          else if (city && !r.o && r.k <= 3) for (let d = 12; d < r.len; d += 30) { const q = L.pointAt(p, cum, d); for (const s of [-1, 1]) { const o = s * (half + 3.2); chunkOf(q.x, q.z).palms.push([q.x - q.dz * o, 0.15, q.z + q.dx * o, (d * 3.1 + s) % 6.28]); } }
        }
        // Exit signs: where a slip road leaves, a sign by its start with the destination in English and Arabic.
        if ((r.k === 5 || r.k === 6) && (r.d || r.da) && r.len > 40) { const q = L.pointAt(p, cum, 6); chunkOf(q.x, q.z).signs.push({ x: q.x - q.dz * (half + 1.5), z: q.z + q.dx * (half + 1.5), y: heightAlong(r, 6), rot: Math.atan2(q.dx, -q.dz), en: r.d || '', ar: r.da || '', blue: r.k === 5 }); }

        if (++done % 600 === 0) { progress(`BUILDING DUBAI'S ROADS · ${done.toLocaleString()} OF ${roads.length.toLocaleString()}`, 0.1 + 0.55 * done / roads.length); await tick(); }
      }

      // Turn builders into meshes, one group per kilometre square.
      progress('PAVING', 0.68); await tick();
      for (const c of W.chunks.values()) {
        const g = new THREE.Group();
        const add = (b, mat, shadow) => { const geo = b.geometry(); if (!geo) return; const m = new THREE.Mesh(geo, mat); m.receiveShadow = true; m.castShadow = !!shadow; m.matrixAutoUpdate = false; g.add(m); };
        add(c.road, mats.road); add(c.mark, mats.mark); add(c.pave, mats.paving); add(c.kerbY, mats.kerbY); add(c.kerbW, mats.kerbW); add(c.conc, mats.concrete, true); add(c.grass, mats.grass);
        c.road = c.mark = c.pave = c.kerbY = c.kerbW = c.conc = c.grass = null;
        c.group = g; g.visible = false; scene.add(g);
      }

      // Land, sea and inland water.
      progress('SHAPING THE COAST AND THE CREEK', 0.74); await tick();
      const sea = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000), mats.water); sea.rotation.x = -Math.PI / 2; sea.position.y = -0.6; sea.receiveShadow = true; scene.add(sea);
      const shapeMesh = (rings, mat, y) => {
        const geos = [];
        for (const ring of rings) {
          const pts = []; for (let i = 0; i < ring.length; i += 2) pts.push(new THREE.Vector2(ring[i], -ring[i + 1]));
          if (pts.length < 3) continue;
          try { const geo = new THREE.ShapeGeometry(new THREE.Shape(pts)); geo.rotateX(-Math.PI / 2); geos.push(geo); } catch { /* a broken ring in the map data */ }
        }
        const merged = mergeGeometries(geos);
        if (!merged) return null;
        // World-space UVs so the sand texture tiles every 30 m.
        const pos = merged.attributes.position, uv = new Float32Array(pos.count * 2);
        for (let i = 0; i < pos.count; i++) { uv[i * 2] = pos.getX(i) / 30; uv[i * 2 + 1] = pos.getZ(i) / 30; }
        merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        const m = new THREE.Mesh(merged, mat); m.position.y = y; m.receiveShadow = true; scene.add(m); return m;
      };
      shapeMesh(land.land, mats.land, 0);
      const inland = shapeMesh(land.water, mats.water, 0.02);
      if (inland) { inland.material = mats.water.clone(); inland.material.polygonOffset = true; inland.material.polygonOffsetFactor = -1; }

      // Towers seen from everywhere (45 m and up).
      progress('RAISING THE SKYLINE', 0.82); await tick();
      const sky = buildingMesh(index.sky, -1);
      if (sky) { scene.add(sky.mesh); }
      W.tileSize = index.size; W.tileKeys = new Set(index.keys);

      // Shared meshes for street furniture.
      W.lampGeo = (() => {
        const pole = new THREE.CylinderGeometry(0.09, 0.14, 11, 6); pole.translate(0, 5.5, 0);
        const arm = new THREE.BoxGeometry(0.12, 0.12, 2.6); arm.translate(0, 10.9, 1.2);
        return mergeGeometries([pole, arm]);
      })();
      W.lampHeadGeo = (() => { const h = new THREE.BoxGeometry(0.45, 0.16, 0.9); h.translate(0, 10.8, 2.4); return h; })();
      W.palm = palmGeometry();
      W.pillarGeo = new THREE.BoxGeometry(1, 1, 1); W.pillarGeo.translate(0, -0.5, 0);
      W.glowMat = new THREE.PointsMaterial({ map: TEX.glow, size: 9, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: '#ffb46a', opacity: 0 });

      progress('READY', 1); await tick();
      return W;
    }

    function heightAlong(r, d) {
      if (!r.b) return 0;
      const n = r.p.length / 2, cum = r.cum;
      let lo = 0, hi = n - 1;
      if (d <= 0) return r.h[0]; if (d >= cum[hi]) return r.h[hi];
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= d) lo = m; else hi = m; }
      const f = (d - cum[lo]) / ((cum[hi] - cum[lo]) || 1);
      return r.h[lo] + (r.h[hi] - r.h[lo]) * f;
    }

    function mergeGeometries(geos) {
      const list = geos.filter(Boolean).map((g) => (g.index ? g.toNonIndexed() : g));
      if (!list.length) return null;
      const names = Object.keys(list[0].attributes).filter((n) => list.every((g) => g.attributes[n]));
      const out = new THREE.BufferGeometry();
      for (const name of names) {
        const size = list[0].attributes[name].itemSize;
        let len = 0; for (const g of list) len += g.attributes[name].array.length;
        const arr = new Float32Array(len); let o = 0;
        for (const g of list) { arr.set(g.attributes[name].array, o); o += g.attributes[name].array.length; }
        out.setAttribute(name, new THREE.BufferAttribute(arr, size));
      }
      if (!out.attributes.normal) out.computeVertexNormals();
      out.computeBoundingSphere();
      return out;
    }

    function palmGeometry() {
      const trunk = new THREE.CylinderGeometry(0.16, 0.24, 7.5, 7, 4); trunk.translate(0, 3.75, 0);
      // bend the trunk slightly
      const tp = trunk.attributes.position; for (let i = 0; i < tp.count; i++) { const y = tp.getY(i); tp.setX(i, tp.getX(i) + Math.pow(y / 7.5, 2) * 0.5); }
      trunk.computeVertexNormals();
      const fronds = [];
      for (let k = 0; k < 9; k++) {
        const f = new THREE.PlaneGeometry(0.7, 3.4, 1, 5); f.translate(0, 1.7, 0);
        const fp = f.attributes.position; for (let i = 0; i < fp.count; i++) { const y = fp.getY(i); fp.setZ(i, -Math.pow(y / 3.4, 2) * 1.6); fp.setX(i, fp.getX(i) * (1 - y / 3.6)); }
        f.rotateX(-1.05 + (k % 2) * 0.25); f.rotateY(k / 9 * Math.PI * 2); f.translate(0.5, 7.4, 0);
        f.computeVertexNormals(); fronds.push(f);
      }
      return { trunk, fronds: mergeGeometries(fronds) };
    }

    // ---- buildings

    const FACADES = ['#d8c8a6', '#e6dcc6', '#ece8de', '#cdb690', '#c8a582', '#bdb8ad', '#e2d2b4', '#d3c3a2', '#efe9dc', '#b9ab95'];
    const GLASS = ['#5d7686', '#4a6272', '#7f97a3', '#3d4c56', '#6f8790', '#88a0a6'];

    /** Merged walls and roofs for a list of buildings [h, x,z, x,z ...]. `skipTall`: leave out ≥45 m (the skyline has them). */
    function buildingMesh(list, tileId, skipTall) {
      let verts = 0;
      const items = [];
      for (const b of list) {
        const h = b[0]; if (skipTall && h >= 45) continue;
        const n = (b.length - 1) / 2; if (n < 3) continue;
        items.push(b); verts += n * 4 + n;
      }
      if (!items.length) return null;
      const pos = [], nrm = [], col = [], fac = [], sty = [], seed = [], idx = [];
      const c = new THREE.Color();
      for (const b of items) {
        const h = b[0], n = (b.length - 1) / 2;
        const s = Math.abs(Math.sin(b[1] * 12.9898 + b[2] * 78.233) * 43758.5453) % 1;
        const glass = h >= 40 && s > 0.25 || h >= 90;
        c.set(glass ? GLASS[Math.floor(s * 97) % GLASS.length] : FACADES[Math.floor(s * 89) % FACADES.length]);
        const style = glass ? 1 : 0;
        let u = 0;
        for (let i = 0; i < n; i++) {
          const ax = b[1 + i * 2], az = b[2 + i * 2], j = (i + 1) % n, bx = b[1 + j * 2], bz = b[2 + j * 2];
          const len = Math.hypot(bx - ax, bz - az); if (len < 0.01) continue;
          // the polygon is counter-clockwise in x/z-flipped space, so the outward normal is (dz, -dx)
          const nx = (bz - az) / len, nz = -(bx - ax) / len;
          const k = pos.length / 3;
          pos.push(ax, 0, az, bx, 0, bz, bx, h, bz, ax, h, az);
          for (let q = 0; q < 4; q++) { nrm.push(nx, 0, nz); col.push(c.r, c.g, c.b); sty.push(style); seed.push(s * 100); }
          fac.push(u, 0, u + len, 0, u + len, h, u, h);
          idx.push(k, k + 2, k + 1, k, k + 3, k + 2);
          u += len;
          if (W().wallGrid) W().wallGrid.addSegment(ax, az, bx, bz, { ax, az, bx, bz, tile: tileId }, 1);
        }
        // roof
        const contour = []; for (let i = 0; i < n; i++) contour.push(new THREE.Vector2(b[1 + i * 2], b[2 + i * 2]));
        let tris; try { tris = THREE.ShapeUtils.triangulateShape(contour, []); } catch { tris = []; }
        const k0 = pos.length / 3;
        for (let i = 0; i < n; i++) { pos.push(b[1 + i * 2], h, b[2 + i * 2]); nrm.push(0, 1, 0); col.push(c.r, c.g, c.b); fac.push(0, 0); sty.push(2); seed.push(s * 100); }
        for (const t of tris) idx.push(k0 + t[0], k0 + t[2], k0 + t[1]);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setAttribute('aFac', new THREE.Float32BufferAttribute(fac, 2));
      g.setAttribute('aStyle', new THREE.Float32BufferAttribute(sty, 1));
      g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
      g.setIndex(idx);
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, mats.building);
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false;
      return { mesh, verts };
    }
    const W = () => world || {};

    // Tiles of ordinary buildings stream in and out around the car.
    const tileQueue = [];
    function updateTiles(x, z) {
      const S = world.tileSize, R = VIEW.tiles;
      const want = new Set();
      for (let tx = Math.floor((x - R) / S); tx <= Math.floor((x + R) / S); tx++) for (let tz = Math.floor((z - R) / S); tz <= Math.floor((z + R) / S); tz++) {
        const k = tx + '_' + tz;
        if (!world.tileKeys.has(k)) continue;
        const cx = (tx + 0.5) * S, cz = (tz + 0.5) * S;
        if (Math.hypot(cx - x, cz - z) > R + S * 0.7) continue;
        want.add(k);
        if (!world.tiles.has(k) && !tileQueue.includes(k)) tileQueue.push(k);
      }
      for (const [k, t] of world.tiles) {
        const [tx, tz] = k.split('_').map(Number), cx = (tx + 0.5) * S, cz = (tz + 0.5) * S;
        if (Math.hypot(cx - x, cz - z) > VIEW.unload + S) {
          if (t.mesh) { scene.remove(t.mesh); t.mesh.geometry.dispose(); }
          world.wallGrid.remove((i) => i.tile === k);
          city.offTile(k);
          world.tiles.delete(k);
        }
      }
      // nearest first
      tileQueue.sort((a, b) => { const d = (k) => { const [tx, tz] = k.split('_').map(Number); return Math.hypot((tx + 0.5) * S - x, (tz + 0.5) * S - z); }; return d(a) - d(b); });
    }
    let tileBusy = false;
    function pumpTiles() {
      if (tileBusy || !tileQueue.length) return;
      const k = tileQueue.shift();
      if (world.tiles.has(k)) return;
      tileBusy = true;
      world.tiles.set(k, { mesh: null });
      loadData(base, 'tile:' + k, 'tiles/' + k + '.js').then((d) => {
        tileBusy = false;
        const t = world.tiles.get(k); if (!t || state.stopped) return;
        const built = buildingMesh(d.b, k, true);
        if (built) { t.mesh = built.mesh; scene.add(built.mesh); }
        city.onTile(k, d.b);
        // collision walls for the tall ones too (their meshes live in the skyline)
        for (const b of d.b) if (b[0] >= 45) { const n = (b.length - 1) / 2; for (let i = 0; i < n; i++) { const j = (i + 1) % n; world.wallGrid.addSegment(b[1 + i * 2], b[2 + i * 2], b[1 + j * 2], b[2 + j * 2], { ax: b[1 + i * 2], az: b[2 + i * 2], bx: b[1 + j * 2], bz: b[2 + j * 2], tile: k }, 1); } }
        delete D.store['tile:' + k];
      }).catch(() => { tileBusy = false; });
    }

    // ---- street furniture per chunk, built when the chunk comes near
    function furnish(c) {
      if (c.furn) return;
      const g = new THREE.Group();
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
      if (c.lamps.length) {
        const poles = new THREE.InstancedMesh(world.lampGeo, mats.pole, c.lamps.length), heads = new THREE.InstancedMesh(world.lampHeadGeo, mats.lampHead, c.lamps.length);
        const glowPos = [];
        c.lamps.forEach(([x, y, z, rot, arm], i) => {
          e.set(0, -rot + (arm > 0 ? Math.PI / 2 : -Math.PI / 2), 0); q.setFromEuler(e); m4.compose(v.set(x, y, z), q, s);
          poles.setMatrixAt(i, m4); heads.setMatrixAt(i, m4);
          const hp = new THREE.Vector3(0, 10.7, 2.4).applyQuaternion(q); glowPos.push(x + hp.x, y + hp.y, z + hp.z);
        });
        poles.castShadow = true; g.add(poles, heads);
        const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(glowPos, 3));
        const pts = new THREE.Points(gg, world.glowMat); pts.frustumCulled = false; g.add(pts);
      }
      if (c.palms.length) {
        const tr = new THREE.InstancedMesh(world.palm.trunk, mats.trunk, c.palms.length), fr = new THREE.InstancedMesh(world.palm.fronds, mats.frond, c.palms.length);
        c.palms.forEach(([x, y, z, rot], i) => { const sc = 0.85 + (rot % 1) * 0.35; e.set(0, rot, 0); q.setFromEuler(e); m4.compose(v.set(x, y, z), q, s.set(sc, sc, sc)); tr.setMatrixAt(i, m4); fr.setMatrixAt(i, m4); });
        s.set(1, 1, 1);
        tr.castShadow = fr.castShadow = true; g.add(tr, fr);
      }
      if (c.pillars.length) {
        const pi = new THREE.InstancedMesh(world.pillarGeo, mats.concrete, c.pillars.length);
        c.pillars.forEach(([x, y, z, rot, w], i) => { e.set(0, -rot, 0); q.setFromEuler(e); m4.compose(v.set(x, y, z), q, new THREE.Vector3(Math.min(w * 0.55, 9), y, 1.6)); pi.setMatrixAt(i, m4); });
        pi.castShadow = true; pi.receiveShadow = true; g.add(pi);
      }
      for (const sg of c.signs) g.add(makeSign(sg));
      c.furn = g; scene.add(g);
    }
    function unfurnish(c) {
      if (!c.furn) return;
      scene.remove(c.furn);
      c.furn.traverse((o) => { if (o.isInstancedMesh) o.dispose(); if (o.isPoints) o.geometry.dispose(); if (o.userData.tex) { o.userData.tex.dispose(); o.material.dispose(); o.geometry.dispose(); } });
      c.furn = null;
    }

    function makeSign(sg) {
      const cv = document.createElement('canvas'); cv.width = 512; cv.height = 192;
      const g = cv.getContext('2d');
      g.fillStyle = sg.blue ? '#1d4f8f' : '#1f6a3c'; g.fillRect(0, 0, 512, 192);
      g.strokeStyle = '#f2f2ee'; g.lineWidth = 6; g.strokeRect(8, 8, 496, 176);
      g.fillStyle = '#f4f4f0'; g.textAlign = 'center';
      g.font = '600 40px "Geeza Pro","Noto Kufi Arabic","Segoe UI",sans-serif'; g.direction = 'rtl';
      fitText(g, sg.ar || '', 256, 78, 470);
      g.direction = 'ltr'; g.font = '600 42px "Avenir Next Condensed","Barlow Condensed","Arial Narrow",sans-serif';
      fitText(g, sg.en || '', 256, 146, 470);
      // arrow
      g.beginPath(); g.moveTo(470, 30); g.lineTo(492, 52); g.lineTo(470, 74); g.fillStyle = '#f4f4f0'; g.fill();
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
      const board = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 1.8), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.05 }));
      board.userData.tex = tex;
      const grp = new THREE.Group();
      board.position.set(0, 5.2, 0); grp.add(board);
      const back = new THREE.Mesh(new THREE.BoxGeometry(4.9, 1.9, 0.08), mats.signBack); back.position.set(0, 5.2, 0.06); back.userData.tex = { dispose() {} }; grp.add(back);
      for (const sx of [-1.8, 1.8]) { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 6.1, 6), mats.pole); post.position.set(sx, 3.05, 0.12); post.userData.tex = { dispose() {} }; grp.add(post); }
      grp.position.set(sg.x, sg.y, sg.z); grp.rotation.y = -sg.rot;
      return grp;
    }
    function fitText(g, text, x, y, max) { let size = parseInt(g.font.match(/(\d+)px/)[1], 10); while (g.measureText(text).width > max && size > 14) { size -= 2; g.font = g.font.replace(/\d+px/, size + 'px'); } g.fillText(text, x, y); }

    // ------------------------------------------------------------------ the player's car

    const carGeo = carGeometry();
    let player = makePlayerCar(carGeo, '#6d7378');   // Fareej's grey saloon
    scene.add(player.group);
    let car = new L.Car();
    let lastSupport = null;

    function resetCar(first) {
      // Start on Al Maktoum Bridge over the Creek, heading towards Bur Dubai.
      let r = first ? world.roads.find((x) => /Al Maktoum Bridge/.test(x.n || '') && x.o) : null;
      if (!r) {
        // Nearest road to the car, in its direction of travel.
        let best = null, bd = Infinity;
        const items = [];
        for (let ring = 0; ring <= 10 && !items.length; ring++) for (let gx = -ring; gx <= ring; gx++) for (let gz = -ring; gz <= ring; gz++) {
          if (Math.max(Math.abs(gx), Math.abs(gz)) !== ring) continue;
          for (const it of world.roadGrid.query(car.x + gx * 40, car.z + gz * 40)) if (world.roads[it.r].k <= 4) items.push(it);
        }
        for (const it of items) { const rr = world.roads[it.r], p = rr.p; const s = L.nearestOnSegment(car.x, car.z, p[it.k * 2], p[it.k * 2 + 1], p[it.k * 2 + 2], p[it.k * 2 + 3]); if (s.d < bd) { bd = s.d; best = { rr, d: rr.cum[it.k] + s.t * (rr.cum[it.k + 1] - rr.cum[it.k]) }; } }
        if (best) { placeOn(best.rr, best.d); return; }
        r = world.roads.find((x) => x.k === 0) || world.roads[0];
      }
      placeOn(r, r.len * 0.45);
    }
    function placeOn(r, d) {
      const q = L.pointAt(r.p, r.cum, d);
      const lane = r.o ? (-r.w / 2 + LANE * 1.5) : LANE * 0.5;
      car.x = q.x - q.dz * lane; car.z = q.z + q.dx * lane; car.y = heightAlong(r, d) + KIND_Y[r.k];
      car.heading = Math.atan2(q.dx, -q.dz); car.vx = car.vz = car.yawRate = 0; car.gear = 1;
      lastSupport = null;
      updateTiles(car.x, car.z);
    }

    /** Height of the road surface under (x,z), preferring the deck nearest the car's current height. */
    function supportAt(x, z, yNow) {
      let best = null;
      for (const it of world.roadGrid.query(x, z)) {
        const r = world.roads[it.r], p = r.p, k = it.k;
        const s = L.nearestOnSegment(x, z, p[k * 2], p[k * 2 + 1], p[k * 2 + 2], p[k * 2 + 3]);
        if (s.d > r.w / 2 + 0.6) continue;
        const y = r.h[k] + (r.h[k + 1] - r.h[k]) * s.t + KIND_Y[r.k];
        if (y > yNow + 1.6) continue;                        // a flyover above us: drive underneath
        if (!best || y > best.y) best = { y, r, k, s };
      }
      return best;
    }

    // ------------------------------------------------------------------ traffic

    const traffic = { cars: [], max: 110, inst: null };
    function makeTrafficMeshes() {
      const n = traffic.max;
      const body = new THREE.InstancedMesh(carGeo.bodyG, new THREE.MeshPhysicalMaterial({ metalness: 0.5, roughness: 0.4, clearcoat: 0.6 }), n);
      const glass = new THREE.InstancedMesh(carGeo.glassG, new THREE.MeshStandardMaterial({ color: '#0d1216', metalness: 0.3, roughness: 0.08 }), n);
      const roof = new THREE.InstancedMesh(carGeo.roofG, body.material, n);
      const wheels = new THREE.InstancedMesh(carGeo.wheelG, new THREE.MeshStandardMaterial({ color: '#151515', roughness: 0.9 }), n * 4);
      const tails = new THREE.InstancedMesh(new THREE.BoxGeometry(1.5, 0.12, 0.06), new THREE.MeshStandardMaterial({ color: '#400', emissive: '#ff2010', emissiveIntensity: 0.6 }), n);
      const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(1.4, 0.1, 0.06), new THREE.MeshStandardMaterial({ color: '#ddd', emissive: '#fff2d8', emissiveIntensity: 0 }), n);
      const col = new THREE.Color();
      for (let i = 0; i < n; i++) { col.set(CAR_COLORS[i % CAR_COLORS.length]); body.setColorAt(i, col); roof.setColorAt(i, col); }
      for (const m of [body, glass, roof, wheels, tails, heads]) { m.count = 0; m.frustumCulled = false; scene.add(m); }
      body.castShadow = true;
      traffic.inst = { body, glass, roof, wheels, tails, heads };
    }
    makeTrafficMeshes();

    function spawnTraffic() {
      // A random road segment 150-650 m away, on a road with traffic.
      for (let tries = 0; tries < 12; tries++) {
        const a = Math.random() * Math.PI * 2, d = 150 + Math.random() * 500;
        const x = car.x + Math.cos(a) * d, z = car.z + Math.sin(a) * d;
        const items = world.roadGrid.query(x, z).filter((it) => world.roads[it.r].k <= 6 && world.roads[it.r].len > 60);
        if (!items.length) continue;
        const it = items[(Math.random() * items.length) | 0], r = world.roads[it.r];
        const dir = r.o ? 1 : (Math.random() < 0.5 ? 1 : -1);
        const s = r.cum[it.k];
        const t = { r: it.r, dir, lane: (Math.random() * r.l) | 0, s, speed: 0, want: (r.s / 3.6) * (0.72 + Math.random() * 0.3), x: 0, z: 0, y: 0, hd: 0, stopT: 0 };
        t.speed = t.want * 0.8;
        traffic.cars.push(t); return;
      }
    }

    function nextRoad(t) {
      const r = world.roads[t.r], n = r.p.length / 2;
      const endPt = t.dir > 0 ? n - 1 : 0;
      const k = Math.round(r.p[endPt * 2]) + ':' + Math.round(r.p[endPt * 2 + 1]);
      const opts = [];
      for (const e of world.nodes.get(k) || []) {
        if (e.r === t.r) continue;
        const c = world.roads[e.r]; if (c.k > 6) continue;
        if (e.end === 0) opts.push({ r: e.r, dir: 1, w: c.k <= r.k ? 3 : 1 });
        else if (!c.o) opts.push({ r: e.r, dir: -1, w: c.k <= r.k ? 3 : 1 });
      }
      if (!opts.length) return false;
      let sum = opts.reduce((a, o) => a + o.w, 0), pick = Math.random() * sum;
      const o = opts.find((x) => (pick -= x.w) <= 0) || opts[0];
      const c = world.roads[o.r];
      t.r = o.r; t.dir = o.dir; t.s = o.dir > 0 ? 0 : c.len; t.lane = Math.min(t.lane, c.l - 1); t.want = (c.s / 3.6) * (0.72 + Math.random() * 0.3);
      return true;
    }

    function updateTraffic(dt) {
      { let n = 6; while (traffic.cars.length < city.trafficTarget() && n--) spawnTraffic(); }
      // Keep a gap to the car ahead in the same lane of the same road.
      const groups = new Map();
      for (const t of traffic.cars) { const k = t.r * 4 + (t.dir > 0 ? 0 : 2) + t.lane * 8; let a = groups.get(k); if (!a) groups.set(k, a = []); a.push(t); }
      for (const a of groups.values()) {
        a.sort((p, q) => (p.s - q.s) * p.dir);
        for (let i = 0; i < a.length; i++) { const ahead = a[i + 1]; a[i].gap = ahead ? Math.abs(ahead.s - a[i].s) - 5 : 999; a[i].aheadSpeed = ahead ? ahead.speed : 99; }
      }
      const keep = [];
      for (const t of traffic.cars) {
        const r = world.roads[t.r];
        // the player in front of us in our lane?
        const fx = Math.sin(t.hd), fz = -Math.cos(t.hd);
        const px = car.x - t.x, pz = car.z - t.z, along = px * fx + pz * fz, side = Math.abs(px * -fz + pz * fx);
        let gap = t.gap;
        if (along > 0 && along < 40 && side < 2.2 && Math.abs(car.y - t.y) < 3) gap = Math.min(gap, along - 5);
        let target = t.want;
        if (gap < 30) target = Math.min(target, Math.max(0, (gap - 4) * 0.8), (t.aheadSpeed || 0) + gap * 0.15);
        target = Math.min(target, city.signalLimit(t));
        if (t.stopT > 0) { t.stopT -= dt; target = 0; }
        const acc = target > t.speed ? 2.6 : -7;
        t.speed = Math.max(0, t.speed + Math.max(Math.min(acc * dt, target - t.speed), -7 * dt));
        t.s += t.speed * dt * t.dir;
        if (t.s > r.len || t.s < 0) { if (!nextRoad(t)) continue; }
        const rr = world.roads[t.r];
        const q = L.pointAt(rr.p, rr.cum, t.s);
        const hx = q.dx * t.dir, hz = q.dz * t.dir;
        const lat = rr.o ? -rr.w / 2 + (t.lane + 0.5) * LANE : (t.lane + 0.5) * LANE;
        t.x = q.x - hz * lat; t.z = q.z + hx * lat; t.y = heightAlong(rr, t.s) + KIND_Y[rr.k];
        const hd = Math.atan2(hx, -hz);
        let dh = hd - t.hd; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
        t.hd += dh * Math.min(1, dt * 6);
        if (Math.hypot(t.x - car.x, t.z - car.z) > 800) continue;   // despawn far away
        keep.push(t);
      }
      traffic.cars = keep;
    }

    function drawTraffic(night) {
      const I = traffic.inst, m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), off = new THREE.Vector3();
      let n = 0;
      for (const t of traffic.cars) {
        e.set(0, -t.hd, 0); q.setFromEuler(e);
        m4.compose(v.set(t.x, t.y, t.z), q, one);
        I.body.setMatrixAt(n, m4); I.glass.setMatrixAt(n, m4); I.roof.setMatrixAt(n, m4);
        off.set(0, 0.82, 2.31).applyQuaternion(q); m4.compose(v.set(t.x + off.x, t.y + off.y, t.z + off.z), q, one); I.tails.setMatrixAt(n, m4);
        off.set(0, 0.68, -2.32).applyQuaternion(q); m4.compose(v.set(t.x + off.x, t.y + off.y, t.z + off.z), q, one); I.heads.setMatrixAt(n, m4);
        let w = 0;
        for (const [x, z] of [[-0.83, -1.32], [0.83, -1.32], [-0.83, 1.42], [0.83, 1.42]]) {
          off.set(x, 0.31, z).applyQuaternion(q);
          const wq = q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2));
          m4.compose(v.set(t.x + off.x, t.y + off.y, t.z + off.z), wq, one); I.wheels.setMatrixAt(n * 4 + w++, m4);
        }
        n++;
      }
      for (const k of ['body', 'glass', 'roof', 'tails', 'heads']) { I[k].count = n; I[k].instanceMatrix.needsUpdate = true; }
      I.wheels.count = n * 4; I.wheels.instanceMatrix.needsUpdate = true;
      I.heads.material.emissiveIntensity = night * 2.2;
      I.tails.material.emissiveIntensity = 0.5 + night * 1.5;
    }

    // ------------------------------------------------------------------ section 2: Fareej, Fatimah, on foot, the first mission

    const S = window.DesertHeatStory, P = window.DesertHeatPeople;
    const story = {
      active: 'fareej', mode: 'drive',            // drive | foot | cut | fly
      chars: { fareej: S.newCharacter('fareej'), fatimah: S.newCharacter('fatimah') },
      unlocked: { fatimah: false }, mission: null, pursuit: null, chaser: null,
      sub: { who: '', text: '', t: 0 }, shown: new Set(), sense: 0, senseCool: 0, damage: 0,
      fly: null, inside: null, guard: null, foot: null, camYaw: 0, prompt: '', savedAt: 0, complete: null,
    };
    const persons = {
      fareej: P.makePerson({ ...S.CHARACTERS.fareej, beard: true, shoes: '#2b2723' }),
      fatimah: P.makePerson({ ...S.CHARACTERS.fatimah, shoes: '#111' }),
    };
    for (const p of Object.values(persons)) { p.group.visible = false; scene.add(p.group); }
    // Fatimah's own car (white), parked at her tower; Fareej's is the player car built above.
    const cars = { fareej: { sim: car, mesh: player }, fatimah: { sim: new L.Car(), mesh: makePlayerCar(carGeo, '#e9e6df') } };
    scene.add(cars.fatimah.mesh.group);
    cars.fatimah.mesh.beam.intensity = 0;

    // ---- HUD for the story
    root.insertAdjacentHTML('beforeend', `
      <div class="obj"></div><div class="sub"><b></b><span></span></div><div class="prompt"></div>
      <div class="who"><div data-c="fareej"><i></i><b>FAREEJ</b><span></span></div><div data-c="fatimah"><i></i><b>FATIMAH</b><span></span></div></div>
      <div class="sense"></div><div class="fade"></div>
      <div class="card"><h2></h2><p class="l1"></p><p class="l2"></p><p class="l3"></p><button>CONTINUE</button></div>
      <div class="fail"><h2>MISSION FAILED</h2><p></p><button>RETRY FROM CHECKPOINT</button></div>`);
    const css2 = document.createElement('style'); css2.textContent = `
      .dh .obj { position:absolute; left:50%; top:24px; transform:translateX(-50%); font-size:19px; letter-spacing:1px; text-shadow:0 1px 6px rgba(0,0,0,.8); max-width:70%; text-align:center; transition:opacity .4s; }
      .dh .sub { position:absolute; left:50%; bottom:92px; transform:translateX(-50%); font-size:22px; text-align:center; max-width:70%; text-shadow:0 1px 4px #000, 0 0 12px rgba(0,0,0,.6); transition:opacity .25s; opacity:0; }
      .dh .sub b { color:var(--gold); font-weight:600; margin-right:8px; } .dh .sub.on { opacity:1; } .dh .sub.note span { font-size:15px; letter-spacing:2px; color:var(--dim); }
      .dh .prompt { position:absolute; left:50%; top:62%; transform:translateX(-50%); font-size:15px; letter-spacing:2px; background:var(--panel); padding:6px 12px; border-left:2px solid var(--gold); display:none; }
      .dh .who { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); display:none; gap:24px; }
      .dh .who.on { display:flex; } .dh .who div { width:170px; padding:16px; background:var(--panel); border-top:2px solid rgba(255,255,255,.15); text-align:center; cursor:pointer; }
      .dh .who div.cur { border-top-color:var(--gold); } .dh .who div.no { opacity:.4; cursor:default; }
      .dh .who i { display:block; width:64px; height:64px; margin:0 auto 10px; border-radius:50%; background:#2a2a2a; }
      .dh .who b { font-size:20px; letter-spacing:4px; font-weight:600; } .dh .who span { display:block; font-size:12px; color:var(--dim); letter-spacing:1px; margin-top:6px; min-height:30px; }
      .dh .sense { position:absolute; inset:0; pointer-events:none; box-shadow: inset 0 0 160px rgba(160,190,255,.45); opacity:0; transition:opacity .2s; }
      .dh .fade { position:absolute; inset:0; background:#000; opacity:0; pointer-events:none; transition:opacity .5s; }
      .dh .card, .dh .fail { position:absolute; left:64px; bottom:80px; width:420px; padding:22px 26px; background:rgba(10,10,10,.82); border-left:3px solid var(--gold); display:none; }
      .dh .card h2, .dh .fail h2 { margin:0 0 12px; font-size:30px; letter-spacing:5px; font-weight:600; } .dh .fail h2 { color:#d8574a; }
      .dh .card p, .dh .fail p { margin:4px 0; font-size:16px; letter-spacing:1px; color:var(--dim); }
      .dh .card button, .dh .fail button { margin-top:16px; font:inherit; font-size:14px; letter-spacing:3px; color:#efe9dc; background:rgba(200,162,90,.25); border:0; padding:8px 16px; cursor:pointer; }
      .dh.cut .speedo, .dh.cut .mini, .dh.cut .place, .dh.cut .hint, .dh.cut .obj { opacity:0; }
      .dh.cut::before, .dh.cut::after { content:''; position:absolute; left:0; right:0; height:9%; background:#000; z-index:1; }
      .dh.cut::before { top:0; } .dh.cut::after { bottom:0; }
      .dh.foot .speedo { opacity:0; }
      .dh.hurt::after { content:''; position:absolute; inset:0; pointer-events:none; box-shadow:inset 0 0 140px rgba(200,30,20,.55); animation: dhhurt .5s forwards; } @keyframes dhhurt { to { opacity:0; } }`;
    root.appendChild(css2);
    const faceColor = { fareej: 'radial-gradient(circle at 50% 40%, #9c6b4a 0 38%, #1d1712 39% 100%)', fatimah: 'radial-gradient(circle at 50% 45%, #b07c58 0 34%, #16110e 35% 100%)' };
    root.querySelectorAll('.who i').forEach((i) => { i.style.background = faceColor[i.parentNode.dataset.c]; });

    function say(who, text) { story.sub = { who, text, t: who ? 2.6 + text.length * 0.055 : 4.5 }; const el = $('.sub'); el.querySelector('b').textContent = who; el.querySelector('span').textContent = text; el.classList.toggle('note', !who); el.classList.add('on'); }
    const objective = (t) => { $('.obj').textContent = t || ''; };
    const fade = (on) => { $('.fade').style.opacity = on ? '1' : '0'; };

    // ---- interiors: small rooms built away from the city (under their address), entered through a fade
    function nightSkylineTex() {
      return canvasTex(512, (g, S2) => {
        const gr = g.createLinearGradient(0, 0, 0, S2); gr.addColorStop(0, '#0b1424'); gr.addColorStop(1, '#2a2533'); g.fillStyle = gr; g.fillRect(0, 0, S2, S2);
        const r = rnd(7);
        for (let i = 0; i < 60; i++) { const w = 10 + r() * 30, h = 80 + r() * 330, x = r() * S2; g.fillStyle = `rgb(${14 + r() * 12},${16 + r() * 12},${24 + r() * 14})`; g.fillRect(x, S2 - h, w, h);
          for (let y = S2 - h + 4; y < S2; y += 6) for (let xx = x + 2; xx < x + w - 2; xx += 4) if (r() < 0.35) { g.fillStyle = r() < 0.8 ? '#e7c27c' : '#cfe0ff'; g.fillRect(xx, y, 2, 3); } }
      }, false);
    }
    function makeRoom(kind, at) {
      const grp = new THREE.Group(); grp.position.set(at.x, -60, at.z); scene.add(grp); grp.visible = false;
      const W2 = kind === 'fatimah' ? 9 : 6, D2 = kind === 'fatimah' ? 7 : 5, H = 2.9;
      const floorM = new THREE.MeshStandardMaterial(kind === 'fatimah' ? { color: '#cfc8bd', roughness: 0.35 } : { color: '#8a6f55', roughness: 0.8 });
      const wallM = new THREE.MeshStandardMaterial({ color: kind === 'fatimah' ? '#e8e3da' : '#c9b9a0', roughness: 0.95, side: THREE.DoubleSide });
      const box = (w, h, d, m, x, y, z) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; grp.add(o); return o; };
      box(W2, 0.1, D2, floorM, 0, -0.05, 0); box(W2, 0.1, D2, wallM, 0, H, 0);
      box(0.1, H, D2, wallM, -W2 / 2, H / 2, 0); box(0.1, H, D2, wallM, W2 / 2, H / 2, 0); box(W2, H, 0.1, wallM, 0, H / 2, D2 / 2);
      // the window wall, with the night city behind glass
      const win = new THREE.Mesh(new THREE.PlaneGeometry(W2 - 1, H - 0.7), new THREE.MeshBasicMaterial({ map: nightSkylineTex() })); win.position.set(0, H / 2 + 0.1, -D2 / 2 - 0.02); grp.add(win);
      box(W2, 0.35, 0.1, wallM, 0, 0.17, -D2 / 2); box(W2, 0.3, 0.1, wallM, 0, H - 0.15, -D2 / 2);
      const wood = new THREE.MeshStandardMaterial({ color: '#5b4330', roughness: 0.7 }), fab = new THREE.MeshStandardMaterial({ color: kind === 'fatimah' ? '#59606a' : '#6b5b4a', roughness: 1 });
      if (kind === 'fatimah') {
        box(2.6, 0.45, 0.95, fab, -2.4, 0.23, 1.8); box(2.6, 0.5, 0.25, fab, -2.4, 0.6, 2.2);         // sofa
        box(1.6, 0.05, 0.9, wood, 2.2, 0.75, -0.6); for (const [x, z] of [[1.5, -0.95], [2.9, -0.95], [1.5, -0.25], [2.9, -0.25]]) box(0.05, 0.75, 0.05, wood, x, 0.37, z);   // table
        const lap = box(0.36, 0.02, 0.25, new THREE.MeshStandardMaterial({ color: '#888', metalness: 0.7, roughness: 0.3 }), 2.2, 0.79, -0.6);
        const scr = box(0.36, 0.24, 0.01, new THREE.MeshStandardMaterial({ color: '#000', emissive: '#bcd2ff', emissiveIntensity: 1.2 }), 2.2, 0.92, -0.73); scr.rotation.x = -0.25;
        grp.userData.laptop = lap;
      } else {
        box(1.9, 0.4, 0.95, fab, 1.8, 0.2, 1.7);                                                             // bed
        box(1.4, 0.05, 0.6, wood, -2, 0.85, -1.9); box(1.4, 0.85, 0.05, wood, -2, 0.42, -1.62);           // workbench
        for (let i = 0; i < 4; i++) box(0.08, 0.005, 0.16, new THREE.MeshStandardMaterial({ color: '#111', emissive: i === 1 ? '#7fa8ff' : '#000', emissiveIntensity: 0.8 }), -2.5 + i * 0.3, 0.88, -1.9);
      }
      const lamp = new THREE.PointLight(kind === 'fatimah' ? '#fff1dd' : '#ffc98a', 6, 12, 1.6); lamp.position.set(0, H - 0.4, 0.5); grp.add(lamp);
      const door = new THREE.Vector3(at.x, -60, at.z + D2 / 2 - 0.6);
      return { grp, w: W2, d: D2, door, kind };
    }
    const rooms = { fareej: makeRoom('fareej', S.PLACES.fareejHome), fatimah: makeRoom('fatimah', S.PLACES.fatimahHome) };

    // the underground car park at the Marina tower: concrete box, pillars, strip lights, the lift
    const garage = (() => {
      const at = S.PLACES.marinaGarage, grp = new THREE.Group(); grp.position.set(at.x, -40, at.z); grp.visible = false; scene.add(grp);
      const con = new THREE.MeshStandardMaterial({ map: TEX.concrete, color: '#9a978f', roughness: 0.9, side: THREE.DoubleSide });
      const floor = new THREE.MeshStandardMaterial({ color: '#4a4b4c', roughness: 0.7 });
      const box = (w, h, d, m, x, y, z) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.receiveShadow = true; o.castShadow = true; grp.add(o); return o; };
      box(60, 0.2, 40, floor, 0, -0.1, 0); box(60, 0.3, 40, con, 0, 3.3, 0);
      box(0.4, 3.4, 40, con, -30, 1.7, 0); box(0.4, 3.4, 40, con, 30, 1.7, 0); box(60, 3.4, 0.4, con, 0, 1.7, -20); box(60, 3.4, 0.4, con, 0, 1.7, 20);
      const pillars = [];
      for (let x = -24; x <= 24; x += 8) for (const z of [-8, 8]) { box(0.7, 3.3, 0.7, con, x, 1.65, z); pillars.push([x, z]); }
      const lineM = new THREE.MeshBasicMaterial({ color: '#d9d4c5' });
      for (let x = -27; x <= 27; x += 2.7) for (const z of [-14, 14]) { const l = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 5), lineM); l.rotation.x = -Math.PI / 2; l.position.set(x, 0.01, z); grp.add(l); }
      const strip = new THREE.MeshStandardMaterial({ color: '#fff', emissive: '#eaf2ff', emissiveIntensity: 2 });
      for (let x = -24; x <= 24; x += 12) box(2.4, 0.05, 0.15, strip, x, 3.12, 0);
      for (const x of [-20, -4, 12]) { const l = new THREE.PointLight('#e8f0ff', 45, 30, 1.2); l.position.set(x, 3, 0); grp.add(l); }
      // parked cars (instanced copies of the traffic body would need their own matrices; a few simple ones here)
      const pm = new THREE.MeshStandardMaterial({ color: '#3a3e44', metalness: 0.5, roughness: 0.45 });
      const parked = [];
      for (const [x, z, c] of [[-20, -14, '#2c2f34'], [-12, -14, '#8d1f1f'], [-4, 14, '#c9c6bf'], [6, -14, '#1d2c44'], [12, 14, '#3a3e44'], [20, -14, '#d0cdc6']]) {
        const m = new THREE.Mesh(carGeo.bodyG, pm.clone()); m.material.color.set(c); m.position.set(x, 0, z); m.rotation.y = z > 0 ? Math.PI : 0; m.castShadow = true; grp.add(m);
        const r2 = new THREE.Mesh(carGeo.roofG, m.material); r2.position.copy(m.position); r2.rotation.y = m.rotation.y; grp.add(r2);
        parked.push([x, z]);
      }
      // the lift: a lit steel door at the far end
      const lift = box(2.2, 2.4, 0.1, new THREE.MeshStandardMaterial({ color: '#b9bcc0', metalness: 0.85, roughness: 0.25 }), 26, 1.2, -19.7);
      box(0.3, 0.3, 0.05, new THREE.MeshStandardMaterial({ color: '#000', emissive: '#7aff9a', emissiveIntensity: 2 }), 27.6, 1.3, -19.6);
      const liftPos = { x: at.x + 26, z: at.z - 18.6 };
      return { grp, at, pillars, parked, liftPos, lift, y: -40 };
    })();

    // ---- on foot
    function startFoot(id, x, z, y, heading) {
      const p = persons[id];
      story.foot = { id, x, z, y, vy: 0, heading, speed: 0, crouch: false, stamina: 1 };
      story.camYaw = heading; p.group.visible = true; p.setPose('stand');
      story.mode = 'foot'; root.classList.add('foot');
    }
    function footBlocked(x, z) {
      const f = story.foot;
      if (story.inside) { const r = story.inside; return Math.abs(x - r.grp.position.x) > r.w / 2 - 0.35 || Math.abs(z - r.grp.position.z) > r.d / 2 - 0.35; }
      if (f.y < -20) {   // in the car park
        const gx = x - garage.at.x, gz = z - garage.at.z;
        if (Math.abs(gx) > 29.4 || Math.abs(gz) > 19.4) return true;
        for (const [px, pz] of garage.pillars) if (Math.abs(gx - px) < 0.75 && Math.abs(gz - pz) < 0.75) return true;
        for (const [px, pz] of garage.parked) if (Math.abs(gx - px) < 1.1 && Math.abs(gz - pz) < 2.5) return true;
        return false;
      }
      for (const wl of world.wallGrid.query(x, z)) { const s = L.nearestOnSegment(x, z, wl.ax, wl.az, wl.bx, wl.bz); if (s.d < 0.4) return true; }
      return false;
    }
    function footStep(dt, K) {
      const f = story.foot, p = persons[f.id];
      let mx = (K.has('d') || K.has('arrowright') ? 1 : 0) - (K.has('a') || K.has('arrowleft') ? 1 : 0);
      let mz = (K.has('w') || K.has('arrowup') ? 1 : 0) - (K.has('s') || K.has('arrowdown') ? 1 : 0);
      f.crouch = K.has('control') || K.has('c') && false;
      const sprint = K.has('shift') && !f.crouch && f.stamina > 0.05;
      const want = (mx || mz) ? (f.crouch ? 1.3 : sprint ? 6.2 : 1.55) : 0;
      // the midday heat drains stamina faster (part 11)
      const hot = state.hour > 11 && state.hour < 16 && !story.inside && f.y > -20;
      f.stamina = Math.max(0, Math.min(1, f.stamina + (sprint && want ? -(hot ? 0.13 : 0.1) : 0.12) * dt));
      f.speed += (want - f.speed) * Math.min(1, dt * (want > f.speed ? 5 : 9));
      if (mx || mz) {
        const ang = story.camYaw + Math.atan2(mx, mz);
        let dh = ang - f.heading; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
        f.heading += dh * Math.min(1, dt * 10);
      }
      const nx = f.x + Math.sin(f.heading) * f.speed * dt, nz = f.z - Math.cos(f.heading) * f.speed * dt;
      if (!footBlocked(nx, f.z)) f.x = nx; else f.speed *= 0.5;
      if (!footBlocked(f.x, nz)) f.z = nz; else f.speed *= 0.5;
      // ground
      let gy;
      if (story.inside) gy = story.inside.grp.position.y; else if (f.y < -20) gy = garage.y;
      else { const sup = supportAt(f.x, f.z, f.y + 0.5); gy = sup ? sup.y : 0; }
      if (f.y > gy + 0.05) { f.vy -= 9.81 * dt; f.y = Math.max(gy, f.y + f.vy * dt); } else { f.y = gy; f.vy = 0; }
      if (K.has(' ') && f.vy === 0 && !story.inside) f.vy = 4.2;
      p.group.position.set(f.x, f.y, f.z); p.group.rotation.y = -f.heading;
      p.update(dt, f.speed, f.crouch);
      story.chars[f.id].x = f.x; story.chars[f.id].z = f.z;
    }

    // ---- getting in and out of cars
    function myCar() { return cars[story.active]; }
    function enterCar() {
      const f = story.foot, c = myCar();
      persons[f.id].group.visible = false; story.foot = null; story.mode = 'drive'; root.classList.remove('foot');
      car = c.sim; player = c.mesh; lastSupport = null;
      story.chars[story.active].inCar = true;
    }
    function exitCar(side = -1) {
      const c = myCar(), h = c.sim.heading;
      const x = c.sim.x + Math.cos(h) * 1.6 * side, z = c.sim.z + Math.sin(h) * 1.6 * side;
      c.sim.vx = c.sim.vz = c.sim.yawRate = 0;
      story.chars[story.active].inCar = false;
      startFoot(story.active, x, z, c.sim.y, h);
    }

    // ---- switching (part 8): a sky camera that lifts off one character and drops onto the other
    function switchTo(id, instant) {
      const from = story.active;
      if (id === from) return;
      const a = story.mode === 'foot' ? story.foot : cars[from].sim;
      const fromPos = new THREE.Vector3(a.x, (a.y || 0) + 2, a.z);
      if (story.mode === 'foot') { story.chars[from].x = a.x; story.chars[from].z = a.z; story.chars[from].y = a.y; story.chars[from].heading = a.heading; }
      // the character we leave stays where they are, seen standing (or hidden in their car)
      const leave = () => { if (story.mode === 'foot') { const p = persons[from]; p.group.visible = !story.inside; p.update(0.016, 0, false); } story.foot = null; };
      leave();
      story.active = id;
      const ch = story.chars[id];
      const land = () => {
        if (ch.inCar) { car = cars[id].sim; player = cars[id].mesh; lastSupport = null; story.mode = 'drive'; root.classList.remove('foot'); persons[id].group.visible = false; }
        else startFoot(id, ch.x, ch.z, ch.y || 0, ch.heading || 0);
        if (!story.mission) say('', `${S.CHARACTERS[id].name.toUpperCase()} · ${S.activityFor(id, state.hour)}`);
      };
      if (instant) { land(); return; }
      const toPos = new THREE.Vector3(ch.inCar ? cars[id].sim.x : ch.x, 2, ch.inCar ? cars[id].sim.z : ch.z);
      story.fly = { t: 0, from: fromPos, to: toPos, land, dur: 3.2 };
      story.mode = 'fly'; updateTiles(toPos.x, toPos.z);
    }
    function flyCamera(dt) {
      const F = story.fly; F.t += dt; const u = Math.min(1, F.t / F.dur);
      const up = Math.sin(Math.min(1, u * 1.15) * Math.PI) * 650 + 3;
      const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
      const x = F.from.x + (F.to.x - F.from.x) * e, z = F.from.z + (F.to.z - F.from.z) * e;
      camera.position.set(x, up + 4, z + 0.01 + up * 0.15); camera.lookAt(x, 0, z); camera.fov = 60;
      sun.target.position.set(x, 0, z);
      if (u > 0.55 && !F.loaded) { F.loaded = true; updateTiles(F.to.x, F.to.z); }
      if (u >= 1) { story.fly = null; F.land(); }
    }

    // the switch wheel (hold TAB)
    function showWheel(on) {
      const el = $('.who'); el.classList.toggle('on', on);
      if (!on) return;
      const can = S.canSwitch({ ...story, chars: story.chars });
      el.querySelectorAll('div[data-c]').forEach((d) => {
        const id = d.dataset.c; d.classList.toggle('cur', id === story.active);
        d.classList.toggle('no', id !== story.active && !can.ok);
        d.querySelector('span').textContent = id === story.active ? 'NOW' : can.ok ? S.activityFor(id, state.hour) : can.why;
      });
    }
    root.querySelectorAll('.who div[data-c]').forEach((d) => d.addEventListener('click', () => {
      const id = d.dataset.c; showWheel(false);
      if (id !== story.active && S.canSwitch(story).ok) switchTo(id);
    }));

    // ---- the black SUV (part 10.3): the same car model, driven by a simple chase brain
    function makeChaser() {
      const mesh = makePlayerCar(carGeo, '#0d0e10'); mesh.body.scale.set(1.08, 1.2, 1.06); scene.add(mesh.group);
      const sim = new L.Car(); sim.spec = Object.assign({}, sim.spec);
      const h = car.heading, back = 38;
      sim.x = car.x - Math.sin(h) * back; sim.z = car.z + Math.cos(h) * back; sim.y = car.y; sim.heading = h;
      const v = Math.max(8, Math.abs(car.speed)); sim.vx = Math.sin(h) * v; sim.vz = -Math.cos(h) * v;
      mesh.beam.intensity = 40;
      return { sim, mesh, rammed: 0, last: null };
    }
    function chaserStep(dt) {
      const C = story.chaser, s = C.sim;
      const tx = car.x + car.vx * 0.6, tz = car.z + car.vz * 0.6;
      const want = Math.atan2(tx - s.x, -(tz - s.z));
      let dh = want - s.heading; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
      const dist = Math.hypot(car.x - s.x, car.z - s.z);
      // a little rubber band: it never falls hopelessly behind, and it ramps you when close
      const input = { throttle: Math.abs(dh) > 1.2 && s.speed > 12 ? 0.3 : 1, brake: Math.abs(dh) > 1.7 && s.speed > 10 ? 1 : 0, steer: THREE.MathUtils.clamp(dh * 2.2, -1, 1), handbrake: Math.abs(dh) > 1.4 && s.speed > 14 };
      if (story.pursuit.unseen > 3 && dist < 140) input.throttle = 0.6;    // searching, not chasing
      const sub = Math.ceil(dt / (1 / 120)), h2 = dt / sub;
      for (let i = 0; i < sub; i++) {
        s.step(h2, input);
        const sup = supportAt(s.x, s.z, s.y); const gy = sup ? sup.y : 0; s.y += (gy - s.y) * Math.min(1, h2 * 20);
        for (const o of [-1.3, 1.3]) {
          const cx = s.x + Math.sin(s.heading) * o, cz = s.z - Math.cos(s.heading) * o;
          if (s.y < 40) for (const wl of world.wallGrid.query(cx, cz)) { const q = L.nearestOnSegment(cx, cz, wl.ax, wl.az, wl.bx, wl.bz); if (q.d < 1.1 && q.d > 1e-4) s.hit((cx - q.px) / q.d, (cz - q.pz) / q.d, 1.1 - q.d); }
        }
        const dx = car.x - s.x, dz = car.z - s.z, dd = Math.hypot(dx, dz);
        if (dd < 2.9 && dd > 1e-3 && Math.abs(car.y - s.y) < 2) {
          const v = car.hit(dx / dd, dz / dd, (2.9 - dd) / 2); s.hit(-dx / dd, -dz / dd, (2.9 - dd) / 2);
          if (v > 2) { audio.thump(v); state.shake = Math.min(0.5, v / 30); story.damage += v; C.rammed = 1.5; }
        }
      }
      C.rammed = Math.max(0, C.rammed - dt);
      // if it gets stuck far behind, it is placed back on your trail out of sight (the search goes on)
      if (dist > 420 && story.pursuit.unseen < 6) { s.x = car.x - Math.sin(car.heading) * 160; s.z = car.z + Math.cos(car.heading) * 160; s.heading = car.heading; s.vx = car.vx * 0.9; s.vz = car.vz * 0.9; s.y = car.y; }
      const m = C.mesh; m.group.position.set(s.x, s.y, s.z); m.group.rotation.y = -s.heading;
      const sp = s.speed / 0.31 * dt; m.wheels.forEach((w, i) => { w.children.forEach((c) => { c.rotation.z -= sp; }); if (i < 2) w.rotation.y = Math.PI / 2 - s.steer; });
      m.head.emissiveIntensity = 3;
      // can it see you? close, or near and with no building in between and on the same level
      let blocked = Math.abs(car.y - s.y) > 4;
      if (!blocked) for (let k = 1; k < 6 && !blocked; k++) { const x = s.x + (car.x - s.x) * k / 6, z = s.z + (car.z - s.z) * k / 6; for (const wl of world.wallGrid.query(x, z)) { if (L.nearestOnSegment(x, z, wl.ax, wl.az, wl.bx, wl.bz).d < 3) { blocked = true; break; } } }
      return S.chaserSees(dist, blocked);
    }
    function removeChaser() { if (!story.chaser) return; scene.remove(story.chaser.mesh.group); story.chaser = null; }

    // ---- the guard in the car park (part 10.4)
    function makeGuard() {
      const p = P.makePerson({ skin: '#8d5d40', hair: '#141210', shirt: '#1b1c1f', trousers: '#1b1c1f', height: 1.84, torch: true, shoes: '#0d0d0d' });
      scene.add(p.group);
      const at = garage.at;
      return { p, x: at.x + 6, z: at.z, y: garage.y, heading: Math.PI / 2, path: [[6, -3], [6, -16], [18, -16], [18, 3]], i: 0, down: false, alert: 0, pause: 0 };
    }
    function guardStep(dt) {
      const G = story.guard; if (!G) return {};
      if (G.down) { G.p.group.rotation.z = Math.min(Math.PI / 2, G.p.group.rotation.z + dt * 5); G.p.group.position.y = garage.y + 0.15; if (G.p.torch) G.p.torch.intensity = 0; return {}; }
      const tgt = G.path[G.i], tx = garage.at.x + tgt[0], tz = garage.at.z + tgt[1];
      const d = Math.hypot(tx - G.x, tz - G.z);
      let sp = 0;
      if (G.pause > 0) G.pause -= dt;
      else if (d < 0.4) { G.i = (G.i + 1) % G.path.length; G.pause = 1.6; }
      else { const want = Math.atan2(tx - G.x, -(tz - G.z)); let dh = want - G.heading; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI; G.heading += dh * Math.min(1, dt * 4); sp = 1.25; G.x += Math.sin(G.heading) * sp * dt; G.z -= Math.cos(G.heading) * sp * dt; }
      G.p.group.position.set(G.x, G.y, G.z); G.p.group.rotation.y = -G.heading; G.p.update(dt, sp, false);
      const f = story.foot; if (!f || f.id !== 'fatimah') return {};
      const dx = f.x - G.x, dz = f.z - G.z, dist = Math.hypot(dx, dz);
      const facing = Math.sin(G.heading) * dx / (dist || 1) - Math.cos(G.heading) * dz / (dist || 1);
      // seen: in the torch cone (about 35 degrees each side) within 13 m, or heard if running close by
      const inCone = facing > Math.cos(0.62) && dist < (f.crouch ? 8 : 13);
      let cover = false;
      for (const [px, pz] of garage.parked.concat(garage.pillars)) { const cx = garage.at.x + px, cz = garage.at.z + pz; const q = L.nearestOnSegment(cx, cz, G.x, G.z, f.x, f.z); if (q.d < 1 && q.t > 0.05 && q.t < 0.95) { cover = true; break; } }
      const heard = dist < 3.5 && f.speed > 3;
      G.alert = (inCone && !cover) || heard ? G.alert + dt : Math.max(0, G.alert - dt * 0.5);
      const behind = dist < 1.8 && facing < -0.3;
      return { saw: G.alert > 0.9, behind, dist };
    }

    // ---- the mission
    const MS = { line: 0 };
    function startMission() {
      const m = new S.Mission(S.NIGHT_FARE); story.mission = m; MS.line = 0;
      state.hour = S.NIGHT_FARE.startHour; state.timeRuns = false;
      story.active = 'fareej'; story.chars.fareej.inCar = true; story.chars.fatimah.inCar = false;
      car = cars.fareej.sim; player = cars.fareej.mesh;
      car.x = S.PLACES.szrStart.x; car.z = S.PLACES.szrStart.z; car.y = 30; resetCar(false);
      story.damage = 0; story.mode = 'cut'; root.classList.add('cut');
      // Fatimah waits outside her office tower in Business Bay
      const pk = S.PLACES.pickup; Object.assign(story.chars.fatimah, { x: pk.x + 6, z: pk.z, y: 0, heading: 0 });
      persons.fatimah.group.position.set(pk.x + 6, 0, pk.z); persons.fatimah.group.visible = true;
      onStepStart();
    }
    function onStepStart() {
      const m = story.mission, st = m.step; MS.line = 0;
      objective(st.objective);
      root.classList.toggle('cut', !!st.cut);
      if (st.cut) story.mode = 'cut';
      else if (story.mode === 'cut') story.mode = story.foot ? 'foot' : 'drive';
      if (st.id === 'passenger') { persons.fatimah.group.visible = false; story.chars.fatimah.inCar = 'fareej'; story.pickupAt = { x: car.x, z: car.z }; story.fareStart = { x: car.x, z: car.z }; }
      if (st.id === 'chase') { removeChaser(); story.chaser = makeChaser(); story.pursuit = new S.Pursuit(); story.damage = 0; const c = story.chaser.sim; c.vx = car.vx * 1.15; c.vz = car.vz * 1.15; }
      if (st.id === 'tomarina') { removeChaser(); say('', 'LOST HIM'); }
      if (st.id === 'switch') {
        // into the car park under the tower: fade, park, and Fatimah gets out
        fade(true);
        setTimeout(() => {
          garage.grp.visible = true;
          car.x = garage.at.x - 22; car.z = garage.at.z + 4; car.y = garage.y; car.heading = Math.PI / 2; car.vx = car.vz = car.yawRate = 0;
          player.group.position.set(car.x, car.y, car.z); player.group.rotation.y = -car.heading;
          story.guard = story.guard || makeGuard();
          story.chars.fatimah.inCar = false; story.chars.fareej.inCar = true;
          story.active = 'fatimah';
          startFoot('fatimah', car.x - 1.8 * Math.sin(car.heading + Math.PI / 2) * -1, car.z + 2.2, garage.y, Math.PI / 2);
          fade(false);
        }, 600);
      }
      if (st.id === 'apartment') { const r = rooms.fatimah; story.inside = r; r.grp.visible = true; garage.grp.visible = false; if (story.guard) { scene.remove(story.guard.p.group); story.guard = null; }
        persons.fatimah.group.position.set(r.grp.position.x + 2.2, r.grp.position.y, r.grp.position.z - 0.05); persons.fatimah.group.rotation.y = 0; persons.fatimah.setPose('sit'); persons.fatimah.group.visible = true; story.foot = null; }
      if (st.id === 'end') {
        rooms.fatimah.grp.visible = false; story.inside = null; persons.fatimah.setPose('stand');
        story.chars.fatimah.x = S.PLACES.fatimahHome.x; story.chars.fatimah.z = S.PLACES.fatimahHome.z; story.chars.fatimah.y = 0; persons.fatimah.group.visible = false;
        story.active = 'fareej'; garage.grp.visible = false;
        car.x = S.PLACES.marinaGarage.x; car.z = S.PLACES.marinaGarage.z; car.y = 30; resetCar(false); car.vx = car.vz = 0;
      }
    }
    function finishMission() {
      const m = story.mission;
      const km = story.fareStart ? Math.hypot(car.x - story.fareStart.x, car.z - story.fareStart.z) / 1000 : 0;
      const fare = S.fareFor(km); story.chars.fareej.money += fare;
      $('.card h2').textContent = 'NIGHT FARE';
      $('.card .l1').textContent = `Fare: ${fare} AED · Damage: not covered`;
      $('.card .l2').textContent = 'Passenger rating: ★☆☆☆☆';
      $('.card .l3').textContent = '"Two strangers. One ride. The wrong night."';
      $('.card').style.display = 'block';
      story.mission = null; story.unlocked.fatimah = true; objective(''); root.classList.remove('cut');
      story.mode = 'drive'; state.timeRuns = true; story.complete = m;
      setTimeout(() => say('', 'NEW MESSAGE TO FATIMAH · UNKNOWN NUMBER: "We know you took them."'), 2500);
      save();
    }
    $('.card button').addEventListener('click', () => { $('.card').style.display = 'none'; renderer.domElement.focus(); });
    $('.fail button').addEventListener('click', () => {
      $('.fail').style.display = 'none'; const m = story.mission; if (!m) return;
      const id = m.retry();
      if (id === 'chase') { story.damage = 0; car.vx = car.vz = 0; }
      if (id === 'switch') { if (story.guard) { scene.remove(story.guard.p.group); story.guard = null; } story.active = 'fareej'; story.foot = null; persons.fatimah.group.visible = false; }
      if (m.def.id === 'night-fare') onStepStart(); else acts.stepStart(); renderer.domElement.focus();
    });

    function missionStep(dt) {
      const m = story.mission; if (!m || m.failed) return;
      const st = m.step;
      // dialogue lines at their times
      while (st.lines && MS.line < st.lines.length && m.t >= st.lines[MS.line][0]) { const l = st.lines[MS.line++]; say(l[1], l[2]); }
      let seen = true, guard = {};
      if (story.chaser) { seen = chaserStep(dt); story.pursuit.step(dt, seen); }
      if (story.guard) guard = guardStep(dt);
      const ctx = {
        inCar: story.mode === 'drive', car: { x: car.x, z: car.z }, carSpeed: Math.abs(car.speed), active: story.active,
        pursuitLost: story.pursuit && story.pursuit.lost, wrecked: story.damage > 260,
        atLift: story.foot && Math.hypot(story.foot.x - garage.liftPos.x, story.foot.z - garage.liftPos.z) < 2.2,
        guardSaw: !!guard.saw && !(story.guard && story.guard.down),
        distFromPickup: story.pickupAt ? Math.hypot(car.x - story.pickupAt.x, car.z - story.pickupAt.z) : 0,
        ...acts.ctx(),
      };
      if (m.def.id !== 'night-fare') acts.runEvents(dt);
      if (story.guard && !story.guard.down && guard.behind) { story.prompt = 'E  KNOCK HIM OUT'; if (state.keys.has('e')) { story.guard.down = true; audio.thump(20); say('Fatimah', 'Sorry. Not sorry.'); } }
      if (story.chaser && st.id === 'chase') objective(story.pursuit.unseen > 0.5 ? `Lose the black SUV · out of sight ${Math.min(10, story.pursuit.unseen).toFixed(0)} / 10` : 'Lose the black SUV.');
      for (const e of m.update(dt, ctx)) {
        if (e.type === 'stepStart') { if (m.def.id === 'night-fare') onStepStart(); else acts.stepStart(); }
        if (e.type === 'complete') { if (m.def.id === 'night-fare') finishMission(); else acts.finish(); }
        if (e.type === 'fail') { removeChaser(); $('.fail p').textContent = e.why; $('.fail').style.display = 'block'; objective(''); }
      }
    }

    // the mission target on the mini-map and in the world: a tall soft column of light
    const beacon = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 120, 24, 1, true), new THREE.MeshBasicMaterial({ color: '#f0c46c', transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    beacon.visible = false; scene.add(beacon);
    function missionTarget() {
      const m = story.mission;
      if (!m) return acts.A.freeAt || null;
      if (m.failed) return null;
      if (m.step.id === 'switch' || m.step.id === 'sneak') return garage.liftPos;
      if (!m.step.target) return null;
      return acts.placeOf(m.step.target);
    }

    // ---- homes: walk up to your door, press E to go in; inside, E at the door to leave. Going home saves.
    function save() { try { localStorage.setItem('desertheat.save', JSON.stringify({ v: 1, unlocked: story.unlocked, chars: { fareej: { money: story.chars.fareej.money }, fatimah: { money: story.chars.fatimah.money } }, hour: state.hour, done: typeof acts !== 'undefined' ? acts.A.done : story.complete ? ['night-fare'] : [], arms: typeof war !== 'undefined' ? war.toJSON() : null, life: typeof life !== 'undefined' ? life.toJSON() : null })); story.savedAt = performance.now(); } catch { /* storage can be blocked; the game still runs */ } }
    function load() { try { return JSON.parse(localStorage.getItem('desertheat.save') || 'null'); } catch { return null; } }

    function homeStep() {
      const f = story.foot; if (!f || story.mission || city.C.interior) return;
      if (story.inside) {
        const r = story.inside;
        if (Math.hypot(f.x - r.door.x, f.z - r.door.z) < 1.4) { story.prompt = 'E  LEAVE'; if (state.keys.has('e')) { state.keys.delete('e'); fade(true); setTimeout(() => { r.grp.visible = false; story.inside = null; const h = S.PLACES[S.CHARACTERS[f.id].home]; f.x = h.x; f.z = h.z + 2; f.y = 30; f.vy = 0; fade(false); }, 500); } }
        return;
      }
      const home = S.PLACES[S.CHARACTERS[f.id].home];
      if (Math.hypot(f.x - home.x, f.z - home.z) < 4) {
        story.prompt = 'E  GO HOME (SAVES)';
        if (state.keys.has('e')) { state.keys.delete('e'); fade(true); setTimeout(() => { const r = rooms[f.id]; r.grp.visible = true; story.inside = r; f.x = r.door.x; f.z = r.door.z - 0.8; f.y = r.grp.position.y; f.heading = 0; story.camYaw = 0; save(); say('', 'GAME SAVED'); fade(false); }, 500); }
      }
    }

    // ---- one frame of the story layer. Returns true when it has drawn the camera itself.
    function storyFrame(dt, K) {
      story.prompt = '';
      // Road Sense (Fareej, driving) and Focus (Fatimah, on foot): a few seconds of slow time
      const ability = K.has('q') && story.senseCool <= 0 && ((story.active === 'fareej' && story.mode === 'drive') || (story.active === 'fatimah' && story.mode === 'foot'));
      if (ability && story.sense <= 0) story.sense = 3;
      if (story.sense > 0) { story.sense -= dt / 0.4; if (story.sense <= 0) story.senseCool = 8; } else story.senseCool = Math.max(0, story.senseCool - dt);
      $('.sense').style.opacity = story.sense > 0 ? '1' : '0';
      // the other characters, standing where they were left
      for (const id of ['fareej', 'fatimah']) if (id !== story.active && !story.chars[id].inCar && !(story.mission && id === 'fatimah' && story.mission.step.id === 'intro')) {
        const c = story.chars[id], p = persons[id];
        if (!p.group.visible && Math.hypot(c.x - car.x, c.z - car.z) < 600 && !story.inside) { p.group.visible = true; const sup = supportAt(c.x, c.z, 50); p.group.position.set(c.x, sup ? sup.y : 0, c.z); }
        p.update(dt, 0, false);
      }
      // the parked car of whoever is not driving
      for (const id of ['fareej', 'fatimah']) if (cars[id].sim !== car) { const s = cars[id].sim, m = cars[id].mesh; m.group.position.set(s.x, s.y, s.z); m.group.rotation.y = -s.heading; m.beam.intensity = 0; }
      acts.missionCarStep();
      acts.A.freeAt = story.mission ? null : acts.freeRoam();
      if (story.mission) missionStep(dt);
      const tgt = missionTarget();
      beacon.visible = !!tgt && story.mode !== 'cut';
      if (tgt) beacon.position.set(tgt.x, (story.foot && story.foot.y < -20 ? garage.y : 0) + 60, tgt.z);
      if (story.mode === 'foot') {
        footStep(dt, K); homeStep();
        // get in your car (F) when close to it
        const c = myCar().sim, f = story.foot;
        if (f && !story.inside && Math.hypot(c.x - f.x, c.z - f.z) < 3.4 && Math.abs(c.y - f.y) < 2 && !(story.mission && story.mission.step.id === 'switch')) { story.prompt = story.prompt || 'F  GET IN'; if (K.has('f')) { K.delete('f'); enterCar(); } }
      }
      city.frame(dt);
      war.frame(dt);
      life.frame(dt);
      $('.prompt').textContent = story.prompt; $('.prompt').style.display = story.prompt ? 'block' : 'none';
      story.sub.t -= dt; if (story.sub.t <= 0) $('.sub').classList.remove('on');
      return story.mode;
    }

    // camera for on foot, cut-scenes and the switch flight
    function storyCamera(dt) {
      if (story.mode === 'fly') { flyCamera(dt); return true; }
      if (story.mode === 'foot' && story.foot && war.aimCamera(dt)) return true;
      if (story.mode === 'foot' && story.foot) {
        const f = story.foot;
        const dist = story.inside ? 2.6 : f.crouch ? 3.2 : 3.9, hgt = story.inside ? 1.55 : f.crouch ? 1.3 : 1.85;
        const yaw = story.camYaw;
        let want = new THREE.Vector3(f.x - Math.sin(yaw) * dist, f.y + hgt, f.z + Math.cos(yaw) * dist);
        if (story.inside) { const r = story.inside, gp = r.grp.position; want.x = THREE.MathUtils.clamp(want.x, gp.x - r.w / 2 + 0.3, gp.x + r.w / 2 - 0.3); want.z = THREE.MathUtils.clamp(want.z, gp.z - r.d / 2 + 0.3, gp.z + r.d / 2 - 0.3); want.y = Math.min(want.y, gp.y + 2.6); }
        if (f.y < -20) { want.y = Math.min(want.y, garage.y + 3); }
        camPos.lerp(want, Math.min(1, dt * 9)); if (camPos.distanceTo(want) > 30) camPos.copy(want);
        camera.position.copy(camPos); camera.lookAt(f.x + Math.sin(yaw) * 1.2, f.y + 1.45, f.z - Math.cos(yaw) * 1.2);
        camera.fov = 58; sun.target.position.set(f.x, f.y, f.z);
        return true;
      }
      if (story.mode === 'cut' && story.mission && story.mission.def.id !== 'night-fare') { camera.fov = 45; return acts.cutCamera(dt); }
      if (story.mode === 'cut' && story.mission) {
        const m = story.mission, st = m.step, t = m.t;
        if (st.id === 'intro') {
          const pk = S.PLACES.pickup;
          if (t < 3.4) { const p = persons.fatimah.group; p.position.x = pk.x + 6 - t * 1.3; p.rotation.y = Math.PI / 2; persons.fatimah.update(dt, 1.3, false);
            camera.position.set(pk.x - 4, 1.7, pk.z + 7); camera.lookAt(p.position.x, 1.4, p.position.z); }
          else { camera.position.set(car.x + 4.5, car.y + 1.4, car.z + 3); camera.lookAt(car.x, car.y + 1, car.z); }
          updateTiles(t < 3.4 ? pk.x : car.x, t < 3.4 ? pk.z : car.z);
        } else if (st.id === 'apartment') {
          const gp = rooms.fatimah.grp.position;
          camera.position.set(gp.x + 0.6 + t * 0.08, gp.y + 1.5, gp.z + 1.4 - t * 0.06); camera.lookAt(gp.x + 2.2, gp.y + 0.9, gp.z - 0.6);
          persons.fatimah.update(dt, 0, false);
        } else if (st.id === 'end') {
          const a = t * 0.08; camera.position.set(car.x + Math.cos(a) * 7, car.y + 2.2, car.z + Math.sin(a) * 7); camera.lookAt(car.x, car.y + 0.9, car.z);
        }
        camera.fov = 45; return true;
      }
      return false;
    }

    // keys for the story layer
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (k === 'tab') { e.preventDefault(); if (!e.repeat && story.mode !== 'fly' && story.mode !== 'cut') showWheel(!$('.who').classList.contains('on')); }
      if ((k === '1' || k === '2') && $('.who').classList.contains('on')) { const id = k === '1' ? 'fareej' : 'fatimah'; showWheel(false); if (id !== story.active && S.canSwitch(story).ok) switchTo(id); }
      if (k === 'f' && story.mode === 'drive' && Math.abs(car.speed) < 3 && (!story.mission || story.mission.def.id !== 'night-fare')) exitCar();
      if (k === 'n' && !story.mission && story.mode !== 'fly') startMission();
      if (k === 'escape' && story.mode === 'cut' && story.mission) story.mission.t += 30;   // skip the cut-scene
    });
    window.addEventListener('mousemove', (e) => { if (dragging && story.mode === 'foot') story.camYaw += e.movementX * 0.006; });

    // ------------------------------------------------------------------ section 3: the living city

    const CY = window.DesertHeatCity;
    const city = (() => {
      const C = {
        shops: new Map(), shopGroups: new Map(), junctions: [], approach: new Map(), cameras: [], stations: [], gates: [],
        peds: [], parked: [], parkedAt: null, fuel: { fareej: 48, fatimah: 52 }, fines: { fareej: [], fatimah: [] },
        cool: new Map(), interior: null, menuShop: null, moneyShown: -1, moneyT: 0, flash: 0, day: 0, honk: 0,
      };

      // ---- HUD pieces
      root.insertAdjacentHTML('beforeend', `<div class="money"><b></b><span></span></div><div class="fuel"><div></div><span>FUEL</span></div>
        <div class="shopmenu"><h3></h3><p class="sub2"></p><ol></ol><p class="hint2">NUMBER KEYS buy · E leave</p></div><div class="flash"></div><div class="ticket"></div>`);
      const css = document.createElement('style'); css.textContent = `
        .dh .money { position:absolute; right:26px; top:52px; text-align:right; opacity:0; transition:opacity .6s; text-shadow:0 1px 6px rgba(0,0,0,.8); }
        .dh .money b { font-size:26px; font-weight:600; letter-spacing:1px; font-variant-numeric:tabular-nums; } .dh .money span { display:block; font-size:16px; color:var(--gold); }
        .dh .money.on { opacity:1; }
        .dh .fuel { position:absolute; right:28px; bottom:120px; width:150px; } .dh .fuel div { height:3px; background:#d8c08a; width:50%; } .dh .fuel span { display:block; text-align:right; font-size:11px; letter-spacing:3px; color:var(--dim); margin-top:4px; }
        .dh .fuel.low div { background:#d8574a; } .dh.foot .fuel { opacity:0; }
        .dh .shopmenu { position:absolute; left:64px; top:50%; transform:translateY(-50%); width:380px; background:rgba(10,10,10,.82); border-left:3px solid var(--gold); padding:18px 22px; display:none; }
        .dh .shopmenu.on { display:block; } .dh .shopmenu h3 { margin:0; font-size:24px; letter-spacing:3px; font-weight:600; } .dh .shopmenu .sub2 { margin:4px 0 12px; color:var(--dim); font-size:13px; letter-spacing:2px; }
        .dh .shopmenu ol { margin:0; padding-left:22px; font-size:17px; line-height:1.7; } .dh .shopmenu li span { float:right; color:var(--gold); font-variant-numeric:tabular-nums; }
        .dh .shopmenu .hint2 { margin:12px 0 0; font-size:12px; letter-spacing:2px; color:var(--dim); }
        .dh .flash { position:absolute; inset:0; background:#fff; opacity:0; pointer-events:none; }
        .dh .ticket { position:absolute; right:26px; top:110px; width:260px; background:rgba(10,10,10,.78); border-left:3px solid #d8574a; padding:10px 14px; font-size:14px; letter-spacing:1px; display:none; }`;
      root.appendChild(css);

      function money() { return story.chars[story.active].money; }
      function pay(amount, why) {
        const ch = story.chars[story.active]; ch.money = Math.round((ch.money - amount) * 100) / 100;
        $('.money span').textContent = (amount > 0 ? '−' : '+') + ' AED ' + Math.abs(amount).toLocaleString('en') + (why ? ' · ' + why : '');
        C.moneyT = 4;
      }
      function fine(amount, why) {
        C.fines[story.active].push({ amount, why });
        const el = $('.ticket'); el.innerHTML = `<b>FINE · AED ${amount.toLocaleString('en')}</b><br>${why}<br><span style="color:var(--dim)">Pay at any bank branch</span>`; el.style.display = 'block';
        clearTimeout(el._t); el._t = setTimeout(() => { el.style.display = 'none'; }, 5000);
      }

      // ---- shop fronts per building tile
      const signTex = (name, color, lit) => canvasTex(256, (g) => {
        g.canvas.height = 64; g.fillStyle = color; g.fillRect(0, 0, 256, 64);
        g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(0, 54, 256, 10);
        g.fillStyle = '#f6f1e6'; g.font = '600 28px "Avenir Next Condensed","Arial Narrow",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        let fs = 28; while (g.measureText(name.toUpperCase()).width > 236 && fs > 14) { fs -= 2; g.font = `600 ${fs}px "Avenir Next Condensed","Arial Narrow",sans-serif`; }
        g.fillText(name.toUpperCase(), 128, 30);
      }, false);
      // shop windows: a painted inside (shelves, a counter, lights) behind dark glass, lit at night
      const shopInside = canvasTex(256, (g2, S2) => {
        g2.fillStyle = '#3a3630'; g2.fillRect(0, 0, S2, S2);
        g2.fillStyle = '#d9d2c2'; g2.fillRect(0, 0, S2, 14); g2.fillStyle = '#fff6dc'; for (let x = 20; x < S2; x += 64) g2.fillRect(x, 4, 30, 5);
        const r = rnd(5), cols = ['#b5402c', '#2f6fb5', '#e5b33a', '#3e9a52', '#e9e6df', '#7a3fa0', '#d27a2c'];
        for (let x = 6; x < S2; x += 84) { g2.fillStyle = '#8a8378'; g2.fillRect(x, 40, 62, 170); for (let y = 48; y < 200; y += 30) for (let k = 0; k < 6; k++) { g2.fillStyle = cols[Math.floor(r() * cols.length)]; g2.fillRect(x + 4 + k * 10, y, 8, 20); } }
        g2.fillStyle = '#5a5248'; g2.fillRect(0, 214, S2, 42); g2.fillStyle = 'rgba(255,255,255,.08)'; for (let i = 0; i < 6; i++) g2.fillRect(r() * S2, 0, 3, S2);
      });
      const glassMat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, map: shopInside, emissiveMap: shopInside, color: '#9a978f', emissive: '#ffe9c8', emissiveIntensity: 0, roughness: 0.12, metalness: 0.25 });
      const doorMat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, color: '#c8a25a', emissive: '#f0c46c', emissiveIntensity: 0.6 });
      const signGeo = new THREE.PlaneGeometry(1, 1), glassGeo = new THREE.PlaneGeometry(1, 1);
      const signMats = new Map();
      function onTile(k, b) {
        const list = CY.shopsForTile(b, k), g = new THREE.Group();
        if (!list.length) { C.shopGroups.set(k, { g, ids: [] }); return; }
        // one sign atlas, one glass mesh and one door mesh per tile (keeps the draw calls low)
        const cols = 4, rows = Math.ceil(list.length / cols), cw = 256, chh = 48;
        const cv = document.createElement('canvas'); cv.width = cw * cols; cv.height = Math.min(4096, chh * rows); const cg = cv.getContext('2d');
        const pos = [], uv = [], idx = [], gpos = [], gidx = [], guv = [], dpos = [], didx = [];
        const quad = (P, I, s, w, h, y0, out) => {
          const ex = s.dx * w / 2, ez = s.dz * w / 2, ox = s.x + s.nx * out, oz = s.z + s.nz * out, b0 = P.length / 3;
          P.push(ox - ex, y0, oz - ez, ox + ex, y0, oz + ez, ox + ex, y0 + h, oz + ez, ox - ex, y0 + h, oz - ez);
          I.push(b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 3);
          if (UVS) { const r = w / 4; UVS.push(r, 0, 0, 0, 0, 1, r, 1); }
        };
        let UVS = null;
        list.forEach((s, i) => {
          const cx = (i % cols) * cw, cy = Math.floor(i / cols) * chh;
          cg.fillStyle = CY.SHOP_TYPES[s.type].sign; cg.fillRect(cx, cy, cw, chh); cg.fillStyle = 'rgba(0,0,0,.2)'; cg.fillRect(cx, cy + chh - 6, cw, 6);
          cg.fillStyle = '#f6f1e6'; let fs = 26; cg.font = `600 ${fs}px "Avenir Next Condensed","Arial Narrow",sans-serif`;
          const t = s.name.toUpperCase(); while (cg.measureText(t).width > cw - 20 && fs > 12) { fs -= 2; cg.font = `600 ${fs}px "Avenir Next Condensed","Arial Narrow",sans-serif`; }
          cg.textAlign = 'center'; cg.textBaseline = 'middle'; cg.fillText(t, cx + cw / 2, cy + chh / 2 - 2);
          // sign quad: the text reads left to right when facing the shop, so the start is on the viewer's left
          const sw = Math.min(s.w * 0.7, 7), sh = sw * chh / cw;
          const b0 = pos.length / 3, ex = -s.dx * sw / 2, ez = -s.dz * sw / 2, ox = s.x + s.nx * 0.12, oz = s.z + s.nz * 0.12, y0 = 3.2;
          pos.push(ox + ex, y0, oz + ez, ox - ex, y0, oz - ez, ox - ex, y0 + sh, oz - ez, ox + ex, y0 + sh, oz + ez);
          const u0 = cx / cv.width, u1 = (cx + cw) / cv.width, v0 = 1 - (cy + chh) / cv.height, v1 = 1 - cy / cv.height;
          uv.push(u0, v0, u1, v0, u1, v1, u0, v1); idx.push(b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 3);
          UVS = guv; quad(gpos, gidx, s, s.w, 2.6, 0.1, 0.08); UVS = null;
          if (s.enterable) quad(dpos, didx, { ...s, dx: s.dx, dz: s.dz }, 1.3, 2.3, 0.02, 0.14);
          C.shops.set(s.id, s);
        });
        const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
        const mk = (P, I, m, U2) => { const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); if (U2) geo.setAttribute('uv', new THREE.Float32BufferAttribute(U2, 2)); geo.setIndex(I); geo.computeVertexNormals(); const o = new THREE.Mesh(geo, m); g.add(o); return o; };
        const sm = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: 0, roughness: 0.6, side: THREE.DoubleSide });
        signMats.set(k, sm);
        mk(pos, idx, sm, uv);
        mk(gpos, gidx, glassMat, guv);
        if (dpos.length) mk(dpos, didx, doorMat);
        scene.add(g); C.shopGroups.set(k, { g, ids: list.map((s) => s.id) });
      }
      function offTile(k) { const t = C.shopGroups.get(k); if (!t) return; scene.remove(t.g); t.g.traverse((o) => { if (o.geometry && o.geometry !== signGeo && o.geometry !== glassGeo) o.geometry.dispose(); }); for (const id of t.ids) C.shops.delete(id); const sm = signMats.get(k); if (sm) { sm.map.dispose(); sm.dispose(); signMats.delete(k); } C.shopGroups.delete(k); }

      // ---- junction signals, speed cameras, petrol stations and toll gates: placed once from the road data
      function placeAll() {
        for (const [key, ends] of world.nodes) {
          const usable = ends.filter((e) => { const r = world.roads[e.r]; return r.k >= 1 && r.k <= 4 && !r.b && !r.t; });
          if (usable.length < 3) continue;
          const [x, z] = key.split(':').map(Number);
          const j = { x, z, offset: CY.hash(x, z) * CY.CYCLE, approaches: [] };
          for (const e of usable) {
            const r = world.roads[e.r], p = r.p, n = p.length / 2;
            // heading of travel INTO the node along this road
            const [ax, az, bx, bz] = e.end === 1 ? [p[n * 2 - 4], p[n * 2 - 3], p[n * 2 - 2], p[n * 2 - 1]] : [p[2], p[3], p[0], p[1]];
            if (e.end === 0 && r.o) continue;           // one-way roads only leave from their start
            const hd = Math.atan2(bx - ax, -(bz - az));
            j.approaches.push({ r: e.r, end: e.end, hd, ax, az });
          }
          if (!j.approaches.length) continue;
          const axis = j.approaches[0].hd;
          for (const a of j.approaches) { a.phase = CY.phaseOf(a.hd, axis); C.approach.set(a.r + ':' + a.end, { j, phase: a.phase }); }
          C.junctions.push(j);
        }
        world.roads.forEach((r, i) => {
          if (r.k <= 2 && r.len > 600 && !r.t) for (const s of CY.camerasAlong(r.len, i)) { const q = L.pointAt(r.p, r.cum, s); C.cameras.push({ r: i, x: q.x - q.dz * (r.w / 2 + 1.5), z: q.z + q.dx * (r.w / 2 + 1.5), hd: Math.atan2(q.dx, -q.dz), y: heightAlong(r, s), limit: r.s || 80, rx: q.x, rz: q.z }); }
          if (r.k >= 1 && r.k <= 3 && r.len > 1200 && !r.b && !r.t && CY.hash(i, 3) < 0.35) {
            const s = r.len * (0.3 + CY.hash(i, 5) * 0.4), q = L.pointAt(r.p, r.cum, s), off = r.w / 2 + 14;
            C.stations.push({ x: q.x - q.dz * off, z: q.z + q.dx * off, hd: Math.atan2(q.dx, -q.dz), brand: CY.FUEL_BRANDS[i % CY.FUEL_BRANDS.length], built: null });
          }
        });
        for (const gt of CY.SALIK) {
          let best = null, bd = 80;
          for (const it of world.roadGrid.query(gt.x, gt.z)) { const r = world.roads[it.r]; if (r.k > 1) continue; const p = r.p, k = it.k; const s = L.nearestOnSegment(gt.x, gt.z, p[k * 2], p[k * 2 + 1], p[k * 2 + 2], p[k * 2 + 3]); if (s.d < bd) { bd = s.d; best = { r, s, k }; } }
          if (!best) { C.gates.push({ ...gt, hd: 0, span: 40, y: 0 }); continue; }
          const p = best.r.p, k = best.k, hd = Math.atan2(p[k * 2 + 2] - p[k * 2], -(p[k * 2 + 3] - p[k * 2 + 1]));
          C.gates.push({ ...gt, x: best.s.px, z: best.s.pz, hd, span: best.r.w * 2 + 14, y: best.r.h[k] });
        }
        buildGates();
      }
      const steel = new THREE.MeshStandardMaterial({ color: '#9aa0a6', metalness: 0.7, roughness: 0.4 });
      function buildGates() {
        for (const gt of C.gates) {
          const g = new THREE.Group(); g.position.set(gt.x, gt.y, gt.z); g.rotation.y = -gt.hd;
          for (const sx of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.6, 8, 0.6), steel); p.position.set(sx * gt.span / 2, 4, 0); g.add(p); }
          const beam = new THREE.Mesh(new THREE.BoxGeometry(gt.span, 1.2, 1.4), steel); beam.position.y = 7.6; g.add(beam);
          const sign = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.1), new THREE.MeshStandardMaterial({ map: canvasTex(256, (c) => { c.canvas.height = 48; c.fillStyle = '#1d4f8f'; c.fillRect(0, 0, 256, 48); c.fillStyle = '#fff'; c.font = '600 26px "Avenir Next Condensed",sans-serif'; c.textAlign = 'center'; c.fillText('SALIK  ·  سالك', 128, 33); }, false), emissive: '#ffffff', emissiveIntensity: 0.15 }));
          sign.position.set(0, 7.6, 0.72); sign.rotation.y = Math.PI; g.add(sign);
          for (let x = -gt.span / 2 + 3; x < gt.span / 2 - 2; x += 3.6) { const cam = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.5), steel); cam.position.set(x, 6.8, 0); g.add(cam); }
          scene.add(g); gt.mesh = g;
        }
      }

      // ---- pools drawn near the player: signal heads, cameras, parked cars, people
      const N_SIG = 160, N_CAM = 24, N_PARK = 90, N_PED = 70;
      const sigPole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.11, 4.4, 8), steel, N_SIG);
      const sigBox = new THREE.InstancedMesh(new THREE.BoxGeometry(0.42, 1.25, 0.32), new THREE.MeshStandardMaterial({ color: '#202224', roughness: 0.6 }), N_SIG);
      const lampG = new THREE.CircleGeometry(0.12, 12);
      const sigLamp = new THREE.InstancedMesh(lampG, new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), N_SIG * 3);
      const camPole = new THREE.InstancedMesh(new THREE.BoxGeometry(0.25, 5, 0.25), steel, N_CAM);
      const camBox = new THREE.InstancedMesh(new THREE.BoxGeometry(0.6, 0.5, 0.9), new THREE.MeshStandardMaterial({ color: '#d9d6cf', roughness: 0.5 }), N_CAM);
      const parkMat = new THREE.MeshPhysicalMaterial({ metalness: 0.5, roughness: 0.42, clearcoat: 0.5 });
      const parkBody = new THREE.InstancedMesh(carGeo.bodyG, parkMat, N_PARK), parkRoof = new THREE.InstancedMesh(carGeo.roofG, parkMat, N_PARK), parkGlass = new THREE.InstancedMesh(carGeo.glassG, new THREE.MeshStandardMaterial({ color: '#0d1216', metalness: 0.3, roughness: 0.08 }), N_PARK);
      const parkWheel = new THREE.InstancedMesh(carGeo.wheelG, new THREE.MeshStandardMaterial({ color: '#151515', roughness: 0.9 }), N_PARK * 4);
      const pedTorso = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.19, 0.42, 3, 8), new THREE.MeshStandardMaterial({ roughness: 0.85 }), N_PED);
      const pedHead = new THREE.InstancedMesh(new THREE.SphereGeometry(0.11, 10, 8), new THREE.MeshStandardMaterial({ roughness: 0.7 }), N_PED);
      const pedLeg = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.075, 0.68, 3, 6), new THREE.MeshStandardMaterial({ roughness: 0.9 }), N_PED * 2);
      for (const m of [sigPole, sigBox, sigLamp, camPole, camBox, parkBody, parkRoof, parkGlass, parkWheel, pedTorso, pedHead, pedLeg]) { m.count = 0; m.frustumCulled = false; m.castShadow = m !== sigLamp; scene.add(m); }
      const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), E2 = new THREE.Euler(), V = new THREE.Vector3(), ONE = new THREE.Vector3(1, 1, 1), COL = new THREE.Color();
      const LIGHT = { red: ['#ff2a1a', '#2a0a08', '#082a10'], amber: ['#2a0a08', '#ffb21a', '#082a10'], green: ['#2a0a08', '#2a1e08', '#22ff6a'] };
      function drawSignals(t) {
        let n = 0, l = 0;
        for (const j of C.junctions) {
          if (Math.abs(j.x - car.x) > 320 || Math.abs(j.z - car.z) > 320) continue;
          for (const a of j.approaches) {
            if (n >= N_SIG) break;
            const r = world.roads[a.r];
            // the pole stands on the near-side kerb before the junction, facing the oncoming driver
            const dx = Math.sin(a.hd), dz = -Math.cos(a.hd), side = r.o ? r.w / 2 + 1.2 : r.w / 2 + 1.2;
            const x = j.x - dx * 6 - dz * side, z = j.z - dz * 6 + dx * side;
            E2.set(0, -a.hd + Math.PI, 0); Q.setFromEuler(E2);
            M4.compose(V.set(x, 2.2, z), Q, ONE); sigPole.setMatrixAt(n, M4);
            M4.compose(V.set(x, 3.9, z), Q, ONE); sigBox.setMatrixAt(n, M4);
            const st = CY.signal(a.phase, t, j.offset), cols = LIGHT[st];
            for (let i = 0; i < 3; i++) { M4.compose(V.set(x - dx * 0.17, 4.3 - i * 0.38, z - dz * 0.17), Q, ONE); sigLamp.setMatrixAt(l, M4); sigLamp.setColorAt(l, COL.set(cols[i])); l++; }
            n++;
          }
        }
        sigPole.count = sigBox.count = n; sigLamp.count = l;
        for (const m of [sigPole, sigBox, sigLamp]) m.instanceMatrix.needsUpdate = true;
        if (sigLamp.instanceColor) sigLamp.instanceColor.needsUpdate = true;
        let c = 0;
        for (const k of C.cameras) {
          if (c >= N_CAM || Math.abs(k.x - car.x) > 500 || Math.abs(k.z - car.z) > 500) continue;
          E2.set(0, -k.hd, 0); Q.setFromEuler(E2);
          M4.compose(V.set(k.x, k.y + 2.5, k.z), Q, ONE); camPole.setMatrixAt(c, M4);
          M4.compose(V.set(k.x, k.y + 5.1, k.z), Q, ONE); camBox.setMatrixAt(c, M4); c++;
        }
        camPole.count = camBox.count = c; camPole.instanceMatrix.needsUpdate = camBox.instanceMatrix.needsUpdate = true;
      }

      // traffic: how fast may this car go, given the light ahead?
      function signalLimit(tc) {
        const end = tc.dir > 0 ? 1 : 0, a = C.approach.get(tc.r + ':' + end);
        if (!a) return 99;
        const r = world.roads[tc.r], left = tc.dir > 0 ? r.len - tc.s : tc.s;
        if (left > 45) return 99;
        const st = CY.signal(a.phase, U.uTime.value, a.j.offset);
        if (st === 'green' || (st === 'amber' && left < 12)) return 99;
        const stopAt = left - 7;                         // stop line a few metres before the junction
        return stopAt <= 0.5 ? 0 : Math.max(0, Math.sqrt(2 * 4.5 * stopAt));
      }
      function trafficTarget() { return Math.round(traffic.max * CY.trafficDensity(state.hour)); }

      // ---- parked cars along the kerbs of ordinary streets near the player
      function refreshParked() {
        C.parked = [];
        for (const it of world.roadGrid.queryRadius ? [] : []) void it;
        const seen = new Set();
        for (let gx = -5; gx <= 5; gx++) for (let gz = -5; gz <= 5; gz++) for (const it of world.roadGrid.query(car.x + gx * 40, car.z + gz * 40)) {
          if (seen.has(it.r + ':' + it.k)) continue; seen.add(it.r + ':' + it.k);
          const r = world.roads[it.r]; if (r.k < 3 || r.k > 4 || r.b || r.t) continue;
          const p = r.p, k = it.k, ax = p[k * 2], az = p[k * 2 + 1], bx = p[k * 2 + 2], bz = p[k * 2 + 3], len = Math.hypot(bx - ax, bz - az);
          if (len < 12) continue;
          const dx = (bx - ax) / len, dz = (bz - az) / len, hd = Math.atan2(dx, -dz);
          for (let s = 6; s < len - 6; s += 5.6) {
            for (const side of [-1, 1]) {
              if (r.o && side < 0) continue;
              if (CY.hash(ax + s, az + side, 11) > 0.42) continue;
              const off = r.w / 2 - 1.1;
              const x = ax + dx * s - dz * off * side, z = az + dz * s + dx * off * side;
              if (Math.abs(x - car.x) > 210 || Math.abs(z - car.z) > 210) continue;
              if (C.parked.length >= N_PARK) break;
              C.parked.push({ x, z, hd: side > 0 ? hd : hd + Math.PI, col: CAR_COLORS[Math.floor(CY.hash(x, z, 12) * CAR_COLORS.length)] });
            }
          }
        }
        let n = 0, w = 0;
        for (const pc of C.parked) {
          E2.set(0, -pc.hd, 0); Q.setFromEuler(E2); M4.compose(V.set(pc.x, 0.06, pc.z), Q, ONE);
          parkBody.setMatrixAt(n, M4); parkRoof.setMatrixAt(n, M4); parkGlass.setMatrixAt(n, M4);
          parkBody.setColorAt(n, COL.set(pc.col)); parkRoof.setColorAt(n, COL);
          for (const [x, z] of [[-0.83, -1.32], [0.83, -1.32], [-0.83, 1.42], [0.83, 1.42]]) {
            const o = new THREE.Vector3(x, 0.37, z).applyQuaternion(Q);
            const wq = Q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2));
            M4.compose(V.set(pc.x + o.x, o.y, pc.z + o.z), wq, ONE); parkWheel.setMatrixAt(w++, M4);
          }
          n++;
        }
        parkBody.count = parkRoof.count = parkGlass.count = n; parkWheel.count = w;
        for (const m of [parkBody, parkRoof, parkGlass, parkWheel]) m.instanceMatrix.needsUpdate = true;
        if (parkBody.instanceColor) parkBody.instanceColor.needsUpdate = true; if (parkRoof.instanceColor) parkRoof.instanceColor.needsUpdate = true;
        C.parkedAt = { x: car.x, z: car.z };
      }

      // ---- people on the pavements
      const SHIRTS = { default: ['#e9e6df', '#3b3d40', '#7b8a99', '#c8b48e', '#8d2f2f', '#2f4f6f', '#f2f2f2', '#141417'], alquoz: ['#ff7a1a', '#3f6fb0', '#ff7a1a', '#3f6fb0'], businessbay: ['#f2f2f2', '#1d2c44', '#2f3a4c', '#e9e6df'] };
      const SKINS = ['#7a4e34', '#9c6b4a', '#b07c58', '#c99a76', '#5e3b28', '#e0b896'];
      function spawnPed() {
        const a = Math.random() * Math.PI * 2, d = 60 + Math.random() * 110, x = car.x + Math.cos(a) * d, z = car.z + Math.sin(a) * d;
        const its = world.roadGrid.query(x, z).filter((it) => { const r = world.roads[it.r]; return r.k >= 2 && r.k <= 4 && !r.b && !r.t; });
        if (!its.length) return;
        const it = its[0], r = world.roads[it.r], cum = r.cum[it.k] + Math.random() * (r.cum[it.k + 1] - r.cum[it.k]);
        const dist = CY.districtAt(x, z).id, pal = SHIRTS[dist] || SHIRTS.default;
        const robe = Math.random() < 0.18;     // kandura or abaya
        const shirt = robe ? (Math.random() < 0.5 ? '#f4f2ec' : '#121214') : pal[Math.floor(Math.random() * pal.length)];
        C.peds.push({ r: it.r, s: cum, dir: Math.random() < 0.5 ? 1 : -1, side: Math.random() < 0.5 ? -1 : 1, v: 1.1 + Math.random() * 0.5, x, z, hd: 0, phase: Math.random() * 6, shirt, legs: robe ? shirt : ['#2f3a4c', '#3a3a3a', '#6b5b4a', '#1d1d22'][Math.floor(Math.random() * 4)], skin: SKINS[Math.floor(Math.random() * SKINS.length)], flee: 0, down: 0, fx: 0, fz: 0 });
      }
      function updatePeds(dt) {
        const want = Math.round(N_PED * CY.crowdDensity(state.hour, CY.districtAt(car.x, car.z).id));
        let tries = 4; while (C.peds.length < want && tries--) spawnPed();
        const keep = [], drv = story.mode === 'drive', sp = Math.abs(car.speed);
        for (const pd of C.peds) {
          const r = world.roads[pd.r];
          if (pd.down > 0) { pd.down -= dt; if (pd.down > 0) keep.push(pd); continue; }
          if (pd.flee > 0) { pd.flee -= dt; pd.x += pd.fx * 4.5 * dt; pd.z += pd.fz * 4.5 * dt; pd.phase += dt * 12; }
          else {
            pd.s += pd.v * pd.dir * dt; pd.phase += pd.v * dt * 5;
            if (pd.s < 0 || pd.s > r.len) { pd.dir *= -1; pd.s = Math.max(0, Math.min(r.len, pd.s)); }
            const q = L.pointAt(r.p, r.cum, pd.s), off = (r.w / 2 + 2.6) * pd.side;
            pd.x = q.x - q.dz * off; pd.z = q.z + q.dx * off; pd.hd = Math.atan2(q.dx * pd.dir, -q.dz * pd.dir);
          }
          // react to a car coming at them
          const dx = pd.x - car.x, dz = pd.z - car.z, d = Math.hypot(dx, dz);
          if (drv && d < 2.2 && sp > 4) { pd.down = 9; audio.thump(sp); state.shake = 0.2; story.damage += 2; continue; }
          if (drv && d < 9 && sp > 3 && pd.flee <= 0) { const vx = car.vx / sp, vz = car.vz / sp, side = Math.sign(dx * -vz + dz * vx) || 1; pd.fx = -vz * side; pd.fz = vx * side; pd.flee = 1.2; pd.hd = Math.atan2(pd.fx, -pd.fz); }
          if (d > 260) continue;
          keep.push(pd);
        }
        C.peds = keep;
        let n = 0;
        for (const pd of C.peds) {
          if (n >= N_PED) break;
          const down = pd.down > 0;
          E2.set(down ? -Math.PI / 2 : 0, -pd.hd, 0, 'YXZ'); Q.setFromEuler(E2);
          const bob = down ? 0 : Math.abs(Math.sin(pd.phase)) * 0.03;
          const up = new THREE.Vector3(0, 1, 0).applyQuaternion(Q);
          const base = new THREE.Vector3(pd.x, down ? 0.2 : 0, pd.z);
          M4.compose(V.copy(base).addScaledVector(up, 1.22 + bob), Q, ONE); pedTorso.setMatrixAt(n, M4); pedTorso.setColorAt(n, COL.set(pd.shirt));
          M4.compose(V.copy(base).addScaledVector(up, 1.66 + bob), Q, ONE); pedHead.setMatrixAt(n, M4); pedHead.setColorAt(n, COL.set(pd.skin));
          for (let i = 0; i < 2; i++) {
            const sw = down ? 0 : Math.sin(pd.phase + i * Math.PI) * (pd.flee > 0 ? 0.7 : 0.38);
            const lq = Q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), sw));
            const hip = new THREE.Vector3((i ? 0.1 : -0.1), 0.92 + bob, 0).applyQuaternion(Q).add(base);
            const mid = new THREE.Vector3(0, -0.44, 0).applyQuaternion(lq).add(hip);
            M4.compose(mid, lq, ONE); pedLeg.setMatrixAt(n * 2 + i, M4); pedLeg.setColorAt(n * 2 + i, COL.set(pd.legs));
          }
          n++;
        }
        pedTorso.count = pedHead.count = n; pedLeg.count = n * 2;
        for (const m of [pedTorso, pedHead, pedLeg]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
      }

      // ---- petrol stations: canopy, pumps and a brand sign, built when near
      function buildStation(st) {
        const g = new THREE.Group(); g.position.set(st.x, 0, st.z); g.rotation.y = -st.hd;
        const white = new THREE.MeshStandardMaterial({ color: '#efeee9', roughness: 0.5 }), red = new THREE.MeshStandardMaterial({ color: '#b5402c', roughness: 0.5 });
        const slab = new THREE.Mesh(new THREE.BoxGeometry(22, 0.12, 30), new THREE.MeshStandardMaterial({ color: '#7d7b77', roughness: 0.9 })); slab.position.y = 0.06; g.add(slab);
        const roof = new THREE.Mesh(new THREE.BoxGeometry(18, 0.8, 22), white); roof.position.y = 5.6; g.add(roof);
        const band = new THREE.Mesh(new THREE.BoxGeometry(18.1, 0.35, 22.1), red); band.position.y = 5.3; g.add(band);
        const under = new THREE.Mesh(new THREE.PlaneGeometry(17, 21), new THREE.MeshStandardMaterial({ color: '#fff', emissive: '#f4f8ff', emissiveIntensity: 1.2 })); under.rotation.x = Math.PI / 2; under.position.y = 5.19; g.add(under);
        for (const z of [-6, 0, 6]) for (const x of [-4, 4]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.7, 0.5), white); p.position.set(x, 0.85, z); g.add(p); const c = new THREE.Mesh(new THREE.BoxGeometry(0.3, 5.2, 0.3), white); c.position.set(x, 2.6, z + 1.5); g.add(c); }
        const shop = new THREE.Mesh(new THREE.BoxGeometry(14, 4, 7), white); shop.position.set(0, 2, -16); g.add(shop);
        const tex = canvasTex(256, (c) => { c.canvas.height = 64; c.fillStyle = '#b5402c'; c.fillRect(0, 0, 256, 64); c.fillStyle = '#fff'; c.font = '600 30px "Avenir Next Condensed",sans-serif'; c.textAlign = 'center'; c.fillText(st.brand.toUpperCase(), 128, 42); }, false);
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.5), new THREE.MeshStandardMaterial({ map: tex, emissive: '#fff', emissiveMap: tex, emissiveIntensity: 0.4 })); sign.position.set(0, 4.6, -12.45); g.add(sign);
        const totem = new THREE.Mesh(new THREE.BoxGeometry(1.6, 7, 0.5), red); totem.position.set(10, 3.5, 13); g.add(totem);
        const lt = new THREE.PointLight('#f4f8ff', 30, 30, 1.3); lt.position.set(0, 4.8, 0); g.add(lt);
        g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        scene.add(g); st.built = g;
      }

      // ---- shop interiors: one room rebuilt from a kit for each kind of shop
      const shopRoom = (() => {
        const g = new THREE.Group(); g.position.set(0, -120, 0); g.visible = false; scene.add(g);
        return { g, w: 8, d: 10, door: new THREE.Vector3() };
      })();
      function fillShop(s) {
        const g = shopRoom.g; while (g.children.length) { const o = g.children.pop(); o.traverse((m) => { if (m.geometry) m.geometry.dispose(); }); }
        g.position.set(s.x, -120, s.z);
        const W2 = 8, D2 = 10, H = 3.2, T = CY.SHOP_TYPES[s.type];
        const mat = (c, r = 0.8, e = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: r, ...e });
        const box = (w, h, d, m, x, y, z) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; g.add(o); return o; };
        const floorC = { gold: '#e8dcc0', bank: '#d6d2ca', gym: '#2a2a2a', cafeteria: '#9a8e7c' }[s.type] || '#cfcac0';
        box(W2, 0.1, D2, mat(floorC, 0.4), 0, -0.05, 0); box(W2, 0.1, D2, mat('#f2f0ea'), 0, H, 0);
        const wall = mat('#ebe7de', 0.95, { side: THREE.DoubleSide });
        box(0.1, H, D2, wall, -W2 / 2, H / 2, 0); box(0.1, H, D2, wall, W2 / 2, H / 2, 0); box(W2, H, 0.1, wall, 0, H / 2, -D2 / 2);
        box(W2 / 2 - 0.8, H, 0.1, wall, -W2 / 4 - 0.4, H / 2, D2 / 2); box(W2 / 2 - 0.8, H, 0.1, wall, W2 / 4 + 0.4, H / 2, D2 / 2);
        const glassDoor = box(1.6, 2.4, 0.05, mat('#9fb6c2', 0.1, { transparent: true, opacity: 0.35 }), 0, 1.2, D2 / 2);
        // strip lights
        for (const z of [-3, 0, 3]) box(2.6, 0.05, 0.2, mat('#fff', 0.5, { emissive: '#fffaf0', emissiveIntensity: 2 }), 0, H - 0.04, z);
        const light = new THREE.PointLight('#fff6e8', 14, 16, 1.2); light.position.set(0, H - 0.3, 0); g.add(light);
        // counter and till
        const counterM = mat(T.sign, 0.6);
        box(3.2, 1.0, 0.7, counterM, -1.6, 0.5, -3.2); box(0.4, 0.25, 0.3, mat('#222', 0.4), -1, 1.12, -3.2);
        // shelves / fridges / tables by type
        const prodCols = ['#c43d2f', '#2f6fb5', '#e5b33a', '#3e9a52', '#f2f2f2', '#7a3fa0'];
        const shelf = (x, z, rot) => { const sh = box(0.5, 2, 3, mat('#d8d4cc', 0.6), x, 1, z); sh.rotation.y = rot || 0; for (let lv = 0; lv < 4; lv++) for (let i = 0; i < 7; i++) box(0.25, 0.22, 0.3, mat(prodCols[(i + lv * 3 + Math.floor(x)) % prodCols.length], 0.6), x + (x < 0 ? 0.13 : -0.13), 0.3 + lv * 0.45, z - 1.2 + i * 0.4); };
        if (s.type === 'grocery' || s.type === 'pharmacy' || s.type === 'phone' || s.type === 'laundry') { shelf(-3.6, 1, 0); shelf(3.6, 1, 0); shelf(0.4, 1.5, 0); if (s.type === 'grocery') box(1.6, 2, 0.6, mat('#e8eef2', 0.2, { emissive: '#dff2ff', emissiveIntensity: 0.4 }), 2.6, 1, -4.6); }
        if (s.type === 'cafeteria') for (const [x, z] of [[-2, 1], [2, 1], [-2, 3.5], [2, 3.5]]) { box(1.1, 0.05, 1.1, mat('#e6e2da', 0.4), x, 0.75, z); box(0.08, 0.75, 0.08, mat('#888', 0.4), x, 0.37, z); for (const sx of [-0.7, 0.7]) box(0.42, 0.45, 0.42, mat('#b5402c', 0.6), x + sx, 0.23, z); }
        if (s.type === 'clothing') for (let i = 0; i < 4; i++) { box(0.05, 1.6, 2.4, mat('#888', 0.3), -3.4 + i * 2.2, 0.8, 1.5); for (let k = 0; k < 6; k++) box(0.5, 0.8, 0.06, mat(prodCols[(k + i) % prodCols.length], 0.9), -3.4 + i * 2.2, 1.0, 0.5 + k * 0.38); }
        if (s.type === 'gold') for (const x of [-2.4, 0, 2.4]) { box(1.8, 0.9, 0.7, mat('#3a2a1a', 0.5), x, 0.45, 0); box(1.7, 0.3, 0.6, mat('#d4b45a', 0.2, { metalness: 1, emissive: '#5a4210', emissiveIntensity: 0.4 }), x, 1.0, 0); }
        if (s.type === 'barber') for (const x of [-2.4, 0, 2.4]) { box(0.7, 1.1, 0.7, mat('#222', 0.4), x, 0.55, -1); box(1.2, 1.2, 0.04, mat('#cfe0ea', 0.05, { metalness: 0.9 }), x, 1.6, -4.9); }
        if (s.type === 'gym') for (const x of [-2.5, 0, 2.5]) { box(1.6, 0.1, 0.6, mat('#555', 0.5), x, 0.5, 1); box(0.06, 0.06, 1.8, mat('#aaa', 0.2, { metalness: 0.9 }), x, 1.1, 1); }
        if (s.type === 'guns') { for (let i = 0; i < 6; i++) { box(1.1, 0.06, 0.08, mat('#1b1c1e', 0.4, { metalness: 0.6 }), -2.8 + (i % 3) * 1.4, 1.4 + Math.floor(i / 3) * 0.5, -4.85); } box(7.8, 2.4, 0.1, mat('#5a5f4a', 0.9), 0, 1.2, -4.95); box(1.2, 1.6, 0.05, mat('#e9e6df', 0.8), 2.6, 1.2, 4.0).visible = false; }
        if (s.type === 'bank') { box(6, 1.1, 0.6, mat('#1f3b5c', 0.5), 0, 0.55, -2.6); box(6, 0.8, 0.04, mat('#9fb6c2', 0.1, { transparent: true, opacity: 0.4 }), 0, 1.5, -2.6); }
        // the person behind the counter
        const clerk = P.makePerson({ skin: SKINS[Math.floor(CY.hash(s.x, s.z, 9) * SKINS.length)], hair: '#151210', shirt: T.sign, trousers: '#222', height: 1.72, beard: CY.hash(s.x, s.z, 8) < 0.5 });
        clerk.group.position.set(-1.6, 0, -4); g.add(clerk.group);
        shopRoom.clerk = clerk;
        shopRoom.door.set(s.x, -120, s.z + D2 / 2 - 0.7);
        g.visible = true;
      }
      function openMenu(s) {
        const items = CY.MENUS[s.type] || [];
        $('.shopmenu h3').textContent = s.name.toUpperCase();
        const ch = story.chars[story.active];
        $('.shopmenu .sub2').textContent = `${CY.SHOP_TYPES[s.type].label.toUpperCase()} · YOU HAVE AED ${Math.round(ch.money).toLocaleString('en')}` + (s.type === 'gold' ? ` · GOLD ${ch.gold || 0} g · AED ${CY.goldPrice(C.day)}/g` : '') + (s.type === 'bank' ? ` · FINES AED ${C.fines[story.active].reduce((a, f) => a + f.amount, 0).toLocaleString('en')}` : '');
        $('.shopmenu ol').innerHTML = items.map(([n, price]) => `<li>${n}<span>${typeof price === 'number' ? 'AED ' + price : price === 'ammo' ? 'AED ' + war.ammoPrice() : price === 'gold10' ? 'AED ' + CY.goldPrice(C.day) * 10 : price === 'sell10' ? '+AED ' + CY.goldPrice(C.day) * 10 : 'AED ' + C.fines[story.active].reduce((a, f) => a + f.amount, 0)}</span></li>`).join('');
        $('.shopmenu').classList.add('on'); C.menuShop = s;
      }
      function buy(i) {
        const s = C.menuShop; if (!s) return;
        const it = (CY.MENUS[s.type] || [])[i]; if (!it) return;
        const ch = story.chars[story.active], [name, price, eff] = it;
        let cost = typeof price === 'number' ? price : price === 'ammo' ? war.ammoPrice() : price === 'gold10' ? CY.goldPrice(C.day) * 10 : price === 'sell10' ? -CY.goldPrice(C.day) * 10 : C.fines[story.active].reduce((a, f) => a + f.amount, 0);
        if (price === 'sell10' && (ch.gold || 0) < 10) { say('', 'YOU HAVE NO GOLD TO SELL'); return; }
        if (cost > ch.money) { say('', 'NOT ENOUGH MONEY'); return; }
        if (cost === 0 && eff.payFines) { say('', 'NO FINES TO PAY'); return; }
        pay(cost, name);
        if (eff.health) ch.health = Math.min(100, ch.health + eff.health);
        if (eff.stamina && story.foot) story.foot.stamina = Math.min(1, story.foot.stamina + eff.stamina);
        if (eff.gold) ch.gold = (ch.gold || 0) + eff.gold;
        if (eff.payFines) C.fines[story.active] = [];
        if (eff.staminaSkill) ch.staminaSkill = Math.min(0.5, (ch.staminaSkill || 0) + eff.staminaSkill);
        if (eff.scratch) say('', Math.random() < 0.3 ? 'SCRATCH CARD: A FREE DRINK!' : 'SCRATCH CARD: NOTHING THIS TIME');
        if (eff.weapon || eff.ammo || eff.armour) war.shopEffect(eff);
        if (eff.shirt) { ch.shirt = eff.shirt; recolour(story.active, eff.shirt); }
        openMenu(s); save();
      }
      function recolour(id, shirt) { persons[id].group.traverse((o) => { if (o.isMesh && o.material && o.material.color && o.material.color.getHexString() === new THREE.Color(S.CHARACTERS[id].shirt).getHexString()) o.material.color.set(shirt); }); S.CHARACTERS[id].shirt = shirt; }
      window.addEventListener('keydown', (e) => { if (C.menuShop && /^[1-9]$/.test(e.key)) buy(Number(e.key) - 1); if (e.key.toLowerCase() === 'h' && story.mode === 'drive') C.honk = 0.5; });

      function shopStep() {
        const f = story.foot; if (!f || story.mission) return;
        if (C.interior) {
          const s = C.interior; shopRoom.clerk.update(0.016, 0, false);
          const nearCounter = Math.hypot(f.x - (s.x - 1.6), f.z - (s.z - 2.4)) < 2.2;
          if (nearCounter && !C.menuShop) { story.prompt = 'E  TALK TO THE COUNTER'; if (state.keys.has('e')) { state.keys.delete('e'); openMenu(s); } }
          if (!nearCounter && C.menuShop) { $('.shopmenu').classList.remove('on'); C.menuShop = null; }
          if (Math.hypot(f.x - shopRoom.door.x, f.z - shopRoom.door.z) < 1.3) {
            story.prompt = 'E  LEAVE'; if (state.keys.has('e')) { state.keys.delete('e'); fade(true); setTimeout(() => { shopRoom.g.visible = false; C.interior = null; story.inside = null; f.x = s.x + s.nx * 2.2; f.z = s.z + s.nz * 2.2; f.y = 0; f.heading = Math.atan2(s.nx, -s.nz); story.camYaw = f.heading; $('.shopmenu').classList.remove('on'); C.menuShop = null; fade(false); }, 450); }
          }
          return;
        }
        let best = null, bd = 2.6;
        for (const s of C.shops.values()) { if (!s.enterable) continue; const d = Math.hypot(f.x - s.x, f.z - s.z); if (d < bd) { bd = d; best = s; } }
        if (best && !story.prompt) {
          story.prompt = `E  ENTER ${best.name.toUpperCase()}`;
          if (state.keys.has('e')) { state.keys.delete('e'); fade(true); setTimeout(() => { fillShop(best); C.interior = best; story.inside = { grp: shopRoom.g, w: 8, d: 10, door: shopRoom.door }; f.x = shopRoom.door.x; f.z = shopRoom.door.z - 0.6; f.y = -120; f.heading = 0; story.camYaw = 0; fade(false); }, 450); }
        }
      }

      // ---- per frame
      let sigT = 0, parkT = 0;
      function frame(dt) {
        const t = U.uTime.value, ch = story.chars[story.active];
        C.day = Math.floor((performance.now() / 1000) / (48 * 60)) + 323;
        sigT -= dt; if (sigT <= 0) { sigT = 0.2; drawSignals(t); }
        parkT -= dt; if (parkT <= 0) { parkT = 1; if (!C.parkedAt || Math.hypot(car.x - C.parkedAt.x, car.z - C.parkedAt.z) > 50) refreshParked(); }
        if (!story.inside) updatePeds(dt);
        // stations: build the near ones, refuel when stopped at the pumps
        for (const st of C.stations) {
          const d = Math.hypot(st.x - car.x, st.z - car.z);
          if (d < 700 && !st.built) buildStation(st);
          if (d > 900 && st.built) { scene.remove(st.built); st.built.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); st.built = null; }
          if (d < 11 && story.mode === 'drive' && Math.abs(car.speed) < 1) {
            const cost = CY.fillCost(C.fuel[story.active]);
            if (cost > 1) { story.prompt = `E  FILL UP · AED ${cost.toFixed(2)}`; if (state.keys.has('e')) { state.keys.delete('e'); if (cost <= ch.money) { pay(cost, st.brand); C.fuel[story.active] = CY.FUEL.tank; } else say('', 'NOT ENOUGH MONEY'); } }
          }
        }
        // fuel
        if (story.mode === 'drive') {
          const metres = Math.abs(car.speed) * dt;
          C.fuel[story.active] = CY.burn(C.fuel[story.active], metres, Math.min(1, car.rpm / car.spec.redline), dt);
        }
        const fl = C.fuel[story.active] / CY.FUEL.tank; $('.fuel div').style.width = (fl * 100) + '%'; $('.fuel').classList.toggle('low', fl < 0.12);
        // Salik, cameras and red lights
        if (story.mode === 'drive' && !story.mission) {
          const sp = Math.abs(car.speed) * 3.6;
          for (const gt of C.gates) if (Math.hypot(gt.x - car.x, gt.z - car.z) < Math.max(14, gt.span / 2) && sp > 15 && !(C.cool.get(gt) > t)) { C.cool.set(gt, t + 40); const fee = CY.salikFee(state.hour); if (fee) pay(fee, 'SALIK ' + gt.name.toUpperCase()); }
          for (const k of C.cameras) {
            if (Math.abs(k.rx - car.x) > 30 || Math.abs(k.rz - car.z) > 30 || C.cool.get(k) > t) continue;
            if (Math.hypot(k.rx - car.x, k.rz - car.z) < 18) { const amt = CY.speedFine(sp, k.limit); if (amt) { C.cool.set(k, t + 15); C.flash = 0.25; fine(amt, `${Math.round(sp)} km/h in a ${k.limit} zone`); } }
          }
          for (const j of C.junctions) {
            if (Math.abs(j.x - car.x) > 9 || Math.abs(j.z - car.z) > 9 || C.cool.get(j) > t || sp < 18) continue;
            const hd = Math.atan2(car.vx, -car.vz); let a = null, bd = 0.6;
            for (const ap of j.approaches) { let dh = Math.abs(((hd - ap.hd) + Math.PI * 3) % (Math.PI * 2) - Math.PI); if (dh < bd) { bd = dh; a = ap; } }
            if (a && CY.signal(a.phase, t, j.offset) === 'red') { C.cool.set(j, t + 20); C.flash = 0.25; fine(CY.RED_LIGHT_FINE, 'Red light'); }
            else C.cool.set(j, t + 5);
          }
        }
        if (C.flash > 0) { C.flash -= dt; $('.flash').style.opacity = String(Math.max(0, C.flash * 3)); }
        // money display fades in only when it changes
        C.moneyT -= dt;
        $('.money b').textContent = 'AED ' + Math.round(ch.money).toLocaleString('en');
        $('.money').classList.toggle('on', C.moneyT > 0 || state.keys.has('tab'));
        // shop fronts glow at night
        const night = U.uNight.value;
        glassMat.emissiveIntensity = 0.05 + night * 0.75;
        for (const m of signMats.values()) m.emissiveIntensity = night * 0.9;
        if (story.mode === 'foot') shopStep();
      }
      // static obstacles for the player's car: parked cars and the station pumps
      function collide(sim) {
        for (const pc of C.parked) {
          const dx = sim.x - pc.x, dz = sim.z - pc.z, dd = Math.hypot(dx, dz);
          if (dd < 2.5 && dd > 1e-3 && sim.y < 2) { const v = sim.hit(dx / dd, dz / dd, 2.5 - dd); if (v > 3) { audio.thump(v); state.shake = Math.min(0.3, v / 40); story.damage += v * 0.3; } }
        }
      }
      return { C, onTile, offTile, placeAll, signalLimit, trafficTarget, frame, collide, fillShop, fuelEmpty: () => C.fuel[story.active] <= 0 };
    })();

    // ------------------------------------------------------------------ section 4: weapons and the police

    const KB = window.DesertHeatCombat;
    const war = (() => {
      const W = {
        arms: { fareej: new KB.Arsenal(['fists']), fatimah: new KB.Arsenal(['fists']) },
        wanted: { fareej: new KB.Wanted(), fatimah: new KB.Wanted() },
        aim: false, trigger: false, pitch: 0, police: [], officers: [], heli: null, fx: [], grenades: [], spawnT: 0, blockT: 0,
        pullT: 0, bustT: 0, down: null, recoil: 0, siren: null,
      };
      const arms = () => W.arms[story.active], wanted = () => W.wanted[story.active];

      root.insertAdjacentHTML('beforeend', `<div class="xhair"></div><div class="stars"></div><div class="weap"><b></b><span></span></div>
        <div class="vitals"><i class="hp"></i><i class="ar"></i></div><div class="bigtext"></div>`);
      const css = document.createElement('style'); css.textContent = `
        .dh .xhair { position:absolute; left:50%; top:45%; width:22px; height:22px; margin:-11px 0 0 -11px; display:none; pointer-events:none; }
        .dh .xhair::before, .dh .xhair::after { content:''; position:absolute; background:rgba(255,255,255,.85); box-shadow:0 0 2px #000; }
        .dh .xhair::before { left:10px; top:0; width:2px; height:22px; } .dh .xhair::after { top:10px; left:0; height:2px; width:22px; }
        .dh .xhair.on { display:block; } .dh .xhair.hit::before, .dh .xhair.hit::after { background:#d8574a; }
        .dh .stars { position:absolute; right:26px; top:86px; font-size:24px; letter-spacing:4px; color:#efe9dc; text-shadow:0 1px 6px #000; }
        .dh .stars.flash { animation: dhstar .6s infinite; } @keyframes dhstar { 50% { opacity:.35; } }
        .dh .weap { position:absolute; right:28px; bottom:190px; text-align:right; display:none; text-shadow:0 1px 6px #000; }
        .dh .weap b { font-size:18px; letter-spacing:2px; font-weight:600; } .dh .weap span { display:block; font-size:22px; color:var(--gold); font-variant-numeric:tabular-nums; }
        .dh .vitals { position:absolute; left:22px; bottom:218px; width:190px; } .dh .vitals i { display:block; height:3px; margin-top:4px; background:#7fbf6a; width:100%; }
        .dh .vitals i.ar { background:#6aa2d8; } .dh.cut .vitals, .dh.cut .stars { opacity:0; }
        .dh .bigtext { position:absolute; left:0; right:0; top:42%; text-align:center; font-size:58px; letter-spacing:12px; font-weight:600; color:#efe9dc; text-shadow:0 2px 20px #000; display:none; }`;
      root.appendChild(css);

      // ---- the gun in the hand
      const gunMat = new THREE.MeshStandardMaterial({ color: '#1b1c1e', metalness: 0.6, roughness: 0.45 });
      function gunMesh(id) {
        const g = new THREE.Group(), long = { smg: 0.42, shotgun: 0.85, rifle: 0.82, sniper: 1.1 }[id] || 0.2;
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.07, long), gunMat); b.position.set(0, 0.02, -long / 2 + 0.05); g.add(b);
        const grip = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.11, 0.05), gunMat); grip.position.set(0, -0.04, 0.02); grip.rotation.x = 0.25; g.add(grip);
        if (long > 0.4) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.09, 0.22), gunMat); st.position.set(0, 0, 0.15); g.add(st); }
        if (id === 'bat') { g.clear(); const bt = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.018, 0.85, 8), new THREE.MeshStandardMaterial({ color: '#8a6a44', roughness: 0.7 })); bt.rotation.x = Math.PI / 2; bt.position.z = -0.35; g.add(bt); }
        g.position.set(0, -0.3, -0.04); g.userData.muzzle = new THREE.Vector3(0, 0.03, -long + 0.03);
        return g;
      }
      const held = { fareej: null, fatimah: null };
      function showGun() {
        for (const id of ['fareej', 'fatimah']) {
          const cur = W.arms[id].cur, p = persons[id];
          if (held[id] && held[id].userData.id === cur) continue;
          if (held[id]) { p.hand.remove(held[id]); held[id] = null; }
          if (cur !== 'fists' && cur !== 'grenade') { held[id] = gunMesh(cur); held[id].userData.id = cur; p.hand.add(held[id]); }
        }
      }

      // ---- effects: tracers, sparks, flashes
      const tracerMat = new THREE.LineBasicMaterial({ color: '#ffe2a0', transparent: true, opacity: 0.9 });
      const flash = new THREE.PointLight('#ffcf7a', 0, 14, 2); scene.add(flash);
      const sparkGeo = new THREE.SphereGeometry(0.05, 6, 4), sparkMat = new THREE.MeshBasicMaterial({ color: '#ffd38a' });
      function tracer(a, b) {
        const geo = new THREE.BufferGeometry().setFromPoints([a, b]); const l = new THREE.Line(geo, tracerMat.clone()); scene.add(l);
        const sp = new THREE.Mesh(sparkGeo, sparkMat); sp.position.copy(b); scene.add(sp);
        W.fx.push({ o: l, t: 0.07 }, { o: sp, t: 0.12 });
      }
      function boom(p, r) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: '#ffb35a', transparent: true, opacity: 0.85 })); m.position.copy(p); scene.add(m);
        W.fx.push({ o: m, t: 0.5, grow: r });
        flash.position.copy(p); flash.intensity = 400; state.shake = 0.6; sound('boom');
      }
      function fxStep(dt) {
        for (const f of W.fx) { f.t -= dt; if (f.grow) { f.o.scale.multiplyScalar(1 + dt * 6); f.o.material.opacity = Math.max(0, f.t * 1.7); } }
        W.fx = W.fx.filter((f) => { if (f.t > 0) return true; scene.remove(f.o); if (f.o.geometry !== sparkGeo) f.o.geometry.dispose(); return false; });
        flash.intensity *= Math.pow(0.0005, dt);
      }

      // ---- sound: shots, explosions, the siren (synthesised until recorded sounds arrive)
      let actx = null, sirenOsc = null, sirenGain = null;
      function ac() { if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } } return actx; }
      function sound(kind) {
        const c = ac(); if (!c) return;
        const len = kind === 'boom' ? 1.2 : kind === 'shotgun' ? 0.4 : 0.22;
        const buf = c.createBuffer(1, c.sampleRate * len, c.sampleRate), d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, kind === 'boom' ? 2 : 5);
        const s = c.createBufferSource(); s.buffer = buf;
        const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = kind === 'boom' ? 600 : kind === 'melee' ? 900 : 3200;
        const g = c.createGain(); g.gain.value = kind === 'boom' ? 0.9 : kind === 'melee' ? 0.3 : 0.45;
        s.connect(f); f.connect(g); g.connect(c.destination); s.start();
      }
      function siren(on) {
        const c = ac(); if (!c) return;
        if (on && !sirenOsc) { sirenOsc = c.createOscillator(); sirenOsc.type = 'triangle'; sirenGain = c.createGain(); sirenGain.gain.value = 0; sirenOsc.connect(sirenGain); sirenGain.connect(c.destination); sirenOsc.start(); }
        if (!sirenOsc) return;
        const t = c.currentTime;
        sirenGain.gain.setTargetAtTime(on ? 0.05 : 0, t, 0.3);
        if (on) sirenOsc.frequency.setTargetAtTime(700 + Math.sin(t * 2.4) * 280, t, 0.05);
      }

      // ---- shooting
      const ray = new THREE.Vector3(), origin = new THREE.Vector3(), tmp = new THREE.Vector3();
      function wallBetween(ax, az, bx, bz) {
        const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 6);
        for (let i = 1; i < n; i++) { const x = ax + (bx - ax) * i / n, z = az + (bz - az) * i / n; for (const wl of world.wallGrid.query(x, z)) if (L.nearestOnSegment(x, z, wl.ax, wl.az, wl.bx, wl.bz).d < 1.2) return true; }
        return false;
      }
      // the nearest thing along a ray: { kind, ref, d }
      function castRay(o, dir, range) {
        let best = null;
        const tryHit = (kind, ref, cx, cy, cz, r) => {
          tmp.set(cx - o.x, cy - o.y, cz - o.z); const along = tmp.dot(dir); if (along < 0.3 || along > range) return;
          const perp2 = tmp.lengthSq() - along * along; if (perp2 > r * r) return;
          if (!best || along < best.d) best = { kind, ref, d: along };
        };
        for (const pd of city.C.peds) if (pd.down <= 0) tryHit('ped', pd, pd.x, 1.1, pd.z, 0.45);
        for (const of of W.officers) if (!of.dead) tryHit('cop', of, of.x, of.y + 1.1, of.z, 0.45);
        for (const pc of W.police) if (!pc.wreck) tryHit('police', pc, pc.sim.x, pc.sim.y + 0.8, pc.sim.z, 1.9);
        for (const t of traffic.cars) tryHit('car', t, t.x, t.y + 0.8, t.z, 1.8);
        if (best) { const hx = o.x + dir.x * best.d, hz = o.z + dir.z * best.d; if (wallBetween(o.x, o.z, hx, hz)) best = null; }
        return best;
      }
      function witnesses(x, z, r = 70) {
        for (const pd of city.C.peds) if (Math.hypot(pd.x - x, pd.z - z) < r) return true;
        for (const pc of W.police) if (Math.hypot(pc.sim.x - x, pc.sim.z - z) < r * 1.5) return true;
        return false;
      }
      function scatter(x, z, r) { for (const pd of city.C.peds) { const dx = pd.x - x, dz = pd.z - z, d = Math.hypot(dx, dz); if (d < r && pd.down <= 0) { pd.flee = 3 + Math.random() * 2; pd.fx = dx / (d || 1); pd.fz = dz / (d || 1); pd.hd = Math.atan2(pd.fx, -pd.fz); } } }

      function shoot() {
        const A = arms(), f = story.foot, inCar = story.mode === 'drive';
        const focus = story.sense > 0 && story.active === 'fatimah';
        const moving = f ? Math.min(1, f.speed / 3) : inCar ? 0.6 : 0;
        if (inCar && !['pistol', 'heavy', 'smg'].includes(A.cur)) return;
        const s = A.fire(moving, focus); if (!s) return;
        const w = A.weapon;
        if (s.kind === 'melee') {
          sound('melee');
          const hx = f.x + Math.sin(f.heading) * 1, hz = f.z - Math.cos(f.heading) * 1;
          for (const pd of city.C.peds) if (pd.down <= 0 && Math.hypot(pd.x - hx, pd.z - hz) < s.range) { pd.down = 10; wanted().crime('hitPerson', f.x, f.z); scatter(f.x, f.z, 25); break; }
          for (const of of W.officers) if (!of.dead && Math.hypot(of.x - hx, of.z - hz) < s.range) { if (KB.damage(of, s.dmg * 2)) of.dead = true; wanted().crime('hitCop', f.x, f.z); break; }
          return;
        }
        if (s.kind === 'throw') {
          camera.getWorldDirection(ray);
          W.grenades.push({ p: new THREE.Vector3(f.x, f.y + 1.6, f.z), v: new THREE.Vector3(ray.x * 16, 7 + ray.y * 10, ray.z * 16), t: 2.4, m: (() => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), gunMat); scene.add(m); return m; })() });
          return;
        }
        sound(A.cur === 'shotgun' ? 'shotgun' : 'shot');
        W.recoil += s.recoil;
        // from the camera through the crosshair; the tracer starts at the muzzle
        camera.getWorldDirection(ray);
        origin.copy(camera.position);
        const muz = new THREE.Vector3();
        if (held[story.active]) held[story.active].localToWorld(muz.copy(held[story.active].userData.muzzle)); else muz.set(car.x, car.y + 1.3, car.z);
        flash.position.copy(muz); flash.intensity = 25;
        let hitAny = false;
        for (let i = 0; i < s.pellets; i++) {
          const d = ray.clone(); d.x += (Math.random() - 0.5) * s.spread * 2; d.y += (Math.random() - 0.5) * s.spread * 2; d.z += (Math.random() - 0.5) * s.spread * 2; d.normalize();
          const h = castRay(origin, d, s.range);
          const end = origin.clone().addScaledVector(d, h ? h.d : Math.min(s.range, 80));
          if (i < 3) tracer(muz, end);
          if (!h) continue;
          hitAny = true;
          if (h.kind === 'ped') { h.ref.down = 12; wanted().crime('hitPerson', muz.x, muz.z); }
          if (h.kind === 'cop') { if (KB.damage(h.ref, s.dmg)) { h.ref.dead = true; wanted().crime('killCop', muz.x, muz.z); } else wanted().crime('hitCop', muz.x, muz.z); }
          if (h.kind === 'police') { h.ref.hp -= s.dmg * 0.5; wanted().crime('hitCop', muz.x, muz.z); if (h.ref.hp <= 0) { h.ref.wreck = true; boom(new THREE.Vector3(h.ref.sim.x, h.ref.sim.y + 1, h.ref.sim.z), 3); wanted().crime('wreckCop', muz.x, muz.z); } }
          if (h.kind === 'car') { h.ref.stopT = 8; h.ref.speed *= 0.2; }
        }
        $('.xhair').classList.toggle('hit', hitAny); setTimeout(() => $('.xhair').classList.remove('hit'), 90);
        const sx = f ? f.x : car.x, sz = f ? f.z : car.z;
        scatter(sx, sz, 70);
        if (witnesses(sx, sz)) wanted().crime('shotsFired', sx, sz);
      }
      function grenadeStep(dt) {
        W.grenades = W.grenades.filter((g) => {
          g.t -= dt; g.v.y -= 9.81 * dt; g.p.addScaledVector(g.v, dt);
          if (g.p.y < 0.07) { g.p.y = 0.07; g.v.y *= -0.35; g.v.x *= 0.6; g.v.z *= 0.6; }
          g.m.position.copy(g.p);
          if (g.t > 0) return true;
          scene.remove(g.m); boom(g.p, 7);
          const R = KB.WEAPONS.grenade.radius;
          for (const pd of city.C.peds) if (Math.hypot(pd.x - g.p.x, pd.z - g.p.z) < R) pd.down = 12;
          for (const of of W.officers) if (Math.hypot(of.x - g.p.x, of.z - g.p.z) < R) of.dead = true;
          for (const pc of W.police) if (Math.hypot(pc.sim.x - g.p.x, pc.sim.z - g.p.z) < R) { pc.wreck = true; pc.sim.vy = 6; }
          for (const t of traffic.cars) if (Math.hypot(t.x - g.p.x, t.z - g.p.z) < R) { t.stopT = 20; t.speed = 0; }
          const me = story.foot || car; const dm = Math.hypot(me.x - g.p.x, me.z - g.p.z);
          if (dm < R) hurt(KB.WEAPONS.grenade.dmg * (1 - dm / R));
          scatter(g.p.x, g.p.z, 90); wanted().crime('shotsFired', g.p.x, g.p.z);
          return false;
        });
      }

      // ---- the player getting hurt
      function hurt(dmg) {
        const ch = story.chars[story.active];
        const cover = story.foot && story.foot.crouch;
        if (KB.damage(ch, dmg, cover)) down('wasted');
        root.classList.remove('hurt'); void root.offsetWidth; root.classList.add('hurt');
      }

      // ---- police
      const policeBody = new THREE.MeshPhysicalMaterial({ color: '#f4f4f0', metalness: 0.4, roughness: 0.35, clearcoat: 0.8 });
      function policeCar(x, z, hd, fast) {
        const mesh = makePlayerCar(carGeo, fast ? '#f4f4f0' : '#f4f4f0');
        // a dark green band along the sides and a light bar
        const band = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.22, 3.8), new THREE.MeshStandardMaterial({ color: '#0f5a3a', roughness: 0.5 })); band.position.set(0, 0.62, 0); mesh.body.add(band);
        const bar = new THREE.Group(); bar.position.set(0, 1.47, 0.1); mesh.body.add(bar);
        const red = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.12, 0.25), new THREE.MeshStandardMaterial({ color: '#400', emissive: '#ff2020', emissiveIntensity: 0 })); red.position.x = -0.32; bar.add(red);
        const blue = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.12, 0.25), new THREE.MeshStandardMaterial({ color: '#004', emissive: '#2050ff', emissiveIntensity: 0 })); blue.position.x = 0.32; bar.add(blue);
        if (fast) { mesh.body.scale.set(1.04, 0.82, 1.08); band.material.color.set('#0b3d29'); }
        scene.add(mesh.group);
        const sim = new L.Car(); sim.spec = Object.assign({}, sim.spec, { torque: sim.spec.torque.map(([r, t]) => [r, t * (fast ? 2.6 : 1.35)]), topSpeed: fast ? 85 : 62, grip: fast ? 1.25 : 1.08 });
        sim.x = x; sim.z = z; sim.heading = hd; sim.y = 0;
        return { sim, mesh, red, blue, hp: fast ? 160 : 120, wreck: false, out: false, fast, stuck: 0, block: false };
      }
      function spawnPolice(block) {
        // on a road 220-320 m away, behind the player if possible
        const me = story.foot || car, hd = story.foot ? story.foot.heading : car.heading;
        for (let tries = 0; tries < 12; tries++) {
          const a = hd + Math.PI + (Math.random() - 0.5) * (tries > 6 ? 6 : 2.2), d = 220 + Math.random() * 100;
          const x = me.x + Math.sin(a) * d, z = me.z - Math.cos(a) * d;
          const its = world.roadGrid.query(x, z).filter((it) => world.roads[it.r].k <= 4 && !world.roads[it.r].t);
          if (!its.length) continue;
          const r = world.roads[its[0].r], q = L.pointAt(r.p, r.cum, r.cum[its[0].k]);
          const pc = policeCar(q.x, q.z, Math.atan2(me.x - q.x, -(me.z - q.z)), wanted().supercars && Math.random() < 0.5);
          pc.sim.y = heightAlong(r, r.cum[its[0].k]) + KIND_Y[r.k];
          W.police.push(pc); return pc;
        }
        return null;
      }
      function roadblock() {
        // two cars across the road ahead of the player
        if (story.mode !== 'drive' || Math.abs(car.speed) < 8) return;
        const ax = car.x + Math.sin(car.heading) * 260, az = car.z - Math.cos(car.heading) * 260;
        const its = world.roadGrid.query(ax, az).filter((it) => world.roads[it.r].k <= 3); if (!its.length) return;
        const r = world.roads[its[0].r], p = r.p, k = its[0].k, hd = Math.atan2(p[k * 2 + 2] - p[k * 2], -(p[k * 2 + 3] - p[k * 2 + 1]));
        const s = L.nearestOnSegment(ax, az, p[k * 2], p[k * 2 + 1], p[k * 2 + 2], p[k * 2 + 3]);
        for (const off of [-2.6, 2.6]) { const pc = policeCar(s.px + Math.cos(hd) * off, s.pz + Math.sin(hd) * off, hd + Math.PI / 2, false); pc.block = true; pc.sim.y = r.h[k] + KIND_Y[r.k]; W.police.push(pc); }
      }
      function removePolice(pc) { scene.remove(pc.mesh.group); if (pc.officer) { scene.remove(pc.officer.p.group); W.officers = W.officers.filter((o) => o !== pc.officer); } }

      function drive(sim, tx, tz, aggressive, dt) {
        const want = Math.atan2(tx - sim.x, -(tz - sim.z));
        let dh = want - sim.heading; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
        const dist = Math.hypot(tx - sim.x, tz - sim.z);
        const input = { throttle: dist < 9 ? 0 : Math.abs(dh) > 1.2 && sim.speed > 12 ? 0.3 : aggressive ? 1 : 0.85, brake: dist < 9 || (Math.abs(dh) > 1.7 && sim.speed > 10) ? 1 : 0, steer: THREE.MathUtils.clamp(dh * 2.2, -1, 1), handbrake: Math.abs(dh) > 1.4 && sim.speed > 14 };
        if (sim.gear === -1) input.brake = 0;
        const sub = Math.ceil(dt / (1 / 120)), h = dt / sub;
        for (let i = 0; i < sub; i++) {
          sim.step(h, input);
          const sup = supportAt(sim.x, sim.z, sim.y); const gy = sup ? sup.y : 0; sim.y += (gy - sim.y) * Math.min(1, h * 20);
          for (const o of [-1.3, 1.3]) { const cx = sim.x + Math.sin(sim.heading) * o, cz = sim.z - Math.cos(sim.heading) * o; if (sim.y < 40) for (const wl of world.wallGrid.query(cx, cz)) { const q = L.nearestOnSegment(cx, cz, wl.ax, wl.az, wl.bx, wl.bz); if (q.d < 1.1 && q.d > 1e-4) sim.hit((cx - q.px) / q.d, (cz - q.pz) / q.d, 1.1 - q.d); } }
        }
        return dist;
      }
      function makeOfficer(pc) {
        const p = P.makePerson({ skin: SKINS_P[Math.floor(Math.random() * SKINS_P.length)], hair: '#141210', shirt: '#5b6450', trousers: '#4a5242', height: 1.8, beard: Math.random() < 0.5, shoes: '#111' });
        const g = gunMesh('pistol'); p.hand.add(g); scene.add(p.group);
        const s = pc.sim;
        const o = { p, x: s.x + Math.cos(s.heading) * 1.6, z: s.z + Math.sin(s.heading) * 1.6, y: s.y, heading: s.heading, health: 100, armour: 30, dead: false, cool: 1 + Math.random(), car: pc };
        W.officers.push(o); pc.officer = o; pc.out = true; return o;
      }
      const SKINS_P = ['#7a4e34', '#9c6b4a', '#b07c58', '#c99a76'];

      function sees(x, z, y) {
        if (story.inside || (story.foot && story.foot.y < -20)) return false;
        for (const pc of W.police) { if (pc.wreck) continue; const d = Math.hypot(pc.sim.x - x, pc.sim.z - z); if (d < 25 || (d < 110 && Math.abs(pc.sim.y - y) < 5 && !wallBetween(pc.sim.x, pc.sim.z, x, z))) return true; }
        for (const o of W.officers) if (!o.dead && Math.hypot(o.x - x, o.z - z) < 40) return true;
        if (W.heli && Math.hypot(W.heli.x - x, W.heli.z - z) < 120 && !(supportAt(x, z, y + 1) || {}).r?.t) return true;
        return false;
      }

      function policeStep(dt, t) {
        const wv = wanted(), me = story.foot || car, onFoot = !!story.foot;
        const lvl = wv.level;
        // keep the right number of units
        W.spawnT -= dt;
        const active = W.police.filter((p) => !p.wreck && !p.block).length;
        if (lvl && active < wv.units && W.spawnT <= 0) { spawnPolice(); W.spawnT = 2.5; }
        if (wv.roadblocks) { W.blockT -= dt; if (W.blockT <= 0) { W.blockT = 22; roadblock(); } }
        // helicopter
        if (wv.helicopter && !W.heli) {
          const g = new THREE.Group();
          const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.1, 2.6, 4, 10), new THREE.MeshStandardMaterial({ color: '#f4f4f0', metalness: 0.4, roughness: 0.4 })); body.rotation.x = Math.PI / 2; g.add(body);
          const tail = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.4, 5), body.material); tail.position.set(0, 0.3, 3.6); g.add(tail);
          const rotor = new THREE.Mesh(new THREE.BoxGeometry(10, 0.05, 0.3), gunMat); rotor.position.y = 1.4; g.add(rotor);
          const spot = new THREE.SpotLight('#eaf2ff', 0, 160, 0.22, 0.5, 1.2); g.add(spot); g.add(spot.target);
          scene.add(g); W.heli = { g, rotor, spot, x: me.x + 200, z: me.z, y: 70 };
        }
        if (W.heli) {
          const H = W.heli; H.x += (me.x + Math.sin(t * 0.3) * 30 - H.x) * Math.min(1, dt * 0.6); H.z += (me.z + Math.cos(t * 0.3) * 30 - H.z) * Math.min(1, dt * 0.6);
          H.g.position.set(H.x, (me.y || 0) + H.y, H.z); H.rotor.rotation.y += dt * 30; H.g.rotation.y = Math.atan2(me.x - H.x, me.z - H.z);
          H.spot.intensity = U.uNight.value * 3000; H.spot.target.position.set(0, -80, 0); H.spot.target.updateMatrixWorld();
          H.spot.position.set(0, -1, 0); H.spot.target.position.set((me.x - H.x), -H.y, (me.z - H.z)).applyAxisAngle(new THREE.Vector3(0, 1, 0), -H.g.rotation.y);
          if (!wv.helicopter) { scene.remove(H.g); W.heli = null; }
        }
        const flashOn = Math.floor(t * 6) % 2 === 0;
        for (const pc of W.police) {
          pc.red.material.emissiveIntensity = lvl && !pc.wreck ? (flashOn ? 4 : 0.2) : 0; pc.blue.material.emissiveIntensity = lvl && !pc.wreck ? (flashOn ? 0.2 : 4) : 0;
          const s = pc.sim, m = pc.mesh;
          if (!pc.wreck && !pc.block && !pc.out) {
            const dist = lvl ? drive(s, me.x + (onFoot ? 0 : car.vx * 0.5), me.z + (onFoot ? 0 : car.vz * 0.5), lvl >= 3, dt) : drive(s, s.x + Math.sin(s.heading) * 50, s.z - Math.cos(s.heading) * 50, false, dt);
            // ram the player's car
            if (!onFoot) { const dx = car.x - s.x, dz = car.z - s.z, dd = Math.hypot(dx, dz); if (dd < 2.9 && dd > 1e-3) { const v = car.hit(dx / dd, dz / dd, (2.9 - dd) / 2); s.hit(-dx / dd, -dz / dd, (2.9 - dd) / 2); if (v > 3) { audio.thump(v); story.damage += v * 0.5; if (v > 8 && lvl < 3) wv.crime('ramCop', car.x, car.z); } } }
            // get out on foot near a player on foot, or when stuck
            if (lvl && ((onFoot && dist < 18 && Math.abs(s.speed) < 3) || (pc.stuck += (Math.abs(s.speed) < 0.5 ? dt : -pc.stuck)) > 6)) makeOfficer(pc);
            if (Math.hypot(s.x - me.x, s.z - me.z) > 700) { pc.gone = true; }
          }
          if (pc.wreck) { s.vx *= 0.95; s.vz *= 0.95; }
          m.group.position.set(s.x, s.y, s.z); m.group.rotation.y = -s.heading;
          m.head.emissiveIntensity = 2.5;
        }
        W.police = W.police.filter((pc) => { if (pc.gone || (!lvl && Math.hypot(pc.sim.x - me.x, pc.sim.z - me.z) > 300) || (pc.block && Math.hypot(pc.sim.x - me.x, pc.sim.z - me.z) > 600)) { removePolice(pc); return false; } return true; });
        // officers on foot: run to the player, aim, shoot when allowed, arrest when close
        let arresting = false;
        for (const o of W.officers) {
          if (o.dead) { o.p.group.rotation.x = -Math.PI / 2; o.p.group.position.set(o.x, o.y + 0.25, o.z); continue; }
          const dx = me.x - o.x, dz = me.z - o.z, d = Math.hypot(dx, dz);
          o.heading = Math.atan2(dx, -dz);
          const shootable = lvl >= 2 || (lvl && arms().armed);
          const sp = d > (shootable ? 12 : 1.6) ? (shootable ? 3.4 : 4.2) : 0;
          o.x += Math.sin(o.heading) * sp * dt; o.z -= Math.cos(o.heading) * sp * dt;
          const sup = supportAt(o.x, o.z, o.y + 0.5); o.y = sup ? sup.y : 0;
          o.p.group.position.set(o.x, o.y, o.z); o.p.group.rotation.y = -o.heading; o.p.update(dt, sp, false, shootable && d < 45);
          if (shootable && d < 45 && lvl) {
            o.cool -= dt;
            if (o.cool <= 0) { o.cool = 0.7 + Math.random() * 0.8; sound('shot');
              const mz = new THREE.Vector3(o.x + Math.sin(o.heading) * 0.6, o.y + 1.4, o.z - Math.cos(o.heading) * 0.6);
              const hitp = Math.random() < KB.hitChance(d, onFoot ? story.foot.speed : Math.abs(car.speed), onFoot && story.foot.crouch) * (onFoot ? 1 : 0.4);
              tracer(mz, new THREE.Vector3(me.x + (hitp ? 0 : (Math.random() - 0.5) * 3), (me.y || 0) + 1.2, me.z + (hitp ? 0 : (Math.random() - 0.5) * 3)));
              if (hitp && !wallBetween(o.x, o.z, me.x, me.z)) hurt(KB.WEAPONS.pistol.dmg * 0.7);
            }
          }
          if (!shootable && lvl && d < 2.2 && onFoot && story.foot.speed < 1) arresting = true;
        }
        W.officers = W.officers.filter((o) => Math.hypot(o.x - me.x, o.z - me.z) < 400 || !lvl ? (lvl || Math.hypot(o.x - me.x, o.z - me.z) < 200) : false);
        // pulled over (1 star, in a car): stop near a patrol car for 3 seconds and take the fines
        const nearCop = W.police.some((pc) => !pc.wreck && Math.hypot(pc.sim.x - car.x, pc.sim.z - car.z) < 12);
        if (!onFoot && lvl && nearCop && Math.abs(car.speed) < 1) { W.pullT += dt; if (W.pullT > 3) { if (lvl === 1) { const due = city.C.fines[story.active].reduce((a, f) => a + f.amount, 0) + 300; city.C.fines[story.active] = []; story.chars[story.active].money -= due; say('', `PULLED OVER · AED ${due.toLocaleString('en')} IN FINES PAID`); wv.clear(); W.pullT = 0; } else down('busted'); } } else W.pullT = 0;
        if (arresting) { W.bustT += dt; if (W.bustT > 1.6) down('busted'); } else W.bustT = 0;
        siren(lvl > 0 && W.police.some((pc) => !pc.wreck && Math.hypot(pc.sim.x - me.x, pc.sim.z - me.z) < 250));
      }

      // ---- busted and the hospital
      const POLICE_STATION = S.xz(25.2575, 55.2985), HOSPITAL = S.xz(25.2350, 55.3165);
      function down(kind) {
        if (W.down) return;
        W.down = kind;
        const ch = story.chars[story.active], cost = kind === 'busted' ? KB.busted(ch.money) : KB.wasted(ch.money);
        const el = $('.bigtext'); el.textContent = kind === 'busted' ? 'ARRESTED' : 'HOSPITALISED'; el.style.display = 'block';
        fade(true);
        setTimeout(() => {
          ch.money -= cost; ch.health = 100; ch.armour = 0;
          if (kind === 'busted') { W.arms[story.active] = new KB.Arsenal(['fists']); }
          wanted().clear();
          for (const pc of W.police) removePolice(pc); W.police = []; for (const o of W.officers) scene.remove(o.p.group); W.officers = [];
          if (W.heli) { scene.remove(W.heli.g); W.heli = null; }
          const at = kind === 'busted' ? POLICE_STATION : HOSPITAL;
          // the car is brought round to the nearest street outside, and you walk out beside it
          if (!story.foot) exitCar();
          car.x = at.x; car.z = at.z; car.y = 30; resetCar(false); car.vx = car.vz = 0;
          story.foot.x = car.x + Math.cos(car.heading) * 2.4; story.foot.z = car.z + Math.sin(car.heading) * 2.4; story.foot.y = car.y + 0.5; story.foot.vy = 0;
          state.hour = (state.hour + 6) % 24;
          el.style.display = 'none'; fade(false);
          say('', kind === 'busted' ? `RELEASED FROM BUR DUBAI POLICE STATION · AED ${cost.toLocaleString('en')} AND YOUR WEAPONS TAKEN` : `DISCHARGED FROM HOSPITAL · BILL AED ${cost.toLocaleString('en')}`);
          W.down = null;
        }, 2600);
      }

      // ---- input: right mouse aims, left fires; R reloads on foot; mouse wheel or [ ] changes weapon; G throws a grenade
      renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
      renderer.domElement.addEventListener('mousedown', (e) => { if (e.button === 2) W.aim = true; if (e.button === 0 && W.aim) W.trigger = true; });
      window.addEventListener('mouseup', (e) => { if (e.button === 2) W.aim = false; if (e.button === 0) W.trigger = false; });
      window.addEventListener('mousemove', (e) => { if (W.aim && story.mode === 'foot') { story.camYaw += e.movementX * 0.0035; W.pitch = THREE.MathUtils.clamp(W.pitch - e.movementY * 0.003, -0.6, 0.7); } });
      renderer.domElement.addEventListener('wheel', (e) => { if (story.mode === 'foot') { arms().cycle(e.deltaY > 0 ? 1 : -1); showGun(); } }, { passive: true });
      window.addEventListener('keydown', (e) => {
        const k = e.key.toLowerCase();
        if (k === ']' || k === '[') { arms().cycle(k === ']' ? 1 : -1); showGun(); }
        if (k === 'k') W.aim = !W.aim;                                  // aim toggle for trackpads
        if (k === 'l' && W.aim) W.trigger = true;                       // fire key for trackpads
        if (k === 'g' && story.foot && arms().has('grenade')) { const prev = arms().cur; arms().select('grenade'); arms().cool = 0; shoot(); if (arms().has(prev)) arms().select(prev); showGun(); }
        if (k === 'r' && story.foot) arms().reload();
      });
      window.addEventListener('keyup', (e) => { if (e.key.toLowerCase() === 'l') W.trigger = false; });

      // the gun shop's counter: buying weapons, ammo and armour (called from the shop menu)
      function shopEffect(eff) {
        const A = arms(), ch = story.chars[story.active];
        if (eff.weapon) { A.give(eff.weapon, eff.mags || 2); A.select(eff.weapon); showGun(); }
        if (eff.ammo) A.give(A.cur, eff.ammo);
        if (eff.armour) ch.armour = 100;
      }
      function ammoPrice() { const w = arms().weapon; return w.ammo ? w.ammo * 2 : 0; }

      // ---- each frame
      function frame(dt) {
        const A = arms(), t = U.uTime.value;
        A.step(dt);
        const canAim = story.mode === 'foot' || (story.mode === 'drive' && ['pistol', 'heavy', 'smg'].includes(A.cur));
        const aiming = W.aim && canAim && !story.inside && !W.down;
        $('.xhair').classList.toggle('on', aiming);
        if (aiming && (W.trigger || false)) { shoot(); if (!A.weapon.auto) W.trigger = false; }
        W.recoil *= Math.pow(0.02, dt); if (aiming) W.pitch += W.recoil * dt * 8;
        if (story.foot) {
          const p = persons[story.active], f = story.foot;
          if (aiming) { f.heading = story.camYaw; p.group.rotation.y = -f.heading; p.update(0, f.speed, f.crouch, true); }
        }
        grenadeStep(dt); fxStep(dt);
        const me = story.foot || car;
        if (wanted().step(dt, me.x, me.z, sees(me.x, me.z, me.y || 0)) === 'cleared') say('', 'YOU LOST THE POLICE');
        // big unpaid fines: a patrol that sees your car stops you
        const owed = city.C.fines[story.active].reduce((a, f) => a + f.amount, 0);
        if (owed > 5000 && !wanted().level && story.mode === 'drive' && W.police.length === 0 && Math.random() < dt / 90) wanted().crime('fines', car.x, car.z);
        policeStep(dt, t);
        // HUD
        const lv = wanted().level;
        $('.stars').textContent = lv ? '★'.repeat(lv) + '☆'.repeat(5 - lv) : '';
        $('.stars').classList.toggle('flash', lv > 0 && wanted().unseen > 0.5);
        const showW = A.cur !== 'fists' && (story.mode === 'foot' || aiming);
        $('.weap').style.display = showW ? 'block' : 'none';
        if (showW) { const o = A.owned[A.cur]; $('.weap b').textContent = A.weapon.name.toUpperCase(); $('.weap span').textContent = A.reloading ? 'RELOADING' : o.mag === Infinity ? '' : `${o.mag} / ${o.reserve}`; }
        const ch = story.chars[story.active];
        $('.vitals .hp').style.width = ch.health + '%'; $('.vitals .ar').style.width = (ch.armour || 0) + '%';
        if (ch.health < 50 && !W.down) ch.health = Math.min(50, ch.health + dt * 1.5);   // health comes back to half on its own
        return aiming;
      }
      // the camera while aiming on foot: over the right shoulder, pitch from the mouse
      function aimCamera(dt) {
        const f = story.foot; if (!f || !W.aim) return false;
        const yaw = story.camYaw, scope = arms().weapon.scope;
        const dist = scope ? 0.6 : 2.5, side = scope ? 0.2 : 0.95;
        const px = f.x - Math.sin(yaw) * dist + Math.cos(yaw) * side, pz = f.z + Math.cos(yaw) * dist + Math.sin(yaw) * side;
        camera.position.set(px, f.y + 1.78 + (f.crouch ? -0.45 : 0), pz);
        camera.lookAt(px + Math.sin(yaw) * 20 * Math.cos(W.pitch), camera.position.y + Math.sin(W.pitch) * 20, pz - Math.cos(yaw) * 20 * Math.cos(W.pitch));
        camera.fov = scope ? 14 : 50;
        return true;
      }
      // police car collisions for the player's car are in policeStep; this keeps them for the save
      function toJSON() { return { fareej: W.arms.fareej.toJSON(), fatimah: W.arms.fatimah.toJSON() }; }
      function fromJSON(j) { if (!j) return; W.arms.fareej = KB.Arsenal.from(j.fareej); W.arms.fatimah = KB.Arsenal.from(j.fatimah); showGun(); }
      showGun();
      return { W, frame, aimCamera, shopEffect, ammoPrice, toJSON, fromJSON, wanted, arms, showGun, spawnPolice };
    })();

    // ------------------------------------------------------------------ section 5: the phone, money, cars and the garage

    const EC = window.DesertHeatEconomy, NV = window.DesertHeatNav, ON = window.DesertHeatOnline;
    const life = (() => {
      const F = {
        open: false, app: 'home', messages: [], waypoint: null, route: null, routeT: 0, graph: null,
        owned: { fareej: [{ id: 'saloon', paint: '#6d7378', tune: {} }], fatimah: [{ id: 'coupe', paint: '#e9e6df', tune: {} }] },
        current: { fareej: 0, fatimah: 0 }, property: ['deira-flat', 'marina-apt'], business: {}, lastDay: 0,
        ride: null, rides: 0, photo: false, gallery: [], settings: { dayMin: 48, shake: true, subs: 'normal' },
        stats: { policeWrecked: 0, maxWanted: 0, fines: 0, rides: 0, speed: 0 }, smoke: [],
      };
      const GARAGE = S.xz(25.1385, 55.2290);

      // ---- markup
      root.insertAdjacentHTML('beforeend', `<div class="phone"><div class="bar"><span class="pt"></span><span>●●● 5G</span></div><div class="scr"></div><div class="homebtn"></div></div>
        <div class="garagemenu shopmenu"><h3>KIRAN'S GARAGE · AL QUOZ</h3><p class="sub2"></p><ol></ol><p class="hint2">NUMBER KEYS choose · drive away to leave</p></div>`);
      const css = document.createElement('style'); css.textContent = `
        .dh .phone { position:absolute; right:40px; bottom:40px; width:300px; height:600px; border-radius:38px; background:#0c0c0e; border:9px solid #1d1d20; box-shadow:0 20px 60px rgba(0,0,0,.6); display:none; overflow:hidden; font-family:-apple-system,"Segoe UI",sans-serif; letter-spacing:0; }
        .dh .phone.on { display:block; animation: dhup .25s ease-out; } @keyframes dhup { from { transform:translateY(60px); opacity:0; } }
        .dh .phone .bar { display:flex; justify-content:space-between; padding:12px 22px 4px; font-size:12px; color:#ddd; }
        .dh .phone .scr { position:absolute; left:0; right:0; top:34px; bottom:34px; overflow-y:auto; padding:10px 16px; color:#eee; font-size:13px; background:linear-gradient(160deg,#30261c,#121a24); }
        .dh .phone .homebtn { position:absolute; left:50%; bottom:10px; width:110px; height:5px; margin-left:-55px; border-radius:3px; background:#ddd; cursor:pointer; }
        .dh .phone .grid { display:grid; grid-template-columns:repeat(4,1fr); gap:16px 8px; margin-top:24px; }
        .dh .phone .app { text-align:center; font-size:10.5px; cursor:pointer; color:#eee; } .dh .phone .app i { display:block; width:52px; height:52px; margin:0 auto 5px; border-radius:13px; font-style:normal; font-size:24px; line-height:52px; color:#fff; }
        .dh .phone h4 { margin:6px 0 10px; font-size:20px; font-weight:600; } .dh .phone .row { padding:9px 0; border-bottom:1px solid rgba(255,255,255,.08); display:flex; justify-content:space-between; gap:8px; align-items:center; }
        .dh .phone .row small { display:block; color:#999; font-size:11px; } .dh .phone button { font:inherit; font-size:12px; border:0; border-radius:14px; padding:5px 11px; background:#2f7d4a; color:#fff; cursor:pointer; }
        .dh .phone button.alt { background:#444; } .dh .phone button:disabled { background:#333; color:#777; cursor:default; } .dh .phone .soon { display:inline-block; font-size:10px; padding:2px 7px; border-radius:8px; background:#b08a2e; color:#111; font-weight:600; margin-left:6px; }
        .dh .phone img { width:100%; border-radius:8px; margin:6px 0; }
        .dh.photo > *:not(canvas.view):not(.phone):not(style) { opacity:0 !important; }
        .dh .garagemenu { top:40%; }`;
      root.appendChild(css);
      const scr = $('.phone .scr');

      // ---- messages
      function message(from, text) { F.messages.unshift({ from, text, at: clockText() }); if (!F.open) say('', `NEW MESSAGE · ${from.toUpperCase()}`); }
      const clockText = () => { const h = Math.floor(state.hour), m = Math.floor((state.hour - h) * 60); return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0'); };
      message('Unknown number', 'We know you took them.');
      message('Jomon', 'Machan! Ride app pays double after midnight this week. Go online 🚕');
      message('Kiran Desai', 'Bring the car to Al Quoz when it needs fixing. Cash only, no questions.');

      // ---- the apps
      const APPS = [
        ['messages', 'Messages', '#2f9a52', '✉'], ['map', 'Maps', '#3d78c9', '⌖'], ['bank', 'Bank', '#1f3b5c', 'Ⓑ'], ['ride', 'Sayara Ride', '#111', '⛟'],
        ['cars', 'My Cars', '#8d1f1f', '⚙'], ['web', 'Internet', '#4a5a6a', '◎'], ['camera', 'Camera', '#555', '◉'], ['online', 'Online', '#6a3f8a', '⇄'],
        ['settings', 'Settings', '#666', '≡'],
      ];
      const money = () => story.chars[story.active].money;
      function render() {
        $('.phone .pt').textContent = clockText();
        const ch = story.chars[story.active], who = story.active;
        let h = '';
        if (F.app === 'home') h = `<div style="font-size:42px;font-weight:200;text-align:center;margin-top:20px">${clockText()}</div><div style="text-align:center;color:#bbb">${S.CHARACTERS[who].name} · AED ${Math.round(ch.money).toLocaleString('en')}</div><div class="grid">${APPS.map(([id, n, c, g]) => `<div class="app" data-app="${id}"><i style="background:${c}">${g}</i>${n}</div>`).join('')}</div>`;
        if (F.app === 'messages') h = `<h4>Messages</h4>` + (F.messages.map((m) => `<div class="row"><div><b>${m.from}</b><small>${m.text}</small></div><small>${m.at}</small></div>`).join('') || '<p>No messages.</p>');
        if (F.app === 'map') h = `<h4>Maps</h4><p>Open the full map (M) and click a place to set a GPS waypoint. The route shows on the mini-map.</p>${F.waypoint ? `<div class="row">Waypoint set<button class="alt" data-act="clearwp">Clear</button></div>` : ''}<h4 style="font-size:15px">Places</h4>` +
          [['Kiran\'s Garage', GARAGE], ['Fareej\'s flat', S.PLACES.fareejHome], ['Fatimah\'s tower', S.PLACES.fatimahHome], ...EC.BUSINESSES.filter((b) => F.business[b.id]).map((b) => [b.name, S.xz(b.lat, b.lon)])].map(([n, p], i) => `<div class="row">${n}<button data-act="wp" data-x="${p.x}" data-z="${p.z}">Go</button></div>`).join('');
        if (F.app === 'bank') {
          const fines = city.C.fines[who].reduce((a, f) => a + f.amount, 0);
          h = `<h4>Gulf Crescent Bank</h4><div class="row">Fareej<b>AED ${Math.round(story.chars.fareej.money).toLocaleString('en')}</b></div><div class="row">Fatimah<b>AED ${Math.round(story.chars.fatimah.money).toLocaleString('en')}</b></div>
            <div class="row">Send AED 1,000 to ${who === 'fareej' ? 'Fatimah' : 'Fareej'}<button data-act="xfer">Send</button></div>
            <div class="row"><div>Unpaid fines<small>${city.C.fines[who].length} tickets</small></div><button data-act="payfines" ${fines ? '' : 'disabled'}>Pay AED ${fines.toLocaleString('en')}</button></div>
            <div class="row"><div>Gold<small>${ch.gold || 0} g</small></div></div>` +
            EC.BUSINESSES.filter((b) => F.business[b.id]).map((b) => `<div class="row"><div>${b.name}<small>AED ${b.perDay.toLocaleString('en')} a day</small></div></div>`).join('');
        }
        if (F.app === 'ride') {
          if (who !== 'fareej') h = '<h4>Sayara Ride</h4><p>Only Fareej drives for Sayara.</p>';
          else h = `<h4>Sayara Ride</h4><p>${F.ride ? (F.ride.stage === 'pickup' ? `Picking up ${F.ride.name}. Follow the GPS.` : `Taking ${F.ride.name} to ${F.ride.toName}.`) : 'You are offline.'}</p><div class="row">Rides today<b>${F.rides}</b></div>` +
            `<button data-act="${F.ride ? 'rideoff' : 'rideon'}">${F.ride ? 'Go offline' : 'Go online'}</button>`;
        }
        if (F.app === 'cars') h = `<h4>My Cars</h4>` + F.owned[who].map((c, i) => `<div class="row"><div>${EC.CARS[c.id].name}<small>${EC.CARS[c.id].cls} · <span style="color:${c.paint}">■</span> · engine ${c.tune.engine || 0}</small></div>${i === F.current[who] ? '<small>IN USE</small>' : `<button data-act="deliver" data-i="${i}">Deliver (AED 250)</button>`}</div>`).join('');
        if (F.app === 'web') h = `<h4>Internet</h4><h4 style="font-size:15px">Autos Dubai</h4>` +
          Object.entries(EC.CARS).filter(([, c]) => !c.hidden).map(([id, c]) => `<div class="row"><div>${c.name}<small>${c.cls}</small></div><button data-act="buycar" data-id="${id}" ${c.price > money() ? 'disabled' : ''}>AED ${c.price.toLocaleString('en')}</button></div>`).join('') +
          `<h4 style="font-size:15px">Homes</h4>` + EC.PROPERTY.filter((p) => p.price).map((p) => `<div class="row"><div>${p.name}</div>${F.property.includes(p.id) ? '<small>OWNED</small>' : `<button data-act="buyprop" data-id="${p.id}" ${p.price > money() ? 'disabled' : ''}>AED ${p.price.toLocaleString('en')}</button>`}</div>`).join('') +
          `<h4 style="font-size:15px">Businesses for sale</h4>` + EC.BUSINESSES.map((b) => `<div class="row"><div>${b.name}<small>about AED ${b.perDay.toLocaleString('en')} a day</small></div>${F.business[b.id] ? '<small>OWNED</small>' : `<button data-act="buybiz" data-id="${b.id}" ${b.price > money() ? 'disabled' : ''}>AED ${b.price.toLocaleString('en')}</button>`}</div>`).join('') +
          `<h4 style="font-size:15px">Gulf News Today</h4>` + EC.headlines(F.stats).map((t) => `<div class="row">${t}</div>`).join('');
        if (F.app === 'camera') h = `<h4>Camera</h4><p>Photo mode hides the screen text. Drag to turn the camera, SPACE takes a photo, P comes back.</p><button data-act="photo">Open photo mode</button>` + F.gallery.map((u) => `<img src="${u}">`).join('');
        if (F.app === 'online') h = `<h4>Online <span class="soon">${ON.STATUS.toUpperCase()}</span></h4><p>Drive Dubai with up to ${ON.MAX_PLAYERS} friends in one city: join with a 4-letter room code, race, follow each other and play the free roam together.</p><p style="color:#bbb">Online play is coming in a later update. It is not switched on in this version.</p><button disabled>Join a room</button> <button disabled class="alt">Create a room</button>`;
        if (F.app === 'settings') h = `<h4>Settings</h4><div class="row">Day length<span>${[24, 48, 96].map((m) => `<button class="${F.settings.dayMin === m ? '' : 'alt'}" data-act="day" data-m="${m}">${m} min</button>`).join(' ')}</span></div>
          <div class="row">Camera shake<button class="${F.settings.shake ? '' : 'alt'}" data-act="shake">${F.settings.shake ? 'On' : 'Off'}</button></div>
          <div class="row">Big subtitles<button class="${F.settings.subs === 'big' ? '' : 'alt'}" data-act="subs">${F.settings.subs === 'big' ? 'On' : 'Off'}</button></div>
          <div class="row"><small>Map data © OpenStreetMap contributors (ODbL)</small></div>`;
        if (F.app !== 'home') h = `<div style="cursor:pointer;color:#8ab4ff" data-app="home">‹ Home</div>` + h;
        scr.innerHTML = h;
      }
      scr.addEventListener('click', (e) => {
        const a = e.target.closest('[data-app]'); if (a) { F.app = a.dataset.app; render(); return; }
        const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
        const who = story.active, ch = story.chars[who], act = b.dataset.act;
        if (act === 'wp') setWaypoint(+b.dataset.x, +b.dataset.z);
        if (act === 'clearwp') { F.waypoint = null; F.route = null; }
        if (act === 'xfer') { const other = who === 'fareej' ? 'fatimah' : 'fareej'; const n = EC.transfer(ch, story.chars[other], 1000); message('Gulf Crescent Bank', `AED ${n} sent to ${S.CHARACTERS[other].name}.`); }
        if (act === 'payfines') { const due = city.C.fines[who].reduce((x, f) => x + f.amount, 0); if (due <= ch.money) { ch.money -= due; city.C.fines[who] = []; message('Dubai Police', `Fines of AED ${due} paid. Thank you.`); } }
        if (act === 'rideon') startRide(); if (act === 'rideoff') { endRide(); }
        if (act === 'deliver') deliver(+b.dataset.i);
        if (act === 'buycar') { const c = EC.CARS[b.dataset.id]; if (c.price <= ch.money) { ch.money -= c.price; F.owned[who].push({ id: b.dataset.id, paint: EC.PAINTS[0][1], tune: {} }); message('Autos Dubai', `Your ${c.name} is ready. Order it from My Cars.`); } }
        if (act === 'buyprop') { const p = EC.PROPERTY.find((x) => x.id === b.dataset.id); if (p.price <= ch.money) { ch.money -= p.price; F.property.push(p.id); message('Bayut Homes', `Keys to ${p.name} are yours. It's a save point now.`); } }
        if (act === 'buybiz') { const x = EC.BUSINESSES.find((y) => y.id === b.dataset.id); if (x.price <= ch.money) { ch.money -= x.price; F.business[x.id] = { day: city.C.day, owner: who }; message('Manager', `Welcome to ${x.name}. I'll send the takings to your bank every day.`); } }
        if (act === 'photo') { togglePhone(false); F.photo = true; root.classList.add('photo'); }
        if (act === 'day') F.settings.dayMin = +b.dataset.m;
        if (act === 'shake') F.settings.shake = !F.settings.shake;
        if (act === 'subs') { F.settings.subs = F.settings.subs === 'big' ? 'normal' : 'big'; $('.sub').style.fontSize = F.settings.subs === 'big' ? '30px' : ''; }
        save(); render();
      });
      $('.phone .homebtn').addEventListener('click', () => { F.app = 'home'; render(); });
      function togglePhone(on) { F.open = on === undefined ? !F.open : on; $('.phone').classList.toggle('on', F.open); if (F.open) { F.app = 'home'; render(); } }

      // ---- GPS
      function setWaypoint(x, z) { F.waypoint = { x, z }; F.routeT = 0; say('', 'WAYPOINT SET'); }
      function updateRoute(dt) {
        const tgt = F.ride ? F.ride.target : missionTarget() || F.waypoint;
        F.routeT -= dt;
        if (!tgt) { F.route = null; return; }
        if (F.routeT > 0 && F.route && F.route.to === tgt) return;
        F.routeT = 2;
        if (!F.graph) F.graph = NV.buildGraph(world.roads);
        const me = story.foot || car;
        const r = NV.route(F.graph, world.roads, me.x, me.z, tgt.x, tgt.z);
        // a route far longer than the straight line means the snap went to the wrong road: show the straight line instead
        const crow = Math.hypot(tgt.x - me.x, tgt.z - me.z);
        F.route = r && r.length < crow * 3 + 400 ? { pts: [me.x, me.z, ...r.points], to: tgt, len: r.length } : { pts: [me.x, me.z, tgt.x, tgt.z], to: tgt, len: crow };
        if (tgt === F.waypoint && Math.hypot(me.x - tgt.x, me.z - tgt.z) < 25) { F.waypoint = null; say('', 'YOU HAVE ARRIVED'); }
      }
      // drawn by drawMini (inside its transformed context)
      function drawRoute(g) {
        if (!F.route) return;
        const p = F.route.pts; g.strokeStyle = 'rgba(200,162,90,0.95)'; g.lineWidth = 9; g.lineCap = 'round'; g.lineJoin = 'round';
        g.beginPath(); g.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]); g.stroke();
        const t = F.route.to; g.fillStyle = '#f0c46c'; g.beginPath(); g.arc(t.x, t.z, 14, 0, 7); g.fill();
      }

      // ---- cars: models, tuning and paint
      function applyCar(who) {
        const o = F.owned[who][F.current[who]], c = cars[who], spec = EC.CARS[o.id];
        c.sim.spec = EC.specFor(new L.Car().spec, o.id, o.tune);
        c.mesh.body.scale.set(spec.body[0], spec.body[1], spec.body[2]);
        c.mesh.paint.color.set(o.paint);
      }
      function deliver(i) {
        const who = story.active, ch = story.chars[who]; if (ch.money < 250) return;
        ch.money -= 250; F.current[who] = i; applyCar(who);
        if (story.mode === 'foot') { const f = story.foot, c = cars[who].sim; c.x = f.x + Math.sin(f.heading) * 6; c.z = f.z - Math.cos(f.heading) * 6; c.y = f.y + 0.5; c.heading = f.heading + Math.PI / 2; c.vx = c.vz = 0; }
        message('My Cars', `Your ${EC.CARS[F.owned[who][i].id].name} has been delivered.`);
      }
      function garageStep() {
        const near = story.mode === 'drive' && Math.hypot(car.x - GARAGE.x, car.z - GARAGE.z) < 18 && Math.abs(car.speed) < 1.5;
        const el = $('.garagemenu');
        if (!near) { el.classList.remove('on'); return; }
        const who = story.active, o = F.owned[who][F.current[who]], price = EC.CARS[o.id].price || 62000;
        const rep = EC.repairCost(story.damage, price);
        const items = [[`Repair the damage`, rep], [`Paint: ${EC.PAINTS[(EC.PAINTS.findIndex((p) => p[1] === o.paint) + 1) % EC.PAINTS.length][0]}`, EC.PAINT_COST]];
        for (const part of Object.keys(EC.TUNE)) { const lv = o.tune[part] || 0; items.push(lv >= 3 ? [`${EC.TUNE[part].name}: fully upgraded`, null] : [`${EC.TUNE[part].name} level ${lv + 1}`, EC.tuneCost(part, lv + 1, price)]); }
        el.querySelector('.sub2').textContent = `${EC.CARS[o.id].name.toUpperCase()} · DAMAGE ${Math.round(Math.min(300, story.damage) / 3)}% · AED ${Math.round(story.chars[who].money).toLocaleString('en')}`;
        el.querySelector('ol').innerHTML = items.map(([n, c]) => `<li>${n}<span>${c === null ? '' : 'AED ' + c.toLocaleString('en')}</span></li>`).join('');
        el.classList.add('on'); F.garageItems = items;
      }
      window.addEventListener('keydown', (e) => {
        const k = e.key.toLowerCase();
        if (k === 'p') { if (F.photo) { F.photo = false; root.classList.remove('photo'); } else togglePhone(); }
        if (k === ' ' && F.photo) { e.preventDefault(); renderer.render(scene, camera); const u = renderer.domElement.toDataURL('image/jpeg', 0.85); F.gallery.unshift(u); F.gallery = F.gallery.slice(0, 6); say('', 'PHOTO SAVED TO THE GALLERY'); }
        if (/^[1-9]$/.test(k) && $('.garagemenu').classList.contains('on')) {
          const i = +k - 1, it = F.garageItems && F.garageItems[i]; if (!it || it[1] === null) return;
          const who = story.active, ch = story.chars[who], o = F.owned[who][F.current[who]];
          if (it[1] > ch.money) { say('Kiran', 'Cash first, habibi.'); return; }
          ch.money -= it[1]; city.C.moneyT = 3;
          if (i === 0) { story.damage = 0; F.smoke.forEach((s) => scene.remove(s.m)); F.smoke = []; say('Kiran', 'Good as new. Almost.'); }
          else if (i === 1) { o.paint = EC.PAINTS[(EC.PAINTS.findIndex((p) => p[1] === o.paint) + 1) % EC.PAINTS.length][1]; say('Kiran', 'Fresh paint. Nobody will know it.'); if (war.wanted().level) { war.wanted().clear(); say('', 'NEW PAINT · THE POLICE LOST YOU'); } }
          else { const part = Object.keys(EC.TUNE)[i - 2]; o.tune[part] = (o.tune[part] || 0) + 1; say('Kiran', `${EC.TUNE[part].name} done. Drive it gently for a day. Joking.`); }
          applyCar(who); save();
        }
      });

      // ---- the ride-hailing job
      function roadPointNear(x, z, minD, maxD) {
        for (let i = 0; i < 30; i++) {
          const a = Math.random() * Math.PI * 2, d = minD + Math.random() * (maxD - minD), px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
          const its = world.roadGrid.query(px, pz).filter((it) => { const r = world.roads[it.r]; return r.k >= 2 && r.k <= 4 && !r.b && !r.t; });
          if (its.length) { const r = world.roads[its[0].r], q = L.pointAt(r.p, r.cum, r.cum[its[0].k]); return { x: q.x - q.dz * (r.w / 2 - 1.5), z: q.z + q.dx * (r.w / 2 - 1.5), name: r.n || CY.districtAt(q.x, q.z).name }; }
        }
        return null;
      }
      function startRide() {
        if (story.active !== 'fareej') return;
        const p = roadPointNear(car.x, car.z, 300, 900); if (!p) { say('', 'NO RIDES NEARBY'); return; }
        F.ride = { stage: 'pickup', target: p, name: EC.RIDE_NAMES[Math.floor(Math.random() * EC.RIDE_NAMES.length)] };
        message('Sayara Ride', `New ride: ${F.ride.name}, ${p.name}.`);
      }
      function endRide() { F.ride = null; }
      function rideStep(dt) {
        const R = F.ride; if (!R || story.active !== 'fareej') return;
        const d = Math.hypot(car.x - R.target.x, car.z - R.target.z);
        if (R.stage === 'pickup' && d < 14 && Math.abs(car.speed) < 1.5 && story.mode === 'drive') {
          const to = roadPointNear(car.x, car.z, 1200, 4000); if (!to) return;
          Object.assign(R, { stage: 'drive', target: to, toName: to.name, from: { x: car.x, z: car.z }, t: 0, dmg0: story.damage, lineT: 6 });
          say(R.name, 'Hi! ' + to.name + ', please.'); F.routeT = 0;
        } else if (R.stage === 'drive') {
          R.t += dt; R.lineT -= dt;
          if (R.lineT <= 0) { R.lineT = 25 + Math.random() * 20; say(R.name, EC.RIDE_LINES[Math.floor(Math.random() * EC.RIDE_LINES.length)]); }
          if (d < 16 && Math.abs(car.speed) < 1.5) {
            const km = Math.hypot(car.x - R.from.x, car.z - R.from.z) / 1000, bumps = Math.floor((story.damage - R.dmg0) / 12);
            const res = EC.rideFare(km, R.t / 60, bumps);
            story.chars.fareej.money += res.total; city.C.moneyT = 4; F.rides++; F.stats.rides++;
            say('', `${'★'.repeat(res.rating)}${'☆'.repeat(5 - res.rating)} · FARE AED ${res.fare}${res.tip ? ' + TIP ' + res.tip : ''}`);
            startRide();
          }
        }
      }

      // ---- smoke from a damaged car
      const smokeMat = new THREE.MeshBasicMaterial({ color: '#555', transparent: true, opacity: 0.35, depthWrite: false });
      const smokeGeo = new THREE.SphereGeometry(0.4, 8, 6);
      function smokeStep(dt) {
        if (story.mode === 'drive' && story.damage > 150 && Math.random() < dt * (story.damage > 240 ? 18 : 7)) {
          const m = new THREE.Mesh(smokeGeo, smokeMat.clone()); const fx = Math.sin(car.heading), fz = -Math.cos(car.heading);
          m.position.set(car.x + fx * 1.8, car.y + 1, car.z + fz * 1.8); if (story.damage > 240) m.material.color.set('#222'); scene.add(m); F.smoke.push({ m, t: 1.6 });
        }
        F.smoke = F.smoke.filter((s) => { s.t -= dt; s.m.position.y += dt * 1.4; s.m.scale.multiplyScalar(1 + dt * 1.2); s.m.material.opacity = s.t * 0.22; if (s.t > 0) return true; scene.remove(s.m); s.m.material.dispose(); return false; });
      }

      // ---- businesses pay every game day
      function businessStep() {
        const day = city.C.day;
        for (const b of EC.BUSINESSES) { const o = F.business[b.id]; if (!o) continue; const pay = EC.businessIncome(b.perDay, day - o.day); if (pay > 0) { story.chars[o.owner].money += pay; o.day = day; message('Manager', `${b.name}: AED ${pay.toLocaleString('en')} paid in.`); } }
      }

      function frame(dt) {
        updateRoute(dt); rideStep(dt); garageStep(); smokeStep(dt);
        if (Math.random() < dt) businessStep();
        if (F.open && Math.random() < dt * 2) $('.phone .pt').textContent = clockText();
        F.stats.speed = Math.max(F.stats.speed, Math.abs(car.speed) * 3.6); F.stats.maxWanted = Math.max(F.stats.maxWanted, war.wanted().level);
        F.stats.fines = city.C.fines[story.active].reduce((a, f) => a + f.amount, 0);
        F.stats.policeWrecked = war.W.police.filter((p) => p.wreck).length + (F.stats._w || 0);
        if (!F.settings.shake) state.shake = 0;
      }
      // the camera in photo mode: free orbit around the player, drag to turn
      function photoCamera() { return F.photo; }
      function toJSON() { return { owned: F.owned, current: F.current, property: F.property, business: F.business, settings: F.settings, rides: F.rides, fines: city.C.fines, fuel: city.C.fuel }; }
      function fromJSON(j) { if (!j) return; for (const k of ['owned', 'current', 'property', 'business', 'settings']) if (j[k]) F[k] = j[k]; F.rides = j.rides || 0; if (j.fines) city.C.fines = j.fines; if (j.fuel) city.C.fuel = j.fuel; applyCar('fareej'); applyCar('fatimah'); }
      applyCar('fareej'); applyCar('fatimah');
      return { F, frame, drawRoute, setWaypoint, togglePhone, message, toJSON, fromJSON, photoCamera, applyCar };
    })();

    // ------------------------------------------------------------------ section 6: the story missions (Act 1 onwards)

    const MI = window.DesertHeatMissions;
    const acts = (() => {
      const A = { car: null, startBeacon: null, done: ['night-fare'] };
      const placeOf = (k) => MI.PLACES[k] || S.PLACES[k];

      function placeGarage(at) {
        garage.at = at; garage.grp.position.set(at.x, garage.y, at.z);
        garage.liftPos = { x: at.x + 26, z: at.z - 18.6 };
      }
      // a mission car: a separate car the player must drive (it replaces the character's car while the mission runs)
      function spawnMissionCar(spec) {
        const at = placeOf(spec.at), cid = spec.id;
        const mesh = makePlayerCar(carGeo, spec.paint); const e = EC.CARS[cid];
        mesh.body.scale.set(e.body[0], e.body[1], e.body[2]);
        const sim = new L.Car(); sim.spec = EC.specFor(new L.Car().spec, cid, {});
        // put it on the nearest street
        const keep = { x: car.x, z: car.z, y: car.y, h: car.heading, vx: car.vx, vz: car.vz };
        car.x = at.x; car.z = at.z; car.y = 30; resetCar(false);
        sim.x = car.x; sim.z = car.z; sim.y = car.y; sim.heading = car.heading;
        Object.assign(car, { x: keep.x, z: keep.z, y: keep.y, heading: keep.h, vx: keep.vx, vz: keep.vz });
        scene.add(mesh.group); mesh.group.position.set(sim.x, sim.y, sim.z); mesh.group.rotation.y = -sim.heading;
        A.car = { sim, mesh, damage: 0, owner: story.active, prev: cars[story.active] };
      }
      function removeMissionCar() {
        if (!A.car) return;
        const who = A.car.owner;
        if (cars[who] === A.car) { cars[who] = A.car.prev; if (story.active === who && story.mode === 'drive') { exitCar(); } }
        scene.remove(A.car.mesh.group); A.car = null;
      }
      // the player gets into the mission car with F when close (handled here, before the normal F)
      function missionCarStep() {
        const C = A.car; if (!C) return;
        if (cars[C.owner] !== C) { const m = C.mesh, s = C.sim; m.group.position.set(s.x, s.y, s.z); m.group.rotation.y = -s.heading; m.beam.intensity = 0; }
        const f = story.foot;
        if (f && Math.hypot(C.sim.x - f.x, C.sim.z - f.z) < 3.6) {
          story.prompt = 'F  GET IN';
          if (state.keys.has('f')) { state.keys.delete('f'); cars[C.owner] = C; enterCar(); }
        }
        if (story.mode === 'drive' && cars[story.active] === C) C.damage = story.damage - (C.dmg0 || 0);
      }

      function stepStart() {
        const m = story.mission, st = m.step, su = st.setup || {};
        MS.line = 0; objective(st.objective || '');
        root.classList.toggle('cut', !!st.cut);
        if (st.cut) story.mode = 'cut'; else if (story.mode === 'cut') story.mode = story.foot ? 'foot' : 'drive';
        if (A.npc) { scene.remove(A.npc.group); A.npc = null; }
        if (su.npc) {
          const me = story.foot || car, h = story.foot ? story.foot.heading : car.heading;
          const n = P.makePerson(MI.CAST[su.npc]); const x = me.x + Math.sin(h) * 1.6, z = me.z - Math.cos(h) * 1.6;
          const sup = supportAt(x, z, (me.y || 0) + 1); n.group.position.set(x, (me.y || 0) < -20 ? me.y : sup ? sup.y : 0, z); n.group.rotation.y = -(h + Math.PI);
          scene.add(n.group); A.npc = n;
          if (story.foot) persons[story.active].group.rotation.y = -h;
        }
        if (su.give) { war.W.arms[story.active].give(su.give.weapon, su.give.mags || 2); war.W.arms[story.active].select(su.give.weapon); war.showGun(); }
        if (su.spawnCar) { removeMissionCar(); spawnMissionCar(su.spawnCar); A.car.dmg0 = story.damage; }
        if (su.wanted) { const me = story.foot || car; war.wanted().crime(su.wanted >= 2 ? 'shotsFired' : 'ramCop', me.x, me.z); }
        if (st.forceSwitch && story.active !== st.who) switchTo(st.who, true);
        if (su.placeNear) { const p = placeOf(su.placeNear), ch = story.chars[st.who]; ch.inCar = false; if (story.foot && story.active === st.who) { story.foot.x = p.x + 14; story.foot.z = p.z + 6; story.foot.y = 30; } }
        if (su.room) { const r = rooms[su.room]; r.grp.visible = true; story.inside = null; A.room = r; }
        if (su.garage) {
          const at = placeOf(su.garage); placeGarage(at); garage.grp.visible = true;
          if (story.mode === 'drive') exitCar();
          story.foot.x = at.x - 24; story.foot.z = at.z + 10; story.foot.y = garage.y; story.foot.heading = Math.PI / 2; story.camYaw = story.foot.heading;
          if (story.guard) scene.remove(story.guard.p.group);
          story.guard = makeGuard(); story.guard.x = at.x + 6; story.guard.z = at.z; story.guard.down = false;
        }
        if (su.shopCut) {
          const me = story.foot || car;
          const s = { ...su.shopCut, x: me.x, z: me.z, nx: 0, nz: 1, dx: 1, dz: 0, w: 8, enterable: true };
          city.fillShop(s); A.shopCut = s;
          if (su.shopCut.both) { for (const id of ['fareej', 'fatimah']) { const p = persons[id]; p.group.visible = true; p.setPose('sit'); p.group.position.set(me.x + (id === 'fareej' ? -2.6 : -1.4), -120, me.z + 1); p.group.rotation.y = id === 'fareej' ? -Math.PI / 2 : Math.PI / 2; } }
          garage.grp.visible = false;
          if (story.guard) { scene.remove(story.guard.p.group); story.guard = null; }
        }
        if (m.def.hour !== undefined && m.i === 0) { state.hour = m.def.hour; }
        // leaving a cut-scene room
        if (!st.cut && A.room) { A.room.grp.visible = false; A.room = null; }
        if (!st.cut && A.shopCut) { city.C.interior = null; A.shopCut = null; }
      }
      function finish() {
        const m = story.mission, def = m.def;
        A.done.push(def.id); story.complete = true;
        if (def.reward) { story.chars[def.who].money += def.reward; }
        removeMissionCar(); garage.grp.visible = false; placeGarage(S.PLACES.marinaGarage);
        if (A.npc) { scene.remove(A.npc.group); A.npc = null; }
        if (story.guard) { scene.remove(story.guard.p.group); story.guard = null; }
        if (A.room) { A.room.grp.visible = false; A.room = null; }
        if (A.shopCut) { const s = A.shopCut; A.shopCut = null; for (const id of ['fareej', 'fatimah']) { persons[id].setPose('stand'); persons[id].group.visible = false; } }
        root.classList.remove('cut');
        story.mission = null; objective('');
        story.mode = story.foot ? 'foot' : 'drive';
        if (story.mode === 'cut' || (!story.foot && !story.chars[story.active].inCar)) { story.mode = 'drive'; }
        if (def.id === 'same-name' || (story.foot && story.foot.y < -20) || (story.foot && story.foot.y < -100)) {
          // back out on the street after the last scene
          const at = def.id === 'same-name' ? MI.PLACES.karama : S.PLACES.fareejHome;
          if (story.foot) { story.foot.x = at.x + 8; story.foot.z = at.z + 4; story.foot.y = 30; story.foot.vy = 0; persons[story.active].group.visible = true; }
        }
        $('.card h2').textContent = def.title.toUpperCase();
        $('.card .l1').textContent = def.reward ? `Paid: AED ${def.reward.toLocaleString('en')}` : 'Mission passed';
        const next = MI.nextMission(A.done);
        $('.card .l2').textContent = next ? `Next: ${next.title} (${S.CHARACTERS[next.who].name})` : 'Act 1 complete. Act 2 comes in the next section.';
        $('.card .l3').textContent = '';
        $('.card').style.display = 'block';
        if (next) life.message(next.who === 'fareej' ? 'Uncle Rashid' : 'Unknown number', `${next.title}: meet at ${placeOf(next.start).name}.`);
        state.timeRuns = true; save();
      }
      function start(def) {
        const m = new S.Mission(def); story.mission = m; MS.line = 0;
        if (story.active !== def.who) switchTo(def.who, true);
        stepStart();
      }
      function ctx() {
        const me = story.foot || car, C = A.car;
        return {
          pos: { x: me.x, z: me.z }, speed: story.mode === 'drive' ? Math.abs(car.speed) : 0, wanted: war.wanted().level,
          inMissionCar: !!C && story.mode === 'drive' && car === C.sim, missionCarDamage: C ? C.damage : 0,
          missionCarLost: !!C && cars[C.owner] === C && story.mode === 'foot' && Math.hypot(C.sim.x - me.x, C.sim.z - me.z) > 250,
        };
      }
      function runEvents(dt) {
        const m = story.mission, st = m.step;
        for (const ev of st.events || []) if (!m.data['ev' + st.events.indexOf(ev)] && ev.at(ctx(), m)) {
          m.data['ev' + st.events.indexOf(ev)] = true; m.data.cops = true;
          if (ev.run === 'wanted1') { war.wanted().crime('ramCop', car.x, car.z); }
          if (ev.say) say(ev.say[0], ev.say[1]);
        }
      }
      // free roam: the next mission's start is a column of light; walk or drive into it with the right character
      function freeRoam() {
        const next = MI.nextMission(A.done); if (!next || story.mission) return null;
        const at = placeOf(next.start), me = story.foot || car;
        if (story.active === next.who && Math.hypot(me.x - at.x, me.z - at.z) < (story.foot ? 6 : 14) && !war.wanted().level) {
          story.prompt = story.prompt || `E  START "${next.title.toUpperCase()}"`;
          if (state.keys.has('e')) { state.keys.delete('e'); $('.card').style.display = 'none'; start(next); }
        }
        return at;
      }
      function cutCamera(dt) {
        const m = story.mission, st = m.step, t = m.t;
        if (A.room) { const gp = A.room.grp.position; camera.position.set(gp.x + 0.6 + t * 0.06, gp.y + 1.5, gp.z + 1.4 - t * 0.05); camera.lookAt(gp.x + 2.2, gp.y + 0.9, gp.z - 0.6); return true; }
        if (A.shopCut) { const s = A.shopCut; camera.position.set(s.x + 2.2 - t * 0.05, -120 + 1.6, s.z + 3.2); camera.lookAt(s.x - 2, -120 + 0.9, s.z + 1); return true; }
        if (A.npc) A.npc.update(dt, 0, false);
        const me = story.foot || car, a = t * 0.12;
        camera.position.set(me.x + Math.cos(a) * 6, (me.y || 0) + 2.2, me.z + Math.sin(a) * 6); camera.lookAt(me.x, (me.y || 0) + 1.2, me.z);
        if (story.foot) persons[story.active].update(dt, 0, false);
        return true;
      }
      return { A, start, stepStart, finish, ctx, runEvents, freeRoam, missionCarStep, cutCamera, placeOf, placeGarage, removeMissionCar };
    })();

    // ------------------------------------------------------------------ maps

    const mini = $('.mini'), mg = mini.getContext('2d');
    function drawMini() {
      const S = 380, scale = 0.42, cx = S / 2, cy = S / 2;     // 0.42 px per metre: about 450 m across
      mg.fillStyle = '#1b1b19'; mg.fillRect(0, 0, S, S);
      mg.save(); mg.translate(cx, cy); mg.rotate(-car.heading); mg.scale(scale, scale); mg.translate(-car.x, -car.z);
      const R = 600;
      mg.lineCap = 'round'; mg.lineJoin = 'round';
      for (const pass of [0, 1]) for (const r of world.roads) {
        const b = r.box; if (b[2] < car.x - R || b[0] > car.x + R || b[3] < car.z - R || b[1] > car.z + R) continue;
        mg.strokeStyle = pass === 0 ? '#0e0e0d' : (r.k <= 1 || r.k === 5 ? '#c8a25a' : r.k <= 2 ? '#8e8a80' : '#5f5c56');
        mg.lineWidth = Math.max(r.w, 6) + (pass === 0 ? 4 : 0);
        mg.beginPath(); mg.moveTo(r.p[0], r.p[1]); for (let i = 2; i < r.p.length; i += 2) mg.lineTo(r.p[i], r.p[i + 1]); mg.stroke();
      }
      life.drawRoute(mg);
      mg.restore();
      // the player
      mg.fillStyle = '#efe9dc'; mg.beginPath(); mg.moveTo(cx, cy - 13); mg.lineTo(cx + 8, cy + 9); mg.lineTo(cx, cy + 4); mg.lineTo(cx - 8, cy + 9); mg.closePath(); mg.fill();
      // north
      const nx = cx + Math.sin(-car.heading) * -170, ny = cy - Math.cos(-car.heading) * 170;
      mg.fillStyle = '#c8a25a'; mg.font = '600 24px "Avenir Next Condensed","Arial Narrow",sans-serif'; mg.textAlign = 'center'; mg.textBaseline = 'middle'; mg.fillText('N', nx, ny);
    }

    let bigMapImg = null, bigMapView = null;
    function drawBigMap() {
      const cv = $('.bigmap canvas'), w = cv.clientWidth, h = cv.clientHeight; cv.width = w * 2; cv.height = h * 2;
      const g = cv.getContext('2d');
      let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
      for (const r of world.roads) { minX = Math.min(minX, r.box[0]); minZ = Math.min(minZ, r.box[1]); maxX = Math.max(maxX, r.box[2]); maxZ = Math.max(maxZ, r.box[3]); }
      const sc = Math.min(cv.width / (maxX - minX), cv.height / (maxZ - minZ)) * 0.92;
      const ox = cv.width / 2 - (minX + maxX) / 2 * sc, oz = cv.height / 2 - (minZ + maxZ) / 2 * sc;
      bigMapView = { sc, ox, oz };
      g.fillStyle = '#0d1418'; g.fillRect(0, 0, cv.width, cv.height);
      g.save(); g.translate(ox, oz); g.scale(sc, sc);
      g.lineCap = 'round';
      for (const r of world.roads) {
        g.strokeStyle = r.k <= 1 || r.k === 5 ? '#c8a25a' : r.k <= 2 ? '#9a958a' : '#4f4d48'; g.lineWidth = (r.k <= 1 ? 3 : 1.6) / sc;
        g.beginPath(); g.moveTo(r.p[0], r.p[1]); for (let i = 2; i < r.p.length; i += 2) g.lineTo(r.p[i], r.p[i + 1]); g.stroke();
      }
      g.restore();
      const px = ox + car.x * sc, pz = oz + car.z * sc;
      g.fillStyle = '#efe9dc'; g.beginPath(); g.arc(px, pz, 9, 0, 7); g.fill(); g.strokeStyle = '#c8a25a'; g.lineWidth = 3; g.beginPath(); g.arc(px, pz, 16, 0, 7); g.stroke();
    }
    $('.bigmap').addEventListener('click', (e) => {
      if (!bigMapView) return;
      const cv = $('.bigmap canvas'), rect = cv.getBoundingClientRect();
      const x = ((e.clientX - rect.left) * 2 - bigMapView.ox) / bigMapView.sc, z = ((e.clientY - rect.top) * 2 - bigMapView.oz) / bigMapView.sc;
      if (e.shiftKey && story.mode === 'drive') { car.x = x; car.z = z; car.y = 30; resetCar(false); } else life.setWaypoint(x, z);   // shift-click jumps there (test build)
      state.mapOn = false; $('.bigmap').classList.remove('on');
    });

    // ------------------------------------------------------------------ the frame

    const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
    let lastT = performance.now(), fpsN = 0, fpsT = 0, miniT = 0, tileT = 0, placeT = 0;
    let raf = 0;

    function setTimeOfDay() {
      const s = L.sunAt(state.hour, TODAY), k = skyAt(s.elevation);
      const night = Math.max(0, Math.min(1, (2 - s.elevation) / 9));
      U.uNight.value = night;
      sky.material.uniforms.uSun.value.set(s.x, s.y, s.z);
      sky.material.uniforms.uZenith.value.copy(k.zen); sky.material.uniforms.uHorizon.value.copy(k.hor); sky.material.uniforms.uSunCol.value.copy(k.sun);
      scene.fog.color.copy(k.hor).multiplyScalar(0.92);
      scene.fog.density = 0.00022 + night * 0.00012;
      // a moon-ish fill light at night so it is never pitch black
      const lightDir = s.elevation > -4 ? new THREE.Vector3(s.x, Math.max(s.y, 0.05), s.z) : new THREE.Vector3(-0.3, 0.6, 0.4);
      sun.position.copy(lightDir).normalize().multiplyScalar(400).add(sun.target.position);
      sun.color.copy(s.elevation > -4 ? k.sun : new THREE.Color('#7f93b8'));
      sun.intensity = s.elevation > -4 ? k.light : 0.18;
      hemi.intensity = k.amb; hemi.color.copy(k.zen).lerp(new THREE.Color('#ffffff'), 0.35); hemi.groundColor.set(night > 0.5 ? '#5a4030' : '#9a8463');
      renderer.toneMappingExposure = 0.92 + night * 0.2;
      mats.lampHead.emissiveIntensity = night * 3;
      if (world && world.glowMat) world.glowMat.opacity = night * 0.85;
      player.head.emissiveIntensity = night * 3; player.beam.intensity = night * 60; player.tail.emissiveIntensity = 0.3 + night * 1.2;
      // Refresh the reflection map when the light has changed enough.
      if (Math.abs(state.hour - envAt) > 0.25) {
        envAt = state.hour; if (envRT) envRT.dispose();
        envRT = pmrem.fromScene(envScene, 0, 1, 40000); scene.environment = envRT.texture;
      }
      const hh = Math.floor(state.hour), mm = Math.floor((state.hour - hh) * 60);
      $('.clock').textContent = String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
      return night;
    }

    function step() {
      raf = requestAnimationFrame(step);
      const now = performance.now(); let dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
      U.uTime.value += dt;
      if (state.timeRuns) { state.hour = (state.hour + dt * 24 / ((typeof life !== 'undefined' ? life.F.settings.dayMin : 48) * 60)) % 24; if (!$('.panel').classList.contains('on')) slider.value = state.hour; }
      const night = setTimeOfDay();
      if (!state.loaded) { camera.position.set(0, 300, 600); camera.lookAt(0, 0, 0); renderer.render(scene, camera); return; }

      // ---- input
      const K = state.keys;
      const throttle = K.has('w') || K.has('arrowup') ? 1 : 0, brake = K.has('s') || K.has('arrowdown') ? 1 : 0;
      const steer = (K.has('d') || K.has('arrowright') ? 1 : 0) - (K.has('a') || K.has('arrowleft') ? 1 : 0);
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      let pad = null; for (const p of pads) if (p) { pad = p; break; }
      const input = { throttle: city.fuelEmpty() ? 0 : throttle, brake, steer, handbrake: K.has(' ') };
      if (pad) {
        const rt = pad.buttons[7] ? pad.buttons[7].value : 0, lt = pad.buttons[6] ? pad.buttons[6].value : 0, sx = Math.abs(pad.axes[0]) > 0.12 ? pad.axes[0] : 0;
        input.throttle = Math.max(input.throttle, rt); input.brake = Math.max(input.brake, lt); if (sx) input.steer = sx; if (pad.buttons[0] && pad.buttons[0].pressed) input.handbrake = true;
        if (Math.abs(pad.axes[2] || 0) > 0.15) state.orbitTarget = (pad.axes[2] || 0) * 2.6;
      }

      // ---- physics, in small steps (slower while Road Sense is on)
      const pdt = story.sense > 0 ? dt * 0.4 : dt;
      if (story.mode === 'drive') {
      const sub = Math.ceil(pdt / (1 / 120)), h = pdt / sub;
      for (let i = 0; i < sub; i++) {
        car.step(h, input);
        // ground and decks
        const sup = supportAt(car.x, car.z, car.y);
        const gy = sup ? sup.y : 0;
        if (car.y > gy + 0.25) { car.vy = (car.vy || 0) - 9.81 * h; car.y += car.vy * h; if (car.y < gy) { car.y = gy; if (car.vy < -6) { audio.thump(-car.vy); state.shake = 0.3; } car.vy = 0; } }
        else { car.y += (gy - car.y) * Math.min(1, h * 25); car.vy = 0; }
        // bridge parapets: if we were on a deck and are about to leave its side, bounce off
        if (lastSupport && lastSupport.r.b && lastSupport.y > 2) {
          const r = lastSupport.r, p = r.p, k = lastSupport.k;
          const s = L.nearestOnSegment(car.x, car.z, p[k * 2], p[k * 2 + 1], p[k * 2 + 2], p[k * 2 + 3]);
          const lim = r.w / 2 + 0.3;
          if (s.d > lim && s.t > 0.001 && s.t < 0.999 && (!sup || sup.y < lastSupport.y - 1)) {
            const nx = (s.px - car.x) / s.d, nz = (s.pz - car.z) / s.d;
            const v = car.hit(nx, nz, s.d - lim); if (v > 3) { audio.thump(v); state.shake = Math.min(0.4, v / 40); }
            continue;
          }
        }
        if (sup) lastSupport = sup;
        // buildings: two circles along the car
        if (car.y < 40) for (const o of [-1.3, 1.3]) {
          const cx = car.x + Math.sin(car.heading) * o, cz = car.z - Math.cos(car.heading) * o;
          for (const wl of world.wallGrid.query(cx, cz)) {
            const s = L.nearestOnSegment(cx, cz, wl.ax, wl.az, wl.bx, wl.bz);
            if (s.d < 1.05 && s.d > 1e-4) { const v = car.hit((cx - s.px) / s.d, (cz - s.pz) / s.d, 1.05 - s.d); if (v > 3) { audio.thump(v); state.shake = Math.min(0.4, v / 40); } }
          }
        }
        // traffic
        for (const t of traffic.cars) {
          const dx = car.x - t.x, dz = car.z - t.z, dd = Math.hypot(dx, dz);
          if (dd < 2.6 && Math.abs(car.y - t.y) < 2 && dd > 1e-3) { const v = car.hit(dx / dd, dz / dd, 2.6 - dd); if (v > 2) { audio.thump(v); state.shake = Math.min(0.3, v / 40); t.stopT = 4; t.speed *= 0.3; } }
        }
        city.collide(car);
      }
      }
      updateTraffic(pdt);
      storyFrame(dt, K);

      // ---- car visuals
      player.group.position.set(car.x, car.y, car.z);
      player.group.rotation.y = -car.heading;
      player.body.rotation.x = THREE.MathUtils.clamp(-car.ax * 0.006, -0.05, 0.05);   // nose dips under braking
      player.body.rotation.z = THREE.MathUtils.clamp(car.ay * 0.007, -0.06, 0.06);    // body roll in turns
      const spin = car.speed / 0.31 * dt;
      player.wheels.forEach((w, i) => { w.children.forEach((c) => { c.rotation.z -= spin; }); if (i < 2) w.rotation.y = Math.PI / 2 - car.steer; });
      player.tail.emissive.set(input.brake && car.gear > 0 && car.speed > 0.5 ? '#ff2a1a' : '#ff1a10');
      player.tail.emissiveIntensity = (input.brake && car.speed > 0.5 ? 2.5 : 0.3) + night * 1.2;
      audio.update(car, input.throttle);

      // ---- camera
      state.orbit += (state.orbitTarget - state.orbit) * Math.min(1, dt * 4);
      if (!dragging && !pad) state.orbitTarget *= Math.pow(0.15, dt);
      const sp = Math.abs(car.speed);
      if (storyCamera(dt)) { /* on foot, a cut-scene or the switch flight */ } else if (state.cam === 2) {   // bonnet
        const fx = Math.sin(car.heading), fz = -Math.cos(car.heading);
        camPos.set(car.x + fx * 0.4, car.y + 1.25, car.z + fz * 0.4);
        camera.position.copy(camPos); camera.lookAt(car.x + fx * 20, car.y + 1.0, car.z + fz * 20);
        camera.fov = 70;
      } else {
        const far = state.cam === 1;
        const dist = (far ? 10.5 : 6.6) + sp * 0.05, hgt = (far ? 3.6 : 2.25) + sp * 0.012;
        // trail the direction of travel a little so drifts show the car's side
        const vh = sp > 3 ? Math.atan2(car.vx, -car.vz) : car.heading;
        let dh = vh - car.heading; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
        const yaw = car.heading + dh * 0.35 + state.orbit + (car.gear === -1 && sp > 1 ? 0 : 0);
        const want = new THREE.Vector3(car.x - Math.sin(yaw) * dist, car.y + hgt, car.z + Math.cos(yaw) * dist);
        // keep the camera out of buildings by pulling it in
        camPos.lerp(want, Math.min(1, dt * 7));
        if (camPos.distanceTo(want) > 40) camPos.copy(want);
        camera.position.copy(camPos);
        camLook.set(car.x + Math.sin(car.heading) * 2.5, car.y + 1.1, car.z - Math.cos(car.heading) * 2.5);
        camera.lookAt(camLook);
        camera.fov = 60 + Math.min(sp * 0.22, 16);
      }
      if (state.shake > 0) { camera.position.x += (Math.random() - 0.5) * state.shake; camera.position.y += (Math.random() - 0.5) * state.shake; state.shake = Math.max(0, state.shake - dt); }
      camera.updateProjectionMatrix();

      // ---- world streaming
      sun.target.position.set(car.x, car.y, car.z);
      setTimeOfDay();
      tileT -= dt; if (tileT <= 0) { tileT = 0.5; updateTiles(car.x, car.z);
        for (const c of world.chunks.values()) {
          const d = Math.hypot(c.x - car.x, c.z - car.z);
          c.group.visible = d < VIEW.roads;
          if (d < VIEW.furniture) furnish(c); else if (d > VIEW.furniture + 500) unfurnish(c);
        }
      }
      pumpTiles(); pumpTiles();
      mats.water.normalMap.offset.set(U.uTime.value * 0.006, U.uTime.value * 0.004);
      drawTraffic(night);

      // ---- HUD
      $('.speedo b').textContent = Math.round(sp * 3.6);
      $('.speedo i').textContent = car.gear === -1 ? 'R' : sp < 0.3 && !input.throttle ? 'N' : String(car.gear);
      $('.rpm div').style.width = Math.min(100, car.rpm / car.spec.redline * 100) + '%';
      miniT -= dt; if (miniT <= 0) { miniT = 1 / 15; drawMini(); }
      placeT -= dt; if (placeT <= 0) { placeT = 0.6; showPlace(); }
      fpsN++; fpsT += dt; if (fpsT > 0.5) { if (state.fpsOn) $('.fps').textContent = `${Math.round(fpsN / fpsT)} FPS · ${renderer.info.render.calls} DRAWS · ${(renderer.info.render.triangles / 1e6).toFixed(2)}M TRIS · ${world.tiles.size} TILES · ${traffic.cars.length} CARS`; fpsN = 0; fpsT = 0; }
      if (state.shake > 0.2) { root.classList.remove('shake'); void root.offsetWidth; }

      renderer.render(scene, camera);
    }

    function showPlace() {
      const sup = supportAt(car.x, car.z, car.y + 0.5);
      let r = sup && sup.r;
      if (!r || !r.n) {
        let bd = 60;
        for (const it of world.roadGrid.query(car.x, car.z)) { const rr = world.roads[it.r]; if (!rr.n) continue; const p = rr.p, k = it.k; const s = L.nearestOnSegment(car.x, car.z, p[k * 2], p[k * 2 + 1], p[k * 2 + 2], p[k * 2 + 3]); if (s.d < bd) { bd = s.d; r = rr; } }
      }
      const key = r ? (r.n || '') : '';
      if (key === state.lastPlace) return;
      state.lastPlace = key;
      $('.place .en').textContent = r && r.n ? r.n : '';
      $('.place .ar').textContent = r && r.a ? r.a : '';
      $('.place .meta').textContent = r ? [r.r, r.s ? 'LIMIT ' + r.s : ''].filter(Boolean).join(' · ') : '';
      $('.place').style.opacity = r && r.n ? '1' : '0';
    }

    function resize() {
      const w = host.clientWidth || window.innerWidth, h = host.clientHeight || window.innerHeight;
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    }
    const ro = new ResizeObserver(resize); ro.observe(host); resize();
    raf = requestAnimationFrame(step);

    // test hooks (used by the Playwright review script): place the car and set the time
    root.__dh = {
      get ready() { return state.loaded; },
      at(lat, lon, hour, headingDeg) {
        const o = { lat: 25.17, lon: 55.24 }, mLon = 111320 * Math.cos(o.lat * Math.PI / 180);
        car.x = (lon - o.lon) * mLon; car.z = -(lat - o.lat) * 110574; car.y = 30; resetCar(false);
        if (headingDeg !== undefined) car.heading = headingDeg * Math.PI / 180;
        if (hour !== undefined) { state.hour = hour; state.timeRuns = false; }
        updateTiles(car.x, car.z); tileT = 0;
      },
      setHour(h) { state.hour = h; state.timeRuns = false; },
      press(k, on) { if (on) state.keys.add(k); else state.keys.delete(k); },
      get car() { return car; },
      get story() { return story; },
      get city() { return city; },
      get war() { return war; },
      get life() { return life; },
      get acts() { return acts; },
      exit() { if (story.mode === 'drive') { car.vx = car.vz = 0; exitCar(); } },
      // jump the running mission to a step (review screenshots and tests)
      toStep(id) { const m = story.mission; if (!m) return; while (m.step && m.step.id !== id) { m.next(); if (m.done) break; } if (!m.done) { m.checkpoint = m.i; onStepStart(); } },
      placeCar(x, z, hd) { car.x = x; car.z = z; car.y = 30; resetCar(false); if (hd !== undefined) car.heading = hd; },
      startMission() { startMission(); },
      switchTo(id, instant) { switchTo(id, instant); },
      get pending() { return tileQueue.length + (tileBusy ? 1 : 0); },
      info() { return { calls: renderer.info.render.calls, tris: renderer.info.render.triangles, tiles: world ? world.tiles.size : 0 }; },
    };

    return function stop() {
      state.stopped = true;
      cancelAnimationFrame(raf); ro.disconnect();
      window.removeEventListener('keydown', down); window.removeEventListener('keyup', up);
      audio.stop();
      renderer.dispose(); if (envRT) envRT.dispose(); pmrem.dispose();
      root.remove();
    };
  }

  window.NotchDesertHeat = { mount };
})();
