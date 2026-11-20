// Desert Heat online (COMING SOON: built but switched off).
//
// The owner asked for the multiplayer code to be in the game but not enabled in releases: the phone shows "Online · Coming
// soon" and nothing here connects anywhere while ENABLED is false. To turn it on later, a server has to exist first
// (a small WebSocket relay, see the protocol below), and ENABLED must be changed in a reviewed release, never from a setting,
// a save file or the network.
//
// Protocol (JSON over WebSocket, 10 updates a second):
//   client -> server  { t: 'hello', v: 1, name, room }            join or create a room (4-letter code), max 8 players
//                     { t: 'state', x, y, z, h, s, car, mode, ch }  position, heading, speed, car id, on foot/driving, character
//                     { t: 'shot', x, y, z, dx, dy, dz, w }         a shot (the receiver decides hits on itself only)
//                     { t: 'chat', text }                           a short quick-chat line (from a fixed list, no free text)
//   server -> client  { t: 'welcome', id, room, players: [...] } / { t: 'state', id, ... } / { t: 'left', id } / { t: 'shot', id, ... }
// Remote players are drawn as ghosts that move smoothly between updates (interpolation 100 ms behind).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DesertHeatOnline = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ENABLED = false;                      // releases ship with this off: "Coming soon"
  const STATUS = 'Coming soon';
  const MAX_PLAYERS = 8, RATE = 10, DELAY = 0.1;
  const QUICK_CHAT = ['Yalla!', 'Follow me', 'Race you to the Marina', 'Need backup', 'Nice driving', 'GG'];

  const validRoom = (r) => typeof r === 'string' && /^[A-Z]{4}$/.test(r);
  const newRoom = (rand = Math.random) => Array.from({ length: 4 }, () => String.fromCharCode(65 + Math.floor(rand() * 26))).join('');

  /** Keeps the last few states of a remote player and gives a smooth position DELAY seconds in the past. */
  class Ghost {
    constructor(id) { this.id = id; this.buf = []; }
    push(t, s) { this.buf.push({ t, ...s }); if (this.buf.length > 20) this.buf.shift(); }
    at(now) {
      const t = now - DELAY, b = this.buf;
      if (!b.length) return null;
      if (t <= b[0].t) return b[0];
      for (let i = 1; i < b.length; i++) if (b[i].t >= t) {
        const a = b[i - 1], c = b[i], u = (t - a.t) / (c.t - a.t || 1);
        let dh = c.h - a.h; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
        return { ...c, x: a.x + (c.x - a.x) * u, y: a.y + (c.y - a.y) * u, z: a.z + (c.z - a.z) * u, h: a.h + dh * u };
      }
      return b[b.length - 1];
    }
  }

  /** The client. connect() refuses while ENABLED is false, so a release can never go online. */
  class Session {
    constructor(url, opts = {}) { this.url = url; this.ws = null; this.ghosts = new Map(); this.id = null; this.room = null; this.sendT = 0; this.onEvent = opts.onEvent || (() => {}); this.WS = opts.WebSocket || (typeof WebSocket !== 'undefined' ? WebSocket : null); }
    get enabled() { return ENABLED; }
    connect(name, room) {
      if (!ENABLED) return { ok: false, why: STATUS };
      if (room && !validRoom(room)) return { ok: false, why: 'Room codes are 4 letters' };
      if (!this.WS) return { ok: false, why: 'No connection available' };
      this.room = room || newRoom();
      this.ws = new this.WS(this.url);
      this.ws.onopen = () => this.send({ t: 'hello', v: 1, name: String(name).slice(0, 16), room: this.room });
      this.ws.onmessage = (m) => { let d; try { d = JSON.parse(m.data); } catch { return; } this.receive(d, performance.now() / 1000); };
      this.ws.onclose = () => { this.onEvent({ t: 'closed' }); this.ws = null; };
      return { ok: true, room: this.room };
    }
    receive(d, now) {
      if (d.t === 'welcome') { this.id = d.id; this.room = d.room; }
      else if (d.t === 'state' && d.id !== this.id) { let g = this.ghosts.get(d.id); if (!g) { if (this.ghosts.size >= MAX_PLAYERS - 1) return; g = new Ghost(d.id); this.ghosts.set(d.id, g); } g.push(now, d); }
      else if (d.t === 'left') this.ghosts.delete(d.id);
      this.onEvent(d);
    }
    send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
    /** Call every frame with the local player's state; sends at RATE per second. */
    tick(dt, s) { if (!this.ws) return; this.sendT -= dt; if (this.sendT <= 0) { this.sendT = 1 / RATE; this.send({ t: 'state', ...s }); } }
    chat(i) { if (QUICK_CHAT[i]) this.send({ t: 'chat', text: QUICK_CHAT[i] }); }
    leave() { if (this.ws) this.ws.close(); this.ws = null; this.ghosts.clear(); }
  }

  return { ENABLED, STATUS, MAX_PLAYERS, QUICK_CHAT, Ghost, Session, validRoom, newRoom };
}));
