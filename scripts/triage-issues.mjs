#!/usr/bin/env node
// The weekly issue routine's bookkeeping. The decisions are plain rules (tested in triage-issues.test.mjs); the AI step
// only does the part that needs judgement (reading and fixing an issue).
//
// An issue moves through stages, recorded as hidden markers in the bot's own comments:
//   (none)   -> attempt   Try to fix it. Fixed: say so and close. Unclear: ask a follow-up and mark it "asked".
//   asked    -> after one quiet cycle: assume   Make the most likely change, ask "is this what you meant?", mark "assumed".
//   assumed  -> after two quiet cycles: close   Close it with a note saying how to reopen.
//   A reply from a person at any stage sends it back to "attempt" with their answer.
//
//   node scripts/triage-issues.mjs plan                    JSON: what to do with each open issue
//   node scripts/triage-issues.mjs close-stale             close the ones the rules say to close
//   node scripts/triage-issues.mjs mark <n> asked|assumed "<comment text>"
// Needs GITHUB_TOKEN and GITHUB_REPOSITORY (set by Actions).

const DAY = 86_400_000;
export const CYCLE_DAYS = 7;
const MARK = /<!-- weekly-triage:(asked|assumed) -->/;

const isBot = (c) => c.user?.type === 'Bot' || /\[bot\]$/.test(c.user?.login || '');

/// What should happen to this issue today? `comments` oldest first; `now` is a Date.
export function decide(issue, comments, now = new Date()) {
  const marked = [...comments].reverse().find((c) => isBot(c) && MARK.test(c.body || ''));
  if (!marked) return { action: 'attempt', stage: null };
  const stage = marked.body.match(MARK)[1];
  const at = new Date(marked.created_at);
  const replied = comments.some((c) => !isBot(c) && new Date(c.created_at) > at);
  if (replied) return { action: 'attempt', stage, reason: 'a person replied' };
  const cycles = Math.floor((now - at) / (CYCLE_DAYS * DAY));
  if (stage === 'asked') return cycles >= 1 ? { action: 'assume', stage, cycles } : { action: 'wait', stage, cycles };
  return cycles >= 2 ? { action: 'close', stage, cycles } : { action: 'wait', stage, cycles };
}

async function gh(path, init = {}) {
  const r = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}${path}`, {
    ...init, headers: { authorization: `Bearer ${process.env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'content-type': 'application/json', ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error(`GitHub ${r.status} on ${path}`);
  return r.status === 204 ? null : r.json();
}

/// Every page of a list (a long thread must not hide the newest marker).
async function pages(path) {
  const all = [];
  for (let page = 1; page <= 20; page++) {
    const part = await gh(`${path}${path.includes('?') ? '&' : '?'}page=${page}`);
    all.push(...part);
    if (part.length < 100) break;
  }
  return all;
}

async function openIssues() {
  const list = await pages('/issues?state=open&per_page=100');
  return list.filter((i) => !i.pull_request);
}

async function plan() {
  const out = [];
  for (const issue of await openIssues()) {
    const comments = await pages(`/issues/${issue.number}/comments?per_page=100`);
    out.push({ number: issue.number, title: issue.title, ageDays: Math.floor((Date.now() - new Date(issue.created_at)) / DAY), ...decide(issue, comments) });
  }
  return out;
}

async function main() {
  const [cmd, a, b, c] = process.argv.slice(2);
  if (cmd === 'plan') { console.log(JSON.stringify(await plan(), null, 2)); return; }
  if (cmd === 'close-stale') {
    for (const p of (await plan()).filter((x) => x.action === 'close')) {
      await gh(`/issues/${p.number}/comments`, { method: 'POST', body: JSON.stringify({ body: `Closing this: I asked about it, shipped my best guess, and there has been no reply for ${p.cycles * CYCLE_DAYS}+ days. If it is still a problem, reply or open a new issue and it will be looked at again.` }) });
      await gh(`/issues/${p.number}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed', state_reason: 'not_planned' }) });
      console.log(`closed #${p.number}`);
    }
    return;
  }
  if (cmd === 'mark') {
    if (!/^\d+$/.test(a || '') || !['asked', 'assumed'].includes(b) || !c) { console.error('Usage: mark <issue> asked|assumed "<text>"'); process.exit(2); }
    await gh(`/issues/${a}/comments`, { method: 'POST', body: JSON.stringify({ body: `${c.replace(/<!--[\s\S]*?-->/g, '')}\n\n<!-- weekly-triage:${b} -->` }) });
    console.log(`marked #${a} as ${b}`); return;
  }
  console.error('Usage: triage-issues.mjs plan | close-stale | mark <n> asked|assumed "<text>"'); process.exit(2);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('triage-issues.mjs')) await main();
