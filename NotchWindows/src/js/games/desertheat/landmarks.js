// Desert Heat section 7: the rest of Dubai: landmarks at their real places, the Metro Red Line along Sheikh Zayed Road,
// the airport, the malls (made-up names), wildlife spots. Real landmarks and roads may be named (part 25); shops, malls and
// brands are made up. window.DesertHeatLandmarks / node.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./logic.js'));
  else root.DesertHeatLandmarks = factory(root.DesertHeatLogic);
}(typeof self !== 'undefined' ? self : this, function (L) {
  'use strict';
  const O = { lat: 25.17, lon: 55.24 }, M_LON = 111320 * Math.cos(O.lat * Math.PI / 180);
  const xz = (lat, lon) => ({ x: (lon - O.lon) * M_LON, z: -(lat - O.lat) * 110574 });

  // kind decides the model the game builds
  const LANDMARKS = [
    { id: 'burj-khalifa', name: 'Burj Khalifa', kind: 'needle', h: 828, r: 38, ...xz(25.1972, 55.2744) },
    { id: 'burj-al-arab', name: 'Burj Al Arab', kind: 'sail', h: 321, r: 30, ...xz(25.1412, 55.1853) },
    { id: 'frame', name: 'Dubai Frame', kind: 'frame', h: 150, r: 48, ...xz(25.2353, 55.3003) },
    { id: 'museum-future', name: 'Museum of the Future', kind: 'torus', h: 77, r: 40, ...xz(25.2192, 55.2820) },
    { id: 'atlantis', name: 'Atlantis, The Palm', kind: 'arch', h: 105, r: 70, ...xz(25.1304, 55.1180) },
    { id: 'jumeirah-beach-hotel', name: 'Jumeirah Beach Hotel', kind: 'wave', h: 104, r: 60, ...xz(25.1413, 55.1898) },
    { id: 'emirates-towers', name: 'Emirates Towers', kind: 'twin', h: 355, r: 22, ...xz(25.2175, 55.2830) },
    { id: 'clock-tower', name: 'Deira Clock Tower', kind: 'clock', h: 25, r: 8, ...xz(25.2584, 55.3168) },
  ];

  const MALLS = [
    { id: 'dunes-mall', name: 'Mall of the Dunes', ...xz(25.1185, 55.2003), shops: ['clothing', 'phone', 'gold', 'cafeteria', 'pharmacy', 'barber'], ski: true },
    { id: 'crescent-mall', name: 'Crescent Mall', ...xz(25.1985, 55.2790), shops: ['clothing', 'cafeteria', 'gold', 'phone', 'bank', 'gym'], ski: false },
  ];

  // Metro Red Line stations along Sheikh Zayed Road (real names; the line itself is drawn in the road's central reservation)
  const METRO_STATIONS = [
    ['World Trade Centre', 25.2252, 55.2852], ['Emirates Towers', 25.2175, 55.2800], ['Financial Centre', 25.2116, 55.2763],
    ['Burj Khalifa / Dubai Mall', 25.2014, 55.2696], ['Business Bay', 25.1912, 55.2604], ['Noor Bank', 25.1557, 55.2289],
    ['First Abu Dhabi Bank', 25.1268, 55.2077], ['Mall of the Emirates', 25.1214, 55.2003], ['Mashreq', 25.1145, 55.1907],
    ['Dubai Internet City', 25.1019, 55.1733], ['Al Khail', 25.0889, 55.1584], ['DMCC', 25.0710, 55.1384],
  ].map(([name, lat, lon]) => ({ name, ...xz(lat, lon) }));

  const AIRPORT = { name: 'Dubai International', terminal: xz(25.2480, 55.3535), runway: [xz(25.2350, 55.3400), xz(25.2650, 55.3800)] };
  const FLAMINGOS = { name: 'Ras Al Khor', ...xz(25.1880, 55.3290), n: 40 };
  const ABRA = [xz(25.2635, 55.2975), xz(25.2615, 55.3010)];   // the Creek crossing between Bur Dubai and Deira

  /**
   * The Metro viaduct: the longest chain of north-east-bound Sheikh Zayed Road carriageway, moved into the central
   * reservation. Returns a flat [x,z,...] list (or [] if the road is not in the data).
   */
  function metroLine(roads) {
    const segs = roads.filter((r) => r.k === 0 && r.o && !r.gen && /Sheikh Zayed Road/.test(r.n || '') && !r.t).filter((r) => {
      const n = r.p.length / 2, dx = r.p[n * 2 - 2] - r.p[0], dz = r.p[n * 2 - 1] - r.p[1];
      return dx > 0 && dz < 0;     // heading north-east (x east, z south)
    });
    if (!segs.length) return [];
    const key = (x, z) => Math.round(x / 3) + ':' + Math.round(z / 3);
    const byStart = new Map(); segs.forEach((r, i) => byStart.set(key(r.p[0], r.p[1]), i));
    let best = [];
    const used = new Set();
    for (let i = 0; i < segs.length; i++) {
      // only start chains that nothing leads into
      const r0 = segs[i];
      if (segs.some((r) => { const n = r.p.length / 2; return key(r.p[n * 2 - 2], r.p[n * 2 - 1]) === key(r0.p[0], r0.p[1]); })) continue;
      let chain = [], cur = i; const seen = new Set();
      while (cur !== undefined && !seen.has(cur)) { seen.add(cur); const r = segs[cur], n = r.p.length / 2; chain = chain.concat(chain.length ? r.p.slice(2) : r.p); cur = byStart.get(key(r.p[n * 2 - 2], r.p[n * 2 - 1])); }
      if (chain.length > best.length) best = chain;
      for (const s of seen) used.add(s);
    }
    // thin out points closer than 15 m, then move left (into the median) by half the carriageway plus a little
    const thin = [best[0], best[1]];
    for (let i = 2; i < best.length; i += 2) if (Math.hypot(best[i] - thin[thin.length - 2], best[i + 1] - thin[thin.length - 1]) > 15) thin.push(best[i], best[i + 1]);
    return L.offset(thin, -9.5);
  }
  const pathLength = (p) => { let s = 0; for (let i = 2; i < p.length; i += 2) s += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]); return s; };

  return { xz, LANDMARKS, MALLS, METRO_STATIONS, AIRPORT, FLAMINGOS, ABRA, metroLine, pathLength };
}));
