// The command palette's actions (Pro, Ctrl+K): every tab and the most useful
// actions, plus whatever you type turned into "Ask AI", "Search files",
// "Translate", "Search the web" or a quick calculation.

import { invoke } from './native.js';
import { MODULES } from './modules.js';
import { allowed, show, collapse, isEnabled } from './app.js';
import { toast } from './ui.js';

/// A safe arithmetic evaluator for "=" answers: numbers, + - * / % ^ ( ) only.
export function calculate(expr) {
  const s = expr.replace(/\s+/g, '').replace(/×/g, '*').replace(/÷/g, '/').replace(/,/g, '');
  if (!/^[0-9.+\-*/%^()]+$/.test(s) || !/\d/.test(s) || !/[+\-*/%^]/.test(s)) return null;
  let i = 0;
  const peek = () => s[i];
  const num = () => {
    if (peek() === '(') { i++; const v = add(); if (peek() !== ')') throw 0; i++; return v; }
    if (peek() === '-') { i++; return -num(); }
    const m = s.slice(i).match(/^\d*\.?\d+/);
    if (!m) throw 0;
    i += m[0].length;
    return Number(m[0]);
  };
  const pow = () => { const b = num(); if (peek() === '^') { i++; return b ** pow(); } return b; };
  const mul = () => { let v = pow(); while ('*/%'.includes(peek()) && peek()) { const op = s[i++]; const r = pow(); v = op === '*' ? v * r : op === '/' ? v / r : v % r; } return v; };
  function add() { let v = mul(); while ('+-'.includes(peek()) && peek()) { const op = s[i++]; const r = mul(); v = op === '+' ? v + r : v - r; } return v; }
  try { const v = add(); return i === s.length && Number.isFinite(v) ? Math.round(v * 1e10) / 1e10 : null; } catch { return null; }
}

export async function paletteActions(query) {
  const q = query.trim();
  const low = q.toLowerCase();
  const actions = [
    ...MODULES.filter((m) => allowed(m)).map((m) => ({ icon: m.icon, label: m.name, hint: isEnabled(m.id) ? 'Tab' : 'Tab (off)', run: () => show(m.id) })),
    { icon: '📝', label: 'New note', run: () => show('notes', { newNote: true }) },
    { icon: '✅', label: 'New to-do', run: () => show('todo', { focusInput: true }) },
    { icon: '⏱', label: 'Start a 5-minute timer', run: async () => { (await import('./services/timer.js')).startTimer(300); toast('Timer started: 5 minutes'); } },
    { icon: '⏱', label: 'Start a 25-minute timer', run: async () => { (await import('./services/timer.js')).startTimer(1500); toast('Timer started: 25 minutes'); } },
    { icon: '🎯', label: 'Start or pause Focus', run: async () => { (await import('./services/focus.js')).toggle(); show('focus'); } },
    { icon: '☕', label: 'Keep the PC awake', run: async () => { const a = await import('./services/awake.js'); const on = !a.state().on; await a.set(on); toast(on ? 'Keeping your PC awake' : 'Keep Awake is off'); } },
    { icon: '⏯', label: 'Play or pause music', run: async () => (await import('./services/media.js')).control('toggle') },
    { icon: '⏭', label: 'Next track', run: async () => (await import('./services/media.js')).control('next') },
    { icon: '◧', label: 'Snap window left', run: async () => { await collapse(); invoke('snap_window', { action: 'left' }).catch((e) => toast(e.message, { error: true })); } },
    { icon: '◨', label: 'Snap window right', run: async () => { await collapse(); invoke('snap_window', { action: 'right' }).catch((e) => toast(e.message, { error: true })); } },
    { icon: '⊞', label: 'Tile all windows', run: async () => { await collapse(); invoke('tile_windows').catch((e) => toast(e.message, { error: true })); } },
    { icon: '📸', label: 'Ask AI about my screen', run: () => show('ai', { screen: true }) },
    { icon: '🎨', label: 'Change theme', run: () => show('settings', { pane: 'Appearance' }) },
    { icon: '🔑', label: 'Enter a key', run: () => show('settings', { pane: 'Access' }) },
    { icon: '⌨', label: 'Shortcuts', run: () => show('settings', { pane: 'Shortcuts' }) },
    { icon: '⬆', label: 'Check for updates', run: () => show('settings', { pane: 'General', checkUpdates: true }) },
    { icon: '🙈', label: 'Hide the pill', run: async () => { await collapse(); invoke('set_hidden', { hidden: true }); } },
    { icon: '⏏', label: 'Quit Notch apple', run: () => invoke('quit_app') },
  ];

  let matches = q ? actions.filter((a) => a.label.toLowerCase().includes(low)) : actions.slice(0, 40);
  // Words that start a label rank first.
  matches.sort((a, b) => Number(!a.label.toLowerCase().startsWith(low)) - Number(!b.label.toLowerCase().startsWith(low)));

  if (q) {
    const extra = [];
    const value = calculate(q.replace(/^=/, ''));
    if (value !== null) extra.push({ icon: '=', label: `${q.replace(/^=/, '')} = ${value.toLocaleString()}`, hint: 'Copy', run: () => invoke('clipboard_copy_text', { text: String(value) }).then(() => toast(`Copied ${value}`)) });
    extra.push(
      { icon: '✨', label: `Ask AI: ${q}`, run: () => show('ai', { ask: q }) },
      { icon: '🔍', label: `Search files: ${q}`, run: () => show('search', { query: q }) },
      { icon: '🈯', label: `Translate: ${q}`, run: () => show('translator', { text: q }) },
      { icon: '🌐', label: `Search the web: ${q}`, run: async () => { const { resolve } = await import('./modules/browser.js'); invoke('open_browser', { url: resolve(q) }); } },
    );
    matches = value !== null ? [extra[0], ...matches, ...extra.slice(1)] : [...matches, ...extra];
  }
  return matches.slice(0, 60);
}
