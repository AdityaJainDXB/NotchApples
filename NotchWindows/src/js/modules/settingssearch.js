// Settings search: which panes (and which rows in them) match what was typed. Plain functions, no page needed.

/// Lower-case and drop accents, so "cafe" finds "Café".
export const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/// Extra words each pane answers to, like the Mac's Settings search (so "hotkey" finds Shortcuts and "key" finds Access).
export const PANE_KEYWORDS = {
  General: 'login startup launch menu bar volume brightness hud recording dot charging',
  Updates: 'version beta install download release',
  Appearance: 'theme colour color dark light accent glow tab order editor import export animation speed sound haptic font style',
  Tabs: 'tabs add-ons widgets enable layout home modules features order',
  Shortcuts: 'hotkey keyboard shortcut capture keys',
  AI: 'gemini ollama openai groq claude provider model key temperature capture assistant',
  Calendar: 'events meetings agenda google account',
  Weather: 'forecast city temperature location',
  Clipboard: 'copy paste history snippets link sync',
  Security: 'lock face unlock password authentication privacy permissions delete tracking analytics',
  Rules: 'profile work study gaming automatic app rules hide per-app time',
  Automations: 'automation routines actions triggers',
  Access: 'license pro ultimate key activate upgrade buy price restore lost deactivate terms refund',
  About: 'version help feedback bug report crash support donate',
};

/// One entry per setting row: { pane, name, desc }. `rows` is what the page reads off a rendered pane.
export function buildIndex(rowsByPane, keywords = PANE_KEYWORDS) {
  const out = [];
  for (const [pane, rows] of Object.entries(rowsByPane)) {
    out.push({ pane, name: pane, desc: keywords[pane] || '', pane_title: true });
    for (const r of rows) if (r && r.name) out.push({ pane, name: r.name, desc: r.desc || '' });
  }
  return out;
}

/// Panes that match, best first, each with the rows that matched. Every word typed must appear (in any order).
export function search(index, query, order = []) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits = new Map();
  for (const e of index) {
    const hay = fold(`${e.name} ${e.desc} ${e.pane}`);
    if (!words.every((w) => hay.includes(w))) continue;
    const h = hits.get(e.pane) || { pane: e.pane, rows: [], score: 0 };
    if (e.pane_title) h.score += 5;
    else { h.rows.push(e); h.score += words.every((w) => fold(e.name).includes(w)) ? 3 : 1; }
    hits.set(e.pane, h);
  }
  const rank = (p) => { const i = order.indexOf(p); return i < 0 ? 999 : i; };
  return [...hits.values()].sort((a, b) => b.score - a.score || rank(a.pane) - rank(b.pane));
}

/// Features (tabs) whose name or description matches, like the Mac: at least two letters, names that start with the query first.
export function searchFeatures(modules, query) {
  const q = fold(query);
  if (q.length < 2) return [];
  return modules.filter((m) => m.id !== 'settings' && (fold(m.name).includes(q) || fold(m.blurb).includes(q)))
    .sort((a, b) => (fold(a.name).startsWith(q) ? 0 : 1) - (fold(b.name).startsWith(q) ? 0 : 1));
}
