// Desert Heat: GPS routes over the real road network (section 5). Points shared by two or more roads are junctions; A*
// over them, respecting one-way roads. window.DesertHeatNav / node.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DesertHeatNav = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const key = (x, z) => Math.round(x) + ':' + Math.round(z);

  /** roads: [{ p: [x,z,...], o: one-way, k: kind }]. Returns { nodes: [{x,z}], edges: [[{to, w, r, a, b}]], at: Map key->id } */
  function buildGraph(roads) {
    const count = new Map();
    roads.forEach((r) => { const n = r.p.length / 2; for (let i = 0; i < n; i++) { const k = key(r.p[i * 2], r.p[i * 2 + 1]); count.set(k, (count.get(k) || 0) + (i === 0 || i === n - 1 ? 2 : 1)); } });
    const at = new Map(), nodes = [], edges = [];
    const id = (x, z) => { const k = key(x, z); let i = at.get(k); if (i === undefined) { i = nodes.length; at.set(k, i); nodes.push({ x, z }); edges.push([]); } return i; };
    roads.forEach((r, ri) => {
      const n = r.p.length / 2; if (n < 2) return;
      let last = 0, len = 0;
      for (let i = 1; i < n; i++) {
        len += Math.hypot(r.p[i * 2] - r.p[i * 2 - 2], r.p[i * 2 + 1] - r.p[i * 2 - 1]);
        const isNode = i === n - 1 || count.get(key(r.p[i * 2], r.p[i * 2 + 1])) > 1;
        if (!isNode) continue;
        const a = id(r.p[last * 2], r.p[last * 2 + 1]), b = id(r.p[i * 2], r.p[i * 2 + 1]);
        // big roads cost a little less per metre, so routes prefer them as drivers do
        const w = len * (r.k <= 1 ? 0.8 : r.k === 5 ? 0.85 : r.k <= 2 ? 0.92 : 1);
        edges[a].push({ to: b, w, r: ri, from: last, upto: i });
        if (!r.o) edges[b].push({ to: a, w, r: ri, from: i, upto: last });
        last = i; len = 0;
      }
    });
    // the biggest connected piece of the network: routes snap only to it (small islands of roads are left out)
    const und = edges.map(() => []); edges.forEach((es, i) => es.forEach((e) => { und[i].push(e.to); und[e.to].push(i); }));
    const comp = new Int32Array(nodes.length).fill(-1); let best = -1, bestN = 0;
    for (let i = 0, c = 0; i < nodes.length; i++, c++) {
      if (comp[i] >= 0) { c--; continue; }
      const st = [i]; comp[i] = c; let n = 0;
      while (st.length) { const u = st.pop(); n++; for (const v of und[u]) if (comp[v] < 0) { comp[v] = c; st.push(v); } }
      if (n > bestN) { bestN = n; best = c; }
    }
    const main = new Uint8Array(nodes.length); for (let i = 0; i < nodes.length; i++) main[i] = comp[i] === best ? 1 : 0;
    return { nodes, edges, at, main };
  }

  function nearestNode(g, x, z) {
    let best = -1, bd = Infinity;
    for (let i = 0; i < g.nodes.length; i++) { const n = g.nodes[i], d = (n.x - x) ** 2 + (n.z - z) ** 2; if (d < bd && g.edges[i].length && (!g.main || g.main[i])) { bd = d; best = i; } }
    return best;
  }

  // A small binary heap for A*.
  class Heap {
    constructor() { this.a = []; }
    push(v, p) { const a = this.a; a.push([p, v]); let i = a.length - 1; while (i > 0) { const j = (i - 1) >> 1; if (a[j][0] <= a[i][0]) break; [a[i], a[j]] = [a[j], a[i]]; i = j; } }
    pop() { const a = this.a, top = a[0], last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[i], a[m]] = [a[m], a[i]]; i = m; } } return top[1]; }
    get size() { return this.a.length; }
  }

  /** A route from (ax,az) to (bx,bz): { points: [x,z,...], length } or null. */
  function route(g, roads, ax, az, bx, bz, ignoreOneWay) {
    const s = nearestNode(g, ax, az), t = nearestNode(g, bx, bz);
    if (s < 0 || t < 0) return null;
    const N = g.nodes.length, dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), via = new Array(N);
    const h = (i) => Math.hypot(g.nodes[i].x - g.nodes[t].x, g.nodes[i].z - g.nodes[t].z) * 0.8;
    const open = new Heap(); dist[s] = 0; open.push(s, h(s));
    const done = new Uint8Array(N);
    while (open.size) {
      const u = open.pop(); if (done[u]) continue; done[u] = 1;
      if (u === t) break;
      for (const e of (ignoreOneWay ? g.both || (g.both = bothWays(g)) : g.edges)[u]) { const nd = dist[u] + e.w; if (nd < dist[e.to]) { dist[e.to] = nd; prev[e.to] = u; via[e.to] = e; open.push(e.to, nd + h(e.to)); } }
    }
    if (prev[t] < 0 && s !== t) return ignoreOneWay ? null : route(g, roads, ax, az, bx, bz, true);
    const chain = []; for (let v = t; v !== s; v = prev[v]) chain.push(via[v]);
    chain.reverse();
    const pts = [g.nodes[s].x, g.nodes[s].z];
    let length = 0;
    for (const e of chain) {
      const p = roads[e.r].p, step = e.upto > e.from ? 1 : -1;
      for (let i = e.from + step; step > 0 ? i <= e.upto : i >= e.upto; i += step) { length += Math.hypot(p[i * 2] - pts[pts.length - 2], p[i * 2 + 1] - pts[pts.length - 1]); pts.push(p[i * 2], p[i * 2 + 1]); }
    }
    return { points: pts, length };
  }

  // the same graph with every edge usable both ways (a fallback when one-way data leaves a gap)
  function bothWays(g) {
    const b = g.edges.map((es) => es.slice());
    g.edges.forEach((es, i) => es.forEach((e) => { if (!g.edges[e.to].some((x) => x.to === i && x.r === e.r)) b[e.to].push({ to: i, w: e.w, r: e.r, from: e.upto, upto: e.from }); }));
    return b;
  }

  return { buildGraph, route, nearestNode, key };
}));
