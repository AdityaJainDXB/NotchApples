#!/usr/bin/env node
// Desert Heat: turns saved OpenStreetMap extracts of Dubai into the game's world files (run offline, never at runtime).
//
//   node tools/desertheat/osm-to-world.js <roads.json> <buildings.json> <water.json> <out folder>
//
// The inputs are Overpass API JSON ("out geom") for the box 25.06-25.28 N, 55.12-55.36 E. Map data © OpenStreetMap
// contributors, ODbL: the game's credits must say so.
//
// Every output is a small script that hands its data to window.DesertHeatData.put(name, data), so the game can load it
// with a <script> tag (the Mac web view cannot fetch() local files).
//
// Output (all lengths in metres, x = east, z = south, origin at ORIGIN below, numbers rounded to 0.1 m):
//   roads.js     { roads: [{ k: kind, l: lanes each way, o: one-way, b: bridge level, t: tunnel, s: speed km/h, n: name, a: Arabic name,
//                           d / da: exit destination (English / Arabic), r: road number (E11...), p: [x,z,...] }] }
//   land.js      { land: [[x,z,...]], water: [[x,z,...]] }    land is the coast-closed mainland plus islands; water is lakes, the Creek, canals
//   tiles/<i>_<j>.js    { b: [[height, x,z, x,z ...]] }        buildings, cut into TILE-metre squares by their first point

const fs = require('fs');
const path = require('path');

const ORIGIN = { lat: 25.17, lon: 55.24 };
const TILE = 500;
const BOX = { s: 25.06, n: 25.28, w: 55.12, e: 55.36 };
const M_LAT = 110574;
const M_LON = 111320 * Math.cos(ORIGIN.lat * Math.PI / 180);

const toXZ = (lat, lon) => [Math.round((lon - ORIGIN.lon) * M_LON * 10) / 10, Math.round(-(lat - ORIGIN.lat) * M_LAT * 10) / 10];

// Ramer-Douglas-Peucker on a flat [x,z,...] list.
function simplify(pts, tol) {
  const n = pts.length / 2;
  if (n < 3) return pts;
  const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const ax = pts[a * 2], az = pts[a * 2 + 1], bx = pts[b * 2], bz = pts[b * 2 + 1];
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz) || 1;
    let best = -1, bi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i * 2] - ax) * dz - (pts[i * 2 + 1] - az) * dx) / len;
      if (d > best) { best = d; bi = i; }
    }
    if (best > tol) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i * 2], pts[i * 2 + 1]);
  return out;
}

// A closed ring: drop the repeated last point, split at the point farthest from the first, simplify both halves.
function simplifyRing(pts, tol) {
  let p = pts;
  if (p.length >= 4 && p[0] === p[p.length - 2] && p[1] === p[p.length - 1]) p = p.slice(0, -2);
  const n = p.length / 2;
  if (n < 4) return p;
  let far = 1, best = -1;
  for (let i = 1; i < n; i++) { const d = Math.hypot(p[i * 2] - p[0], p[i * 2 + 1] - p[1]); if (d > best) { best = d; far = i; } }
  const a = simplify(p.slice(0, far * 2 + 2), tol);
  const b = simplify(p.slice(far * 2).concat(p.slice(0, 2)), tol);
  return a.concat(b.slice(2, -2));
}

function writeData(file, name, data) {
  fs.writeFileSync(file, `window.DesertHeatData.put(${JSON.stringify(name)},${JSON.stringify(data)});\n`);
}

const flat = (geom) => { const p = []; for (const g of geom) p.push(...toXZ(g.lat, g.lon)); return p; };

// ---- roads
const KIND = { motorway: 0, trunk: 1, primary: 2, secondary: 3, tertiary: 4, motorway_link: 5, trunk_link: 5, primary_link: 6, secondary_link: 6 };
const DEFAULT_LANES = [4, 3, 3, 2, 1, 1, 1];
const DEFAULT_SPEED = [120, 100, 80, 60, 60, 80, 60];

function roads(file) {
  const out = [];
  for (const e of JSON.parse(fs.readFileSync(file)).elements) {
    if (e.type !== 'way' || !e.geometry) continue;
    const t = e.tags || {};
    const k = KIND[t.highway]; if (k === undefined) continue;
    const oneway = t.oneway === 'yes' || t.highway === 'motorway' || /_link$/.test(t.highway) && t.oneway !== 'no';
    let lanes = parseInt(t.lanes, 10);
    if (!(lanes > 0)) lanes = DEFAULT_LANES[k] * (oneway ? 1 : 2);
    const each = oneway ? lanes : Math.max(1, Math.round(lanes / 2));
    const speed = parseInt(t.maxspeed, 10) || DEFAULT_SPEED[k];
    const r = { k, l: Math.min(each, 7), o: oneway ? 1 : 0, s: speed, p: simplify(flat(e.geometry), 0.6) };
    if (t.bridge && t.bridge !== 'no') r.b = Math.max(1, parseInt(t.layer, 10) || 1);
    if (t.tunnel && t.tunnel !== 'no') r.t = 1;
    if (t.name || t['name:en']) r.n = t['name:en'] || t.name;
    if (t['name:ar']) r.a = t['name:ar'];
    if (t.destination) r.d = t.destination.split(';').slice(0, 2).join(' · ');
    if (t['destination:ar']) r.da = t['destination:ar'].split(';').slice(0, 2).join(' · ');
    if (t.ref) r.r = t.ref.split(';')[0];
    out.push(r);
  }
  return out;
}

// ---- buildings
function heightOf(t, area, x, z) {
  const h = parseFloat(t.height);
  if (h > 0) return Math.min(h, 830);
  const lv = parseFloat(t['building:levels']);
  if (lv > 0) return lv * 3.6 + 2;
  // No height in the data: a plausible low-rise, a little taller for big footprints (a deterministic hash keeps it stable).
  const r = Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
  return Math.round(4 + r * 6 + Math.min(area / 400, 12));
}

function areaOf(p) { let a = 0; for (let i = 0; i < p.length; i += 2) { const j = (i + 2) % p.length; a += p[i] * p[j + 1] - p[j] * p[i + 1]; } return a / 2; }

function buildings(file, outDir) {
  const tiles = {};
  let kept = 0, dropped = 0;
  for (const e of JSON.parse(fs.readFileSync(file)).elements) {
    if (e.type !== 'way' || !e.geometry || e.geometry.length < 4) continue;
    let p = simplifyRing(flat(e.geometry), 0.4);
    if (p.length < 6) { dropped++; continue; }
    let a = areaOf(p);
    if (Math.abs(a) < 30) { dropped++; continue; }
    if (a < 0) { const q = []; for (let i = p.length - 2; i >= 0; i -= 2) q.push(p[i], p[i + 1]); p = q; a = -a; }  // counter-clockwise
    const h = Math.round(heightOf(e.tags || {}, a, p[0], p[1]) * 10) / 10;
    const key = `${Math.floor(p[0] / TILE)}_${Math.floor(p[1] / TILE)}`;
    (tiles[key] = tiles[key] || []).push([h, ...p]);
    kept++;
  }
  const dir = path.join(outDir, 'tiles');
  fs.mkdirSync(dir, { recursive: true });
  const sky = [];
  for (const [k, b] of Object.entries(tiles)) {
    writeData(path.join(dir, `${k}.js`), `tile:${k}`, { b });
    for (const x of b) if (x[0] >= 45) sky.push(x);   // towers seen from far away stay loaded all the time
  }
  writeData(path.join(outDir, 'index.js'), 'index', { size: TILE, keys: Object.keys(tiles), sky });
  return { kept, dropped, tiles: Object.keys(tiles).length };
}

// ---- land and water
function land(file) {
  const els = JSON.parse(fs.readFileSync(file)).elements;
  const coast = els.filter((e) => e.type === 'way' && e.tags && e.tags.natural === 'coastline' && e.geometry).map((e) => e.geometry.map((g) => [g.lat, g.lon]));
  // Join coastline ways end to start.
  const key = (p) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`;
  const byStart = new Map(); coast.forEach((c, i) => byStart.set(key(c[0]), i));
  const used = new Set(); const chains = [];
  for (let i = 0; i < coast.length; i++) {
    if (used.has(i)) continue;
    // walk back to the chain's start
    let start = i; const seen = new Set([i]);
    for (;;) { const prev = coast.findIndex((c, j) => !seen.has(j) && !used.has(j) && key(c[c.length - 1]) === key(coast[start][0])); if (prev < 0) break; seen.add(prev); start = prev; }
    let chain = []; let cur = start;
    while (cur !== undefined && !used.has(cur)) { used.add(cur); chain = chain.concat(chain.length ? coast[cur].slice(1) : coast[cur]); cur = byStart.get(key(coast[cur][coast[cur].length - 1])); }
    chains.push(chain);
  }
  const inBox = ([la, lo]) => la >= BOX.s && la <= BOX.n && lo >= BOX.w && lo <= BOX.e;
  const landRings = [];
  for (const c of chains) {
    const closed = key(c[0]) === key(c[c.length - 1]);
    if (closed) { if (c.some(inBox)) landRings.push(c); continue; }
    // The mainland coast is open: OSM keeps land on the left of the way, so for Dubai's NE-running coast the land is to the
    // south-east. Close the chain around the box's south and east corners (padded) to make the mainland polygon.
    const pad = 0.06;
    landRings.push(c.concat([[BOX.n + pad, BOX.e + pad], [BOX.s - pad, BOX.e + pad], [BOX.s - pad, BOX.w - pad], c[0]]));
  }
  const ring = (r) => simplifyRing(r.flatMap(([la, lo]) => toXZ(la, lo)), 1.5);
  const water = els.filter((e) => e.tags && e.tags.natural === 'water');
  const wr = [];
  for (const e of water) {
    if (e.type === 'way' && e.geometry) wr.push(e.geometry.map((g) => [g.lat, g.lon]));
    if (e.type === 'relation' && e.members) for (const m of e.members) if (m.role === 'outer' && m.geometry) wr.push(m.geometry.map((g) => [g.lat, g.lon]));
  }
  return { land: landRings.map(ring).filter((r) => r.length >= 6), water: wr.map(ring).filter((r) => r.length >= 6 && Math.abs(areaOf(r)) > 400) };
}

if (require.main === module) {
  const [rf, bf, wf, out] = process.argv.slice(2);
  if (!out) { console.error('usage: osm-to-world.js roads.json buildings.json water.json outdir'); process.exit(1); }
  fs.mkdirSync(out, { recursive: true });
  const r = roads(rf);
  writeData(path.join(out, 'roads.js'), 'roads', { origin: ORIGIN, roads: r });
  const l = land(wf);
  writeData(path.join(out, 'land.js'), 'land', l);
  const b = buildings(bf, out);
  console.log(`roads ${r.length}, land rings ${l.land.length}, water ${l.water.length}, buildings ${b.kept} (dropped ${b.dropped}) in ${b.tiles} tiles`);
}

module.exports = { simplify, simplifyRing, toXZ, areaOf, heightOf };
