#!/usr/bin/env node
// Checks the website in web/: every local link, image, script and stylesheet points at a file that exists, every
// #anchor points at an id on its page, and sitemap.xml lists only pages that exist. No browser needed.
//   node scripts/check-site.mjs        (exit 1 when something is broken)
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../web', import.meta.url)));
const pages = readdirSync(root).filter((f) => f.endsWith('.html'));
const bad = [];
const idsOf = (html) => new Set([...html.matchAll(/\sid=["']([^"']+)["']/g)].map((m) => m[1]));
const htmls = Object.fromEntries(pages.map((p) => [p, readFileSync(join(root, p), 'utf8')]));

for (const [page, html] of Object.entries(htmls)) {
  for (const m of html.matchAll(/\s(?:href|src)=["']([^"']+)["']/g)) {
    const ref = m[1].trim();
    if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(ref) || ref === '' || ref.includes('${')) continue;   // other schemes and JS template strings
    const [path, hash] = ref.split('#');
    const target = path ? resolve(dirname(join(root, page)), path.split('?')[0]) : join(root, page);
    if (path && !(existsSync(target) && (statSync(target).isFile() || existsSync(join(target, 'index.html'))))) { bad.push(`${page}: missing file ${ref}`); continue; }
    if (hash) {
      const file = path ? (statSync(target).isDirectory() ? join(target, 'index.html') : target) : join(root, page);
      if (extname(file) === '.html') {
        const html2 = path ? readFileSync(file, 'utf8') : html;
        if (!idsOf(html2).has(hash) && !/^[:~]/.test(hash)) bad.push(`${page}: no #${hash} on ${path || page}`);
      }
    }
  }
}
if (existsSync(join(root, 'sitemap.xml'))) {
  for (const m of readFileSync(join(root, 'sitemap.xml'), 'utf8').matchAll(/<loc>https?:\/\/[^/]+\/?([^<]*)<\/loc>/g)) {
    const p = m[1].split('#')[0].replace(/^NotchApples\/?/, '');   // the project path on GitHub Pages
    if (p && !existsSync(join(root, p))) bad.push(`sitemap.xml: ${p} does not exist`);
  }
}
if (bad.length) { console.error(`${bad.length} problem(s):\n` + bad.map((b) => '  ' + b).join('\n')); process.exit(1); }
console.log(`web/: ${pages.length} pages checked, no broken links`);
