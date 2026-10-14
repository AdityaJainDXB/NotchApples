// Anonymous, opt-in usage statistics, glitch notes and user feedback.
//
// What the apps may send (and only after the person agrees in the app): a random install id (a UUID made on the device,
// not linked to a name, an email or a licence), the app version, the operating system ("mac" or "win") and its version,
// and the plan tier. Feedback and glitch notes are text the person typed and chose to send. Nothing here stores an IP
// address. The admin panel reads the totals; nothing is sent anywhere else.
//
//   POST /telemetry/ping     {id, v, os, osv, tier}       "this install is alive today" (at most one write per 6 hours)
//   POST /telemetry/glitch   {id, v, os, kind, text}      a problem the person described
//   POST /feedback           {id, v, os, kind, text}      kind: idea | problem | praise
//   POST /admin/insights     (admin) totals, by version, by OS, by tier, daily actives
//   POST /admin/glitches     (admin) newest glitch notes
//   POST /admin/feedback     (admin) newest feedback

const DAY = 86_400_000;
const ID = /^[0-9a-f]{32}$/;
const VERSION = /^[0-9]{1,3}(\.[0-9]{1,3}){1,3}$/;
const OSES = new Set(['mac', 'win']);
const KINDS = new Set(['idea', 'problem', 'praise']);
const pad = (n) => String(n).padStart(15, '0');
const dayKey = (t) => new Date(t).toISOString().slice(0, 10);

export class InsightsError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (m) => new InsightsError(400, m);

/// One install said hello. Writes at most once per 6 hours per install, plus one tiny "active today" marker per day.
export async function ping(env, body, now = Date.now()) {
  const id = String(body.id || '').toLowerCase();
  if (!ID.test(id)) throw bad('Bad id.');
  const v = String(body.v || ''), os = String(body.os || '');
  if (!VERSION.test(v) || !OSES.has(os)) throw bad('Bad version or system.');
  const osv = String(body.osv || '').replace(/[^0-9A-Za-z. _-]/g, '').slice(0, 24);
  const tier = [0, 1, 2].includes(Number(body.tier)) ? Number(body.tier) : 0;
  const key = `usr:${id}`;
  const cur = await env.KV.getWithMetadata(key);
  const m = cur.metadata || null;
  if (m && now - m.last < 6 * 3_600_000 && m.v === v && m.os === os && m.tier === tier) return { ok: true };
  const days = (m?.days || 0) + (m && dayKey(m.last) === dayKey(now) ? 0 : 1);
  await env.KV.put(key, '1', { metadata: { first: m?.first || now, last: now, v, os, osv, tier, days }, expirationTtl: 400 * 86400 });
  await env.KV.put(`dau:${dayKey(now)}:${id}`, '1', { expirationTtl: 45 * 86400 });
  return { ok: true };
}

async function limited(env, name, id, seconds) {
  const k = `${name}:${id}`;
  if (await env.KV.get(k)) throw new InsightsError(429, 'Slow down a little.');
  await env.KV.put(k, '1', { expirationTtl: Math.max(60, seconds) });
}

function cleanText(t, max) {
  return String(t || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/\s+\n/g, '\n').trim().slice(0, max);
}

const rand = () => Math.random().toString(36).slice(2, 8);

export async function glitch(env, body, now = Date.now()) {
  const id = String(body.id || '').toLowerCase();
  if (!ID.test(id)) throw bad('Bad id.');
  const v = String(body.v || ''), os = String(body.os || '');
  if (!VERSION.test(v) || !OSES.has(os)) throw bad('Bad version or system.');
  const text = cleanText(body.text, 600);
  if (text.length < 3) throw bad('Say a little more about what went wrong.');
  await limited(env, 'glrl', id, 600);
  await env.KV.put(`gl:${pad(now)}:${rand()}`, text, { metadata: { id: id.slice(0, 8), v, os, kind: cleanText(body.kind, 16) || 'glitch' }, expirationTtl: 90 * 86400 });
  return { ok: true };
}

export async function feedback(env, body, now = Date.now()) {
  const id = String(body.id || '').toLowerCase();
  if (!ID.test(id)) throw bad('Bad id.');
  const v = String(body.v || ''), os = String(body.os || '');
  if (!VERSION.test(v) || !OSES.has(os)) throw bad('Bad version or system.');
  const kind = KINDS.has(body.kind) ? body.kind : 'idea';
  const text = cleanText(body.text, 1000);
  if (text.length < 3) throw bad('Write a few words first.');
  await limited(env, 'fbrl', id, 3600);
  await env.KV.put(`fb:${pad(now)}:${rand()}`, JSON.stringify({ kind, text, v, os, id: id.slice(0, 8), at: now }), { expirationTtl: 365 * 86400 });
  return { ok: true };
}

async function listAll(env, prefix, cap) {
  const out = []; let cursor;
  do {
    const page = await env.KV.list({ prefix, cursor, limit: 1000 });
    out.push(...page.keys);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor && out.length < cap);
  return out;
}

const tally = (arr, f) => { const o = {}; for (const x of arr) { const k = f(x); o[k] = (o[k] || 0) + 1; } return o; };

/// The numbers for the admin panel. Counts only; nothing here can identify a person.
export async function insights(env, now = Date.now()) {
  const users = (await listAll(env, 'usr:', 20000)).map((k) => k.metadata).filter(Boolean);
  const dailyActive = [];
  for (let i = 13; i >= 0; i--) {
    const d = dayKey(now - i * DAY);
    dailyActive.push({ day: d, active: (await listAll(env, `dau:${d}:`, 20000)).length });
  }
  const within = (days) => users.filter((u) => now - u.last < days * DAY).length;
  const versionsByOs = {};
  for (const u of users) { const k = `${u.os}|${u.v}`; versionsByOs[k] = (versionsByOs[k] || 0) + 1; }
  return {
    total: users.length,
    newLast7: users.filter((u) => now - u.first < 7 * DAY).length,
    active1: within(1), active7: within(7), active30: within(30),
    byOs: tally(users, (u) => u.os),
    byVersion: tally(users, (u) => u.v),
    byTier: tally(users, (u) => ['Free', 'Pro', 'Ultimate'][u.tier] || 'Free'),
    byOsVersion: tally(users, (u) => `${u.os === 'mac' ? 'macOS' : 'Windows'} ${u.osv || '?'}`),
    versionsByOs,
    dailyActive,
    note: 'Only installs that agreed to share anonymous usage are counted.',
  };
}

export async function glitches(env, limit = 100) {
  const keys = (await listAll(env, 'gl:', 2000)).reverse().slice(0, limit);
  const items = [];
  for (const k of keys) items.push({ at: Number(k.name.split(':')[1]), ...(k.metadata || {}), text: await env.KV.get(k.name) });
  return { glitches: items };
}

export async function feedbackList(env, limit = 200) {
  const keys = (await listAll(env, 'fb:', 3000)).reverse().slice(0, limit);
  const items = [];
  for (const k of keys) { try { items.push(JSON.parse(await env.KV.get(k.name))); } catch { /* skip a damaged one */ } }
  const byKind = tally(items, (i) => i.kind);
  return { feedback: items, byKind };
}
