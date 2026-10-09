#!/usr/bin/env node
// Packs and uploads server-held content (paid assets that never go in the public repo).
//
//   node scripts/assets.mjs pack <folder> <out.pack>        files in a folder → one NKP1 pack (name + bytes for each file)
//   node scripts/assets.mjs put <id> <tier> <file> [type]    upload to the live server (tier 1 = Pro, 2 = Ultimate)
//   node scripts/assets.mjs list                             what the server holds
//   node scripts/assets.mjs delete <id>
//
// The server URL and admin token come from WORKER_URL and ADMIN_TOKEN, or from the site's api.json and
// private/admin-token.txt (which is git-ignored). The token is never printed.

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const [cmd, ...args] = process.argv.slice(2);

/** NKP1: 'NKP1', file count (u16), then for each file: name length (u8), name, data length (u32), data. All big-endian. */
export function pack(files) {
  const parts = [Buffer.from('NKP1'), Buffer.alloc(2)];
  parts[1].writeUInt16BE(files.length);
  for (const [name, data] of files) {
    const n = Buffer.from(name), head = Buffer.alloc(1 + n.length + 4);
    head.writeUInt8(n.length, 0); n.copy(head, 1); head.writeUInt32BE(data.length, 1 + n.length);
    parts.push(head, data);
  }
  return Buffer.concat(parts);
}

async function config() {
  let url = process.env.WORKER_URL;
  if (!url) {
    const site = join(root, '..', 'notchapples-site', 'api.json');
    if (existsSync(site)) url = JSON.parse(readFileSync(site, 'utf8')).licenseServer;
  }
  const tokenFile = join(root, 'private', 'admin-token.txt');
  const token = process.env.ADMIN_TOKEN || (existsSync(tokenFile) ? readFileSync(tokenFile, 'utf8').trim() : '');
  if (!url || !token) throw new Error('Set WORKER_URL and ADMIN_TOKEN (or have the site folder and private/admin-token.txt).');
  return { url: url.replace(/\/+$/, ''), token };
}

if (cmd === 'pack') {
  const [dir, out] = args;
  const files = readdirSync(dir).filter((f) => !f.startsWith('.')).sort().map((f) => [f, readFileSync(join(dir, f))]);
  writeFileSync(out, pack(files));
  console.log(`${files.length} files → ${out}`);
} else if (cmd === 'put') {
  const [id, tier, file, type = 'application/octet-stream'] = args;
  const { url, token } = await config();
  const r = await fetch(`${url}/admin/asset-put?id=${encodeURIComponent(id)}&tier=${tier}&type=${encodeURIComponent(type)}`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: readFileSync(file) });
  console.log(r.status, await r.text());
} else if (cmd === 'list' || cmd === 'delete') {
  const { url, token } = await config();
  const r = await fetch(`${url}/admin/asset-${cmd}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ id: args[0] }) });
  console.log(r.status, await r.text());
} else if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('Usage: assets.mjs pack|put|list|delete (see the top of this file)');
}
