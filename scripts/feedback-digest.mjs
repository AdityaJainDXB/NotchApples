#!/usr/bin/env node
// Pulls the feedback, glitch notes and user numbers from the licence server (admin only) and writes a digest for the
// weekly routine to consolidate into a GitHub issue and the website's "What people are asking for" page.
//   node scripts/feedback-digest.mjs            writes private/feedback-digest.md and .json, prints a short summary
//   node scripts/feedback-digest.mjs --publish  also rewrites web/feedback-summary.json from private/feedback-themes.json
//                                               (themes the routine wrote: [{title, kind, count, note}]; no raw messages)
// The admin code comes from ADMIN_TOKEN or private/admin-token.txt and is never printed. Nothing identifying is in the
// data (a random install id is cut to 8 characters; there are no emails, names or addresses).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const priv = join(root, 'private');
const publish = process.argv.includes('--publish');

const server = () => {
  const url = JSON.parse(readFileSync(join(root, 'web', 'api.json'), 'utf8')).licenseServer;
  if (!/^https:\/\/[a-z0-9.-]+\.workers\.dev\/?$/.test(url)) throw new Error('The licence server address must be an https …workers.dev address.');
  return url.replace(/\/+$/, '');
};
const token = () => {
  if (process.env.ADMIN_TOKEN) return process.env.ADMIN_TOKEN.trim();
  const f = join(priv, 'admin-token.txt');
  if (existsSync(f)) return readFileSync(f, 'utf8').trim();
  throw new Error('No admin code: set ADMIN_TOKEN or keep private/admin-token.txt.');
};
const api = async (path) => {
  const r = await fetch(`${server()}/admin/${path}`, { method: 'POST', headers: { authorization: `Bearer ${token()}`, 'content-type': 'application/json' }, body: '{}' });
  if (!r.ok) throw new Error(`/admin/${path}: HTTP ${r.status}`);
  return r.json();
};

if (publish) {
  const f = join(priv, 'feedback-themes.json');
  if (!existsSync(f)) { console.error('private/feedback-themes.json is missing: the routine writes it first.'); process.exit(1); }
  const themes = JSON.parse(readFileSync(f, 'utf8'));
  const clean = (themes.themes || []).slice(0, 12).map((t) => ({ title: String(t.title).slice(0, 90), kind: ['idea', 'problem', 'praise'].includes(t.kind) ? t.kind : 'idea', count: Math.max(1, Number(t.count) || 1), note: String(t.note || '').slice(0, 220) }));
  writeFileSync(join(root, 'web', 'feedback-summary.json'), JSON.stringify({ updated: new Date().toISOString().slice(0, 10), responses: Number(themes.responses) || 0, themes: clean }, null, 2) + '\n');
  console.log(`web/feedback-summary.json written with ${clean.length} theme(s).`);
  process.exit(0);
}

const [ins, fb, gl] = await Promise.all([api('insights'), api('feedback'), api('glitches')]);
mkdirSync(priv, { recursive: true });
writeFileSync(join(priv, 'feedback-digest.json'), JSON.stringify({ ins, fb, gl }, null, 2));
const when = (t) => new Date(t).toISOString().slice(0, 10);
const md = [
  `# Feedback digest, ${when(Date.now())}`, '',
  `Installs sharing: ${ins.total} (active in 30 days: ${ins.active30}; Mac ${ins.byOs.mac || 0}, Windows ${ins.byOs.win || 0}).`,
  `Feedback: ${fb.feedback.length} (${Object.entries(fb.byKind).map(([k, n]) => `${n} ${k}`).join(', ') || 'none'}). Glitch notes: ${gl.glitches.length}.`, '',
  '## Feedback (newest first)', ...fb.feedback.map((x) => `- [${x.kind}] ${when(x.at)} ${x.os} ${x.v}: ${x.text.replace(/\s+/g, ' ')}`), '',
  '## Glitch notes (newest first)', ...gl.glitches.map((x) => `- ${when(x.at)} ${x.os} ${x.v}: ${String(x.text).replace(/\s+/g, ' ')}`), '',
].join('\n');
writeFileSync(join(priv, 'feedback-digest.md'), md);
console.log(`Digest written to private/feedback-digest.md: ${fb.feedback.length} feedback, ${gl.glitches.length} glitch notes, ${ins.total} installs sharing.`);
