// The bridge to the native side. Everything that needs Windows (system APIs,
// background watchers) and every web request goes through here.
//
// Web requests go through Rust rather than fetch(): the web view applies CORS,
// and many free services the app uses (ESPN team lists, Groq, Yahoo Finance, a
// local Ollama) would otherwise be blocked.

const T = window.__TAURI__;
export const hasTauri = !!T;

let mock = null;
async function devMock() {
  // Outside the app (a plain browser, for design work) a stand-in answers.
  mock ??= import('./dev/mock.js').then((m) => m.default);
  return mock;
}

/// Calls a Rust command. Rejects with an Error whose message is readable.
export async function invoke(cmd, args = {}) {
  if (!T) return (await devMock()).invoke(cmd, args);
  try { return await T.core.invoke(cmd, args); }
  catch (e) { throw new Error(typeof e === 'string' ? e : e?.message || String(e)); }
}

/// Listens for an event from Rust. Returns a function that stops listening.
export async function listen(event, fn) {
  if (!T) return (await devMock()).listen(event, fn);
  return T.event.listen(event, (e) => fn(e.payload));
}

export class HttpError extends Error {
  constructor(status, message, body) { super(message); this.status = status; this.body = body; }
}

/// A web request. Returns { status, ok, text, headers, json() }.
export async function http(url, { method = 'GET', headers = {}, body, json, timeout = 30000, binary = false } = {}) {
  if (json !== undefined) {
    body = JSON.stringify(json);
    headers = { 'content-type': 'application/json', ...headers };
  }
  let r;
  if (T) {
    r = await invoke('http', { req: { url, method, headers, body, timeout_ms: timeout, binary } });
  } else {
    r = await (await devMock()).http({ url, method, headers, body, binary, timeout });
  }
  return {
    status: r.status, ok: r.ok, text: r.body, headers: r.headers || {},
    json() { try { return JSON.parse(r.body); } catch { throw new HttpError(r.status, 'The service sent something unreadable.'); } },
  };
}

/// GET (or POST) and parse JSON; throws HttpError on a non-2xx answer.
export async function getJSON(url, opts = {}) {
  const r = await http(url, opts);
  if (!r.ok) {
    let msg = `The service answered ${r.status}.`;
    try {
      const j = JSON.parse(r.text);
      msg = j.error?.message || j.error_description || (typeof j.error === 'string' ? j.error : '') || j.message || msg;
    } catch {}
    throw new HttpError(r.status, msg, r.text);
  }
  return r.json();
}

export const openUrl = (url) => invoke('open_url', { url });
export const notify = (title, body) => invoke('notify', { title, body }).catch(() => {});
