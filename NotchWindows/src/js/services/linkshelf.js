// The links shelf: save a link now, read it later. Turns what you paste or type into a clean web address and refuses
// anything that isn't one, so a saved "link" can never be a script or a local file. Nothing is fetched.
// The same rules and test vectors as the Mac's LinkShelfLogic.swift.

const SHAPE = /^(?:(https?):\/\/)?([^\s/?#@]+)([/?#]\S*)?$/i;
const DOMAIN = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;
const LOCAL = /^(localhost|(\d{1,3}\.){3}\d{1,3})$/;

/// "example.com/a" → "https://example.com/a". null unless it is a web address.
export function normalize(input) {
  const m = SHAPE.exec(String(input ?? '').trim());
  if (!m) return null;
  const scheme = m[1] ? m[1].toLowerCase() : null, host = m[2].toLowerCase(), bare = host.replace(/:\d{1,5}$/, '');
  if (!(DOMAIN.test(bare) || (scheme && LOCAL.test(bare)))) return null;
  return `${scheme || 'https'}://${host}${m[3] || ''}`;
}

/// "https://www.example.com/a/b" → "example.com/a/b" (40 characters at most).
export function label(url) {
  let s = String(url).replace(/^https?:\/\//i, '');
  if (s.startsWith('www.')) s = s.slice(4);
  s = s.replace(/\/+$/, '');
  return s.length > 40 ? `${s.slice(0, 39)}…` : s;
}
