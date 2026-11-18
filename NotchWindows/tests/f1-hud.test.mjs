// The Racing HUD's rules: the timing tower's rows and gaps, the fastest lap, the flag block, the banners, the radio subtitles. Run: node --test NotchWindows/tests
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const H = require('../src/js/games/f1/hud.js');

const L = 3000;
const car = (id, o = {}) => ({ id, name: id.toUpperCase(), prog: 9000 - id.length * 0, gapL: 0, ...o });
const field = (n) => Array.from({ length: n }, (_, i) => ({ id: 'c' + i, name: 'C' + i, prog: 9000 - i * 40, gapL: i * 1.2, bestLap: 0 }));

test('ordinals, lap times and gaps read like a timing screen', () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 112].map(H.ordinal), ['1ST', '2ND', '3RD', '4TH', '11TH', '12TH', '13TH', '21ST', '22ND', '23RD', '101ST', '112TH']);
  assert.equal(H.fmtLapTime(92.65), '1:32.650'); assert.equal(H.fmtLapTime(32.0504), '32.050'); assert.equal(H.fmtLapTime(59.9996), '1:00.000'); assert.equal(H.fmtLapTime(NaN), '--');
  assert.equal(H.fmtGap(3.27), '+3.270'); assert.equal(H.fmtGap(-0.412), '-0.412'); assert.equal(H.fmtGap(65.31), '+1:05.3'); assert.equal(H.fmtGap(NaN), '');
});

test('the fastest lap belongs to the quickest lap of any racer, and race officials never hold it', () => {
  const a = { id: 'a', bestLap: 93.2 }, b = { id: 'b', bestLap: 92.1 }, c = { id: 'c', bestLap: 0 }, sc = { id: 'sc', official: true, bestLap: 60 };
  assert.equal(H.fastestHolder([a, b, c, sc]), b);
  assert.equal(H.fastestHolder([c, sc]), null); assert.equal(H.fastestHolder([]), null);
});

test('the tower lists a small field in full, and the first four plus you in a big one', () => {
  assert.deepEqual(H.towerIndices(6, 5), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(H.towerIndices(8, 0), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(H.towerIndices(20, 0), [0, 1, 2, 3, 4], 'in front: the fifth car fills the last row');
  assert.deepEqual(H.towerIndices(20, 3), [0, 1, 2, 3, 4]);
  assert.deepEqual(H.towerIndices(20, 4), [0, 1, 2, 3, 4]);
  assert.deepEqual(H.towerIndices(20, 13), [0, 1, 2, 3, 13], 'further back: you are shown after the first four');
});

test('gaps: to the leader with dashes for the leader, or to you with a sign, laps down, pit and out', () => {
  const all = field(10), me = all[3];
  assert.deepEqual(H.towerGap(all, 0, me, 2, L), { text: '- - -', kind: 'lead' });
  assert.deepEqual(H.towerGap(all, 2, me, 2, L), { text: '+2.400', kind: 'gap' });
  assert.deepEqual(H.towerGap(all, 3, me, 1, L), { text: '', kind: 'me' });
  assert.deepEqual(H.towerGap(all, 1, me, 1, L), { text: '-2.400', kind: 'gap' }, 'ahead of you: negative');
  assert.deepEqual(H.towerGap(all, 5, me, 1, L), { text: '+2.400', kind: 'gap' }, 'behind you: positive');
  all[6].prog -= 3500; assert.deepEqual(H.towerGap(all, 6, me, 2, L), { text: '+1 LAP', kind: 'laps' });
  all[7].prog -= 7200; assert.deepEqual(H.towerGap(all, 7, me, 2, L), { text: '+2 LAPS', kind: 'laps' });
  all[8].dnf = true; assert.deepEqual(H.towerGap(all, 8, me, 2, L), { text: 'OUT', kind: 'out' });
  all[9].inLane = true; assert.deepEqual(H.towerGap(all, 9, me, 1, L), { text: 'PIT', kind: 'pit' });
  const nogap = field(3); nogap[1].gapL = null; assert.deepEqual(H.towerGap(nogap, 1, nogap[0], 2, L), { text: '', kind: 'none' }, 'no timing yet: no number rather than a wrong one');
});

test('tower rows mark you and the fastest lap holder', () => {
  const all = field(12), me = all[9]; all[2].bestLap = 91.5; me.bestLap = 92.3;
  const rows = H.towerRows(all, me, 2, L, H.fastestHolder(all));
  assert.deepEqual(rows.map((r) => r.pos), [1, 2, 3, 4, 10]);
  assert.deepEqual(rows.map((r) => r.fastest), [false, false, true, false, false]);
  assert.deepEqual(rows.map((r) => r.isMe), [false, false, false, false, true]);
  assert.equal(rows[4].racer, me); assert.equal(rows[0].gap.kind, 'lead');
  assert.equal(H.towerRows(all, me, 2, L, null).some((r) => r.fastest), false);
});

test('the flag block: CAUTION with the sector, the SC, the red flag, then RESUME RACING for a few seconds', () => {
  const tr = H.createFlagTracker();
  assert.equal(H.flagBlock(tr, { flag: 'green' }, 0), null);
  const y = H.flagBlock(tr, { flag: 'yellow', sector: 2 }, 10);
  assert.equal(y.title, 'CAUTION'); assert.equal(y.sub, 'SECTOR 2'); assert.equal(y.bg, H.HUD.col.yellow);
  assert.equal(H.flagBlock(tr, { flag: 'yellow' }, 11).sub, '', 'no sector known: no sector line');
  assert.equal(H.flagBlock(tr, { flag: 'vsc' }, 12).key, 'vsc');
  assert.equal(H.flagBlock(tr, { flag: 'sc' }, 13).sub, 'STAY BEHIND IT');
  assert.equal(H.flagBlock(tr, { flag: 'sc', inWarned: true }, 14).sub, 'IN THIS LAP');
  assert.equal(H.flagBlock(tr, { flag: 'sc', restart: true }, 15).sub, 'RESTART AT THE LINE');
  const red = H.flagBlock(tr, { flag: 'red' }, 16); assert.equal(red.title, 'RED FLAG'); assert.equal(red.bg, H.HUD.col.red);
  const res = H.flagBlock(tr, { flag: 'green' }, 20); assert.equal(res.key, 'resume'); assert.equal(res.title, 'RESUME RACING'); assert.equal(res.bg, H.HUD.col.green);
  assert.equal(H.flagBlock(tr, { flag: 'green' }, 20 + H.HUD.resumeS - 0.1).key, 'resume');
  assert.equal(H.flagBlock(tr, { flag: 'green' }, 20 + H.HUD.resumeS + 0.1), null, 'then it goes');
  assert.equal(H.flagBlock(tr, { flag: 'chequered' }, 99).title, 'CHEQUERED FLAG');
  assert.equal(H.flagBlock(tr, { flag: 'green' }, 100), null, 'no RESUME RACING after the chequered flag');
});

test('sectors are thirds of the lap', () => {
  assert.deepEqual([0, 0.2, 0.34, 0.5, 0.67, 0.99, 1, -1].map(H.sectorOf), [1, 1, 2, 2, 3, 3, 3, 1]);
});

test('banners come one at a time, a more important one cuts in, a stale one is dropped', () => {
  const q = H.createBanners(), B = H.HUD.banner;
  assert.equal(H.bannerNow(q, 0), null);
  H.bannerPush(q, { id: 'clean', kind: 'clean', title: 'CLEAN LAPS x 3' }, 0);
  const n0 = H.bannerNow(q, 0); assert.equal(n0.banner.id, 'clean'); assert.equal(n0.a, 0, 'fades in'); assert.equal(n0.slide, 1);
  assert.ok(H.bannerNow(q, B.fadeS).a >= 1 - 1e-9); assert.ok(H.bannerNow(q, B.holdS - B.fadeS / 2).a < 1, 'fades out');
  // a second one waits for the first to finish
  assert.equal(H.bannerPush(q, { id: 'f', kind: 'fastest', title: 'FASTEST LAP', sub: 'X 1:32.020' }, 1), 'now', 'fastest lap (priority 2) outranks a clean-laps banner (1)');
  assert.equal(H.bannerNow(q, 1).banner.id, 'f');
  assert.equal(H.bannerPush(q, { id: 'info', kind: 'info', title: 'HELLO' }, 1.5), 'queued', 'a lower priority waits');
  assert.equal(H.bannerNow(q, 2).banner.id, 'f');
  assert.equal(H.bannerNow(q, 1 + B.holdS + 0.01).banner.id, 'info', 'the next one starts when the first ends');
  assert.equal(H.bannerNow(q, 1 + 2 * B.holdS + 0.5), null, 'and then none');
});

test('the same banner is updated, not shown twice, and the queue is capped', () => {
  const q = H.createBanners(), B = H.HUD.banner;
  H.bannerPush(q, { id: 'w', kind: 'warning', title: 'WARNING', sub: 'TRACK LIMITS 1/3' }, 0); H.bannerNow(q, 0);
  assert.equal(H.bannerPush(q, { id: 'w', kind: 'warning', title: 'WARNING', sub: 'TRACK LIMITS 2/3' }, 1), 'same');
  assert.equal(H.bannerNow(q, 1.2).banner.sub, 'TRACK LIMITS 2/3');
  for (let i = 0; i < 9; i++) H.bannerPush(q, { id: 'i' + i, kind: 'info', title: 'I' + i }, 2 + i * 0.01);
  assert.equal(q.wait.length, B.maxQueue); assert.equal(q.wait[0].id, 'i0', 'the oldest of the same priority goes first');
  const dup = H.createBanners(); H.bannerPush(dup, { id: 'a', kind: 'info', title: 'A' }, 0); H.bannerPush(dup, { id: 'b', kind: 'info', title: 'B' }, 0); H.bannerPush(dup, { id: 'b', kind: 'info', title: 'B2' }, 1);
  assert.equal(dup.wait.filter((w) => w.id === 'b').length, 1);
});

test('a banner that waited too long is dropped, an important one is kept', () => {
  const q = H.createBanners(), B = H.HUD.banner;
  H.bannerPush(q, { id: 'a', kind: 'warning', title: 'A', hold: 10 }, 0); H.bannerNow(q, 0);
  H.bannerPush(q, { id: 'old', kind: 'info', title: 'OLD' }, 1); H.bannerPush(q, { id: 'warn', kind: 'penalty', title: 'PEN' }, 1);
  assert.equal(H.bannerNow(q, 10.1).banner.id, 'warn', 'the penalty (priority 3) is kept and shown');
  const t2 = 10.1 + B.holdS + 0.01; assert.equal(H.bannerNow(q, t2), null, 'the info banner waited more than maxWaitS and was dropped');
  const chq = H.createBanners(); H.bannerPush(chq, { id: 'c', kind: 'chequered', title: 'CHEQUERED FLAG' }, 0); H.bannerNow(chq, 0);
  assert.equal(H.bannerPush(chq, { id: 'w', kind: 'warning', title: 'W' }, 1), 'queued', 'nothing outranks the chequered flag');
});

test('banner texts: the fastest lap and the clean-lap streak', () => {
  assert.equal(H.fastestBanner(null), null); assert.equal(H.fastestBanner({ bestLap: 0 }), null);
  const b = H.fastestBanner({ name: 'Kimi', bestLap: 92.02 }); assert.equal(b.title, 'FASTEST LAP'); assert.equal(b.sub, 'Kimi  1:32.020'); assert.equal(b.kind, 'fastest');
  assert.deepEqual([1, 2, 3, 4, 5, 6, 10, 15].map((n) => !!H.cleanLapBanner(n)), [false, false, true, false, true, false, true, true]);
  assert.equal(H.cleanLapBanner(5).title, 'CLEAN LAPS x 5');
});

test('radio subtitles last longer for longer lines, the newest replaces the old, and they fade', () => {
  const sb = H.createSubs(), S = H.HUD.subtitle;
  assert.equal(H.subNow(sb, 0), null); assert.equal(H.subPush(sb, '   ', 'eng', 0), null);
  const short = H.subPush(sb, 'Box, box.', 'eng', 0), shortLen = short.end - short.start; assert.equal(shortLen, S.minS, 'short lines still stay long enough to read');
  const long = H.subPush(sb, 'Yes, yes, come on, we are on the podium! Good job this weekend, great drive, thank you!', 'eng', 10), longLen = long.end - long.start;
  assert.ok(longLen > shortLen && longLen <= S.maxS);
  assert.equal(H.subPush(sb, 'x '.repeat(100), 'eng', 20).end - 20, S.maxS, 'capped');
  H.subPush(sb, 'Final lap.', 'com', 30);
  const n = H.subNow(sb, 30.01); assert.equal(n.text, 'Final lap.'); assert.equal(n.who, 'com'); assert.ok(n.a < 0.1);
  assert.equal(H.subNow(sb, 31).a, 1); assert.ok(H.subNow(sb, 30 + S.minS - 0.05).a < 0.5);
  assert.equal(H.subNow(sb, 30 + S.minS + 0.01), null);
});

test('the minimap line is purple while your lap is the fastest, otherwise the sector colours; the finish card reads like a podium card', () => {
  const cols = ['#3ad07a', '#ffd23f', null];
  assert.deepEqual(H.sectorLine(cols, false), ['#3ad07a', '#ffd23f', null]);
  assert.deepEqual(H.sectorLine(cols, true), [H.HUD.col.purple, H.HUD.col.purple, H.HUD.col.purple]);
  assert.deepEqual(H.sectorLine(null, false), [null, null, null]);
  assert.deepEqual(H.finishCard(2, 'Kimi', 'Monaco'), { ord: '2ND', name: 'KIMI', caption: 'MONACO' });
});

test('every banner kind has a priority and a colour, and the chequered flag outranks the rest', () => {
  for (const [k, v] of Object.entries(H.HUD.kinds)) { assert.ok(v.pri >= 1, k); assert.match(v.col, /^#[0-9a-f]{6}$/i, k); }
  const max = Math.max(...Object.values(H.HUD.kinds).map((v) => v.pri)); assert.equal(H.HUD.kinds.chequered.pri, max);
});
