#!/usr/bin/env node
// Checks the admin access codes against the live Worker and, when asked, replaces them with fresh ones.
//
//   node server/license-worker/scripts/admin-keys.mjs check
//       Tries every stored code (ADMIN_TOKEN, private/admin-token.txt, .env.admin.keys) once against /admin/stats and
//       says which still sign in. It never prints a code.
//   node server/license-worker/scripts/admin-keys.mjs reroll [--count 3] [--apply]
//       Makes fresh codes, saves them to .env.admin.keys (owner-only, git-ignored; the old file is kept as
//       .env.admin.keys.<time>.bak) and logs what happened to private/admin-keys.log (hashes only, never a code).
//       With --apply it also sets the new hashes on the Worker (wrangler login needed); without it, it prints the command.
//   node server/license-worker/scripts/admin-keys.mjs auto [--apply]
//       The automated policy: check, and reroll only when no stored code signs in any more.
//
// Admin sign-in is a Bearer code checked by the Worker, which answers every origin, so moving the website to
// another address cannot invalidate a code. This tool is for the day one stops working anyway.
import { readFileSync, writeFileSync, existsSync, renameSync, appendFileSync, mkdirSync, chmodSync } from 'node:fs';
import { createHash, randomInt } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const envFile = join(root, '.env.admin.keys');
const logFile = join(root, 'private', 'admin-keys.log');
const args = process.argv.slice(2);
const mode = args[0] || 'check';
const flag = (n) => args.includes(`--${n}`);
const count = Number(args[args.indexOf('--count') + 1]) || 3;

const sha = (s) => createHash('sha256').update(s).digest('hex');
const workerUrl = () => {
  if (process.env.WORKER_URL) return process.env.WORKER_URL.replace(/\/+$/, '');
  const api = join(root, 'web', 'api.json');
  if (existsSync(api)) return JSON.parse(readFileSync(api, 'utf8')).licenseServer.replace(/\/+$/, '');
  throw new Error('Set WORKER_URL (or keep web/api.json).');
};

function storedCodes() {
  const found = [];
  if (process.env.ADMIN_TOKEN) found.push(['ADMIN_TOKEN (environment)', process.env.ADMIN_TOKEN.trim()]);
  const legacy = join(root, 'private', 'admin-token.txt');
  if (existsSync(legacy)) found.push(['private/admin-token.txt', readFileSync(legacy, 'utf8').trim()]);
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, 'utf8').split('\n')) {
      const m = line.match(/^(ADMIN_KEY_\d+)=(.+)$/);
      if (m) found.push([`.env.admin.keys ${m[1]}`, m[2].trim()]);
    }
  }
  return found.filter(([, v]) => v);
}

async function probe(code) {
  try {
    const r = await fetch(`${workerUrl()}/admin/stats`, { method: 'POST', headers: { authorization: `Bearer ${code}`, 'content-type': 'application/json' }, body: '{}' });
    return r.status === 200 ? 'valid' : r.status === 401 ? 'invalid' : `inconclusive (HTTP ${r.status})`;
  } catch (e) { return `inconclusive (${e.message})`; }
}

async function check() {
  const codes = storedCodes();
  if (!codes.length) { console.log('No stored admin code found (ADMIN_TOKEN, private/admin-token.txt, .env.admin.keys).'); return { valid: 0, total: 0, conclusive: true }; }
  let valid = 0, conclusive = true;
  for (const [name, code] of codes) {
    const verdict = await probe(code);
    if (verdict === 'valid') valid++;
    if (verdict.startsWith('inconclusive')) conclusive = false;
    console.log(`  ${name}: ${verdict}`);
  }
  console.log(`${valid} of ${codes.length} stored admin code(s) sign in.`);
  return { valid, total: codes.length, conclusive };
}

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';   // no I, L, O or U
const makeCode = () => 'NA-' + Array.from({ length: 5 }, () => Array.from({ length: 4 }, () => ALPHABET[randomInt(32)]).join('')).join('-');

function log(line) {
  mkdirSync(dirname(logFile), { recursive: true });
  appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`);
}

function reroll() {
  const codes = Array.from({ length: count }, makeCode);
  const hashes = codes.map(sha);
  if (existsSync(envFile)) renameSync(envFile, `${envFile}.${Date.now()}.bak`);
  writeFileSync(envFile, `# Notch Apple admin access codes, made ${new Date().toISOString()}. Keep this file private; it is git-ignored.\n` +
    codes.map((c, i) => `ADMIN_KEY_${i + 1}=${c}`).join('\n') + '\n', { mode: 0o600 });
  chmodSync(envFile, 0o600);
  let applied = false;
  if (flag('apply')) {
    const r = spawnSync('bash', [join(root, 'server', 'license-worker', 'scripts', 'set-admin-codes.sh'), hashes.join(',')], { stdio: 'inherit' });
    applied = r.status === 0;
  }
  log(`reroll count=${count} applied=${applied} hashes=${hashes.map((h) => h.slice(0, 8)).join(',')}`);
  console.log(`Wrote ${count} new admin code(s) to .env.admin.keys (not shown here).`);
  console.log(applied ? 'The Worker now accepts them; the old hashed codes no longer sign in.'
    : `NOT YET APPLIED. To make the Worker accept them:\n  bash server/license-worker/scripts/set-admin-codes.sh ${hashes.join(',')}`);
  console.log('Note: a separate plaintext ADMIN_TOKEN secret on the Worker, if one is set, keeps working until you change it.');
}

if (mode === 'check') { const r = await check(); process.exit(r.total === 0 || r.valid > 0 || !r.conclusive ? 0 : 1); }
else if (mode === 'reroll') reroll();
else if (mode === 'auto') {
  const r = await check();
  if (r.total > 0 && r.valid > 0) console.log('At least one admin code still works: nothing to do.');
  else if (!r.conclusive) console.log('Could not reach the Worker to decide: not rerolling.');
  else { console.log('No admin code signs in: rerolling.'); reroll(); }
} else { console.error('Usage: admin-keys.mjs check | reroll [--count 3] [--apply] | auto [--apply]'); process.exit(2); }
