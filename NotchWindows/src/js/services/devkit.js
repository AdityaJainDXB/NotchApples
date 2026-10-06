// Small developer tools for the Dev Tools tab: format and minify JSON, base64 and URL encoding, case changes, a JWT
// decoder, hashes, UUIDs, lorem ipsum, timestamps, a regex tester and a colour contrast checker. Everything runs on
// this PC and nothing is sent anywhere. The same rules as the Mac's DevToolkitLogic.swift, with the same test cases.

// ---- JSON (key order and number formatting are kept exactly as typed) ----

export function isJSON(s) { try { JSON.parse(s); return String(s).trim() !== ''; } catch { return false; } }

export function formatJSON(s) {
  if (!isJSON(s)) return null;
  const chars = [...String(s).trim()];
  let out = '', depth = 0, inString = false, escaped = false;
  const newline = () => { out += `\n${'  '.repeat(depth)}`; };
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (inString) { out += c; if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') inString = false; continue; }
    switch (c) {
      case '"': inString = true; out += c; break;
      case '{': case '[': {
        let j = i + 1; while (j < chars.length && /\s/.test(chars[j])) j++;
        if (chars[j] === (c === '{' ? '}' : ']')) { out += c + chars[j]; i = j; } else { out += c; depth++; newline(); }
        break;
      }
      case '}': case ']': depth--; newline(); out += c; break;
      case ',': out += c; newline(); break;
      case ':': out += ': '; break;
      case ' ': case '\n': case '\t': case '\r': break;
      default: out += c;
    }
  }
  return out;
}

export function minifyJSON(s) {
  if (!isJSON(s)) return null;
  let out = '', inString = false, escaped = false;
  for (const c of String(s).trim()) {
    if (inString) { out += c; if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') inString = false; }
    else if (c === '"') { inString = true; out += c; }
    else if (!/\s/.test(c)) out += c;
  }
  return out;
}

// ---- encoding ----

const enc = new TextEncoder(), dec = new TextDecoder('utf-8', { fatal: true });
export const base64Encode = (s) => btoa(String.fromCharCode(...enc.encode(s)));
/// Accepts normal and URL-safe base64, with or without padding. null if it isn't valid text.
export function base64Decode(s) {
  try {
    let t = String(s).trim().replace(/-/g, '+').replace(/_/g, '/');
    while (t.length % 4) t += '=';
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(t)) return null;
    return dec.decode(Uint8Array.from(atob(t), (c) => c.charCodeAt(0)));
  } catch { return null; }
}
/// Everything except letters, digits and - . _ ~ is %-encoded (as UTF-8).
export const urlEncode = (s) => [...enc.encode(s)].map((b) => (/[A-Za-z0-9\-._~]/.test(String.fromCharCode(b)) ? String.fromCharCode(b) : `%${b.toString(16).toUpperCase().padStart(2, '0')}`)).join('');
export function urlDecode(s) { try { return decodeURIComponent(s); } catch { return null; } }

// ---- case ----

export const words = (s) => String(s).match(/[A-Z]?[a-z]+|[A-Z]+(?![a-z])|[0-9]+/g) || [];
export const CASES = ['UPPER', 'lower', 'Title Case', 'snake_case', 'kebab-case', 'camelCase', 'PascalCase'];
export function convert(s, style) {
  const w = words(s).map((x) => x.toLowerCase());
  const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
  switch (style) {
    case 'UPPER': return String(s).toUpperCase();
    case 'lower': return String(s).toLowerCase();
    case 'Title Case': return w.map(cap).join(' ');
    case 'snake_case': return w.join('_');
    case 'kebab-case': return w.join('-');
    case 'camelCase': return w.map((x, i) => (i ? cap(x) : x)).join('');
    case 'PascalCase': return w.map(cap).join('');
    default: return String(s);
  }
}

// ---- JWT (shows what's inside; it cannot check the signature, which needs the secret) ----

export function decodeJWT(token) {
  const parts = String(token).trim().split('.');
  if (parts.length !== 3) return null;
  const h = base64Decode(parts[0]), p = base64Decode(parts[1]);
  const header = h && formatJSON(h), payload = p && formatJSON(p);
  if (!header || !payload) return null;
  const claims = JSON.parse(p);
  const at = (k) => (typeof claims[k] === 'number' ? new Date(claims[k] * 1000) : null);
  const expires = at('exp');
  return { header, payload, hasSignature: parts[2] !== '', issued: at('iat'), expires, notBefore: at('nbf'), isExpired: (now = Date.now()) => !!expires && expires.getTime() < now };
}

// ---- hashes and ids ----

export const HASHES = { 'SHA-1': 'SHA-1', 'SHA-256': 'SHA-256', 'SHA-512': 'SHA-512' };
export async function hash(s, kind) {
  return [...new Uint8Array(await crypto.subtle.digest(HASHES[kind], enc.encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export const uuid = () => crypto.randomUUID();
const LOREM = ('lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua '
  + 'ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat duis aute irure dolor in '
  + 'reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt in culpa '
  + 'qui officia deserunt mollit anim id est laborum').split(' ');
export function loremIpsum(count) {
  const n = Math.max(1, Math.min(Number(count) || 1, 2000));
  const text = Array.from({ length: n }, (_, i) => LOREM[i % LOREM.length]).join(' ');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

// ---- timestamps ----

/// "1516239022" (seconds), "1516239022000" (milliseconds) or "2018-01-18T01:30:22Z" → { seconds, isoUTC }.
export function parseStamp(input) {
  const s = String(input).trim();
  if (!s) return null;
  let secs;
  if (/^-?[0-9.]+$/.test(s) && Number.isFinite(Number(s))) { const n = Number(s); secs = Math.abs(n) >= 1e11 ? n / 1000 : n; }
  else { const t = Date.parse(s); if (Number.isNaN(t) || !/\d{4}-\d{2}-\d{2}/.test(s)) return null; secs = t / 1000; }
  return { seconds: secs, isoUTC: new Date(Math.floor(secs) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z') };
}

// ---- regex ----

export function regexTest(pattern, text, { ignoreCase = false, multiline = false, dotAll = false } = {}) {
  let re;
  try { re = new RegExp(pattern, `g${ignoreCase ? 'i' : ''}${multiline ? 'm' : ''}${dotAll ? 's' : ''}`); } catch { return { invalid: "That pattern isn't valid." }; }
  const matches = [];
  for (const m of String(text).matchAll(re)) {
    if (matches.length >= 200) break;
    matches.push({ text: m[0], groups: m.slice(1).map((g) => g ?? '') });
    if (m[0] === '') re.lastIndex++;   // an empty match must not loop forever
  }
  return { matches };
}

// ---- colour contrast (WCAG) ----

export function rgb(hex) {
  let h = String(hex).trim().toLowerCase().replace(/^#/, '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/.test(h)) return null;
  const v = parseInt(h, 16);
  return { r: ((v >> 16) & 255) / 255, g: ((v >> 8) & 255) / 255, b: (v & 255) / 255 };
}
const lin = (x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
export const luminance = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
export function contrast(a, b) {
  const x = rgb(a), y = rgb(b);
  if (!x || !y) return null;
  const l1 = luminance(x), l2 = luminance(y);
  const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  return { ratio, aaNormal: ratio >= 4.5, aaLarge: ratio >= 3, aaaNormal: ratio >= 7, aaaLarge: ratio >= 4.5 };
}
