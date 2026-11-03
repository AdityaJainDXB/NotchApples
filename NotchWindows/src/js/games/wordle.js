// Daily Word for the Games tab, shared by the Mac and Windows apps: a five-letter word, six guesses, green / yellow / grey.
// One puzzle a day (the same word for everyone on the same local date, no server), a streak, a share grid, and a Practice
// mode for extra words. The rules are in wordle-logic.js and the word lists in wordle-words.js.
//
//   window.NotchWordleGame.mount(hostElement)  starts the game; returns a function that stops it.
//   window.NotchWordleGame.suspend() / resume() the notch closed / opened (nothing runs in the background anyway).
//   window.NotchWordleGame.key(key, down)      a key forwarded by the Mac app when the web view has no keyboard focus.
//
// Nothing runs while you are not typing: there is no animation loop, only a short timer that clears the message line.
(function () {
  'use strict';
  const L = window.NotchWordleLogic, WORDS = window.NotchWordleWords;
  const VALID = new Set(WORDS.valid);
  const store = {
    get(k, d) { try { const v = localStorage.getItem('wordle.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('wordle.' + k, JSON.stringify(v)); } catch { /* storage off */ } },
  };
  const ROWS = ['qwertyuiop', 'asdfghjkl', '+zxcvbnm-'];                    // + = Enter, - = Backspace
  const PRAISE = ['Genius!', 'Magnificent!', 'Impressive!', 'Splendid!', 'Great!', 'Phew!'];

  const CSS = `
  .wd { container-type: size; position: relative; width: 100%; height: 100%; overflow: hidden; background: #0d0b14; color: #f1ecff; font: 13px/1.35 -apple-system, "Segoe UI", system-ui, sans-serif; user-select: none; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 8px 10px; box-sizing: border-box; outline: none; }
  .wd * { box-sizing: border-box; }
  .wd .wd-head { flex: 0 0 auto; width: 100%; max-width: 470px; display: flex; align-items: center; gap: 8px; }
  .wd h1 { margin: 0; font-size: 16px; flex: 1 1 auto; }
  .wd h1 small { font-size: 11px; font-weight: 600; color: #9d93b8; margin-left: 6px; }
  .wd .wd-streak { font-weight: 800; color: #ffb347; white-space: nowrap; }
  .wd button { font: inherit; font-weight: 700; padding: 3px 10px; border-radius: 9px; border: 1px solid rgba(255,255,255,.22); background: rgba(255,255,255,.07); color: #fff; cursor: pointer; }
  .wd button:hover { background: rgba(255,255,255,.15); }
  .wd button.on { border-color: #b36bff; box-shadow: 0 0 0 1px #b36bff inset; background: rgba(179,107,255,.2); }
  .wd .wd-msg { flex: 0 0 auto; min-height: 20px; font-weight: 700; text-align: center; color: #f1ecff; }
  .wd .wd-msg.win { color: #5ce08a; } .wd .wd-msg.lose { color: #ff8a8a; }
  .wd .wd-gridwrap { flex: 1 1 auto; min-height: 0; width: 100%; display: flex; justify-content: center; }
  .wd .wd-grid { container-type: size; height: 100%; max-width: 100%; aspect-ratio: 5 / 6; display: grid; grid-template: repeat(6, 1fr) / repeat(5, 1fr); gap: 5px; }
  .wd .wd-row { display: contents; }
  .wd .wd-t { display: flex; align-items: center; justify-content: center; border: 2px solid #3a3456; border-radius: 6px; font-weight: 800; text-transform: uppercase; font-size: 7cqh; line-height: 1; }
  .wd .wd-t.f { border-color: #6b6290; animation: wdpop .09s ease-out; }
  .wd .wd-t.g { background: #3f9a5b; border-color: #3f9a5b; } .wd .wd-t.y { background: #b99a2f; border-color: #b99a2f; } .wd .wd-t.x { background: #3a3456; border-color: #3a3456; }
  .wd .shake .wd-t { animation: wdshake .3s; }
  .wd .wd-kb { flex: 0 0 auto; width: 100%; max-width: 470px; display: flex; flex-direction: column; gap: 5px; }
  .wd .wd-kr { display: flex; gap: 4px; justify-content: center; }
  .wd .wd-k { flex: 1 1 0; max-width: 40px; height: 34px; padding: 0; border-radius: 6px; border: 0; background: #4a4268; font-weight: 700; text-transform: uppercase; font-size: 13px; }
  .wd .wd-k.wide { flex: 1.6 1 0; max-width: 62px; font-size: 11px; }
  .wd .wd-k.g { background: #3f9a5b; } .wd .wd-k.y { background: #b99a2f; } .wd .wd-k.x { background: #231f33; color: #8a82a8; }
  .wd .wd-end { flex: 0 0 auto; display: flex; gap: 6px; flex-wrap: wrap; justify-content: center; }
  @keyframes wdpop { from { transform: scale(.88); } to { transform: scale(1); } }
  @keyframes wdshake { 20%, 60% { transform: translateX(-4px); } 40%, 80% { transform: translateX(4px); } }
  @container (max-height: 380px) { .wd .wd-k { height: 28px; } }
  `;
  let styled = false;
  const ensureStyle = () => { if (styled) return; styled = true; const s = document.createElement('style'); s.textContent = CSS; document.head.append(s); };
  const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  function mount(host) {
    ensureStyle();
    host.innerHTML = '';
    const root = h('div', 'wd'); root.tabIndex = 0; host.append(root);
    if (window.NotchLeaderboard) window.NotchLeaderboard.button(root, { games: () => [{ id: 'wordle', label: 'Daily Word streak', kind: 'days', best: () => stats.best }] });   // Friends leaderboard (off until the player opts in)

    let mode = 'daily';                                          // 'daily' | 'practice' | 'nyt'
    let today = L.dateKey(new Date());
    let daily = null, practice = null;                           // { answer, guesses, status: 'play' | 'won' | 'lost' }
    let stats = { ...L.newStats(), ...store.get('stats', {}) };
    let cur = '', msg = '', msgClass = '', msgTimer = 0, shake = false, alive = true, last = '';

    function loadDaily() {
      today = L.dateKey(new Date());
      const answer = L.dailyWord(WORDS.answers, today), saved = store.get('daily', null);
      daily = saved && saved.key === today && saved.answer === answer ? saved : { key: today, answer, guesses: [], status: 'play' };
      if (!(saved && saved.key === today)) cur = '';
    }
    const saveDaily = () => store.set('daily', daily);
    function newPractice() { practice = { answer: L.randomWord(WORDS.answers, null, last), guesses: [], status: 'play' }; last = practice.answer; cur = ''; }
    loadDaily();

    // The NYT puzzle: today's answer is read from the New York Times' public puzzle feed by the host app (the page cannot do it
    // itself), once a day. Offline or blocked, it says so and the other modes keep working. Nothing here uses their name or look.
    let nyt = null, nytBusy = false;
    const hasNyt = () => typeof window.NotchHostFetch === 'function';
    async function loadNyt() {
      const key = L.dateKey(new Date()), saved = store.get('nyt', null);
      if (saved && saved.key === key) { nyt = saved; render(); return; }
      if (nytBusy) return;
      nytBusy = true; nyt = null; say('Fetching today’s puzzle…', '', 0); render();
      try {
        const j = JSON.parse(await window.NotchHostFetch(`https://www.nytimes.com/svc/wordle/v2/${key}.json`)), a = String(j.solution || '').toLowerCase();
        if (!/^[a-z]{5}$/.test(a)) throw new Error('unreadable');
        nyt = { key, answer: a, no: j.days_since_launch || null, guesses: [], status: 'play' }; store.set('nyt', nyt); say('', '', 0);
      } catch { mode = 'daily'; say('Couldn’t reach today’s NYT puzzle. Are you online?', 'lose', 4000); }
      nytBusy = false; cur = ''; render();
    }
    const game = () => (mode === 'daily' ? daily : mode === 'nyt' ? (nyt || { key: '', answer: '', guesses: [], status: 'loading' }) : practice);
    function say(text, cls, ms) {
      msg = text; msgClass = cls || ''; clearTimeout(msgTimer);
      if (ms) msgTimer = setTimeout(() => { msg = ''; msgClass = ''; render(); }, ms);
    }
    async function copy(text) {
      try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back below */ }
      try {
        const t = document.createElement('textarea'); t.value = text; t.style.cssText = 'position:fixed;left:-999px;top:0'; document.body.append(t); t.select();
        const ok = document.execCommand('copy'); t.remove(); return ok;
      } catch { return false; }
    }
    async function share() {
      const g = game();
      const ok = await copy(L.shareText(mode === 'daily' ? g.key : mode === 'nyt' ? `NYT puzzle ${g.no || g.key}` : '', g.guesses, g.answer, mode === 'practice'));
      if (!alive) return;
      say(ok ? 'Result copied to the clipboard' : 'Could not copy the result', ok ? '' : 'lose', 2500);
      render();
    }

    function submit() {
      const g = game();
      if (g.status !== 'play') return;
      if (cur.length < L.LEN) { say('Not enough letters', '', 1500); shake = true; render(); return; }
      if (mode !== 'nyt' && !VALID.has(cur)) { say('Not in the word list', '', 1500); shake = true; render(); return; }
      g.guesses.push(cur); cur = '';
      const won = g.guesses[g.guesses.length - 1] === g.answer;
      if (won || g.guesses.length >= L.TRIES) {
        g.status = won ? 'won' : 'lost';
        if (mode === 'daily') { stats = L.record(stats, g.key, won, g.guesses.length); store.set('stats', stats); if (window.NotchLeaderboard) window.NotchLeaderboard.submit('wordle', stats.streak); }   // sent only if the player opted in
        say(won ? PRAISE[g.guesses.length - 1] : g.answer.toUpperCase(), won ? 'win' : 'lose', 0);
        if (mode === 'daily') saveDaily(); else if (mode === 'nyt') store.set('nyt', g);
        render();
        share();                                             // copied when the puzzle ends
        return;
      }
      if (mode === 'daily') saveDaily(); else if (mode === 'nyt') store.set('nyt', g);
      say('', '', 0); render();
    }

    function press(k) {
      if (!alive) return false;
      if (mode === 'daily' && L.dateKey(new Date()) !== today) { loadDaily(); render(); }   // the day turned over while it was open
      if (mode === 'nyt' && nyt && L.dateKey(new Date()) !== nyt.key) { nyt = null; loadNyt(); return false; }
      const g = game();
      if (k === 'Enter') { submit(); return true; }
      if (g.status !== 'play') return false;
      if (k === 'Backspace') { cur = cur.slice(0, -1); shake = false; if (msg && !msgTimer) say('', ''); render(); return true; }
      if (/^[a-z]$/.test(k) && cur.length < L.LEN) { cur += k; shake = false; render(); return true; }
      return /^[a-z]$/.test(k);
    }

    function render() {
      if (!alive) return;
      const g = game();
      root.replaceChildren();
      const head = h('div', 'wd-head');
      const title = h('h1', '', 'Daily Word'); title.append(h('small', '', mode === 'daily' ? today : mode === 'nyt' ? 'NYT puzzle' : 'Practice'));
      const streak = h('span', 'wd-streak', `🔥 ${L.currentStreak(stats, today)}`); streak.title = `Streak · best ${stats.best} · won ${stats.won} of ${stats.played}`;
      const bD = h('button', mode === 'daily' ? 'on' : '', 'Daily'), bP = h('button', mode === 'practice' ? 'on' : '', 'Practice');
      bD.onclick = () => { mode = 'daily'; cur = ''; shake = false; say('', ''); render(); root.focus(); };
      bP.onclick = () => { if (mode !== 'practice' || !practice) newPractice(); mode = 'practice'; cur = ''; shake = false; say('', ''); render(); root.focus(); };
      head.append(title, streak, bD, bP);
      if (hasNyt()) {
        const bN = h('button', mode === 'nyt' ? 'on' : '', 'NYT puzzle'); bN.title = 'Today’s puzzle from The New York Times (needs the internet). Any five-letter word is accepted.';
        bN.onclick = () => { mode = 'nyt'; cur = ''; shake = false; say('', ''); render(); root.focus(); loadNyt(); };
        head.append(bN);
      }

      const m = h('div', 'wd-msg' + (msgClass ? ' ' + msgClass : ''), msg);

      const wrap = h('div', 'wd-gridwrap'), grid = h('div', 'wd-grid');
      for (let r = 0; r < L.TRIES; r++) {
        const row = h('div', 'wd-row' + (shake && r === g.guesses.length ? ' shake' : ''));
        const done = r < g.guesses.length, word = done ? g.guesses[r] : r === g.guesses.length ? cur : '';
        const sc = done ? L.score(word, g.answer) : null;
        const tiles = [];
        for (let i = 0; i < L.LEN; i++) tiles.push(h('div', 'wd-t' + (sc ? ' ' + sc[i] : word[i] ? ' f' : ''), word[i] || ''));
        row.replaceChildren(...tiles);
        grid.append(row);
      }
      wrap.append(grid);

      const states = L.letterStates(g.guesses, g.answer), kb = h('div', 'wd-kb');
      for (const r of ROWS) {
        const kr = h('div', 'wd-kr');
        for (const ch of r) {
          const label = ch === '+' ? 'Enter' : ch === '-' ? '⌫' : ch, key = ch === '+' ? 'Enter' : ch === '-' ? 'Backspace' : ch;
          const b = h('button', 'wd-k' + (ch === '+' || ch === '-' ? ' wide' : '') + (states[ch] ? ' ' + states[ch] : ''), label);
          b.onmousedown = (e) => e.preventDefault();             // keep the keyboard focus on the game
          b.onclick = () => { press(key); root.focus(); };
          kr.append(b);
        }
        kb.append(kr);
      }
      root.append(head, m, wrap);
      if (g.status === 'loading') { /* waiting for today's puzzle: the message above says so */ }
      else if (g.status !== 'play') {
        const end = h('div', 'wd-end'), bShare = h('button', '', 'Copy result'), bMore = h('button', 'on', mode === 'daily' ? 'Practice with another word' : 'Another word');
        bShare.onclick = () => share();
        bMore.onclick = () => { newPractice(); mode = 'practice'; say('', ''); render(); root.focus(); };
        end.append(bShare, bMore); root.append(end);
      } else root.append(kb);
    }

    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
      if (press(k)) e.preventDefault();
    };
    const onVis = () => { if (!document.hidden && mode === 'daily' && L.dateKey(new Date()) !== today) { loadDaily(); render(); } };
    window.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onVis);

    const api = {
      suspend() { /* nothing is running */ },
      resume() { onVis(); },
      key(k, down) { if (down) press(k && k.length === 1 ? k.toLowerCase() : k); },
      state: () => ({ mode, today, answer: game().answer, guesses: game().guesses.slice(), status: game().status, cur, stats }),
      dev: { press, submit, get daily() { return daily; }, newPractice },
    };
    render();
    root.focus();
    const stop = () => {
      alive = false; clearTimeout(msgTimer);
      window.removeEventListener('keydown', onKey); document.removeEventListener('visibilitychange', onVis);
      host.innerHTML = '';
      if (window.NotchWordleGame.current === api) window.NotchWordleGame.current = null;
    };
    window.NotchWordleGame.current = api;
    return stop;
  }

  window.NotchWordleGame = {
    current: null,
    mount,
    key: (k, down) => { const c = window.NotchWordleGame.current; if (c) c.key(k, down); },
    suspend: () => { const c = window.NotchWordleGame.current; if (c) c.suspend(); },
    resume: () => { const c = window.NotchWordleGame.current; if (c) c.resume(); },
    state: () => { const c = window.NotchWordleGame.current; return c ? c.state() : null; },
    get dev() { const c = window.NotchWordleGame.current; return c && c.dev; },
  };
})();
