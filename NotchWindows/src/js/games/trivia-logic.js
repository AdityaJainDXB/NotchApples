// Daily Trivia: the rules, with no screen. The question of the day (the same for everyone on the same local date, no server),
// a practice round of five, the streak and the share text. Shared by the Mac and Windows apps (the game itself is trivia.js,
// the questions are in trivia-questions.js) and tested in Node (NotchWindows/tests/trivia.test.mjs).
(function () {
  'use strict';
  const PRACTICE = 5;
  const pad = (n) => String(n).padStart(2, '0');
  /// 'YYYY-MM-DD' for a date in the player's own time zone: the question changes at local midnight.
  const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const dayNumber = (key) => { const [y, m, d] = key.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 86400000); };
  const prevKey = (key) => { const t = new Date((dayNumber(key) - 1) * 86400000); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`; };

  // The questions are walked in a fixed scattered order: day n gets question (n * STEP + OFFSET) mod count. STEP is a prime
  // bigger than the list, so it shares no factor with the count and no question repeats until the whole list has been used.
  const STEP = 1009, OFFSET = 211;
  /// The position in the list of the question for a day (a 'YYYY-MM-DD' key).
  function dailyIndex(count, key) { return (((dayNumber(key) * STEP + OFFSET) % count) + count) % count; }
  const dailyQuestion = (qs, key) => qs[dailyIndex(qs.length, key)];

  /// `count` different questions for a practice round, avoiding the ones in `not` (positions) when the list is big enough.
  function practiceSet(qs, rng, count, not) {
    const r = rng || Math.random, want = Math.min(count || PRACTICE, qs.length), skip = new Set(not || []);
    let pool = qs.map((_, i) => i).filter((i) => !skip.has(i));
    if (pool.length < want) pool = qs.map((_, i) => i);
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    return pool.slice(0, want);
  }

  /// Problems with a question list, as strings (empty when it is fine). Used by the tests.
  function validate(qs) {
    const bad = [], seen = new Set();
    qs.forEach((x, i) => {
      const at = `#${i}`;
      if (!x.q || !x.cat) bad.push(`${at} needs a question and a category`);
      if (!Array.isArray(x.o) || x.o.length !== 4 || x.o.some((s) => !s)) bad.push(`${at} needs four options`);
      else if (new Set(x.o.map((s) => s.toLowerCase())).size !== 4) bad.push(`${at} has repeated options`);
      if (!Number.isInteger(x.a) || x.a < 0 || x.a > 3) bad.push(`${at} has no valid answer`);
      if (!x.why) bad.push(`${at} has no explanation`);
      const k = (x.q || '').toLowerCase();
      if (seen.has(k)) bad.push(`${at} repeats a question`); seen.add(k);
    });
    return bad;
  }

  const isRight = (q, choice) => choice === q.a;
  /// The number right in a practice round: `choices` is the option picked for each question.
  const practiceScore = (qs, picked, choices) => picked.reduce((n, qi, k) => n + (choices[k] === qs[qi].a ? 1 : 0), 0);

  const newStats = () => ({ played: 0, correct: 0, streak: 0, best: 0, lastRight: '', lastPlayed: '' });
  /// Records the answer to the daily question. A right answer on the day after the last right answer extends the streak;
  /// a wrong one ends it. Counting the same day twice does nothing.
  function record(stats, key, right) {
    const s = { ...newStats(), ...stats };
    if (s.lastPlayed === key) return s;
    s.played++; s.lastPlayed = key;
    if (right) { s.streak = s.lastRight === prevKey(key) ? s.streak + 1 : 1; s.correct++; s.lastRight = key; s.best = Math.max(s.best, s.streak); }
    else s.streak = 0;
    return s;
  }
  /// The streak to show today: it is only alive if the last right answer was today or yesterday.
  const currentStreak = (stats, key) => (stats && (stats.lastRight === key || stats.lastRight === prevKey(key)) ? stats.streak : 0);

  /// The share text: the title and squares only, so it does not give the answer away.
  function shareText(key, q, right) {
    return `Daily Trivia ${key}\n${q.cat} ${right ? '🟩' : '⬛'}`;
  }
  function practiceShareText(results) {
    return `Daily Trivia practice ${results.filter(Boolean).length}/${results.length}\n${results.map((r) => (r ? '🟩' : '⬛')).join('')}`;
  }

  const api = { PRACTICE, STEP, OFFSET, dateKey, dayNumber, prevKey, dailyIndex, dailyQuestion, practiceSet, validate, isRight, practiceScore, newStats, record, currentStreak, shareText, practiceShareText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.NotchTriviaLogic = api;
})();
