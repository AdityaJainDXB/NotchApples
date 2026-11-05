// Notch Apple Friends: mailboxes for private chat. The wire format is docs/FRIENDS_PROTOCOL.md; read that first.
//
// The server only ever holds: a random-looking box id (a hash of the friend code), two public keys, hashes of send tokens,
// and sealed blobs it cannot read. No names, no codes, no texts, no friend lists. IP addresses are used in memory for rate
// limiting (as a daily hash) and never stored or logged.

const BOX = /^[0-9a-f]{32}$/;
const HASH = /^[0-9a-f]{64}$/;
const B64U = /^[A-Za-z0-9_-]+$/;
const MAX_BODY = 24 * 1024;
const MAX_REQ_BLOB = 5800;     // ~4 KB once decoded
const MAX_MSG_BLOB = 22000;    // ~16 KB
// A mailbox holds what a friend has not collected yet: 700 messages or 4.5 MB (a 2 MB file is 250 pieces of about 15 KB each).
const MAX_QUEUE = 700, MAX_QUEUE_BYTES = 4.5 * 1024 * 1024, MAX_REQUESTS = 20, MAX_ALLOW = 500;
const SENDS_PER_MIN = 300;     // per sender token: a file goes out as one message per piece
const TTL_MS = 14 * 24 * 3600 * 1000;
const AUTH_WINDOW_MS = 5 * 60 * 1000;
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS', 'access-control-allow-headers': 'content-type, x-nf-auth' };

const enc = new TextEncoder();
const hex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
const unb64u = (s) => { const t = String(s).replace(/-/g, '+').replace(/_/g, '/'); return Uint8Array.from(atob(t + '==='.slice((t.length + 3) % 4)), (c) => c.charCodeAt(0)); };
const sha256hex = async (data) => hex(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? enc.encode(data) : data));
const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS } });
const fail = (status, error) => reply({ error }, status);

async function edKey(rawB64u) {
  const raw = unb64u(rawB64u);
  if (raw.length !== 32) throw new Error('bad key');
  for (const algo of [{ name: 'Ed25519' }, { name: 'NODE-ED25519', namedCurve: 'NODE-ED25519' }]) {
    try { return { key: await crypto.subtle.importKey('raw', raw, algo, false, ['verify']), algo }; } catch { /* try the other name */ }
  }
  throw new Error('no Ed25519');
}
/** True when `sig` (base64url) is a good Ed25519 signature of `message` by the 32-byte public key `signB64u`. */
export async function verifySig(signB64u, message, sig) {
  try { const { key, algo } = await edKey(signB64u); return await crypto.subtle.verify(algo, key, unb64u(sig), enc.encode(message)); } catch { return false; }
}
const authMessage = async (method, path, ts, body) => `nf1\n${method}\n${path}\n${ts}\n${await sha256hex(body)}`;
const pad = (n) => String(n).padStart(12, '0');

/** A rolling-window counter; one object per (bucket, hashed address). */
export class FriendRate {
  constructor(state) { this.state = state; }
  async fetch(request) {
    const u = new URL(request.url), now = Date.now();
    const max = Math.min(10000, Math.max(1, Number(u.searchParams.get('max')) || 10)), window = Math.min(24 * 3600 * 1000, Math.max(1000, Number(u.searchParams.get('w')) || 60000));
    const times = ((await this.state.storage.get('t')) || []).filter((t) => now - t < window);
    if (times.length >= max) return Response.json({ ok: false });
    times.push(now);
    await this.state.storage.put('t', times);
    return Response.json({ ok: true });
  }
}

/** One mailbox: the keys of its owner, who may send to it, and the sealed items waiting for it. */
export class Mailbox {
  constructor(state) { this.state = state; this.s = state.storage; }

  async fetch(request) {
    const url = new URL(request.url), path = url.pathname, method = request.method;
    const box = path.split('/')[3] || '';
    if (method === 'GET' && path.startsWith('/f/ws/')) return this.socket(request, url);
    const text = method === 'GET' || method === 'DELETE' ? '' : await request.text();
    if (text.length > MAX_BODY) return fail(413, 'Too large');
    let body = {};
    if (text) { try { body = JSON.parse(text); } catch { return fail(400, 'Bad JSON'); } }

    if (method === 'GET' && path.startsWith('/f/key/')) {
      const keys = await this.s.get('keys');
      return keys ? reply({ sign: keys.sign, dh: keys.dh }) : fail(404, 'Not found');
    }
    if (method === 'POST' && path === '/f/req') return this.addRequest(body);
    if (method === 'POST' && path === '/f/send') return this.addMessage(body);

    // Everything below is for the mailbox's owner.
    const header = request.headers.get('x-nf-auth') || '';
    if (method === 'POST' && path === '/f/claim') return this.claim(body, header, text, path);
    const bad = await this.checkOwner(method, path, header, text);
    if (bad) return bad;
    if (method === 'PUT' && path === '/f/allow') return this.allow(body);
    if (method === 'DELETE' && path.startsWith('/f/allow/')) return this.revoke(box === '' ? '' : decodeURIComponent(path.split('/')[3] || ''));
    if (method === 'POST' && path === '/f/wipe') { await this.s.deleteAll(); for (const ws of this.state.getWebSockets()) { try { ws.close(4001, 'wiped'); } catch { /* closed */ } } return reply({ ok: true }); }
    return fail(404, 'Not found');
  }

  /** null when the owner's signature, clock and counter are good; otherwise the error to send. */
  async checkOwner(method, path, header, body, keys = null) {
    keys ||= await this.s.get('keys');
    if (!keys) return fail(401, 'No such mailbox.');
    const [ts, sig] = String(header).split('.');
    const t = Number(ts);
    if (!Number.isFinite(t) || !sig || Math.abs(Date.now() - t) > AUTH_WINDOW_MS) return fail(401, 'Check the date and time on this device.');
    if (!(await verifySig(keys.sign, await authMessage(method, path, ts, body), sig))) return fail(401, 'Bad signature.');
    const last = (await this.s.get('lastAuth')) || 0;
    if (t <= last) return fail(401, 'That request was already used.');
    await this.s.put('lastAuth', t);
    return null;
  }

  async claim(body, header, text, path) {
    if (!BOX.test(body.box || '') || !B64U.test(body.sign || '') || !B64U.test(body.dh || '') || unb64u(body.sign).length !== 32 || unb64u(body.dh).length !== 32) return fail(400, 'Bad keys.');
    const have = await this.s.get('keys');
    if (have && (have.sign !== body.sign || have.dh !== body.dh)) return fail(409, 'That mailbox already belongs to someone else.');
    const bad = await this.checkOwner('POST', path, header, text, have || { sign: body.sign });
    if (bad) return bad;
    if (!have) await this.s.put('keys', { sign: body.sign, dh: body.dh, at: Date.now() });
    await this.scheduleCleanup();
    return reply({ ok: true });
  }

  async allow(body) {
    if (!HASH.test(body.hash || '')) return fail(400, 'Bad hash.');
    const n = (await this.s.get('allowN')) || 0;
    if (!(await this.s.get(`a:${body.hash}`))) {
      if (n >= MAX_ALLOW) return fail(429, 'Too many friends.');
      await this.s.put(`a:${body.hash}`, 1); await this.s.put('allowN', n + 1);
    }
    return reply({ ok: true });
  }
  async revoke(hash) {
    if (HASH.test(hash) && (await this.s.get(`a:${hash}`))) { await this.s.delete(`a:${hash}`); await this.s.put('allowN', Math.max(0, ((await this.s.get('allowN')) || 1) - 1)); }
    return reply({ ok: true });
  }

  async seq() { const n = ((await this.s.get('seq')) || 0) + 1; await this.s.put('seq', n); return n; }

  async addRequest(body) {
    if (typeof body.blob !== 'string' || !B64U.test(body.blob) || body.blob.length > MAX_REQ_BLOB) return fail(400, 'Bad request.');
    // Always "accepted", so nobody can use this call to find out which mailboxes exist.
    if (!(await this.s.get('keys'))) return reply({ ok: true }, 202);
    const count = (await this.s.get('rCount')) || 0;
    if (count >= MAX_REQUESTS) return reply({ ok: true }, 202);
    const id = await this.seq();
    await this.s.put(`r:${pad(id)}`, { blob: body.blob, at: Date.now() }); await this.s.put('rCount', count + 1);
    this.push({ type: 'req', id, blob: body.blob });
    return reply({ ok: true }, 202);
  }

  async addMessage(body) {
    if (typeof body.blob !== 'string' || !B64U.test(body.blob) || body.blob.length > MAX_MSG_BLOB || typeof body.token !== 'string' || !B64U.test(body.token)) return fail(400, 'Bad message.');
    let hash; try { hash = await sha256hex(unb64u(body.token)); } catch { return fail(400, 'Bad message.'); }
    if (!(await this.s.get(`a:${hash}`))) return fail(403, 'They have not accepted you.');
    if (body.live === true) {          // typing: only for someone connected right now, never stored
      const n = this.push({ type: 'live', blob: body.blob });
      return reply({ ok: true, delivered: n > 0 });
    }
    const count = (await this.s.get('qCount')) || 0, bytes = (await this.s.get('qBytes')) || 0;
    if (count >= MAX_QUEUE || bytes + body.blob.length > MAX_QUEUE_BYTES) return fail(507, 'Their mailbox is full.');
    const id = await this.seq();
    await this.s.put(`q:${pad(id)}`, { blob: body.blob, at: Date.now() });
    await this.s.put('qCount', count + 1); await this.s.put('qBytes', bytes + body.blob.length);
    this.push({ type: 'msg', id, blob: body.blob });
    return reply({ ok: true, id });
  }

  /** Sends to every open socket; returns how many. */
  push(item) {
    let n = 0;
    for (const ws of this.state.getWebSockets()) { try { ws.send(JSON.stringify(item)); n++; } catch { /* closed */ } }
    return n;
  }

  async socket(request, url) {
    if (request.headers.get('Upgrade') !== 'websocket') return fail(426, 'Expected WebSocket');
    const keys = await this.s.get('keys');
    if (!keys) return fail(401, 'No such mailbox.');
    const bad = await this.checkOwner('GET', url.pathname, request.headers.get('x-nf-auth') || url.searchParams.get('a') || '', '', keys);
    if (bad) return bad;
    for (const old of this.state.getWebSockets()) { try { old.close(4000, 'replaced'); } catch { /* closed */ } }   // one live socket per owner
    const [client, server] = Object.values(new WebSocketPair());
    this.state.acceptWebSocket(server);
    const requests = await this.items('r:'), queue = await this.items('q:');
    server.send(JSON.stringify({ type: 'hello', requests, queue }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async items(prefix) {
    const now = Date.now(), out = [];
    for (const [k, v] of await this.s.list({ prefix })) {
      if (now - v.at > TTL_MS) { await this.drop(k, v); continue; }
      out.push({ id: Number(k.slice(2)), blob: v.blob });
    }
    return out;
  }
  async drop(key, item) {
    await this.s.delete(key);
    if (key.startsWith('q:')) { await this.s.put('qCount', Math.max(0, ((await this.s.get('qCount')) || 1) - 1)); await this.s.put('qBytes', Math.max(0, ((await this.s.get('qBytes')) || 0) - (item?.blob?.length || 0))); }
    else await this.s.put('rCount', Math.max(0, ((await this.s.get('rCount')) || 1) - 1));
  }

  webSocketMessage(ws, data) {
    if (data === 'ping') { ws.send('pong'); return; }
    return this.onMessage(ws, data);
  }
  async onMessage(ws, data) {
    let m; try { m = JSON.parse(data); } catch { return; }
    if (!Array.isArray(m.ack)) return;
    for (const id of m.ack.slice(0, 500)) {
      if (!Number.isInteger(id)) continue;
      for (const prefix of ['q:', 'r:']) { const key = `${prefix}${pad(id)}`, item = await this.s.get(key); if (item) await this.drop(key, item); }
    }
  }
  webSocketClose(ws) { try { ws.close(); } catch { /* closed */ } }
  webSocketError(ws) { try { ws.close(); } catch { /* closed */ } }

  async scheduleCleanup() { if (!(await this.s.getAlarm())) await this.s.setAlarm(Date.now() + 24 * 3600 * 1000); }
  async alarm() {
    await this.items('q:'); await this.items('r:');          // reading drops what is past its 14 days
    if (await this.s.get('keys')) await this.s.setAlarm(Date.now() + 24 * 3600 * 1000);
  }
}

/** The Worker's front door for /f/…: checks the shape, applies the per-address limits, and hands the call to the mailbox. */
export async function routeFriends(request, env) {
  const url = new URL(request.url), path = url.pathname, method = request.method;
  if (method === 'OPTIONS') return new Response(null, { headers: CORS });
  let box = null, bucket = null, max = 0, window = 60000;
  const m = path.match(/^\/f\/(key|ws|allow)\/([^/]+)$/);
  if (method === 'GET' && m && m[1] === 'key') { box = m[2]; bucket = 'key'; max = 30; }
  else if (method === 'GET' && m && m[1] === 'ws') { box = m[2]; }
  else if (method === 'DELETE' && m && m[1] === 'allow') { box = null; }
  else if (!['/f/claim', '/f/req', '/f/send', '/f/allow', '/f/wipe'].includes(path)) return fail(404, 'Not found');

  let text = null, body = {};
  if (method === 'POST' || method === 'PUT') {
    text = await request.text();
    if (text.length > MAX_BODY) return fail(413, 'Too large');
    try { body = JSON.parse(text || '{}'); } catch { return fail(400, 'Bad JSON'); }
  }
  // Which mailbox, and which limit.
  if (path === '/f/claim') { box = body.box; bucket = 'claim'; max = 5; window = 3600000; }
  else if (path === '/f/req') { box = body.to; bucket = `req:${body.to}`; max = 3; }
  else if (path === '/f/send') { box = body.to; bucket = `send:${await sha256hex(String(body.token || ''))}`; max = SENDS_PER_MIN; }
  else if (path === '/f/allow' || path === '/f/wipe') { box = body.box || request.headers.get('x-nf-box'); }
  else if (method === 'DELETE') { box = request.headers.get('x-nf-box'); }
  if (!BOX.test(box || '')) return fail(400, 'Bad mailbox.');

  if (bucket && env.FRIEND_RATE) {
    const ip = request.headers.get('cf-connecting-ip') || 'unknown', day = new Date().toISOString().slice(0, 10);
    const id = env.FRIEND_RATE.idFromName(await sha256hex(`${day}|${bucket}|${ip.includes(':') ? ip.split(':').slice(0, 4).join(':') : ip}`));
    const r = await (await env.FRIEND_RATE.get(id).fetch(`https://rate/?max=${max}&w=${window}`)).json();
    if (!r.ok) return fail(429, 'Too many requests. Try again later.');
    if (path === '/f/req') {           // and an hourly cap on requests overall from one address
      const id2 = env.FRIEND_RATE.idFromName(await sha256hex(`${day}|reqall|${ip}`));
      if (!(await (await env.FRIEND_RATE.get(id2).fetch('https://rate/?max=10&w=3600000')).json()).ok) return fail(429, 'Too many requests. Try again later.');
    }
  }
  // The mailbox gets the request as it came (the body was already read, so it is rebuilt).
  const forward = method === 'POST' || method === 'PUT' ? new Request(request.url, { method, headers: request.headers, body: text }) : request;
  return env.MAILBOX.get(env.MAILBOX.idFromName(box)).fetch(forward);
}
