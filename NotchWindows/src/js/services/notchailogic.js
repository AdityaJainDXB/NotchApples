// NotchAI on Windows: the pure rules, rewritten from the Mac's Swift (ModelLocality, NotchAIGuard,
// NotchAIConversationLogic, NotchAIVoiceLogic) with the Swift tests as the specification. No network, no UI, so
// node tests cover all of it.
//
// Local first: while "Allow cloud and unverified models" is off, NotchAI only talks to a model that Ollama's own
// model list shows as installed on this PC. Anything else is refused BEFORE a request is made, so nothing is sent.

// ---- where a model runs ----

/// Ollama's hosted models are named "...-cloud" or "...:cloud"; a local Ollama just passes them on to ollama.com.
export function isOllamaCloudName(model) {
  const m = String(model || '').toLowerCase();
  return m.endsWith('-cloud') || m.endsWith(':cloud') || m.includes(':cloud-') || m.includes('-cloud:');
}

function hostOf(url) {
  try { return new URL(String(url)).hostname.toLowerCase().replace(/^\[|\]$/g, ''); } catch { return ''; }
}
function ipv4(host) {
  const parts = host.split('.');
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p))) return null;
  return parts.map(Number);
}

/// True for this PC, loopback and private-network / .local hosts.
export function isLocalHost(url) {
  const host = hostOf(url);
  if (!host) return false;
  if (host === 'localhost' || host === '::1' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  const p = ipv4(host);
  if (!p) return false;
  return p[0] === 127 || p[0] === 10 || (p[0] === 192 && p[1] === 168) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31);
}

/// True only for this PC itself (not the rest of the network).
export function isLoopbackHost(url) {
  const host = hostOf(url);
  if (!host) return false;
  if (host === 'localhost' || host === '::1' || host.endsWith('.localhost')) return true;
  const p = ipv4(host);
  return !!p && p[0] === 127;
}

/// Reads Ollama's /api/tags entries. A model is verified local only if the server lists it with real weights on
/// disk (a digest and a size above zero) and no remote_host / remote_model. A cloud-looking name is always cloud.
/// Anything that is not clearly local is NOT local. Returns { kind: 'local' | 'cloud' | 'unverified', why }.
export function verdict(tags, model) {
  if (isOllamaCloudName(model)) return { kind: 'cloud', why: 'the name marks it as an Ollama Cloud model' };
  const wanted = String(model || '').toLowerCase();
  const entry = (Array.isArray(tags) ? tags : []).find((e) => [e?.name, e?.model]
    .filter((v) => typeof v === 'string').map((v) => v.toLowerCase()).some((v) => v === wanted || v === `${wanted}:latest`));
  if (!entry) return { kind: 'unverified', why: `the server doesn't list ${model} as installed` };
  const nonEmpty = (k) => typeof entry[k] === 'string' && entry[k] !== '';
  if (nonEmpty('remote_host') || nonEmpty('remote_model')) return { kind: 'cloud', why: 'the server says it runs remotely' };
  if (!(Number(entry.size) > 0)) return { kind: 'cloud', why: 'it has no weights on this machine' };
  if (!nonEmpty('digest')) return { kind: 'unverified', why: 'the server gave no digest for it' };
  return { kind: 'local', why: '' };
}

/// What to print next to a model: Local, Cloud or Unverified. Display only; `guard` decides what may run.
export function badge(provider, model, v) {
  if (provider !== 'ollama') return 'Cloud';
  if (isOllamaCloudName(model)) return 'Cloud';
  if (v?.kind === 'local') return 'Local';
  if (v?.kind === 'cloud') return 'Cloud';
  return 'Unverified';
}

/// The one gate. `v` is the verdict from the server's model list, or null when it could not be read.
/// Returns { ok: true } or { ok: false, why }. Fails closed: no verdict means no request.
export function guard({ provider, providerName, model, allowCloud, v }) {
  if (allowCloud) return { ok: true };
  if (provider !== 'ollama') {
    return { ok: false, why: `${providerName || provider} is a cloud provider. Local first is on, so nothing was sent. Choose Ollama (this PC), or allow cloud models below.` };
  }
  if (!v) return { ok: false, why: "NotchAI couldn't read Ollama's model list, so it can't confirm the model runs on this PC. Nothing was sent. Start Ollama, or allow cloud models below." };
  if (v.kind === 'local') return { ok: true };
  return { ok: false, why: `${model} is not verified to run on this PC (${v.why}). Nothing was sent. Pick an installed model, or allow cloud and unverified models below.` };
}

// ---- the conversation ----

/// For Regenerate: drop the trailing assistant replies and return the turns before the last question plus that
/// question. null when there is no question to ask again.
export function regeneration(turns) {
  const t = [...turns];
  while (t.length && t[t.length - 1].role === 'assistant') t.pop();
  const q = t[t.length - 1];
  if (!q || q.role !== 'user' || !String(q.text || '').trim()) return null;
  t.pop();
  return { history: t, question: q.text };
}

/// Keeps the newest turns that fit in `maxCharacters`, always keeps the last turn, and never starts on an
/// assistant reply, so the model sees a well-formed chat.
export function trimmed(turns, maxCharacters) {
  if (!turns.length) return [];
  const last = turns[turns.length - 1];
  const kept = [last];
  let used = last.text.length;
  for (let i = turns.length - 2; i >= 0; i--) {
    if (used + turns[i].text.length > maxCharacters) break;
    kept.unshift(turns[i]);
    used += turns[i].text.length;
  }
  while (kept.length > 1 && kept[0].role === 'assistant') kept.shift();
  return kept;
}

/// Context budget in characters from a model's window in tokens (about 4 characters a token, a quarter kept free
/// for the reply). A default when the window is unknown.
export function contextBudget(windowTokens) {
  if (!(windowTokens > 0)) return 24000;
  return Math.max(2000, Math.floor(windowTokens * 4 * 0.75));
}

// ---- speaking an answer ----

/// The words to read aloud: no Markdown marks, code blocks replaced by a short phrase, links shortened.
export function spokenText(md) {
  let t = String(md || '');
  t = t.replace(/```[\s\S]*?```/g, ' (code omitted) ');
  t = t.replace(/`([^`]*)`/g, '$1');
  t = t.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1');
  t = t.replace(/https?:\/\/\S+/g, 'a link');
  t = t.replace(/^\s{0,3}(#{1,6}|[-*+>]|\d+\.)\s+/gm, '');
  t = t.replace(/[*_~|]+/g, '');
  t = t.replace(/[ \t]+/g, ' ');
  t = t.replace(/\n{2,}/g, '\n');
  return t.trim();
}

function splitLong(s, max) {
  const parts = [];
  let rest = s;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let cut = window.lastIndexOf(',');
    if (cut < 0) cut = window.lastIndexOf(' ');
    if (cut < 0) cut = max - 1;
    const piece = rest.slice(0, cut + 1).trim();
    if (piece) parts.push(piece);
    rest = rest.slice(cut + 1);
  }
  if (rest.trim()) parts.push(rest.trim());
  return parts;
}

/// Cuts text into sentence-sized chunks of at most `max` characters, so the first can start speaking while the
/// rest wait, and Stop takes effect between chunks.
export function chunks(text, max = 220) {
  const clean = String(text || '').trim();
  if (!clean) return [];
  const sentences = [];
  let current = '';
  for (const ch of clean) {
    current += ch;
    if ('.!?…\n'.includes(ch)) { sentences.push(current.trim()); current = ''; }
  }
  if (current.trim()) sentences.push(current.trim());
  const out = [];
  let buffer = '';
  const flush = () => { if (buffer) { out.push(buffer); buffer = ''; } };
  for (const s of sentences) {
    if (!s) continue;
    if (s.length > max) { flush(); out.push(...splitLong(s, max)); }
    else if (!buffer) buffer = s;
    else if (buffer.length + 1 + s.length <= max) buffer += ` ${s}`;
    else { flush(); buffer = s; }
  }
  flush();
  return out;
}

/// The voice loop's states, the same as the Mac: idle, listening, transcribing, thinking, executing, speaking,
/// interrupted, error. `event` is a name; 'aiReplied' takes `speak`.
export function nextVoiceState(s, event, speak = false) {
  if (event === 'reset') return 'idle';
  if (event === 'failed') return 'error';
  if (event === 'startListening') return s === 'speaking' ? 'interrupted' : 'listening';
  if (event === 'heardWords' && (s === 'interrupted' || s === 'listening')) return 'transcribing';
  if (event === 'speechEnded' && ['interrupted', 'listening', 'transcribing'].includes(s)) return 'thinking';
  if (event === 'cancelled' && ['listening', 'transcribing', 'interrupted'].includes(s)) return 'idle';
  if (event === 'toolsRunning' && s === 'thinking') return 'executing';
  if (event === 'aiReplied' && (s === 'thinking' || s === 'executing')) return speak ? 'speaking' : 'idle';
  if (s === 'speaking' && (event === 'speakingFinished' || event === 'cancelled')) return 'idle';
  if (s === 'speaking' && event === 'interrupt') return 'interrupted';
  if (event === 'speakingStarted' && (s === 'idle' || s === 'thinking')) return 'speaking';
  return s;
}
