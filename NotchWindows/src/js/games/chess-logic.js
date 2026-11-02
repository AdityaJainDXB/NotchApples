// Chess: the rules and the computer player, with no screen. Legal moves (castling, en passant, promotion), check, checkmate,
// stalemate, draws by the fifty-move rule, repetition and too little material, and a small alpha-beta search for the computer.
// Shared by the Mac and Windows apps (the game itself is chess.js) and tested in Node (NotchWindows/tests/chess.test.mjs).
//
// Squares are 0..63 with 0 = a8 and 63 = h1 (row 0 is Black's back rank). Pieces are letters: uppercase White, lowercase Black.
(function () {
  'use strict';
  const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const sqName = (s) => 'abcdefgh'[s & 7] + (8 - (s >> 3));
  const sqFrom = (n) => 'abcdefgh'.indexOf(n[0]) + (8 - Number(n[1])) * 8;
  const isWhite = (p) => p !== '.' && p === p.toUpperCase();
  const KN = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
  const KG = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]], ORTH = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  function parseFen(fen) {
    const [pl, turn, cast, ep, half, full] = fen.trim().split(/\s+/);
    const b = [];
    for (const ch of pl) { if (ch === '/') continue; if (/\d/.test(ch)) for (let i = 0; i < Number(ch); i++) b.push('.'); else b.push(ch); }
    if (b.length !== 64) throw new Error('bad FEN');
    return { b, white: turn !== 'b', cast: cast === '-' || !cast ? '' : cast, ep: ep && ep !== '-' ? sqFrom(ep) : -1, half: Number(half) || 0, full: Number(full) || 1, hist: [] };
  }
  function toFen(g) {
    let s = '';
    for (let r = 0; r < 8; r++) { let e = 0; for (let f = 0; f < 8; f++) { const p = g.b[r * 8 + f]; if (p === '.') e++; else { if (e) s += e; e = 0; s += p; } } if (e) s += e; if (r < 7) s += '/'; }
    return `${s} ${g.white ? 'w' : 'b'} ${g.cast || '-'} ${g.ep >= 0 ? sqName(g.ep) : '-'} ${g.half} ${g.full}`;
  }
  const newGame = (fen = START) => { const g = parseFen(fen); g.hist = [posKey(g)]; return g; };
  const posKey = (g) => toFen(g).split(' ').slice(0, 4).join(' ');
  const clone = (g) => ({ b: g.b.slice(), white: g.white, cast: g.cast, ep: g.ep, half: g.half, full: g.full, hist: g.hist });

  /// Is square `sq` attacked by the side `byWhite`?
  function attacked(b, sq, byWhite) {
    const r = sq >> 3, f = sq & 7, P = (c) => (byWhite ? c.toUpperCase() : c.toLowerCase());
    const pr = byWhite ? r + 1 : r - 1;
    if (pr >= 0 && pr < 8) for (const df of [-1, 1]) { const ff = f + df; if (ff >= 0 && ff < 8 && b[pr * 8 + ff] === P('p')) return true; }
    for (const [dr, df] of KN) { const rr = r + dr, ff = f + df; if (rr >= 0 && rr < 8 && ff >= 0 && ff < 8 && b[rr * 8 + ff] === P('n')) return true; }
    for (const [dr, df] of KG) { const rr = r + dr, ff = f + df; if (rr >= 0 && rr < 8 && ff >= 0 && ff < 8 && b[rr * 8 + ff] === P('k')) return true; }
    for (const [dirs, a, c] of [[DIAG, P('b'), P('q')], [ORTH, P('r'), P('q')]]) {
      for (const [dr, df] of dirs) {
        let rr = r + dr, ff = f + df;
        while (rr >= 0 && rr < 8 && ff >= 0 && ff < 8) { const p = b[rr * 8 + ff]; if (p !== '.') { if (p === a || p === c) return true; break; } rr += dr; ff += df; }
      }
    }
    return false;
  }
  const kingSq = (b, white) => b.indexOf(white ? 'K' : 'k');
  const inCheck = (g, white = g.white) => attacked(g.b, kingSq(g.b, white), !white);

  /// Moves that obey how the pieces move, before checking that they leave the own king safe. { from, to, promo?, ep?, castle? }
  function pseudo(g) {
    const out = [], b = g.b, w = g.white;
    for (let s = 0; s < 64; s++) {
      const p = b[s];
      if (p === '.' || isWhite(p) !== w) continue;
      const r = s >> 3, f = s & 7, t = p.toLowerCase();
      const push = (to, extra) => out.push({ from: s, to, ...extra });
      if (t === 'p') {
        const dir = w ? -1 : 1, start = w ? 6 : 1, last = w ? 0 : 7, r1 = r + dir;
        const add = (to, extra) => { if ((to >> 3) === last) for (const pr of 'qrbn') push(to, { ...extra, promo: pr }); else push(to, extra); };
        if (r1 >= 0 && r1 < 8 && b[r1 * 8 + f] === '.') {
          add(r1 * 8 + f);
          if (r === start && b[(r + 2 * dir) * 8 + f] === '.') push((r + 2 * dir) * 8 + f, { dbl: true });
        }
        for (const df of [-1, 1]) {
          const ff = f + df; if (ff < 0 || ff > 7 || r1 < 0 || r1 > 7) continue;
          const to = r1 * 8 + ff, q = b[to];
          if (q !== '.' && isWhite(q) !== w) add(to);
          else if (to === g.ep) push(to, { ep: true });
        }
      } else if (t === 'n' || t === 'k') {
        for (const [dr, df] of t === 'n' ? KN : KG) {
          const rr = r + dr, ff = f + df; if (rr < 0 || rr > 7 || ff < 0 || ff > 7) continue;
          const q = b[rr * 8 + ff]; if (q === '.' || isWhite(q) !== w) push(rr * 8 + ff);
        }
        if (t === 'k') {
          const home = w ? 60 : 4;
          if (s === home && !attacked(b, home, !w)) {
            const K = w ? 'K' : 'k', Q = w ? 'Q' : 'q', R = w ? 'R' : 'r';
            if (g.cast.includes(K) && b[home + 1] === '.' && b[home + 2] === '.' && b[home + 3] === R && !attacked(b, home + 1, !w) && !attacked(b, home + 2, !w)) push(home + 2, { castle: 'k' });
            if (g.cast.includes(Q) && b[home - 1] === '.' && b[home - 2] === '.' && b[home - 3] === '.' && b[home - 4] === R && !attacked(b, home - 1, !w) && !attacked(b, home - 2, !w)) push(home - 2, { castle: 'q' });
          }
        }
      } else {
        const dirs = t === 'b' ? DIAG : t === 'r' ? ORTH : DIAG.concat(ORTH);
        for (const [dr, df] of dirs) {
          let rr = r + dr, ff = f + df;
          while (rr >= 0 && rr < 8 && ff >= 0 && ff < 8) {
            const q = b[rr * 8 + ff];
            if (q === '.') push(rr * 8 + ff); else { if (isWhite(q) !== w) push(rr * 8 + ff); break; }
            rr += dr; ff += df;
          }
        }
      }
    }
    return out;
  }

  /// A new game state after the move (the move is assumed legal). Does not touch the original.
  function apply(g, m) {
    const n = clone(g), b = n.b, p = b[m.from], w = g.white, t = p.toLowerCase();
    const captured = b[m.to] !== '.' || m.ep;
    b[m.to] = m.promo ? (w ? m.promo.toUpperCase() : m.promo.toLowerCase()) : p; b[m.from] = '.';
    if (m.ep) b[m.to + (w ? 8 : -8)] = '.';
    if (m.castle === 'k') { b[m.to - 1] = b[m.to + 1]; b[m.to + 1] = '.'; }
    if (m.castle === 'q') { b[m.to + 1] = b[m.to - 2]; b[m.to - 2] = '.'; }
    n.ep = m.dbl ? (m.from + m.to) / 2 : -1;
    let c = n.cast;
    if (t === 'k') c = c.replace(w ? /[KQ]/g : /[kq]/g, '');
    for (const [sq, ch] of [[63, 'K'], [56, 'Q'], [7, 'k'], [0, 'q']]) if (m.from === sq || m.to === sq) c = c.replace(ch, '');
    n.cast = c;
    n.half = t === 'p' || captured ? 0 : g.half + 1;
    if (!w) n.full = g.full + 1;
    n.white = !w;
    n.hist = g.hist.concat(posKey(n));
    return n;
  }

  const legal = (g) => pseudo(g).filter((m) => !inCheck(apply(g, m), g.white));
  const legalFrom = (g, from) => legal(g).filter((m) => m.from === from);

  function insufficient(b) {
    const rest = b.filter((p) => p !== '.' && p.toLowerCase() !== 'k');
    if (!rest.length) return true;
    if (rest.some((p) => 'pqr'.includes(p.toLowerCase()))) return false;
    if (rest.length === 1) return true;                                                  // a lone bishop or knight
    if (rest.every((p) => p.toLowerCase() === 'b')) {                                    // bishops that all sit on the same colour
      const cols = new Set(); b.forEach((p, s) => { if (p.toLowerCase() === 'b') cols.add(((s >> 3) + (s & 7)) & 1); });
      return cols.size === 1;
    }
    return false;
  }

  /// { over, result: 'white' | 'black' | 'draw' | null, reason, check }
  function status(g) {
    const moves = legal(g), check = inCheck(g);
    if (!moves.length) return check ? { over: true, result: g.white ? 'black' : 'white', reason: 'checkmate', check } : { over: true, result: 'draw', reason: 'stalemate', check };
    if (insufficient(g.b)) return { over: true, result: 'draw', reason: 'not enough pieces to checkmate', check };
    if (g.half >= 100) return { over: true, result: 'draw', reason: 'fifty moves without a capture or pawn move', check };
    const k = g.hist[g.hist.length - 1];
    if (g.hist.filter((x) => x === k).length >= 3) return { over: true, result: 'draw', reason: 'the same position three times', check };
    return { over: false, result: null, reason: '', check };
  }

  const moveText = (m) => sqName(m.from) + sqName(m.to) + (m.promo || '');
  const findMove = (g, text) => legal(g).find((m) => moveText(m) === text) || null;

  /// Standard algebraic notation of a legal move in position g (check and mate marks included).
  function san(g, m) {
    const p = g.b[m.from], t = p.toLowerCase();
    let s;
    if (m.castle) s = m.castle === 'k' ? 'O-O' : 'O-O-O';
    else {
      const cap = g.b[m.to] !== '.' || m.ep;
      if (t === 'p') s = (cap ? 'abcdefgh'[m.from & 7] + 'x' : '') + sqName(m.to) + (m.promo ? '=' + m.promo.toUpperCase() : '');
      else {
        const others = legal(g).filter((o) => o.to === m.to && o.from !== m.from && g.b[o.from] === p);
        let dis = '';
        if (others.length) { dis = others.every((o) => (o.from & 7) !== (m.from & 7)) ? 'abcdefgh'[m.from & 7] : others.every((o) => (o.from >> 3) !== (m.from >> 3)) ? String(8 - (m.from >> 3)) : sqName(m.from); }
        s = t.toUpperCase() + dis + (cap ? 'x' : '') + sqName(m.to);
      }
    }
    const n = apply(g, m), st = status(n);
    return s + (st.reason === 'checkmate' ? '#' : st.check ? '+' : '');
  }

  // ---- the computer player -------------------------------------------------------------------------------------------
  const VAL = { p: 100, n: 320, b: 335, r: 500, q: 900, k: 0 };
  // Piece-square bonuses from White's point of view (row 0 = Black's side); mirrored for Black.
  const PST = {
    p: [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
    n: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
    b: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
    r: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
    q: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
    k: [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
  };
  /// Static score in centipawns from White's point of view.
  function evaluate(b) {
    let s = 0;
    for (let i = 0; i < 64; i++) {
      const p = b[i]; if (p === '.') continue;
      const t = p.toLowerCase();
      if (isWhite(p)) s += VAL[t] + PST[t][i]; else s -= VAL[t] + PST[t][i ^ 56];
    }
    return s;
  }
  const order = (g, ms) => ms.map((m) => {
    const v = g.b[m.to] === '.' ? (m.ep ? 100 : 0) : VAL[g.b[m.to].toLowerCase()] * 10 - VAL[g.b[m.from].toLowerCase()];
    return { m, k: v + (m.promo === 'q' ? 800 : 0) + (m.castle ? 30 : 0) };
  }).sort((a, c) => c.k - a.k).map((x) => x.m);

  /// Pick a move for the side to move. level 1 (beginner) .. 4 (strong). `rand` is injectable for tests.
  function bestMove(g, level = 2, rand = Math.random, deadline = Infinity) {
    const moves = legal(g);
    if (!moves.length) return null;
    const sign = g.white ? 1 : -1;
    if (level <= 1) {                                                                        // beginner: mostly random, takes free pieces
      const caps = moves.filter((m) => g.b[m.to] !== '.' && VAL[g.b[m.to].toLowerCase()] >= VAL[g.b[m.from].toLowerCase()]);
      return rand() < 0.5 && caps.length ? caps[Math.floor(rand() * caps.length)] : moves[Math.floor(rand() * moves.length)];
    }
    const depth = level === 2 ? 2 : level === 3 ? 3 : 4;
    let nodes = 0;
    const MATE = 100000;
    const search = (st, d, alpha, beta, ply) => {
      if (++nodes % 2048 === 0 && Date.now() > deadline) throw new Error('time');
      const ms = legal(st);
      if (!ms.length) return inCheck(st) ? (st.white ? -MATE + ply : MATE - ply) : 0;
      if (st.half >= 100 || insufficient(st.b)) return 0;
      if (d === 0) return quiesce(st, alpha, beta, 0);
      if (st.white) {
        let best = -Infinity;
        for (const m of order(st, ms)) { const v = search(apply(st, m), d - 1, alpha, beta, ply + 1); if (v > best) best = v; if (best > alpha) alpha = best; if (alpha >= beta) break; }
        return best;
      }
      let best = Infinity;
      for (const m of order(st, ms)) { const v = search(apply(st, m), d - 1, alpha, beta, ply + 1); if (v < best) best = v; if (best < beta) beta = best; if (alpha >= beta) break; }
      return best;
    };
    const quiesce = (st, alpha, beta, q) => {
      const stand = evaluate(st.b);
      if (q >= 4) return stand;
      const caps = pseudo(st).filter((m) => st.b[m.to] !== '.' || m.ep || m.promo === 'q');
      if (st.white) {
        let best = stand; if (best >= beta) return best; if (best > alpha) alpha = best;
        for (const m of order(st, caps)) { const n = apply(st, m); if (inCheck(n, st.white)) continue; const v = quiesce(n, alpha, beta, q + 1); if (v > best) best = v; if (best > alpha) alpha = best; if (alpha >= beta) break; }
        return best;
      }
      let best = stand; if (best <= alpha) return best; if (best < beta) beta = best;
      for (const m of order(st, caps)) { const n = apply(st, m); if (inCheck(n, st.white)) continue; const v = quiesce(n, alpha, beta, q + 1); if (v < best) best = v; if (best < beta) beta = best; if (alpha >= beta) break; }
      return best;
    };
    let chosen = null;
    // Iterative deepening so a time limit still leaves a good move from the last finished depth.
    for (let d = 1; d <= depth; d++) {
      let best = null, bestV = -Infinity;
      try {
        for (const m of order(g, chosen ? [chosen].concat(moves.filter((x) => x !== chosen)) : moves)) {
          let v = sign * search(apply(g, m), d - 1, -Infinity, Infinity, 1);
          if (level === 2) v += (rand() - 0.5) * 60;                                         // a little human error at level 2
          if (v > bestV) { bestV = v; best = m; }
        }
      } catch (e) { if (e.message === 'time') break; throw e; }
      if (best) chosen = best;
    }
    return chosen || moves[0];
  }

  /// Count leaf nodes to a depth (used by the tests to check move generation against known numbers).
  function perft(g, d) {
    if (d === 0) return 1;
    let n = 0;
    for (const m of legal(g)) n += d === 1 ? 1 : perft(apply(g, m), d - 1);
    return n;
  }

  const api = { START, newGame, parseFen, toFen, legal, legalFrom, apply, status, inCheck, san, bestMove, evaluate, perft, sqName, sqFrom, moveText, findMove, isWhite, attacked };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.NotchChessLogic = api;
})();
