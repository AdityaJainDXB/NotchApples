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
// Search: every public page has a short title, a description that fits a result, and an absolute canonical; the home
// page's FAQ structured data says exactly what the visible FAQ says.
for (const [page, html] of Object.entries(htmls)) {
  if (/noindex|http-equiv="refresh"/.test(html) || /^google/.test(page)) continue;
  const t = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || '', d = (html.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '';
  if (!t || t.length > 62) bad.push(`${page}: title missing or longer than 62 characters`);
  if (d.length < 70 || d.length > 160) bad.push(`${page}: description should be 70 to 160 characters (is ${d.length})`);
  if (!/<link rel="canonical" href="https:\/\//.test(html)) bad.push(`${page}: no absolute canonical link`);
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) { try { JSON.parse(m[1]); } catch { bad.push(`${page}: structured data is not valid JSON`); } }
}
{ const h = htmls['index.html'], visible = [...h.matchAll(/<details class="q"><summary>([\s\S]*?)<i /g)].length, ld = (h.match(/"@type":"Question"/g) || []).length;
  if (visible !== ld) bad.push(`index.html: ${visible} FAQ questions on the page but ${ld} in the structured data`); }
if (bad.length) { console.error(`${bad.length} problem(s):\n` + bad.map((b) => '  ' + b).join('\n')); process.exit(1); }
console.log(`web/: ${pages.length} pages checked, no broken links`);
