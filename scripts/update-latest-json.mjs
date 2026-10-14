#!/usr/bin/env node
// Writes web/latest.json: the newest stable Mac release, for the app's update check and the website's version label.
// GitHub's API only lets an anonymous address make 60 requests an hour, which a shared network uses up; a static file
// on the website has no such limit. Run by scripts/release.sh after a release, and by the weekly workflow (needs gh).
//   node scripts/update-latest-json.mjs
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'web', 'latest.json');
const repo = 'AdityaJainDXB/NotchApples';
const api = (path) => JSON.parse(execFileSync('gh', ['api', `repos/${repo}${path}`], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }));
const cmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };

const releases = api('/releases?per_page=30')
  .filter((r) => !r.draft && !r.prerelease && /^v\d+\.\d+\.\d+$/.test(r.tag_name))
  .map((r) => ({ r, dmg: (r.assets || []).find((a) => /\.dmg$/i.test(a.name)) }))
  .filter((x) => x.dmg)
  .sort((a, b) => cmp(b.r.tag_name.slice(1), a.r.tag_name.slice(1)));
if (!releases.length) { console.error('No Mac release with a DMG found; latest.json left as it was.'); process.exit(1); }
const { r, dmg } = releases[0];

// The newest Windows build (tagged win-v…, marked pre-release while it is a beta) for the Windows app's update check.
const winCmp = (a, b) => { const x = a.match(/\d+/g).map(Number), y = b.match(/\d+/g).map(Number); for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };
const win = api('/releases?per_page=30')
  .filter((x) => !x.draft && /^win-v\d+\.\d+/.test(x.tag_name))
  .map((x) => ({ x, exe: (x.assets || []).find((a) => /-setup\.exe$/i.test(a.name)) }))
  .filter((y) => y.exe)
  .sort((a, b) => winCmp(b.x.tag_name, a.x.tag_name))[0];

let stars = null;
try { stars = api('').stargazers_count; } catch { /* keep going without it */ }
const data = {
  version: r.tag_name.slice(1),
  title: r.name || `Notch Apple ${r.tag_name.slice(1)}`,
  notes: (r.body || '').slice(0, 20000),
  published: r.published_at,
  dmg: dmg.browser_download_url,
  dmgSize: dmg.size,
  page: r.html_url,
  stars,
  windows: win ? {
    version: win.x.tag_name.replace(/^win-v/, ''),
    notes: (win.x.body || '').slice(0, 20000),
    url: win.exe.browser_download_url,
    sha256: win.exe.digest?.startsWith('sha256:') ? win.exe.digest.slice(7) : null,
    size: win.exe.size,
    page: win.x.html_url,
  } : null,
};
const next = JSON.stringify(data, null, 2) + '\n';
if (existsSync(out) && readFileSync(out, 'utf8') === next) { console.log(`latest.json is current (${data.version}).`); process.exit(0); }
writeFileSync(out, next);
console.log(`latest.json now says ${data.version}.`);
