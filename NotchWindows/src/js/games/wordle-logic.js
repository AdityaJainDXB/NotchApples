// Daily Word: the rules of a five-letter word puzzle, with no screen. Scoring (green / yellow / grey with the right handling of
// repeated letters), the word of the day, the keyboard colours, the streak and the share text. Shared by the Mac and Windows
// apps (the game itself is wordle.js, the words are in wordle-words.js) and tested in Node (NotchWindows/tests/wordle.test.mjs).
(function () {
  'use strict';
  const LEN = 5, TRIES = 6;
  // 'g' = right letter, right place; 'y' = in the word, wrong place; 'x' = not in the word (or used up).
  const RANK = { x: 0, y: 1, g: 2 };

  /// Scores a guess against the answer. Greens first; then each yellow uses up one of the answer's remaining letters,
  /// so a letter is never marked more times than it appears in the answer.
  function score(guess, answer) {
    const res = new Array(LEN).fill('x'), left = {};
    for (let i = 0; i < LEN; i++) {
      if (guess[i] === answer[i]) res[i] = 'g'; else left[answer[i]] = (left[answer[i]] || 0) + 1;
    }
    for (let i = 0; i < LEN; i++) {
      if (res[i] === 'g') continue;
      if (left[guess[i]] > 0) { res[i] = 'y'; left[guess[i]]--; }
    }
    return res;
  }

  const pad = (n) => String(n).padStart(2, '0');
  /// 'YYYY-MM-DD' for a date in the player's own time zone: the puzzle changes at local midnight.
  const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const dayNumber = (key) => { const [y, m, d] = key.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 86400000); };
  const prevKey = (key) => { const t = new Date((dayNumber(key) - 1) * 86400000); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`; };

  // The answers are walked in a fixed scattered order: day n gets answers[(n * STEP + OFFSET) mod count]. STEP is prime and
  // bigger than the list, so it shares no factor with the count and no word repeats until the whole list has been used.
  const STEP = 1009, OFFSET = 417;
  /// The word for a day (a 'YYYY-MM-DD' key): the same for everyone, with no server.
  function dailyWord(answers, key) {
    const n = answers.length;
    return answers[(((dayNumber(key) * STEP + OFFSET) % n) + n) % n];
  }
  const randomWord = (answers, rng, not) => { let w; do w = answers[Math.floor((rng || Math.random)() * answers.length)]; while (w === not && answers.length > 1); return w; };

  /// The best colour found so far for each letter, for the on-screen keyboard.
  function letterStates(guesses, answer) {
    const m = {};
    for (const g of guesses) score(g, answer).forEach((s, i) => { if (!(g[i] in m) || RANK[s] > RANK[m[g[i]]]) m[g[i]] = s; });
    return m;
  }

  const newStats = () => ({ played: 0, won: 0, streak: 0, best: 0, lastWin: '', lastPlayed: '', dist: [0, 0, 0, 0, 0, 0] });
  /// Records a finished daily puzzle. A win on the day after the last win extends the streak; a loss ends it.
  /// Counting the same day twice does nothing.
  function record(stats, key, won, tries) {
    const s = { ...newStats(), ...stats, dist: (stats && stats.dist ? stats.dist : newStats().dist).slice() };
    if (s.lastPlayed === key) return s;
    s.played++; s.lastPlayed = key;
    if (won) {
      s.streak = s.lastWin === prevKey(key) ? s.streak + 1 : 1;
      s.won++; s.lastWin = key; s.best = Math.max(s.best, s.streak);
      if (tries >= 1 && tries <= TRIES) s.dist[tries - 1]++;
    } else s.streak = 0;
    return s;
  }
  /// The streak to show today: it is only alive if the last win was today or yesterday.
  const currentStreak = (stats, key) => (stats && (stats.lastWin === key || stats.lastWin === prevKey(key)) ? stats.streak : 0);

  const EMOJI = { g: '🟩', y: '🟨', x: '⬛' };
  /// The share text: a title line and the grid of squares, with no letters (so it does not give the word away).
  function shareText(key, guesses, answer, practice) {
    const won = guesses.length > 0 && guesses[guesses.length - 1] === answer;
    const head = `Daily Word ${practice ? 'practice' : key} ${won ? guesses.length : 'X'}/${TRIES}`;
    return `${head}\n\n${guesses.map((g) => score(g, answer).map((s) => EMOJI[s]).join('')).join('\n')}`;
  }

  const api = { LEN, TRIES, STEP, OFFSET, score, dateKey, dayNumber, prevKey, dailyWord, randomWord, letterStates, newStats, record, currentStreak, shareText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.NotchWordleLogic = api;
})();
