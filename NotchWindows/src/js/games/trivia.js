// Daily Trivia for the Games tab, shared by the Mac and Windows apps: one multiple-choice question a day (the same for everyone
// on the same local date, no server, works offline), a streak, a copyable result, and a Practice mode of five random questions
// with a score. The rules are in trivia-logic.js and the questions in trivia-questions.js.
//
//   window.NotchTriviaGame.mount(hostElement)  starts the game; returns a function that stops it.
//   window.NotchTriviaGame.suspend() / resume() the notch closed / opened (nothing runs in the background anyway).
//   window.NotchTriviaGame.key(key, down)      a key forwarded by the Mac app when the web view has no keyboard focus.
//
// Nothing runs while you are not clicking: there are no timers and no animation loops, the page only redraws on a click or key.
(function () {
  'use strict';
  const L = window.NotchTriviaLogic, QS = window.NotchTriviaQuestions.questions;
  const store = {
    get(k, d) { try { const v = localStorage.getItem('trivia.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('trivia.' + k, JSON.stringify(v)); } catch { /* storage off */ } },
  };
  const LETTERS = ['A', 'B', 'C', 'D'];

  const CSS = `
  .tv { container-type: size; position: relative; width: 100%; height: 100%; overflow: auto; background: #0d0b14; color: #f1ecff; font: 13px/1.4 -apple-system, "Segoe UI", system-ui, sans-serif; user-select: none; display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 8px 12px; box-sizing: border-box; outline: none; }
  .tv * { box-sizing: border-box; }
  .tv .tv-head { flex: 0 0 auto; width: 100%; max-width: 560px; display: flex; align-items: center; gap: 8px; }
  .tv h1 { margin: 0; font-size: 16px; flex: 1 1 auto; }
  .tv h1 small { font-size: 11px; font-weight: 600; color: #9d93b8; margin-left: 6px; }
  .tv .tv-streak { font-weight: 800; color: #ffb347; white-space: nowrap; }
  .tv button { font: inherit; font-weight: 700; padding: 3px 10px; border-radius: 9px; border: 1px solid rgba(255,255,255,.22); background: rgba(255,255,255,.07); color: #fff; cursor: pointer; }
  .tv button:hover { background: rgba(255,255,255,.15); }
  .tv button.on { border-color: #b36bff; box-shadow: 0 0 0 1px #b36bff inset; background: rgba(179,107,255,.2); }
  .tv .tv-card { flex: 0 0 auto; width: 100%; max-width: 560px; display: flex; flex-direction: column; gap: 8px; }
  .tv .tv-cat { font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: #b36bff; }
  .tv .tv-q { font-size: 17px; font-weight: 700; line-height: 1.3; }
  .tv .tv-opts { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .tv .tv-opt { display: flex; gap: 8px; align-items: center; text-align: left; padding: 8px 10px; font-weight: 600; border-radius: 10px; min-height: 40px; }
  .tv .tv-opt b { flex: 0 0 auto; width: 20px; height: 20px; border-radius: 50%; background: rgba(255,255,255,.12); display: grid; place-items: center; font-size: 11px; }
  .tv .tv-opt.right { background: #2d6b44; border-color: #5ce08a; } .tv .tv-opt.wrong { background: #6b2d2d; border-color: #ff8a8a; } .tv .tv-opt.dim { opacity: .55; }
  .tv .tv-opts.done .tv-opt { cursor: default; }
  .tv .tv-res { font-weight: 800; } .tv .tv-res.win { color: #5ce08a; } .tv .tv-res.lose { color: #ff8a8a; }
  .tv .tv-why { color: #cfc6e8; }
  .tv .tv-row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
  .tv .tv-note { color: #9d93b8; font-size: 12px; }
  .tv .tv-score { font-size: 28px; font-weight: 800; }
  @container (max-width: 420px) { .tv .tv-opts { grid-template-columns: 1fr; } }
  `;
  let styled = false;
  const ensureStyle = () => { if (styled) return; styled = true; const s = document.createElement('style'); s.textContent = CSS; document.head.append(s); };
  const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  function mount(host) {
    ensureStyle();
    host.innerHTML = '';
    const root = h('div', 'tv'); root.tabIndex = 0; host.append(root);
    if (window.NotchLeaderboard) window.NotchLeaderboard.button(host, { games: () => [{ id: 'trivia', label: 'Daily Trivia streak', kind: 'days', best: () => stats.best }] });   // Friends leaderboard (off until the player opts in)

    let mode = 'daily';                                          // 'daily' | 'practice'
    let today = L.dateKey(new Date());
    let daily = null;                                            // { key, qi, choice }  (choice: the option picked, or null)
    let prac = null;                                             // { picked: [question positions], choices: [], step: 0 }
    let lastPrac = [], note = '', alive = true;
    let stats = { ...L.newStats(), ...store.get('stats', {}) };

    function loadDaily() {
      today = L.dateKey(new Date());
      const qi = L.dailyIndex(QS.length, today), saved = store.get('daily', null);
      daily = saved && saved.key === today && saved.qi === qi ? saved : { key: today, qi, choice: null };
    }
    function newPractice() { prac = { picked: L.practiceSet(QS, null, L.PRACTICE, lastPrac), choices: [], step: 0 }; lastPrac = prac.picked.slice(); note = ''; }
    loadDaily();

    async function copy(text) {
      try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back below */ }
      try {
        const t = document.createElement('textarea'); t.value = text; t.style.cssText = 'position:fixed;left:-999px;top:0'; document.body.append(t); t.select();
        const ok = document.execCommand('copy'); t.remove(); return ok;
      } catch { return false; }
    }
    async function share() {
      const text = mode === 'daily' ? L.shareText(daily.key, QS[daily.qi], daily.choice === QS[daily.qi].a)
        : L.practiceShareText(prac.picked.map((qi, k) => prac.choices[k] === QS[qi].a));
      const ok = await copy(text);
      if (!alive) return;
      note = ok ? 'Result copied to the clipboard' : 'Could not copy the result';
      render();
    }

    /// The question on screen and the option picked for it (null while unanswered).
    const current = () => {
      if (mode === 'daily') return { q: QS[daily.qi], choice: daily.choice };
      const qi = prac.picked[prac.step];
      return { q: QS[qi], choice: prac.choices[prac.step] == null ? null : prac.choices[prac.step] };
    };
    const practiceDone = () => mode === 'practice' && prac.step >= prac.picked.length;

    function answer(i) {
      if (mode === 'daily') {
        if (daily.choice != null) return;
        daily.choice = i; store.set('daily', daily);
        stats = L.record(stats, daily.key, i === QS[daily.qi].a); store.set('stats', stats); if (window.NotchLeaderboard) window.NotchLeaderboard.submit('trivia', stats.streak);   // sent only if the player opted in and joined a board

      } else {
        if (practiceDone() || prac.choices[prac.step] != null) return;
        prac.choices[prac.step] = i;
      }
      note = ''; render();
    }
    function next() {
      if (mode !== 'practice' || practiceDone() || prac.choices[prac.step] == null) return;
      prac.step++; note = ''; render();
    }

    function press(k) {
      if (!alive) return false;
      if (mode === 'daily' && L.dateKey(new Date()) !== today) { loadDaily(); render(); }   // the day turned over while it was open
      if (/^[1-4]$/.test(k) || /^[a-d]$/i.test(k)) {
        if (practiceDone()) return false;
        answer(/^[1-4]$/.test(k) ? Number(k) - 1 : k.toLowerCase().charCodeAt(0) - 97); return true;
      }
      if (k === 'Enter' || k === ' ') {
        if (mode === 'practice' && practiceDone()) { newPractice(); render(); return true; }
        if (mode === 'practice' && current().choice != null) { next(); return true; }
        return false;
      }
      return false;
    }

    function render() {
      if (!alive) return;
      root.replaceChildren();
      const head = h('div', 'tv-head');
      const title = h('h1', '', 'Daily Trivia'); title.append(h('small', '', mode === 'daily' ? today : 'Practice'));
      const streak = h('span', 'tv-streak', `🔥 ${L.currentStreak(stats, today)}`); streak.title = `Streak · best ${stats.best} · right ${stats.correct} of ${stats.played}`;
      const bD = h('button', mode === 'daily' ? 'on' : '', 'Daily'), bP = h('button', mode === 'practice' ? 'on' : '', 'Practice');
      bD.onclick = () => { mode = 'daily'; note = ''; render(); root.focus(); };
      bP.onclick = () => { if (mode !== 'practice' || !prac) newPractice(); mode = 'practice'; note = ''; render(); root.focus(); };
      head.append(title, streak, bD, bP);
      root.append(head);

      const card = h('div', 'tv-card');
      if (practiceDone()) {
        const results = prac.picked.map((qi, k) => prac.choices[k] === QS[qi].a), got = results.filter(Boolean).length;
        card.append(h('div', 'tv-cat', 'Practice round finished'), h('div', 'tv-score', `${got} / ${prac.picked.length}`), h('div', 'tv-q', results.map((r) => (r ? '🟩' : '⬛')).join('')));
        const row = h('div', 'tv-row'), bShare = h('button', '', 'Copy result'), bMore = h('button', 'on', 'Play 5 more');
        bShare.onclick = () => share(); bMore.onclick = () => { newPractice(); render(); root.focus(); };
        row.append(bShare, bMore); card.append(row);
      } else {
        const { q, choice } = current(), answered = choice != null;
        card.append(h('div', 'tv-cat', mode === 'practice' ? `${q.cat} · question ${prac.step + 1} of ${prac.picked.length}` : q.cat), h('div', 'tv-q', q.q));
        const opts = h('div', 'tv-opts' + (answered ? ' done' : ''));
        q.o.forEach((text, i) => {
          const cls = 'tv-opt' + (answered ? (i === q.a ? ' right' : i === choice ? ' wrong' : ' dim') : '');
          const b = h('button', cls); b.append(h('b', '', LETTERS[i]), h('span', '', text));
          b.onmousedown = (e) => e.preventDefault();             // keep the keyboard focus on the game
          b.onclick = () => { answer(i); root.focus(); };
          opts.append(b);
        });
        card.append(opts);
        if (answered) {
          const right = choice === q.a;
          card.append(h('div', 'tv-res ' + (right ? 'win' : 'lose'), right ? 'Correct!' : `Not quite. The answer is ${q.o[q.a]}.`), h('div', 'tv-why', q.why));
          const row = h('div', 'tv-row');
          if (mode === 'daily') {
            const bShare = h('button', '', 'Copy result'), bMore = h('button', 'on', 'Practice');
            bShare.onclick = () => share(); bMore.onclick = () => { newPractice(); mode = 'practice'; render(); root.focus(); };
            row.append(bShare, bMore, h('span', 'tv-note', 'A new question tomorrow.'));
          } else {
            const last = prac.step >= prac.picked.length - 1, bNext = h('button', 'on', last ? 'See score' : 'Next question');
            bNext.onclick = () => { next(); root.focus(); };
            row.append(bNext);
          }
          card.append(row);
        } else card.append(h('div', 'tv-note', 'Click an answer, or press 1–4 (or A–D).'));
      }
      if (note) card.append(h('div', 'tv-note', note));
      root.append(card);
    }

    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
      if (press(e.key.length === 1 ? e.key.toLowerCase() : e.key)) e.preventDefault();
    };
    const onVis = () => { if (!document.hidden && mode === 'daily' && L.dateKey(new Date()) !== today) { loadDaily(); render(); } };
    window.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onVis);

    const api = {
      suspend() { /* nothing is running */ },
      resume() { onVis(); },
      key(k, down) { if (down) press(k && k.length === 1 ? k.toLowerCase() : k); },
      state: () => ({ mode, today, daily: daily && { ...daily }, practice: prac && { ...prac }, stats }),
      dev: { press, answer, next },
    };
    render();
    root.focus();
    const stop = () => {
      alive = false;
      window.removeEventListener('keydown', onKey); document.removeEventListener('visibilitychange', onVis);
      host.innerHTML = '';
      if (window.NotchTriviaGame.current === api) window.NotchTriviaGame.current = null;
    };
    window.NotchTriviaGame.current = api;
    return stop;
  }

  window.NotchTriviaGame = {
    current: null,
    mount,
    key: (k, down) => { const c = window.NotchTriviaGame.current; if (c) c.key(k, down); },
    suspend: () => { const c = window.NotchTriviaGame.current; if (c) c.suspend(); },
    resume: () => { const c = window.NotchTriviaGame.current; if (c) c.resume(); },
    state: () => { const c = window.NotchTriviaGame.current; return c ? c.state() : null; },
    get dev() { const c = window.NotchTriviaGame.current; return c && c.dev; },
  };
})();
