// The Racing HUD's rules (the logic behind the broadcast-style display, not the drawing): which cars the timing tower lists and what its gap column says,
// who holds the fastest lap, the flag block at the top of the tower (CAUTION in sector 2, RESUME RACING), the banners that slide in at the top centre
// (fastest lap, warnings, flags, the chequered flag) one at a time with priorities, the radio subtitles, the clean-lap streak and the finish card.
// Pure: no DOM, no canvas, no clock (the game passes the time in), no randomness. The game (racing.js) draws what these return.
//
// ALL TUNABLE NUMBERS ARE IN `HUD` BELOW.
(function (root) {
  'use strict';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const HUD = {
    tower: { fullFieldMax: 8, top: 5 },                  // a field this small is listed in full; a bigger one shows the first `top` cars, and you if you are further back
    resumeS: 5,                                          // how long "RESUME RACING" stays after a flag, a Safety Car or a red flag ends
    banner: { holdS: 3.6, fadeS: 0.35, maxWaitS: 7, maxQueue: 4, keepPri: 3 },   // seconds shown; fade in and out; a waiting banner older than this is dropped (unless its priority is `keepPri` or more); how many wait
    kinds: {                                             // priority (higher replaces a lower one that is showing) and the colour of the icon square
      fastest: { pri: 2, col: '#b36bff' },
      warning: { pri: 3, col: '#ffd23f' },
      penalty: { pri: 3, col: '#ff6b4a' },
      flag: { pri: 3, col: '#ffd23f' },
      green: { pri: 3, col: '#3ad07a' },
      chequered: { pri: 4, col: '#f2f2f2' },
      clean: { pri: 1, col: '#3ad07a' },
      info: { pri: 1, col: '#4da3ff' },
    },
    subtitle: { baseS: 1.6, perWordS: 0.38, minS: 2.4, maxS: 7, fadeS: 0.3 },     // how long a radio line stays on screen: baseS + words x perWordS, kept between minS and maxS
    cleanLap: { first: 3, every: 5 },                    // the "clean laps" banner shows at this streak, and then at every multiple of `every`
    col: { purple: '#b36bff', green: '#3ad07a', yellow: '#ffd23f', red: '#ff4d4d', white: '#f2f2f2', ink: '#101626' },
  };

  /// 1 -> "1ST", 2 -> "2ND", 3 -> "3RD", 11 -> "11TH", 22 -> "22ND".
  function ordinal(n) {
    const v = Math.max(0, Math.round(n)), t = v % 100, o = (t >= 11 && t <= 13) ? 'TH' : ['TH', 'ST', 'ND', 'RD'][v % 10] || 'TH';
    return `${v}${o}`;
  }
  /// A lap time: 1:32.650 (or 32.650 under a minute).
  function fmtLapTime(t) {
    if (!(t >= 0)) return '--';
    let m = Math.floor(t / 60), s = Math.round((t - m * 60) * 1000) / 1000; if (s >= 60) { m += 1; s -= 60; }
    const sc = s.toFixed(3).padStart(6, '0');
    return m ? `${m}:${sc}` : sc;
  }
  /// A gap in seconds with its sign: +3.270, -0.412, +1:05.3 (a minute or more).
  function fmtGap(sec) {
    if (!Number.isFinite(sec)) return '';
    const a = Math.abs(sec), sign = sec < 0 ? '-' : '+';
    if (a >= 60) { const m = Math.floor(a / 60); return `${sign}${m}:${(a - m * 60).toFixed(1).padStart(4, '0')}`; }
    return `${sign}${a.toFixed(3)}`;
  }

  /// The racer with the fastest lap so far (a lap time above 0), or null. Race officials do not count.
  function fastestHolder(racers) {
    let best = null;
    for (const r of racers) if (r && !r.official && r.bestLap > 0 && (!best || r.bestLap < best.bestLap)) best = r;
    return best;
  }

  // ---- the timing tower
  /// Which positions (indices into the classification) the tower lists: a small field in full, otherwise the first four and then you, or the fifth car if you are in front of it.
  function towerIndices(count, meIndex) {
    const T = HUD.tower;
    if (count <= T.fullFieldMax) return Array.from({ length: count }, (_, i) => i);
    const out = []; for (let i = 0; i < T.top - 1; i++) out.push(i);
    out.push(meIndex >= T.top - 1 ? meIndex : T.top - 1);
    return [...new Set(out)];
  }
  /// The gap column for the car at `index` in `all` (the classification): { text, kind } with kind 'out', 'pit', 'lead', 'laps', 'gap', 'me' or 'none'.
  /// mode 1: the gap to you (negative: ahead of you); mode 2: the gap to the leader (the leader shows dashes, as on the broadcast tower).
  function towerGap(all, index, me, mode, L) {
    const r = all[index];
    if (r.dnf) return { text: 'OUT', kind: 'out' };
    if (r.inLane) return { text: 'PIT', kind: 'pit' };
    if (mode === 2) {
      if (index === 0) return { text: '- - -', kind: 'lead' };
      const dl = Math.floor((all[0].prog - r.prog) / L);
      if (dl >= 1) return { text: `+${dl} LAP${dl > 1 ? 'S' : ''}`, kind: 'laps' };
      return r.gapL != null ? { text: fmtGap(Math.max(0, r.gapL)), kind: 'gap' } : { text: '', kind: 'none' };
    }
    if (r === me) return { text: '', kind: 'me' };
    const dl = Math.round((r.prog - me.prog) / L);
    if (Math.abs(dl) >= 1) return { text: `${dl > 0 ? '+' : '-'}${Math.abs(dl)} LAP${Math.abs(dl) > 1 ? 'S' : ''}`, kind: 'laps' };
    if (r.gapL != null && me.gapL != null) return { text: fmtGap(r.gapL - me.gapL), kind: 'gap' };
    return { text: '', kind: 'none' };
  }
  /// The tower's rows: [{ index, pos, racer, gap, isMe, fastest }]. `all` is the classification without disqualified cars; `fastest` is fastestHolder().
  function towerRows(all, me, mode, L, fastest) {
    const mi = all.indexOf(me);
    return towerIndices(all.length, mi).map((i) => ({ index: i, pos: i + 1, racer: all[i], gap: towerGap(all, i, me, mode, L), isMe: all[i] === me, fastest: !!fastest && all[i] === fastest }));
  }

  // ---- the flag block at the top of the tower
  /// The sector (1 to 3) of a point a fraction of the way round the lap.
  function sectorOf(frac) { return clamp(Math.floor(clamp(frac, 0, 0.9999) * 3), 0, 2) + 1; }
  function createFlagTracker() { return { last: 'green', resumeUntil: -1 }; }
  /// Call every frame with the flag that is out ('green', 'yellow', 'vsc', 'sc', 'red', 'chequered'), the sector of a yellow (1 to 3, or null), and the time.
  /// Returns the block to draw in place of the tower's header, or null: { key, title, sub, bg, fg }.
  function flagBlock(tr, input, t) {
    const f = input.flag || 'green', c = HUD.col;
    if (f === 'green' && tr.last !== 'green' && tr.last !== 'chequered') tr.resumeUntil = t + HUD.resumeS;
    tr.last = f;
    if (f === 'yellow') return { key: 'yellow', title: 'CAUTION', sub: input.sector ? `SECTOR ${input.sector}` : '', bg: c.yellow, fg: c.ink };
    if (f === 'vsc') return { key: 'vsc', title: 'VIRTUAL SAFETY CAR', sub: 'KEEP THE DELTA', bg: c.yellow, fg: c.ink };
    if (f === 'sc') return { key: 'sc', title: 'SAFETY CAR', sub: input.restart ? 'RESTART AT THE LINE' : input.inWarned ? 'IN THIS LAP' : 'STAY BEHIND IT', bg: c.yellow, fg: c.ink };
    if (f === 'red') return { key: 'red', title: 'RED FLAG', sub: 'RACE STOPPED', bg: c.red, fg: '#fff' };
    if (f === 'chequered') return { key: 'chq', title: 'CHEQUERED FLAG', sub: '', bg: c.white, fg: c.ink };
    if (t < tr.resumeUntil) return { key: 'resume', title: 'RESUME RACING', sub: '', bg: c.green, fg: c.ink };
    return null;
  }

  // ---- the banners at the top centre
  /// A queue of banners. Push { id, kind, title, sub?, icon?, hold? }; ask for the one to draw with bannerNow(q, t).
  function createBanners() { return { cur: null, wait: [] }; }
  const kindOf = (k) => HUD.kinds[k] || HUD.kinds.info;
  function bannerPush(q, b, t) {
    const K = kindOf(b.kind), item = Object.assign({ icon: b.kind, sub: '' }, b, { pri: b.pri != null ? b.pri : K.pri, col: b.col || K.col, queuedAt: t });
    if (q.cur && q.cur.id === item.id) { q.cur = Object.assign(q.cur, { title: item.title, sub: item.sub }); return 'same'; }     // the one showing is updated, not shown twice
    const dup = q.wait.findIndex((w) => w.id === item.id); if (dup >= 0) q.wait.splice(dup, 1);
    if (q.cur && item.pri > q.cur.pri) { q.cur = null; q.wait.push(item); return 'now'; }
    q.wait.push(item);
    q.wait.sort((a, b2) => b2.pri - a.pri || a.queuedAt - b2.queuedAt);
    while (q.wait.length > HUD.banner.maxQueue) q.wait.pop();       // the lowest priority, newest, goes
    return 'queued';
  }
  /// The banner to draw at time t: { banner, a, slide } (a: 0 to 1 opacity, slide: 1 to 0, how far it still has to come in) or null.
  function bannerNow(q, t) {
    const B = HUD.banner;
    if (q.cur && t >= q.cur.end) q.cur = null;
    if (!q.cur) {
      q.wait = q.wait.filter((w) => w.pri >= B.keepPri || t - w.queuedAt <= B.maxWaitS);
      const next = q.wait.shift();
      if (next) q.cur = Object.assign(next, { start: t, end: t + (next.hold || B.holdS) });
    }
    if (!q.cur) return null;
    const a = clamp(Math.min((t - q.cur.start) / B.fadeS, (q.cur.end - t) / B.fadeS), 0, 1);
    return { banner: q.cur, a, slide: 1 - a };
  }
  /// The banner for the fastest lap, or null when nobody has set one.
  function fastestBanner(holder, name) {
    return holder && holder.bestLap > 0 ? { id: 'fastest', kind: 'fastest', icon: 'stopwatch', title: 'FASTEST LAP', sub: `${name || holder.name || ''}  ${fmtLapTime(holder.bestLap)}`.trim() } : null;
  }
  /// The "clean laps" banner when the streak (laps in a row without a track-limit warning or a hit) reaches the first mark and then every few laps; null otherwise.
  function cleanLapBanner(streak) {
    const C = HUD.cleanLap;
    return streak >= C.first && (streak === C.first || streak % C.every === 0) ? { id: 'clean', kind: 'clean', icon: 'clean', title: `CLEAN LAPS x ${streak}` } : null;
  }

  // ---- the radio subtitles
  function createSubs() { return { cur: null }; }
  const words = (s) => String(s).trim().split(/\s+/).filter(Boolean).length;
  /// A line of radio: the newest replaces the one showing. who: 'eng' (your engineer), 'com' (the commentator) or anything else.
  function subPush(sb, text, who, t) {
    const S = HUD.subtitle, txt = String(text || '').trim(); if (!txt) return null;
    sb.cur = { text: txt, who: who || 'eng', start: t, end: t + clamp(S.baseS + words(txt) * S.perWordS, S.minS, S.maxS) };
    return sb.cur;
  }
  /// The line to draw at time t: { text, who, a } or null.
  function subNow(sb, t) {
    const S = HUD.subtitle, c = sb.cur;
    if (!c || t >= c.end) { sb.cur = null; return null; }
    return { text: c.text, who: c.who, a: clamp(Math.min((t - c.start) / S.fadeS, (c.end - t) / S.fadeS), 0, 1) };
  }

  // ---- the minimap's line and the finish card
  /// The colours of the three sectors on the minimap's line: the sector result colours of the lap (green: your best, yellow: slower, null: not driven yet),
  /// or all purple while that lap is the fastest lap of the race.
  function sectorLine(cols, purpleLap) {
    return [0, 1, 2].map((i) => (purpleLap ? HUD.col.purple : (cols && cols[i]) || null));
  }
  /// What the card at the bottom left says when you finish: { ord: '2ND', name, caption }.
  function finishCard(pos, name, event) { return { ord: ordinal(pos), name: String(name || '').toUpperCase(), caption: String(event || '').toUpperCase() }; }

  const api = { HUD, ordinal, fmtLapTime, fmtGap, fastestHolder, towerIndices, towerGap, towerRows, sectorOf, createFlagTracker, flagBlock, createBanners, bannerPush, bannerNow, fastestBanner, cleanLapBanner, createSubs, subPush, subNow, sectorLine, finishCard };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NotchRaceF1 = root.NotchRaceF1 || {};
  root.NotchRaceF1.hud = api;
})(typeof window !== 'undefined' ? window : globalThis);
