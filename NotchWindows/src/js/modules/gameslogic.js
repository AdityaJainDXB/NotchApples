// The Games menu: which games there are, how they are grouped, and how a search and a filter narrow them down. No page code here, so it
// is tested on its own. The Mac app has the same list (NotchApple/Modules/Games/GamesMenuLogic.swift); a test keeps them equal.

export const CATEGORIES = [
  { id: 'all', name: 'All' },
  { id: 'arcade', name: 'Arcade' },
  { id: 'fly', name: 'Flying & racing' },
  { id: 'strategy', name: 'Strategy' },
  { id: 'cards', name: 'Cards & board' },
  { id: 'online', name: 'Online' },
  { id: 'daily', name: 'Daily' },
  { id: 'private', name: 'Private' },
];

/// `id` is what games.js opens. `art` is the two colours of the card's picture. `locked` games need an access code first.
export const GAMES = [
  { id: 'fe', name: 'Flight Economy', icon: '✈️', art: ['#1c3b6e', '#2f8fd6'], cats: ['strategy', 'private'], tags: ['Private'], locked: true },
  { id: 'plane', name: 'Plane', icon: '🛩️', art: ['#1d6fa5', '#56c1ff'], cats: ['fly', 'online'], tags: ['Online'] },
  { id: 'racing', name: 'Racing', icon: '🏎️', art: ['#a3201f', '#ff6b4a'], cats: ['fly', 'online'], tags: ['Online'] },
  { id: 'rocket', name: 'Rocket League', icon: '⚽', art: ['#1e5d3a', '#52d68a'], cats: ['fly', 'online'], tags: ['Online'] },
  { id: 'ctf', name: 'Capture the Flag', icon: '🚩', art: ['#6b2d8c', '#c07bff'], cats: ['online'], tags: ['Online'] },
  { id: 'scribble', name: 'Scribble', icon: '✏️', art: ['#8a5a14', '#ffc95c'], cats: ['online'], tags: ['Online'] },
  { id: 'chess', name: 'Chess', icon: '♟️', art: ['#2a2a35', '#6a6a82'], cats: ['cards', 'online'], tags: ['Online', '2P'] },
  { id: 'nightshift', name: 'Night Shift', icon: '🔦', art: ['#150a22', '#47206b'], cats: ['arcade'], tags: ['New'] },
  { id: 'eagle', name: 'Eagle Ride', icon: '🦅', art: ['#87ceeb', '#ffd700'], cats: ['fly'], tags: ['New'] },
  { id: 'tetris', name: 'Tetris', icon: '🧱', art: ['#1c2e6b', '#4d7cff'], cats: ['arcade'], tags: [] },
  { id: 'snake', name: 'Snake', icon: '🐍', art: ['#1e5d2a', '#6fe36b'], cats: ['arcade'], tags: [] },
  { id: 'breakout', name: 'Breakout', icon: '🧨', art: ['#7a2a1c', '#ff9a5c'], cats: ['arcade'], tags: [] },
  { id: 'runner', name: 'Runner', icon: '🏃', art: ['#176a6a', '#4de0d0'], cats: ['arcade'], tags: [] },
  { id: '2048', name: '2048', icon: '🔢', art: ['#8a6a1c', '#f2c94c'], cats: ['arcade'], tags: [] },
  { id: 'memory', name: 'Memory', icon: '💡', art: ['#4a2a8a', '#9b7bff'], cats: ['arcade'], tags: [] },
  { id: 'reaction', name: 'Reaction', icon: '⚡', art: ['#8a7a1c', '#fff06b'], cats: ['arcade'], tags: [] },
  { id: 'cookie', name: 'Cookies', icon: '🍪', art: ['#6b4220', '#d99a5c'], cats: ['strategy'], tags: [] },
  { id: 'wordle', name: 'Daily Word', icon: '🔤', art: ['#2a6b4a', '#7ee7a8'], cats: ['daily'], tags: ['Daily'] },
  { id: 'trivia', name: 'Daily Trivia', icon: '❓', art: ['#6b2a5a', '#ff8ac8'], cats: ['daily'], tags: ['Daily'] },
  { id: 'blackjack', name: 'Blackjack', icon: '🂡', art: ['#0f4a2a', '#2fae6a'], cats: ['cards'], tags: [] },
  { id: 'solitaire', name: 'Solitaire', icon: '🃏', art: ['#1a4a5a', '#4db3d1'], cats: ['cards'], tags: [] },
  { id: 'poker', name: 'Poker', icon: '♣️', art: ['#3a1a4a', '#9a4dd1'], cats: ['cards'], tags: [] },
];

export const byId = (id) => GAMES.find((g) => g.id === id) || null;

/// The games a search word and a filter leave. The search matches anywhere in the name, ignoring capitals.
export function filterGames(games, { q = '', cat = 'all' } = {}) {
  const word = String(q).trim().toLowerCase();
  return games.filter((g) => (!word || g.name.toLowerCase().includes(word)) && (cat === 'all' || g.cats.includes(cat)));
}

/// How many games each filter has (shown small beside its name).
export function counts(games) {
  const out = {};
  for (const c of CATEGORIES) out[c.id] = c.id === 'all' ? games.length : games.filter((g) => g.cats.includes(c.id)).length;
  return out;
}

/// The "Jump back in" list: the game just played goes first, no repeats, at most three, and only games that exist.
export function recordRecent(list, id, known = GAMES.map((g) => g.id)) {
  return [id, ...(Array.isArray(list) ? list : []).filter((x) => x !== id)].filter((x) => known.includes(x)).slice(0, 3);
}
