// Shared flying for the Plane game ("Fly with others"): a live list of the pilots who have switched it on.
//
// Opt-in and anonymous. A pilot sends a random id made on their device, the callsign they chose (cleaned like the
// leaderboard names), the aircraft and where it is, every couple of seconds, and gets back the other pilots nearby.
// Nothing is written to storage (the list lives in memory and a pilot who stops sending is forgotten after 10 seconds),
// no address is stored beyond a per-address count that stops one machine from flooding the sky with fake pilots.
//
//   POST /plane/sky        {id, cs, plane, p:[x,y,z], h, pi, b, s}  -> { others: [...], pilots }
//   POST /plane/sky/leave  {id}
//   GET  /plane/sky/count  -> { pilots }

const ID = /^[0-9a-f]{32}$/;
// The aircraft a pilot can fly (the helicopters are not shared): anything else is refused, never echoed to other pilots.
const PLANES = new Set(['c172', 'pa28', 'sr22', 'pc12', 'cit', 'e175', 'a220', 'b737', 'a320', 'b787', 'a350', 'b777', 'b747', 'a380', 'f35', 'f16', 'f15', 'f18', 'typhoon', 'f22', 'su27']);
const STALE = 10_000, MIN_GAP = 800, NEAR = 25_000, MAX_PILOTS = 400, MAX_PER_ADDRESS = 3, MAX_OTHERS = 14;
const num = (v, lo, hi) => (Number.isFinite(Number(v)) && v !== null && v !== '' && Number(v) >= lo && Number(v) <= hi ? Number(v) : null);

export class SkyError extends Error { constructor(status, message) { super(message); this.status = status; } }

export class SkyRoom {
  constructor() { this.pilots = new Map(); }
  prune(now) { for (const [id, p] of this.pilots) if (now - p.at > STALE) this.pilots.delete(id); }
  count(now = Date.now()) { this.prune(now); return this.pilots.size; }
  leave(id) { this.pilots.delete(String(id || '').toLowerCase()); return { ok: true }; }
  /// `addr` is a hash of the sender's address. `clean` turns a callsign into a safe one.
  update(body, addr, clean, now = Date.now()) {
    const id = String(body?.id || '').toLowerCase();
    if (!ID.test(id)) throw new SkyError(400, 'Bad id.');
    const plane = String(body.plane || '');
    if (!PLANES.has(plane)) throw new SkyError(400, 'Bad aircraft.');
    const p = Array.isArray(body.p) ? body.p.map((v, i) => num(v, i === 1 ? -50 : -20_000, i === 1 ? 30_000 : 20_000)) : [];
    const h = num(body.h, -7, 7), pi = num(body.pi, -3.2, 3.2), b = num(body.b, -3.2, 3.2), s = num(body.s, 0, 700);
    if (p.length !== 3 || p.includes(null) || [h, pi, b, s].includes(null)) throw new SkyError(400, 'Bad position.');
    const rg = body.rg === undefined ? 'home' : String(body.rg);
    if (!/^[a-z0-9-]{1,24}$/.test(rg)) throw new SkyError(400, 'Bad place.');
    this.prune(now);
    const cur = this.pilots.get(id);
    if (cur && now - cur.at < MIN_GAP) throw new SkyError(429, 'Too fast.');
    if (!cur) {
      if (this.pilots.size >= MAX_PILOTS) throw new SkyError(503, 'The sky is full right now.');
      let mine = 0; for (const o of this.pilots.values()) if (o.addr === addr) mine++;
      if (mine >= MAX_PER_ADDRESS) throw new SkyError(429, 'Too many pilots from one address.');
    }
    // An existing pilot keeps the address and the short session id it arrived with (they cannot be moved to dodge the cap).
    this.pilots.set(id, { id, addr: cur ? cur.addr : addr, sid: cur ? cur.sid : [...crypto.getRandomValues(new Uint8Array(4))].map((x) => x.toString(16).padStart(2, '0')).join(''), cs: clean(body.cs), rg, plane, p, h, pi, b, s, at: now });
    const others = [];
    for (const o of this.pilots.values()) {
      if (o.id === id || o.rg !== rg) continue;   // only pilots flying in the same part of the world
      const d = Math.hypot(o.p[0] - p[0], o.p[2] - p[2]);
      if (d <= NEAR) others.push({ k: o.sid, cs: o.cs, plane: o.plane, p: o.p, h: o.h, pi: o.pi, b: o.b, s: o.s, age: now - o.at, d });
    }
    others.sort((x, y) => x.d - y.d);
    return { others: others.slice(0, MAX_OTHERS).map(({ d, ...rest }) => rest), pilots: this.pilots.size };
  }
}
