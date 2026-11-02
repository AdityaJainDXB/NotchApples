// Tetris: the rules, with no screen. A 10x20 well, the seven tetrominoes from a 7-bag, SRS rotation with the standard wall
// kicks, hold, a next queue, the ghost piece, line clears with standard scoring (back-to-back tetrises x1.5) and levels.
// Shared by the Mac and Windows apps (the game itself is tetris.js) and tested in Node (NotchWindows/tests/tetris.test.mjs).
//
// The well is rows[0] (top) .. rows[19] (bottom); a cell is 0 (empty) or the piece letter. A piece is { t, r, x, y }: its type,
// rotation 0..3 and the position of its box's top-left corner (y may be negative while it spawns above the well).
(function () {
  'use strict';
  const W = 10, H = 20, NEXT = 3, TYPES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

  // Spawn (rotation 0) shapes as picture rows in their SRS boxes (4x4 for I, 3x3 for the rest; O fills the middle of a 4x4).
  const PICS = {
    I: ['....', 'XXXX', '....', '....'],
    O: ['.XX.', '.XX.', '....', '....'],
    T: ['.X.', 'XXX', '...'],
    S: ['.XX', 'XX.', '...'],
    Z: ['XX.', '.XX', '...'],
    J: ['X..', 'XXX', '...'],
    L: ['..X', 'XXX', '...'],
  };
  const BOX = { I: 4, O: 4, T: 3, S: 3, Z: 3, J: 3, L: 3 };

  // SHAPES[type][rotation] = four [x, y] cells inside the box; each next rotation is a clockwise turn of the box.
  const SHAPES = {};
  for (const t of TYPES) {
    const n = BOX[t];
    let cells = [];
    PICS[t].forEach((row, y) => [...row].forEach((ch, x) => { if (ch === 'X') cells.push([x, y]); }));
    SHAPES[t] = [];
    for (let r = 0; r < 4; r++) {
      SHAPES[t].push(cells);
      cells = t === 'O' ? cells : cells.map(([x, y]) => [n - 1 - y, x]);           // clockwise: (x, y) -> (n-1-y, x)
    }
  }

  // SRS wall-kick offsets, written as in the guideline (x right, y UP) and flipped to screen coordinates below.
  const KICK_JLSTZ = {
    '01': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]], '10': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '12': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]], '21': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '23': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]], '32': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '30': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]], '03': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  };
  const KICK_I = {
    '01': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]], '10': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    '12': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]], '21': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    '23': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]], '32': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    '30': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]], '03': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
  };
  const kicks = (t, from, to) => (t === 'O' ? [[0, 0]] : (t === 'I' ? KICK_I : KICK_JLSTZ)[`${from}${to}`].map(([x, y]) => [x, -y]));

  const LINE_POINTS = [0, 100, 300, 500, 800];
  const cellsOf = (p) => SHAPES[p.t][p.r].map(([cx, cy]) => [p.x + cx, p.y + cy]);

  /// A fresh shuffled bag of the seven pieces (Fisher-Yates with the given random function).
  function makeBag(rng) {
    const b = TYPES.slice();
    for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
    return b;
  }
  const refill = (g) => { while (g.queue.length < 7 + NEXT) g.queue.push(...makeBag(g.rng)); };
  const draw = (g) => { refill(g); const t = g.queue.shift(); refill(g); return t; };

  const blank = () => Array.from({ length: H }, () => new Array(W).fill(0));
  const fits = (g, p) => cellsOf(p).every(([x, y]) => x >= 0 && x < W && y < H && (y < 0 || !g.rows[y][x]));
  const spawnOf = (t) => ({ t, r: 0, x: 3, y: t === 'I' ? -1 : 0 });

  function createGame(rng) {
    const g = { rng: rng || Math.random, rows: blank(), queue: [], piece: null, hold: null, canHold: true, score: 0, lines: 0, level: 1, over: false, b2b: false, resets: 0, last: null };
    spawn(g);
    return g;
  }
  /// Brings the next piece in at the top (or a given one); if it does not fit, the game is over (topped out).
  function spawn(g, t) {
    const p = spawnOf(t || draw(g));
    g.piece = p; g.canHold = true; g.resets = 0;
    if (!fits(g, p)) { p.y -= 1; if (!fits(g, p)) { g.over = true; return false; } }   // one more row of room above the well
    return true;
  }

  const gravityMs = (level) => Math.max(16, Math.round(1000 * Math.pow(0.8 - (level - 1) * 0.007, level - 1)));
  const grounded = (g) => !fits(g, { ...g.piece, y: g.piece.y + 1 });
  function ghostY(g) { let y = g.piece.y; while (fits(g, { ...g.piece, y: y + 1 })) y++; return y; }
  const touch = (g) => { if (grounded(g)) g.resets++; };                              // moves while on the floor count towards the lock delay cap

  function move(g, dx) {
    if (g.over) return false;
    const p = { ...g.piece, x: g.piece.x + dx };
    if (!fits(g, p)) return false;
    g.piece = p; touch(g); return true;
  }
  /// Rotates clockwise (dir 1) or counter-clockwise (dir -1), trying the five SRS kicks in order.
  function rotate(g, dir) {
    if (g.over) return false;
    const from = g.piece.r, to = (from + (dir > 0 ? 1 : 3)) % 4;
    for (const [kx, ky] of kicks(g.piece.t, from, to)) {
      const p = { ...g.piece, r: to, x: g.piece.x + kx, y: g.piece.y + ky };
      if (fits(g, p)) { g.piece = p; touch(g); return true; }
    }
    return false;
  }
  /// One row down for a soft drop (1 point), or false when the piece is on the floor.
  function softDrop(g) {
    if (g.over) return false;
    const p = { ...g.piece, y: g.piece.y + 1 };
    if (!fits(g, p)) return false;
    g.piece = p; g.score += 1; return true;
  }
  /// Gravity: one row down, or lock the piece if it cannot go down. Returns 'moved', or what lock() returns.
  function tick(g) {
    if (g.over) return null;
    const p = { ...g.piece, y: g.piece.y + 1 };
    if (fits(g, p)) { g.piece = p; return 'moved'; }
    return lock(g);
  }
  /// Drops straight down and locks (2 points a row).
  function hardDrop(g) {
    if (g.over) return null;
    const y = ghostY(g);
    g.score += 2 * (y - g.piece.y);
    g.piece = { ...g.piece, y };
    return lock(g);
  }
  /// Swaps the piece with the held one (once per piece). Returns false when it is not allowed.
  function holdPiece(g) {
    if (g.over || !g.canHold) return false;
    const t = g.piece.t, from = g.hold;
    g.hold = t;
    spawn(g, from || undefined);
    g.canHold = false;
    return true;
  }

  /// Writes the piece into the well, clears full rows, scores, levels up and brings in the next piece.
  /// Returns { cleared, points, tetris, over }.
  function lock(g) {
    const cells = cellsOf(g.piece);
    if (cells.every(([, y]) => y < 0)) { g.over = true; return { cleared: 0, points: 0, tetris: false, over: true }; }   // locked wholly above the well
    let above = false;
    for (const [x, y] of cells) { if (y < 0) above = true; else g.rows[y][x] = g.piece.t; }
    const keep = g.rows.filter((row) => row.some((c) => !c));
    const cleared = H - keep.length;
    while (keep.length < H) keep.unshift(new Array(W).fill(0));
    g.rows = keep;
    let points = 0;
    if (cleared) {
      points = LINE_POINTS[cleared] * g.level;
      const tetris = cleared === 4;
      if (tetris && g.b2b) points = Math.floor(points * 1.5);
      g.b2b = tetris;
      g.lines += cleared; g.level = Math.floor(g.lines / 10) + 1;
      g.score += points;
    }
    g.last = { cleared, points, tetris: cleared === 4 };
    if (above && !cleared) { g.over = true; return { ...g.last, over: true }; }   // part of it stuck out of the top
    spawn(g);
    return { ...g.last, over: g.over };
  }

  const api = { W, H, NEXT, TYPES, SHAPES, KICK_JLSTZ, KICK_I, LINE_POINTS, createGame, spawn, makeBag, move, rotate, softDrop, tick, hardDrop, holdPiece, lock, ghostY, grounded, fits, cellsOf, gravityMs, upcoming: (g) => g.queue.slice(0, NEXT) };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.NotchTetrisLogic = api;
})();
