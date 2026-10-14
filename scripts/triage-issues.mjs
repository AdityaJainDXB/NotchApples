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
// The routine's own comments carry the hidden marker. It runs from the owner's login on the desktop (not a bot account), so a
// marker counts when a bot or the repository owner wrote it: a stranger pasting the marker into a comment cannot move an issue along.
const owner = () => (process.env.GITHUB_REPOSITORY || '').split('/')[0].toLowerCase();
const isRoutine = (c) => MARK.test(c.body || '') && (isBot(c) || (c.user?.login || '').toLowerCase() === owner() && owner() !== '');

/// What kind of issue is this, from the labels its form applied?
export function kindOf(labels = []) {
  const names = labels.map((l) => (typeof l === 'string' ? l : l.name));
  if (names.includes('enhancement')) return 'feature';
  if (names.some((n) => ['bug', 'mac', 'windows', 'flight-sim'].includes(n))) return 'problem';
  if (names.includes('question')) return 'help';
  if (names.some((n) => n === 'feedback' || n === 'from-feedback')) return 'feedback';
  return 'other';
}

/// What should happen to this issue today? `comments` oldest first; `now` is a Date.
export function decide(issue, comments, now = new Date()) {
  const marked = [...comments].reverse().find(isRoutine);
  if (!marked) return { action: 'attempt', stage: null };
  const stage = marked.body.match(MARK)[1];
  const at = new Date(marked.created_at);
  const replied = comments.some((c) => !isRoutine(c) && !isBot(c) && new Date(c.created_at) > at);
  if (replied) return { action: 'attempt', stage, reason: 'a person replied' };
  const cycles = Math.floor((now - at) / (CYCLE_DAYS * DAY));
  if (stage === 'asked') return cycles >= 1 ? { action: 'assume', stage, cycles } : { action: 'wait', stage, cycles };
  return cycles >= 2 ? { action: 'close', stage, cycles } : { action: 'wait', stage, cycles };
}

/// What should happen to this discussion? A discussion is answered once; a person writing after the routine's answer brings it back.
export function decideDiscussion(d, now = new Date()) {
  const category = d.category?.name || '';
  if (d.closed || !['Q&A', 'General', 'Ideas'].includes(category)) return { action: 'skip' };
  if (category === 'Q&A' && d.answer) return { action: 'skip', reason: 'answered' };
  const comments = d.comments?.nodes || [];
  const mine = [...comments].reverse().find((c) => /<!-- weekly-triage:discussion -->/.test(c.body || '') && (c.author?.login || '').toLowerCase() === owner() && owner() !== '');
  if (!mine) return { action: 'reply', category };
  const at = new Date(mine.createdAt);
  return comments.some((c) => c !== mine && new Date(c.createdAt) > at && (c.author?.login || '').toLowerCase() !== owner()) ? { action: 'reply', category, reason: 'a person replied' } : { action: 'wait' };
}

async function graphql(query, variables = {}) {
  const r = await fetch('https://api.github.com/graphql', { method: 'POST', headers: { authorization: `Bearer ${process.env.GITHUB_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ query, variables }) });
  const j = await r.json();
  if (!r.ok || j.errors) throw new Error(`GitHub GraphQL: ${JSON.stringify(j.errors || r.status).slice(0, 200)}`);
  return j.data;
}

async function discussionsPlan() {
  const [o, n] = process.env.GITHUB_REPOSITORY.split('/');
  const data = await graphql(`query($o:String!,$n:String!){repository(owner:$o,name:$n){discussions(first:50,orderBy:{field:UPDATED_AT,direction:DESC}){nodes{id number title body closed category{name} answer{id} comments(last:30){nodes{author{login} createdAt body}}}}}}`, { o, n });
  return data.repository.discussions.nodes.map((d) => ({ id: d.id, number: d.number, title: d.title, category: d.category?.name, ...decideDiscussion(d) })).filter((d) => d.action !== 'skip');
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
    out.push({ number: issue.number, title: issue.title, kind: kindOf(issue.labels), labels: (issue.labels || []).map((l) => l.name), ageDays: Math.floor((Date.now() - new Date(issue.created_at)) / DAY), ...decide(issue, comments) });
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
  if (cmd === 'discussions') { console.log(JSON.stringify(await discussionsPlan(), null, 2)); return; }
  if (cmd === 'reply-discussion') {
    if (!/^D_[A-Za-z0-9_-]+$/.test(a || '') || !b) { console.error('Usage: reply-discussion <discussion node id> "<text>"'); process.exit(2); }
    await graphql('mutation($id:ID!,$body:String!){addDiscussionComment(input:{discussionId:$id,body:$body}){comment{id}}}', { id: a, body: `${b.replace(/<!--[\s\S]*?-->/g, '')}\n\n<!-- weekly-triage:discussion -->` });
    console.log(`replied to ${a}`); return;
  }
  console.error('Usage: triage-issues.mjs plan | close-stale | mark <n> asked|assumed "<text>" | discussions | reply-discussion <id> "<text>"'); process.exit(2);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('triage-issues.mjs')) await main();
