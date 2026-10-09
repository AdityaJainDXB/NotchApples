// Notch apple Messenger relay (Anonymous rooms).
//
//   wss://<worker>/<topic>/ws
//
// Everyone connected to the same topic gets every frame anyone else sends, live.
// The topic is a hash of the room code and every frame is AES-GCM sealed with a key
// made from the code, so this relay never sees room names or message text. Nothing is
// written to storage or logged; frames are only passed between open sockets.

const TOPIC = /^notchapple-v1-[0-9a-f]{40}$/;
// Clipboard Link (Ultimate) rooms live under /clip/<topic>/ws?p=<pass> and need a pass from the licence server. The pass
// is a short-lived signed note that says "Ultimate", with no key or device in it, so the relay still learns nothing about
// who is connected. Anonymous Messenger rooms keep using /<topic>/ws.
const PUBLIC_KEY = 'HmCtNtd+sFaJO+8TQ57od7pptH3dhEx00SO16I1fhvs=';   // the same public key the apps use to check licences
const CLIP_MIN_TIER = 2;
const MAX_FRAME = 16 * 1024;
const MAX_PEERS = 200;

let pubKey = null;
async function publicKey() {
  if (pubKey) return pubKey;
  const raw = Uint8Array.from(atob(PUBLIC_KEY), (c) => c.charCodeAt(0));
  for (const algo of [{ name: 'Ed25519' }, { name: 'NODE-ED25519', namedCurve: 'NODE-ED25519' }]) {
    try { pubKey = { key: await crypto.subtle.importKey('raw', raw, algo, false, ['verify']), algo }; return pubKey; } catch { /* try the other name */ }
  }
  throw new Error('no Ed25519');
}
const unb64u = (s) => { const t = String(s).replace(/-/g, '+').replace(/_/g, '/'); return Uint8Array.from(atob(t + '==='.slice((t.length + 3) % 4)), (c) => c.charCodeAt(0)); };

/** True for a genuine, unexpired pass for at least `minTier`. */
export async function passOk(pass, minTier = CLIP_MIN_TIER, nowSec = Math.floor(Date.now() / 1000)) {
  const parts = String(pass || '').split('.');
  if (parts.length !== 3 || parts[0] !== 'pass1') return false;
  try {
    const { key, algo } = await publicKey();
    if (!(await crypto.subtle.verify(algo, key, unb64u(parts[2]), new TextEncoder().encode(`NOTCHAPPLE-pass1\n${parts[1]}`)))) return false;
    const p = JSON.parse(new TextDecoder().decode(unb64u(parts[1])));
    return Number(p.exp) > nowSec && Number(p.t) >= minTier;
  } catch { return false; }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/') return new Response('Notch apple rooms relay');
    const clip = url.pathname.match(/^\/clip\/([^/]+)\/ws$/);
    if (clip) {
      if (!TOPIC.test(clip[1])) return new Response('Not found', { status: 404 });
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
      if (!(await passOk(url.searchParams.get('p')))) return new Response('Clipboard Link needs Ultimate', { status: 403 });
      return env.ROOM.get(env.ROOM.idFromName(`clip:${clip[1]}`)).fetch(request);
    }
    const m = url.pathname.match(/^\/([^/]+)\/ws$/);
    if (!m || !TOPIC.test(m[1])) return new Response('Not found', { status: 404 });
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
    return env.ROOM.get(env.ROOM.idFromName(m[1])).fetch(request);
  },
};

export class Room {
  constructor(state) { this.state = state; }

  async fetch() {
    if (this.state.getWebSockets().length >= MAX_PEERS) return new Response('Room full', { status: 429 });
    const [client, server] = Object.values(new WebSocketPair());
    this.state.acceptWebSocket(server);
    server.send(JSON.stringify({ event: 'open' }));
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, data) {
    if (data === 'ping') { ws.send('pong'); return; }
    const size = typeof data === 'string' ? data.length : data.byteLength;
    if (size === 0 || size > MAX_FRAME) return;
    for (const peer of this.state.getWebSockets()) {
      if (peer !== ws) { try { peer.send(data); } catch { /* closed */ } }
    }
  }

  webSocketClose(ws) { try { ws.close(); } catch {} }
  webSocketError(ws) { try { ws.close(); } catch {} }
}
