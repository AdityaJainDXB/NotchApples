#!/usr/bin/env node
// The safe, mechanical repairs the weekly routine makes before it gives up on a failing gate (no AI needed):
//   * web/sitemap.xml lists exactly the public pages that exist, with today's date on pages that changed;
//   * web/latest.json and What's new are brought up to the latest release (when gh is available).
//   node scripts/fix-site.mjs
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(root, 'web');
const BASE = 'https://adityajaindxb.github.io/NotchApples/';
const sh = (cmd, args) => { try { return execFileSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { return `${e.stdout || ''}${e.stderr || ''}`; } };

// 1. The sitemap: every public page, and nothing else (the admin page, forwarding stub and 404 stay out).
const hidden = new Set(['admin.html', 'legacy.html', '404.html']);
const pages = readdirSync(web).filter((f) => f.endsWith('.html') && !hidden.has(f) && !/^google[0-9a-f]+\.html$/.test(f))   // not the Search Console verification file
  .sort((a, b) => (a === 'index.html' ? -1 : b === 'index.html' ? 1 : a.localeCompare(b)));
const sitemapPath = join(web, 'sitemap.xml');
const old = existsSync(sitemapPath) ? readFileSync(sitemapPath, 'utf8') : '';
const meta = (page) => { const url = page === 'index.html' ? BASE : BASE + page; const m = old.match(new RegExp(`<url><loc>${url.replace(/[.*+?^${}()|[\]\\\\]/g, '\\\\$&')}</loc><lastmod>([^<]*)</lastmod>`)); return { url, last: m?.[1] }; };
const changed = new Set(sh('git', ['diff', '--name-only', 'HEAD', '--', 'web']).split('\n'));
const today = new Date().toISOString().slice(0, 10);
const entries = pages.map((p) => { const m = meta(p); const last = changed.has(`web/${p}`) || !m.last ? today : m.last; return `  <url><loc>${m.url}</loc><lastmod>${last}</lastmod></url>`; });
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</urlset>\n`;
if (sitemap !== old) { writeFileSync(sitemapPath, sitemap); console.log('sitemap.xml rebuilt'); } else console.log('sitemap.xml is right');

// 2. Release data and What's new.
console.log(sh('node', ['scripts/update-latest-json.mjs']).trim() || 'latest.json unchanged');
console.log(sh('node', ['scripts/update-site.mjs']).trim());
