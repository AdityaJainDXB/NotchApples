// Notch apple Messenger relay (Anonymous rooms).
//
//   wss://<worker>/<topic>/ws
//
// Everyone connected to the same topic gets every frame anyone else sends, live.
// The topic is a hash of the room code and every frame is AES-GCM sealed with a key
// made from the code, so this relay never sees room names or message text. Nothing is
// written to storage or logged; frames are only passed between open sockets.

const TOPIC = /^notchapple-v1-[0-9a-f]{40}$/;
const MAX_FRAME = 16 * 1024;
const MAX_PEERS = 200;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/') return new Response('Notch apple rooms relay');
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
