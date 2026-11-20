// Desert Heat section 9: the E11 to Abu Dhabi, the desert and its dunes, Abu Dhabi island, Yas Island and its circuit,
// boats and jet skis. The real Dubai map ends at Jebel Ali; this region is generated from rules (the map download for it was
// not available), joined to the real E11 where the data stops, and shortened: about 20 km of motorway instead of 120.
// Same coordinates as the rest of the game (metres, x east, z south). window.DesertHeatRegion / node.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./logic.js'));
  else root.DesertHeatRegion = factory(root.DesertHeatLogic);
}(typeof self !== 'undefined' ? self : this, function (L) {
  'use strict';
  const rnd = (seed) => { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };
  const r1 = (v) => Math.round(v * 10) / 10;

  /** The south-west end of the real E11 (Sheikh Zayed Road) in the map data: where the generated motorway carries on. */
  function findE11End(roads) {
    let best = null, score = -Infinity;
    for (const r of roads) {
      if (r.k !== 0 || !/Sheikh Zayed|E11/.test((r.n || '') + (r.r || ''))) continue;
      const n = r.p.length / 2;
      for (let i = 0; i < n; i++) { const x = r.p[i * 2], z = r.p[i * 2 + 1], s = z - x; if (s > score) { score = s; best = { x, z }; } }
    }
    return best || { x: -11500, z: 11500 };
  }

  // The layout, all relative to the E11's end. The motorway heads south-west (towards -x, +z).
  const DIR = { x: -Math.SQRT1_2, z: Math.SQRT1_2 }, SIDE = { x: Math.SQRT1_2, z: Math.SQRT1_2 };   // SIDE points inland (south-east)
  const E11_LEN = 19000;

  function layout(end) {
    const at = (s, d) => ({ x: end.x + DIR.x * s + SIDE.x * d, z: end.z + DIR.z * s + SIDE.z * d });
    return {
      end, at,
      desert: { s0: 1500, s1: 16000, d0: 300, d1: 9000 },                 // inland of the motorway
      camp: at(8000, 3800),
      mosque: at(E11_LEN - 200, 900),
      abuDhabi: at(E11_LEN + 4200, -500),                                   // the island's centre
      yas: at(E11_LEN - 3500, -3800),
      marinaJetski: { x: -10950, z: 9550 },
    };
  }

  // a gently curving polyline from a to b
  function curve(a, b, n, bend, seed) {
    const rand = rnd(seed), out = [];
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz), px = -dz / len, pz = dx / len;
    const ph = rand() * 6;
    for (let i = 0; i <= n; i++) { const t = i / n, w = Math.sin(t * Math.PI) * Math.sin(t * 2.3 + ph) * bend; out.push(r1(a.x + dx * t + px * w), r1(a.z + dz * t + pz * w)); }
    return out;
  }
  const road = (k, l, o, s, n, a, r, p, extra) => Object.assign({ k, l, o, s, n, a, r, p, gen: 1 }, extra || {});   // gen: made by rules, not map data

  /** All generated roads, in the map converter's format. Shared end points join them into one network (and to the real E11). */
  function roads(end) {
    const Lo = layout(end), out = [];
    const e11 = curve(end, Lo.at(E11_LEN, 0), 60, 160, 11);
    // UAE traffic keeps right: the south-west bound carriageway is on the north-west side
    const sw = [r1(end.x), r1(end.z)].concat(Array.from(L.offset(e11, -11)).slice(2).map(r1));
    const neFwd = Array.from(L.offset(e11, 11)).map(r1); const ne = []; for (let i = neFwd.length - 2; i >= 2; i -= 2) ne.push(neFwd[i], neFwd[i + 1]); ne.push(r1(end.x), r1(end.z));
    // the bridge leaves from the end of the south-west carriageway, and the north-east one starts there too
    const swEnd = { x: sw[sw.length - 2], z: sw[sw.length - 1] };
    ne.unshift(swEnd.x, swEnd.z);
    out.push(road(0, 4, 1, 140, 'Sheikh Zayed Road', 'شارع الشيخ زايد', 'E11', sw));
    out.push(road(0, 4, 1, 140, 'Sheikh Zayed Road', 'شارع الشيخ زايد', 'E11', ne));
    const grid = islandGrid(Lo);
    // the bridge ends on the island's nearest street corner
    let best = null, bd = Infinity; for (const r of grid.roads) for (let i = 0; i < r.p.length; i += 2) { const d = Math.hypot(r.p[i] - swEnd.x, r.p[i + 1] - swEnd.z); if (d < bd) { bd = d; best = { x: r.p[i], z: r.p[i + 1] }; } }
    const bridge = curve(swEnd, best, 10, 40, 3); bridge[0] = swEnd.x; bridge[1] = swEnd.z; bridge[bridge.length - 2] = best.x; bridge[bridge.length - 1] = best.z;
    out.push(road(1, 3, 0, 100, 'Sheikh Zayed Bridge', 'جسر الشيخ زايد', 'E10', bridge, { b: 1 }));
    out.push(...grid.roads);
    // side roads leave from points on the carriageways (shared points join them)
    const pointNear = (p, q) => { let bi = 0, b2 = Infinity; for (let i = 0; i < p.length; i += 2) { const d = Math.hypot(p[i] - q.x, p[i + 1] - q.z); if (d < b2) { b2 = d; bi = i; } } return { x: p[bi], z: p[bi + 1] }; };
    const loop = circuit(Lo.yas);
    const yasFrom = pointNear(sw, Lo.at(E11_LEN - 3000, -11)), yasTo = { x: loop[0], z: loop[1] };
    const yasLink = curve(yasFrom, yasTo, 12, 60, 7); yasLink[0] = yasFrom.x; yasLink[1] = yasFrom.z; yasLink[yasLink.length - 2] = yasTo.x; yasLink[yasLink.length - 1] = yasTo.z;
    out.push(road(2, 2, 0, 80, 'Yas Leisure Drive', 'شارع ياس للترفيه', '', yasLink));
    out.push(road(3, 2, 1, 250, 'Yas Circuit', 'حلبة ياس', '', loop, { c: 1 }));
    const campFrom = pointNear(ne, Lo.at(7600, 11));
    const track = curve(campFrom, Lo.camp, 20, 300, 5); track[0] = campFrom.x; track[1] = campFrom.z;
    out.push(road(4, 1, 0, 60, 'Camp Track', 'طريق المخيم', '', track, { sand: 1 }));
    return out;
  }

  // Abu Dhabi island: the Corniche along the north-west shore, long avenues, and cross streets; they meet on shared points.
  const AD = { w: 7200, h: 3800 };
  const AVENUES = [['Corniche Road', 'شارع الكورنيش'], ['Khalifa Bin Zayed Street', 'شارع خليفة بن زايد'], ['Hamdan Bin Mohammed Street', 'شارع حمدان بن محمد'], ['Zayed The First Street', 'شارع زايد الأول'], ['Al Falah Street', 'شارع الفلاح'], ['Sultan Bin Zayed Street', 'شارع سلطان بن زايد']];
  const CROSS = ['Airport Road', 'Al Najda Street', 'Electra Street', 'Al Salam Street', 'Mohammed Bin Khalifa Street', 'Defence Road', 'Muroor Road', 'Al Khaleej Al Arabi Street'];
  function islandFrame(Lo) {
    const c = Lo.abuDhabi, ax = { x: DIR.x, z: DIR.z }, ay = { x: SIDE.x, z: SIDE.z };     // along = south-west, across = inland
    const P = (u, v) => ({ x: r1(c.x + ax.x * u + ay.x * v), z: r1(c.z + ax.z * u + ay.z * v) });
    return { c, P };
  }
  function islandGrid(Lo) {
    const { P } = islandFrame(Lo), out = [];
    const vs = AVENUES.map((_, i) => Math.round(-AD.h / 2 + 140 + i * ((AD.h - 280) / (AVENUES.length - 1))));
    const us = CROSS.map((_, i) => Math.round(-AD.w / 2 + 400 + i * ((AD.w - 800) / (CROSS.length - 1))));
    const uAll = [...new Set([...us, ...Array.from({ length: 24 }, (_, i) => Math.round(-AD.w / 2 + 100 + i * 300))])].filter((u) => u <= AD.w / 2 - 100).sort((a, b) => a - b);
    AVENUES.forEach(([n, a], i) => { const p = []; for (const u of uAll) { const q = P(u, vs[i]); p.push(q.x, q.z); } out.push(road(i === 0 ? 1 : 2, i === 0 ? 3 : 2, 0, i === 0 ? 80 : 60, n, a, '', p)); });
    CROSS.forEach((n, i) => { const p = []; for (const v of vs) { const q = P(us[i], v); p.push(q.x, q.z); } out.push(road(3, 2, 0, 60, n, '', '', p)); });
    return { roads: out };
  }
  // The island's land, Yas, and the desert inland of the E11 (all counter-clockwise rings)
  function land(end) {
    const Lo = layout(end), { P } = islandFrame(Lo), rings = [];
    const ring = (pts) => pts.flatMap((q) => [q.x, q.z]);
    rings.push(ring([P(-AD.w / 2, -AD.h / 2), P(-AD.w / 2, AD.h / 2), P(AD.w / 2, AD.h / 2), P(AD.w / 2, -AD.h / 2)]));
    const y = Lo.yas; rings.push(ring([0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ x: y.x + Math.cos(i / 8 * Math.PI * 2) * 2600, z: y.z + Math.sin(i / 8 * Math.PI * 2) * 2000 }))));
    // a strip of mainland along the motorway and everything inland of it (the desert)
    rings.push(ring([Lo.at(-200, -900), Lo.at(-200, 12000), Lo.at(E11_LEN + 600, 12000), Lo.at(E11_LEN + 600, -900)]));
    return rings;
  }

  // ---- buildings: towers along the Corniche, mid-rise blocks between the streets; a few landmarks
  function buildings(end) {
    const Lo = layout(end), { P } = islandFrame(Lo), rand = rnd(42), out = [];
    const box = (u, v, w, d, h) => { const a = P(u - w / 2, v - d / 2), b = P(u - w / 2, v + d / 2), c = P(u + w / 2, v + d / 2), e = P(u + w / 2, v - d / 2); return [Math.round(h), a.x, a.z, b.x, b.z, c.x, c.z, e.x, e.z]; };
    for (let u = -AD.w / 2 + 250; u < AD.w / 2 - 200; u += 380) for (let v = -AD.h / 2 + 300; v < AD.h / 2 - 150; v += 300) {
      const corniche = v < -AD.h / 2 + 700;
      for (let k = 0; k < 2; k++) {
        const w = 40 + rand() * 60, d = 30 + rand() * 50, h = corniche ? 70 + rand() * 180 : 14 + rand() * 50;
        out.push(box(u + (k ? 90 : -90), v + (rand() - 0.5) * 60, w, d, h));
      }
    }
    return out;
  }
  const LANDMARKS = (end) => { const Lo = layout(end); return [
    { id: 'grand-mosque', name: 'Sheikh Zayed Grand Mosque', kind: 'mosque', x: Lo.mosque.x, z: Lo.mosque.z, r: 160, safe: 320 },
    { id: 'etihad-towers', name: 'Etihad Towers', kind: 'twin', h: 300, r: 30, ...islandFrame(Lo).P(AD.w / 2 - 500, -AD.h / 2 + 260) },
    { id: 'emirates-palace', name: 'Emirates Palace', kind: 'palace', h: 60, r: 120, ...islandFrame(Lo).P(AD.w / 2 - 1100, -AD.h / 2 + 220) },
  ]; };

  // ---- the Yas circuit: a closed loop with a long straight, a hairpin and a fast chicane section
  function circuit(c) {
    const pts = [[0, 0], [1100, 0], [1250, 80], [1260, 260], [1100, 340], [700, 360], [600, 520], [650, 700], [560, 820], [300, 780], [150, 600], [-80, 560], [-260, 420], [-300, 200], [-180, 40], [0, 0]];
    const rot = Math.atan2(DIR.z, DIR.x), cs = Math.cos(rot), sn = Math.sin(rot), out = [];
    for (const [u, v] of pts) out.push(r1(c.x - 450 + u * cs - v * sn), r1(c.z - 300 + u * sn + v * cs));
    return out;
  }
  /** Lap timing over a closed loop: crossing checkpoints in order makes a lap. */
  class Race {
    constructor(loop, laps = 3, cps = 8) {
      this.loop = loop; this.cum = L.cumulative(loop); this.len = this.cum[this.cum.length - 1]; this.laps = laps;
      this.cps = Array.from({ length: cps }, (_, i) => L.pointAt(loop, this.cum, (i + 1) / cps * this.len * 0.999));
      this.next = 0; this.lap = 0; this.t = 0; this.lapStart = 0; this.best = null; this.done = false;
    }
    update(dt, x, z) {
      if (this.done) return null;
      this.t += dt;
      const cp = this.cps[this.next], prev = this.prev || { x, z }; this.prev = { x, z };
      if (L.nearestOnSegment(cp.x, cp.z, prev.x, prev.z, x, z).d < 30) {
        this.next++;
        if (this.next === this.cps.length) { this.next = 0; this.lap++; const lt = this.t - this.lapStart; this.lapStart = this.t; if (this.best === null || lt < this.best) this.best = lt; if (this.lap >= this.laps) this.done = true; return { lap: this.lap, time: lt }; }
      }
      return null;
    }
    progress() { return this.lap + this.next / this.cps.length; }
  }

  // ---- the desert: dunes rise away from the motorway and the camp track
  function makeDunes(end) {
    const Lo = layout(end), D = Lo.desert;
    function local(x, z) { const dx = x - end.x, dz = z - end.z; return { s: dx * DIR.x + dz * DIR.z, d: dx * SIDE.x + dz * SIDE.z }; }
    function inDesert(x, z) { const q = local(x, z); return q.s > D.s0 && q.s < D.s1 && q.d > D.d0 && q.d < D.d1; }
    function height(x, z) {
      const q = local(x, z); if (!(q.s > D.s0 - 400 && q.s < D.s1 + 400 && q.d > D.d0 - 100 && q.d < D.d1 + 400)) return 0;
      // fade in from the edges, then long crescent dunes across the wind with ripples
      const edge = Math.min(1, (q.d - D.d0) / 500, (q.s - D.s0) / 600, (D.s1 - q.s) / 600, (D.d1 - q.d) / 600);
      if (edge <= 0) return 0;
      const camp = Lo.camp, cd = Math.hypot(x - camp.x, z - camp.z), flat = Math.min(1, Math.max(0, (cd - 120) / 200));
      const h = 11 * Math.pow(Math.max(0, Math.sin(q.s / 260 + Math.sin(q.d / 410) * 1.6)), 1.6) + 6 * Math.sin(q.d / 190 + q.s / 530) + 3 * Math.sin(q.s / 70 + q.d / 90);
      return Math.max(0, h + 4) * edge * flat;
    }
    return { inDesert, height };
  }

  // ---- boats and jet skis: thrust, drag, turning that needs speed
  class Boat {
    constructor(kind = 'jetski') { this.kind = kind; this.x = 0; this.z = 0; this.heading = 0; this.speed = 0; this.yawRate = 0; this.top = kind === 'jetski' ? 26 : 18; this.accel = kind === 'jetski' ? 6.5 : 3.5; }
    step(dt, input) {
      const t = (input.throttle || 0) - (input.brake || 0) * 0.6;
      this.speed += (t * this.accel - this.speed * Math.abs(this.speed) * (this.accel / (this.top * this.top)) - Math.sign(this.speed) * 0.4) * dt;
      if (Math.abs(this.speed) < 0.05 && !t) this.speed = 0;
      const grip = Math.min(1, Math.abs(this.speed) / 6);
      this.yawRate += ((input.steer || 0) * 1.4 * grip - this.yawRate) * Math.min(1, dt * 4);
      this.heading += this.yawRate * dt * Math.sign(this.speed || 1);
      this.x += Math.sin(this.heading) * this.speed * dt; this.z -= Math.cos(this.heading) * this.speed * dt;
    }
  }

  function pointInRing(x, z, r) { let inside = false; for (let i = 0, j = r.length / 2 - 1; i < r.length / 2; j = i++) { const xi = r[i * 2], zi = r[i * 2 + 1], xj = r[j * 2], zj = r[j * 2 + 1]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside; } return inside; }

  return { findE11End, layout, roads, land, buildings, LANDMARKS, circuit, Race, makeDunes, Boat, pointInRing, E11_LEN, AD };
}));
