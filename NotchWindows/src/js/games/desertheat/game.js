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
      <div class="hint"><kbd>W A S D</kbd> drive &nbsp;·&nbsp; <kbd>SPACE</kbd> hand brake &nbsp;·&nbsp; <kbd>C</kbd> camera &nbsp;·&nbsp; <kbd>M</kbd> map &nbsp;·&nbsp; <kbd>T</kbd> time of day &nbsp;·&nbsp; <kbd>R</kbd> reset car</div>
      <div class="panel"><h4>TIME OF DAY</h4><input type="range" min="0" max="24" step="0.05"><div class="row">
        <button data-h="6.2">Dawn</button><button data-h="12">Noon</button><button data-h="17.25">Sunset</button><button data-h="21.5">Night</button></div>
        <label><input type="checkbox" class="run" checked> Time passes (48 min a day)</label></div>
      <div class="fps"></div>
      <div class="bigmap"><canvas></canvas><div class="t">DUBAI · CLICK TO MOVE THERE (TEST BUILD)</div><div class="credit">Map data © OpenStreetMap contributors</div></div>
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
      if (k === 'f3' || k === 'f') { state.fpsOn = !state.fpsOn; $('.fps').style.display = state.fpsOn ? 'block' : 'none'; }
      if (k === 'r' && world) resetCar();
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
        state.loaded = true;
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
    const player = makePlayerCar(carGeo, '#d9d6cf');
    scene.add(player.group);
    const car = new L.Car();
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
      while (traffic.cars.length < traffic.max) spawnTraffic();
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
      car.x = x; car.z = z; car.y = 30; resetCar(false);
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
      if (state.timeRuns) { state.hour = (state.hour + dt * 24 / (48 * 60)) % 24; if (!$('.panel').classList.contains('on')) slider.value = state.hour; }
      const night = setTimeOfDay();
      if (!state.loaded) { camera.position.set(0, 300, 600); camera.lookAt(0, 0, 0); renderer.render(scene, camera); return; }

      // ---- input
      const K = state.keys;
      const throttle = K.has('w') || K.has('arrowup') ? 1 : 0, brake = K.has('s') || K.has('arrowdown') ? 1 : 0;
      const steer = (K.has('d') || K.has('arrowright') ? 1 : 0) - (K.has('a') || K.has('arrowleft') ? 1 : 0);
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      let pad = null; for (const p of pads) if (p) { pad = p; break; }
      const input = { throttle, brake, steer, handbrake: K.has(' ') };
      if (pad) {
        const rt = pad.buttons[7] ? pad.buttons[7].value : 0, lt = pad.buttons[6] ? pad.buttons[6].value : 0, sx = Math.abs(pad.axes[0]) > 0.12 ? pad.axes[0] : 0;
        input.throttle = Math.max(input.throttle, rt); input.brake = Math.max(input.brake, lt); if (sx) input.steer = sx; if (pad.buttons[0] && pad.buttons[0].pressed) input.handbrake = true;
        if (Math.abs(pad.axes[2] || 0) > 0.15) state.orbitTarget = (pad.axes[2] || 0) * 2.6;
      }

      // ---- physics, in small steps
      const sub = Math.ceil(dt / (1 / 120)), h = dt / sub;
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
      }
      updateTraffic(dt);

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
      if (state.cam === 2) {   // bonnet
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
