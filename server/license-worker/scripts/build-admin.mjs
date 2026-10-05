// Bundles src/admin.html into src/admin-page.js (the Worker serves it at /admin).
// Run after editing the panel: node server/license-worker/scripts/build-admin.mjs
import { readFileSync, writeFileSync } from 'node:fs';
const dir = new URL('../src/', import.meta.url);
const html = readFileSync(new URL('admin.html', dir), 'utf8');
writeFileSync(new URL('admin-page.js', dir), `// Generated from admin.html by scripts/build-admin.mjs. Don't edit by hand.\nexport const ADMIN_PAGE = ${JSON.stringify(html)};\n`);
console.log('admin-page.js written');
