// Emoji and symbol search for the palette ("emoji heart", ":fire"). Words you type must all match the name or an
// everyday search word ("love" finds hearts). The same scoring and test vectors as the Mac's EmojiLogic.swift.
import { RAW } from './emojidata.js';

let cache = null;
export const all = () => cache || (cache = RAW.split('\n').map((l) => { const p = l.split('|'); return p.length === 3 ? { emoji: p[0], name: p[1], extra: p[2] } : null; }).filter(Boolean));

const POPULAR = ['😀', '😂', '❤️', '👍', '🙏', '🎉', '🔥', '✨', '👀', '✅', '🚀', '💡'];

/// "emoji heart" → "heart", ":fire" → "fire", "emoji" → "". null when the text isn't an emoji search.
export function trigger(query) {
  const q = String(query ?? '').trim().toLowerCase();
  if (q.startsWith(':')) return q.slice(1).trim();
  for (const w of ['emojis', 'emoji', 'symbols', 'symbol']) if (q === w || q.startsWith(`${w} `)) return q.slice(w.length).trim();
  return null;
}

/// Best matches first. An empty search gives the popular ones.
export function search(query, limit = 12) {
  const tokens = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const list = all();
  if (!tokens.length) return POPULAR.map((p) => list.find((e) => e.emoji === p)).filter(Boolean).slice(0, limit);
  const scored = [];
  list.forEach((e, index) => {
    const words = e.name.split(' ');
    let total = 0;
    for (const t of tokens) {
      if (e.name === t) total += 10;
      else if (e.name.startsWith(t)) total += 6;
      else if (words.some((w) => w.startsWith(t))) total += 4;
      else if (e.name.includes(t)) total += 2;
      else if (e.extra.split(' ').some((w) => w.startsWith(t))) total += 1;
      else { total = -1; break; }
    }
    if (total > 0) scored.push({ e, total, index });
  });
  scored.sort((a, b) => b.total - a.total || a.e.name.length - b.e.name.length || a.index - b.index);
  return scored.slice(0, limit).map((s) => s.e);
}
