// Settings search: which panes (and which rows in them) match what was typed. Plain functions, no page needed.

/// Lower-case and drop accents, so "cafe" finds "Café".
export const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/// One entry per setting row: { pane, name, desc }. `rows` is what the page reads off a rendered pane.
export function buildIndex(rowsByPane) {
  const out = [];
  for (const [pane, rows] of Object.entries(rowsByPane)) {
    out.push({ pane, name: pane, desc: '', pane_title: true });
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
