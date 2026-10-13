#!/usr/bin/env node
// Keeps the website's "What's new" list current from release-notes/*.md, and the sitemap dates fresh.
// Run by the weekly workflow (and by hand): it only edits web/index.html and web/sitemap.xml, and only adds releases
// newer than the newest one already listed. Existing entries are never rewritten.
//   node scripts/update-site.mjs [--dry]
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const indexPath = join(root, 'web', 'index.html');
const dry = process.argv.includes('--dry');
const cmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };

let html = readFileSync(indexPath, 'utf8');
const start = html.indexOf('const REL=[');
const end = html.indexOf('\n];', start);
if (start < 0 || end < 0) { console.error('Could not find the REL list in web/index.html'); process.exit(1); }
const listed = [...html.slice(start, end).matchAll(/\n \['(\d+\.\d+\.\d+)'/g)].map((m) => m[1]);
const newest = listed.sort(cmp).at(-1) || '0.0.0';

const plain = (s) => s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/^[^\p{L}\p{N}]+/u, '').replace(/\s+/g, ' ').trim();   // no leading emoji, like the entries already listed
const short = (s, n) => (s.length <= n ? s : s.slice(0, n - 1).replace(/[\s,;:.]+\S*$/, '') + '…');
// The strings end up inside a <script> and are shown with innerHTML: escape quotes, backslashes and anything HTML.
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/&/g, '\\u0026').replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

const files = readdirSync(join(root, 'release-notes')).filter((f) => /^\d+\.\d+\.\d+\.md$/.test(f))
  .map((f) => f.replace(/\.md$/, '')).filter((v) => cmp(v, newest) > 0).sort(cmp);   // oldest first, so each one lands on top in order

const entries = [];
for (const v of files) {
  const text = readFileSync(join(root, 'release-notes', `${v}.md`), 'utf8');
  const bullets = text.split('\n').filter((l) => /^- /.test(l)).map((l) => plain(l.slice(2)));
  if (!bullets.length) continue;
  const firstBold = (text.match(/^- .*?\*\*(.+?)\*\*/m) || [])[1];
  const title = short(plain(firstBold || bullets[0]).replace(/[.:]$/, ''), 60);
  let date = '';
  // The day the notes were first written, not the last time a commit touched them.
  try { date = execFileSync('git', ['log', '--diff-filter=A', '--format=%cd', '--date=format:%-d %B %Y', '--', `release-notes/${v}.md`], { cwd: root, encoding: 'utf8' }).trim().split('\n').pop();; } catch { /* not a git checkout */ }
  entries.push(` ['${v}','${date || new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}','${esc(title)}',[${bullets.slice(0, 3).map((b) => `'${esc(short(b, 170))}'`).join(',')}]],`);
}

if (!entries.length) { console.log(`What's new is current (newest listed: ${newest}).`); process.exit(0); }
const insertAt = html.indexOf('\n', start) + 1;
html = html.slice(0, insertAt) + entries.reverse().join('\n') + '\n' + html.slice(insertAt);
console.log(`Adding ${entries.length} release(s) to What's new: ${files.join(', ')}`);

const sitemapPath = join(root, 'web', 'sitemap.xml');
const today = new Date().toISOString().slice(0, 10);
const sitemap = readFileSync(sitemapPath, 'utf8').replace(/(<loc>[^<]*NotchApples\/<\/loc><lastmod>)[^<]*/, `$1${today}`);
if (!dry) { writeFileSync(indexPath, html); writeFileSync(sitemapPath, sitemap); }
