// Claude Code status dot, like the Mac's ClaudeCodeStatus: a green dot for 4 seconds when a Claude Code
// task finishes, a yellow one for 4 seconds when it needs your input or approval (or ends with warnings
// or errors). It shows on the closed pill and in the open notch's header, then fades out.
//
// Windows has no notchapple:// links, so Claude Code's hooks write a tiny file into this app's data
// folder (claude-status.txt: "done 1759..." or "attention 1759...") and this service reads it.
// Nothing leaves your PC.

import { load, save } from '../store.js';
import { invoke } from '../native.js';
import { provide, refresh } from '../activity.js';

export const SECONDS = 4;
const GREEN = ['done', 'success', 'ok', 'complete', 'completed', 'finished', 'passed'];
const YELLOW = ['attention', 'input', 'approval', 'permission', 'waiting', 'warning', 'warn', 'warnings', 'error', 'errors', 'failed', 'fail'];

/// 'green', 'yellow' or null for anything else.
export function dotFor(status) {
  const s = String(status || '').trim().toLowerCase();
  return GREEN.includes(s) ? 'green' : YELLOW.includes(s) ? 'yellow' : null;
}

export const enabled = () => load('claudecode.on', true);
export const setEnabled = (v) => save('claudecode.on', v);

let dot = null, until = 0, lastStamp = 0, timer = null;
export const current = () => (dot && Date.now() < until ? dot : null);
export const COLOURS = { green: '#30d158', yellow: '#ffd60a' };

/// Shows the dot now (a hook fired, or the Settings "Try" button).
export function show(colour) {
  if (!enabled() || !COLOURS[colour]) return;
  dot = colour; until = Date.now() + SECONDS * 1000;
  refresh();
  dispatchEvent(new Event('claude-dot'));
  clearTimeout(timer);
  timer = setTimeout(() => { dot = null; refresh(); dispatchEvent(new Event('claude-dot')); }, SECONDS * 1000 + 50);
}

/// "done 1759999999999" → { status, stamp }
export function parse(text) {
  const m = String(text || '').trim().match(/^([a-z]+)\s+(\d{6,})/i);
  return m ? { status: m[1], stamp: Number(m[2]) } : null;
}

async function dataDir() { return (await invoke('app_info').catch(() => ({}))).data_dir || ''; }
export const statusPath = async () => { const d = await dataDir(); return d ? `${d}\\claude-status.txt` : ''; };

async function poll() {
  clearTimeout(poll.t);
  poll.t = setTimeout(poll, 1500);
  if (!enabled()) return;
  try {
    const path = await statusPath();
    if (!path) return;
    const f = await invoke('read_file_base64', { path });
    const p = parse(atob(f.data));
    if (!p || p.stamp <= lastStamp) return;
    const first = lastStamp === 0;
    lastStamp = p.stamp;
    // A file left over from before the app started must not flash a dot.
    if (first && Date.now() - p.stamp > 10_000) return;
    const c = dotFor(p.status);
    if (c) show(c);
  } catch { /* no file yet: nothing has fired */ }
}

export function start() {
  provide('claudecode', 90, () => { const c = current(); return c ? { dot: COLOURS[c], priority: 90 } : null; });
  poll();
}

// ---- the hooks to give Claude Code ----

const ps = (status) => `powershell -NoProfile -WindowStyle Hidden -Command "[IO.Directory]::CreateDirectory([IO.Path]::Combine([Environment]::GetFolderPath('ApplicationData'),'com.notchapple.windows'))|Out-Null;`
  + `[IO.File]::WriteAllText([IO.Path]::Combine([Environment]::GetFolderPath('ApplicationData'),'com.notchapple.windows','claude-status.txt'),'${status} '+[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"`;

/// The "hooks" block to put in %USERPROFILE%\.claude\settings.json. Stop = a task finished;
/// Notification = Claude Code needs you.
export function hooksJSON() {
  const entry = (status) => [{ hooks: [{ type: 'command', command: ps(status) }] }];
  return JSON.stringify({ hooks: { Stop: entry('done'), Notification: entry('attention') } }, null, 2);
}
