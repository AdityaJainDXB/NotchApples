// Scribble for the Games tab: the rules with no screen, shared by the Mac and Windows apps (the game itself is scribble.js) and tested
// in Node (NotchWindows/tests/scribble.test.mjs). A draw-and-guess game for up to 10 players: each turn one player draws a word and the
// others type guesses; the faster you guess, the more you score; the drawer scores when people guess. Computer players take part: they
// draw simple pictures from templates, and they guess honestly (from the length of the word and the letters shown so far, never from
// the drawing). The canvas is 1000 wide and 750 tall; all positions are on that grid.
(function () {
  'use strict';
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const W = 1000, H = 750;
  const ROUNDS = 3, DRAW_TIME = 80, CHOOSE_TIME = 15, REVEAL_TIME = 5, MAX_PLAYERS = 10, MIN_BOT_DELAY = 10;

  const WORDS = [];
  // The word list: single words, and a few two-word ones.
  const SINGLE = ('cat dog fish bird horse cow pig duck frog snake elephant giraffe monkey lion tiger rabbit mouse bee butterfly spider whale shark turtle penguin owl ' +
    'house car bus bike boat plane train rocket tree flower sun moon star cloud rain umbrella key door chair table bed lamp clock book pencil phone computer guitar piano drum ' +
    'hat shoe sock shirt glasses crown ring cup bottle apple banana pizza cake cookie egg bread carrot grapes lemon burger cheese ' +
    'mountain river beach island volcano rainbow snowman fire leaf hand eye nose heart ghost robot dragon castle pirate sword ladder bridge balloon gift camera flag candle ' +
    'scissors hammer kite basket bucket bell cactus mushroom pumpkin tent anchor feather lightning snowflake toothbrush fork spoon knife wheel telescope trophy skateboard').split(' ');
  const DOUBLE = ['ice cream', 'hot dog', 'teddy bear', 'traffic light', 'police car', 'fire truck', 'birthday cake', 'christmas tree', 'soccer ball', 'swimming pool'];
  WORDS.push(...SINGLE, ...DOUBLE);

  // ---- pictures the computer players can draw ------------------------------------------------------------------------
  const circle = (cx, cy, r, n = 28, a0 = 0, a1 = Math.PI * 2) => Array.from({ length: n + 1 }, (_, i) => [cx + r * Math.cos(a0 + ((a1 - a0) * i) / n), cy + r * Math.sin(a0 + ((a1 - a0) * i) / n)]);
  const ellipse = (cx, cy, rx, ry, n = 32) => Array.from({ length: n + 1 }, (_, i) => [cx + rx * Math.cos((Math.PI * 2 * i) / n), cy + ry * Math.sin((Math.PI * 2 * i) / n)]);
  const star = (cx, cy, R, r) => { const p = []; for (let i = 0; i <= 10; i++) { const a = -Math.PI / 2 + (Math.PI * i) / 5, rad = i % 2 ? r : R; p.push([cx + rad * Math.cos(a), cy + rad * Math.sin(a)]); } return p; };
  const heart = (cx, cy, k) => Array.from({ length: 41 }, (_, i) => { const t = (Math.PI * 2 * i) / 40; return [cx + k * 16 * Math.sin(t) ** 3, cy - k * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))]; });
  const rays = (cx, cy, r1, r2, n) => Array.from({ length: n }, (_, i) => { const a = (Math.PI * 2 * i) / n; return [[cx + r1 * Math.cos(a), cy + r1 * Math.sin(a)], [cx + r2 * Math.cos(a), cy + r2 * Math.sin(a)]]; });

  const TEMPLATES = {
    sun: () => [circle(500, 375, 110), ...rays(500, 375, 150, 230, 10)],
    house: () => [[[300, 650], [300, 400], [700, 400], [700, 650], [300, 650]], [[250, 400], [500, 200], [750, 400], [250, 400]], [[450, 650], [450, 520], [550, 520], [550, 650]], [[340, 450], [340, 520], [410, 520], [410, 450], [340, 450]]],
    tree: () => [[[470, 650], [470, 450]], [[530, 650], [530, 450]], circle(500, 330, 150)],
    flower: () => [[[500, 650], [500, 400]], [[500, 560], [420, 500], [500, 530]], circle(500, 320, 36, 16), ...Array.from({ length: 6 }, (_, i) => circle(500 + 85 * Math.cos((Math.PI * 2 * i) / 6), 320 + 85 * Math.sin((Math.PI * 2 * i) / 6), 45, 16))],
    star: () => [star(500, 380, 230, 95)],
    heart: () => [heart(500, 390, 16)],
    car: () => [[[250, 500], [250, 400], [400, 400], [470, 320], [620, 320], [700, 400], [780, 400], [780, 500], [250, 500]], circle(380, 510, 45, 20), circle(650, 510, 45, 20), [[470, 330], [470, 400]], [[470, 400], [700, 400]]],
    boat: () => [[[250, 500], [750, 500], [650, 600], [350, 600], [250, 500]], [[500, 500], [500, 200]], [[500, 210], [700, 450], [500, 450]], [[200, 650], [300, 630], [400, 660], [500, 630], [600, 660], [700, 630], [800, 650]]],
    fish: () => [ellipse(480, 375, 200, 110), [[680, 375], [820, 290], [820, 460], [680, 375]], circle(390, 340, 12, 10), [[300, 400], [330, 420], [300, 440]]],
    cloud: () => [circle(380, 420, 80), circle(490, 360, 100), circle(610, 400, 90), circle(520, 440, 70), [[300, 500], [690, 500]]],
    apple: () => [circle(500, 410, 170, 32), [[500, 240], [525, 170]], [[525, 190], [610, 170], [570, 235], [525, 190]]],
    balloon: () => [ellipse(500, 300, 130, 170), [[490, 470], [510, 470], [500, 492], [490, 470]], [[500, 492], [470, 560], [530, 620], [500, 700]]],
    key: () => [circle(350, 375, 80, 24), circle(350, 375, 30, 16), [[430, 375], [760, 375]], [[680, 375], [680, 445]], [[740, 375], [740, 430]]],
    umbrella: () => [circle(500, 400, 250, 30, Math.PI, Math.PI * 2), [[250, 400], [750, 400]], [[500, 400], [500, 620], [460, 665], [420, 635]], [[500, 150], [500, 400]], [[330, 290], [390, 400]], [[670, 290], [610, 400]]],
    snowman: () => [circle(500, 560, 120), circle(500, 370, 85), circle(500, 235, 60), [[440, 190], [440, 105], [560, 105], [560, 190]], [[410, 190], [590, 190]], circle(480, 222, 5, 8), circle(520, 222, 5, 8), [[500, 240], [555, 250], [500, 256]], circle(500, 360, 8, 8), circle(500, 400, 8, 8)],
    rocket: () => [[[500, 100], [580, 250], [580, 500], [420, 500], [420, 250], [500, 100]], circle(500, 300, 36, 18), [[420, 430], [340, 540], [420, 500]], [[580, 430], [660, 540], [580, 500]], [[450, 500], [500, 630], [550, 500]]],
    mountain: () => [[[150, 620], [400, 250], [520, 420], [620, 320], [850, 620], [150, 620]], [[340, 345], [370, 320], [400, 350], [430, 320], [460, 345]]],
    pizza: () => [[[500, 660], [250, 250], [750, 250], [500, 660]], [[250, 250], [500, 200], [750, 250]], circle(420, 330, 30, 14), circle(580, 330, 30, 14), circle(500, 460, 28, 14)],
    cup: () => [[[350, 300], [370, 600], [550, 600], [570, 300], [350, 300]], circle(570, 450, 70, 16, -Math.PI / 2, Math.PI / 2), [[420, 250], [440, 200], [420, 150]], [[500, 250], [520, 200], [500, 150]]],
    cat: () => [circle(500, 400, 150, 32), [[370, 300], [390, 190], [450, 262]], [[630, 300], [610, 190], [550, 262]], circle(450, 380, 15, 10), circle(550, 380, 15, 10), [[485, 430], [515, 430], [500, 450], [485, 430]], [[400, 440], [300, 430]], [[400, 462], [300, 482]], [[600, 440], [700, 430]], [[600, 462], [700, 482]]],
    clock: () => [circle(500, 375, 230, 36), [[500, 375], [500, 230]], [[500, 375], [600, 420]], ...rays(500, 375, 200, 225, 12)],
    kite: () => [[[500, 120], [650, 330], [500, 560], [350, 330], [500, 120]], [[500, 120], [500, 560]], [[350, 330], [650, 330]], [[500, 560], [460, 620], [540, 670], [480, 725]]],
    'ice cream': () => [[[400, 400], [500, 700], [600, 400], [400, 400]], circle(500, 360, 110, 28), [[420, 440], [440, 470], [470, 440]]],
    candle: () => [[[450, 300], [450, 650], [550, 650], [550, 300], [450, 300]], [[500, 160], [540, 240], [500, 292], [460, 240], [500, 160]]],
  };
  const BOT_WORDS = Object.keys(TEMPLATES);
  /// The strokes a computer player draws for `word` (empty when it has no picture for it).
  const templateStrokes = (word) => (TEMPLATES[word] ? TEMPLATES[word]().map((s) => s.map(([x, y]) => [Math.round(clamp(x, 0, W)), Math.round(clamp(y, 0, H))])) : []);

  // ---- words and guesses ---------------------------------------------------------------------------------------------
  const normalize = (t) => String(t == null ? '' : t).toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
  const edits = (a, b) => {                       // the edit distance, for telling "so close" from "no"
    const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return dp[a.length][b.length];
  };
  const matches = (guess, word) => { const g = normalize(guess); return g === word || g === word + 's' || g === word + 'es'; };
  const closeTo = (guess, word) => { const g = normalize(guess); return g.length >= 4 && g !== word && edits(g, word) === 1; };

  // ---- a game --------------------------------------------------------------------------------------------------------
  /// `rng` is Math.random, or a seeded one in tests.
  function newGame(opts = {}) {
    return { phase: 'lobby', rounds: opts.rounds || ROUNDS, drawTime: opts.drawTime || DRAW_TIME, rng: opts.rng || Math.random, round: 1, turn: 0, order: [], players: {}, drawer: null,
             choices: [], word: null, timeLeft: 0, mask: [], hintAt: [], ink: [], plan: null, guessed: [], events: [], t: 0, winner: null };
  }
  const say = (g, text) => g.events.push({ e: 'sys', text });

  function addPlayer(g, spec) {
    if (g.players[spec.id] || Object.keys(g.players).length >= MAX_PLAYERS) return null;
    const p = { id: spec.id, name: String(spec.name || 'Player').slice(0, 14), bot: !!spec.bot, skill: clamp(spec.skill == null ? 0.7 : spec.skill, 0.2, 1), score: 0, got: false, tried: [], next: 0 };
    g.players[p.id] = p;
    if (g.phase !== 'lobby') g.order.push(p.id);
    say(g, `${p.name} joined.`);
    return p;
  }
  function removePlayer(g, id) {
    const p = g.players[id]; if (!p) return;
    delete g.players[id];
    const at = g.order.indexOf(id);
    if (at >= 0) { g.order.splice(at, 1); if (at < g.turn) g.turn--; }
    say(g, `${p.name} left.`);
    if (Object.keys(g.players).length < 2 && g.phase !== 'lobby' && g.phase !== 'over') { g.phase = 'over'; finishGame(g); return; }
    if (id === g.drawer && (g.phase === 'choosing' || g.phase === 'drawing')) { say(g, 'The drawer left, so this turn is skipped.'); g.turn--; g.timeLeft = 0; g.phase = 'reveal'; g.word = g.word || null; g.skipped = true; }
  }
  const shuffled = (g, list) => { const a = list.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(g.rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  function startGame(g) {
    if (g.phase !== 'lobby' && g.phase !== 'over') return false;
    if (Object.keys(g.players).length < 2) return false;
    for (const p of Object.values(g.players)) { p.score = 0; p.got = false; p.tried = []; }
    g.order = shuffled(g, Object.keys(g.players)); g.round = 1; g.turn = 0; g.winner = null;
    beginChoosing(g);
    return true;
  }
  function beginChoosing(g) {
    g.drawer = g.order[g.turn];
    const drawer = g.players[g.drawer];
    const pool = drawer && drawer.bot ? BOT_WORDS : WORDS;
    g.choices = shuffled(g, pool).slice(0, 3);
    g.phase = 'choosing'; g.timeLeft = CHOOSE_TIME; g.word = null; g.skipped = false; g.ink = []; g.guessed = [];
    for (const p of Object.values(g.players)) { p.got = false; }
    g.events.push({ e: 'clear' });
    say(g, `${drawer ? drawer.name : 'Someone'} is choosing a word.`);
  }
  function chooseWord(g, id, word) {
    if (g.phase !== 'choosing' || id !== g.drawer || !g.choices.includes(word)) return false;
    g.word = word; g.phase = 'drawing'; g.timeLeft = g.drawTime; g.choices = [];
    g.mask = [...word].map((c) => c === ' ');                               // spaces are shown, letters hidden
    const letters = [...word].filter((c) => c !== ' ').length;
    g.hintAt = letters >= 4 ? [g.drawTime * 0.45, g.drawTime * 0.75].slice(0, letters >= 7 ? 2 : 1) : [];
    const drawer = g.players[g.drawer];
    if (drawer && drawer.bot) { const strokes = templateStrokes(word); g.plan = { strokes, i: 0, at: 0, total: strokes.reduce((n, s) => n + s.length, 0), sent: 0 }; }
    else g.plan = null;
    for (const p of Object.values(g.players)) p.next = g.t + MIN_BOT_DELAY + g.rng() * 5 / p.skill;
    say(g, `${drawer.name} is drawing!`);
    return true;
  }
  /// What everyone sees of the word: letters revealed so far, the rest as underscores.
  const hintText = (g) => (g.word ? [...g.word].map((c, i) => (c === ' ' ? '  ' : g.mask[i] || g.phase === 'reveal' || g.phase === 'over' ? c : '_')).join(' ') : '');

  function reveal(g) {
    const hidden = [...g.word].map((c, i) => i).filter((i) => g.word[i] !== ' ' && !g.mask[i]);
    if (hidden.length <= 1) return;
    g.mask[hidden[Math.floor(g.rng() * hidden.length)]] = true;
    g.events.push({ e: 'hint' });
  }

  /// A guess from player `id`. Returns { result: 'correct' | 'close' | 'wrong' | 'ignored', points }.
  function guess(g, id, text) {
    const p = g.players[id];
    if (!p || g.phase !== 'drawing' || id === g.drawer || p.got) return { result: 'ignored', points: 0 };
    const t = String(text || '').slice(0, 60);
    if (matches(t, g.word)) {
      const first = g.guessed.length === 0;
      const points = Math.round(100 + 400 * Math.max(0, g.timeLeft) / g.drawTime) + (first ? 50 : 0);
      p.got = true; p.score += points; g.guessed.push(id);
      const d = g.players[g.drawer]; if (d) d.score += Math.round(points * 0.4);
      g.events.push({ e: 'right', id, name: p.name, points });
      return { result: 'correct', points };
    }
    if (closeTo(t, g.word)) { g.events.push({ e: 'chat', id, name: p.name, text: t, close: true }); return { result: 'close', points: 0 }; }
    g.events.push({ e: 'chat', id, name: p.name, text: t });
    return { result: 'wrong', points: 0 };
  }

  function endTurn(g) {
    g.phase = 'reveal'; g.timeLeft = REVEAL_TIME;
    const d = g.players[g.drawer];
    if (!g.skipped) {
      say(g, `The word was “${g.word}”.`);
      const others = Object.keys(g.players).length - 1;
      if (d && g.guessed.length === 0) say(g, 'Nobody guessed it.');
      else if (d && others > 0 && g.guessed.length === others) { d.score += 100; say(g, `Everybody guessed it! ${d.name} gets a bonus.`); }
    }
    g.events.push({ e: 'turn-end' });
  }
  function finishGame(g) {
    g.phase = 'over';
    const ranked = Object.values(g.players).sort((a, b) => b.score - a.score);
    g.winner = ranked.length && (ranked.length < 2 || ranked[0].score > ranked[1].score) ? ranked[0].id : (ranked.length ? ranked[0].id : null);
    say(g, ranked.length ? `${ranked[0].name} wins with ${ranked[0].score} points!` : 'The game is over.');
    g.events.push({ e: 'over' });
  }
  function nextTurn(g) {
    g.turn++;
    if (g.turn >= g.order.length) { g.turn = 0; g.round++; }
    if (g.round > g.rounds) { finishGame(g); return; }
    beginChoosing(g);
  }

  /// What a computer player types: it picks among the words that still fit the picture-less clue (the length and the letters shown), more
  /// likely the right one the fewer words fit and the later it is. It never sees the drawing.
  function botGuess(g, bot) {
    const clue = [...g.word].map((c, i) => (c === ' ' ? ' ' : g.mask[i] ? c : '?'));
    const fits = WORDS.filter((w) => w.length === clue.length && [...w].every((c, i) => clue[i] === '?' ? c !== ' ' : clue[i] === c) && !bot.tried.includes(w));
    if (!fits.length) return null;
    const elapsed = 1 - Math.max(0, g.timeLeft) / g.drawTime;
    const chance = clamp((1 / fits.length) * (0.25 + 0.45 * bot.skill) + elapsed * 0.04 * bot.skill, 0, 0.85);
    const pick = fits.includes(g.word) && g.rng() < chance ? g.word : fits.filter((w) => w !== g.word)[Math.floor(g.rng() * Math.max(1, fits.length - (fits.includes(g.word) ? 1 : 0)))] || fits[0];
    bot.tried.push(pick);
    return pick;
  }

  /// Moves the game on by `dt` seconds: timers, hints, the computer players drawing and guessing. Changes to show come out in g.events.
  function step(g, dt) {
    g.t += dt;
    if (g.phase === 'lobby' || g.phase === 'over') return;
    g.timeLeft -= dt;
    if (g.phase === 'choosing') {
      const d = g.players[g.drawer];
      if (d && d.bot && g.timeLeft < CHOOSE_TIME - 1.2) chooseWord(g, g.drawer, g.choices[0]);
      else if (g.timeLeft <= 0) chooseWord(g, g.drawer, g.choices[Math.floor(g.rng() * g.choices.length)]);
      return;
    }
    if (g.phase === 'reveal') { if (g.timeLeft <= 0) nextTurn(g); return; }
    // drawing
    const elapsed = g.drawTime - g.timeLeft;
    while (g.hintAt.length && elapsed >= g.hintAt[0]) { g.hintAt.shift(); reveal(g); }
    if (g.plan) {                                                           // a computer player draws its picture over about 60% of the time
      const want = Math.min(g.plan.total, Math.floor((elapsed / (g.drawTime * 0.6)) * g.plan.total));
      while (g.plan.sent < want && g.plan.i < g.plan.strokes.length) {
        const s = g.plan.strokes[g.plan.i];
        const from = g.plan.at, to = Math.min(s.length, from + Math.max(1, want - g.plan.sent));
        const pts = s.slice(Math.max(0, from - 1), to);
        if (pts.length >= 1) g.events.push({ e: 'ink', sid: `b${g.plan.i}`, color: '#222222', size: 6, pts, cont: from > 0 });
        g.plan.sent += to - from; g.plan.at = to;
        if (to >= s.length) { g.plan.i++; g.plan.at = 0; }
      }
    }
    for (const p of Object.values(g.players)) {
      if (!p.bot || p.id === g.drawer || p.got || g.t < p.next) continue;
      p.next = g.t + (7 + g.rng() * 9) / p.skill;
      const w = botGuess(g, p);
      if (w) guess(g, p.id, w);
    }
    const guessers = Object.values(g.players).filter((p) => p.id !== g.drawer);
    if (g.timeLeft <= 0 || (guessers.length && guessers.every((p) => p.got))) endTurn(g);
  }

  /// What every player may see (the word only once the turn is over; the drawer is told it privately).
  function publicState(g) {
    return { ph: g.phase, rd: g.round, rds: g.rounds, dr: g.drawer, hint: hintText(g), tl: Math.max(0, Math.ceil(g.timeLeft)), dt: g.drawTime,
             word: g.phase === 'reveal' || g.phase === 'over' ? g.word : null, win: g.winner,
             pl: Object.values(g.players).map((p) => [p.id, p.name, p.score, p.got ? 1 : 0, p.bot ? 1 : 0]) };
  }

  const api = { W, H, ROUNDS, DRAW_TIME, CHOOSE_TIME, REVEAL_TIME, MAX_PLAYERS, WORDS, BOT_WORDS, templateStrokes, normalize, matches, closeTo, newGame, addPlayer, removePlayer, startGame,
                chooseWord, guess, step, hintText, publicState, botGuess, endTurn };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.NotchScribbleLogic = api;
})();
