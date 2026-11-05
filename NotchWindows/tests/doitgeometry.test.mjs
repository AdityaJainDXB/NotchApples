// Do It's pen and magnifier maths on Windows (services/doitgeometry.js, a port of the Mac's DoItGeometry.swift). The cases are the Mac's,
// from DoItGeometryTests. Run: node --test NotchWindows/tests/doitgeometry.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './load.mjs';

const G = await loadModule('services/doitgeometry.js');
const near = (a, b, e = 0.001) => assert.ok(Math.abs(a - b) <= e, `${a} is not near ${b}`);

test('a zoomed view maps back onto the whole screen', () => {
  const view = { x0: 200, y0: 400, x1: 600, y1: 800 };
  const p = G.toScreen({ x: 500, y: 250 }, view);
  near(p.x, 400); near(p.y, 500);
  assert.deepEqual(G.toScreen({ x: 1000, y: 1000 }, view), { x: 600, y: 800 });
  assert.deepEqual(G.toScreen({ x: 5000, y: -3 }), { x: 1000, y: 0 }, 'out of range stays on the screen');
});

test('zoom regions compose, and tiny or full boxes reset the view', () => {
  const first = G.zoomRegion(100, 100, 600, 500);
  assert.deepEqual(first, { x0: 100, y0: 100, x1: 600, y1: 500 });
  const second = G.zoomRegion(0, 0, 500, 500, first);
  assert.deepEqual(second, { x0: 100, y0: 100, x1: 350, y1: 300 });
  assert.deepEqual(G.zoomRegion(600, 500, 100, 100), first, 'corners may come in either order');
  assert.equal(G.zoomRegion(0, 0, 0, 0), null, 'no box means look at everything again');
  assert.equal(G.zoomRegion(300, 300, 320, 900), null, 'a sliver is not a zoom');
  assert.equal(G.zoomRegion(0, 0, 1000, 1000), null);
  assert.equal(G.zoomRegion(NaN, 0, 500, 500), null);
});

test('strokes are read from the shapes an AI actually sends', () => {
  const many = G.strokes(JSON.parse('[[[100,100],[200,200]],[[300,300],[400,300],[500,350]]]'));
  assert.equal(many.length, 2); assert.equal(many[1].length, 3);
  const one = G.strokes([[10, 20], [30, 40], [50, 60]]);
  assert.equal(one.length, 1, 'a bare list of points is one stroke');
  assert.deepEqual(one[0][2], { x: 50, y: 60 });
  assert.deepEqual(G.strokes([[{ x: 1, y: 2 }, { x: '30', y: '40.5' }]]), [[{ x: 1, y: 2 }, { x: 30, y: 40.5 }]], 'objects and numeric strings work');
});

test('coordinates 0 and 1 survive and out of range ones are clamped', () => {
  assert.deepEqual(G.strokes([[0, 0], [1, 1], [1500, -20]]), [[{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 1000, y: 0 }]]);
});

test('bad or huge input never gets past', () => {
  assert.deepEqual(G.strokes(null), []); assert.deepEqual(G.strokes('not a list'), []); assert.deepEqual(G.strokes([]), []);
  assert.deepEqual(G.strokes([[[5, 5]]]), [], 'one point is not a stroke');
  assert.deepEqual(G.strokes([[['a', 'b'], [null, 1]]]), []);
  assert.deepEqual(G.strokes([[true, false], [true, true]]), [], 'booleans are not coordinates');
  assert.equal(G.strokes(Array.from({ length: 40 }, () => [[0, 0], [10, 10]])).length, G.MAX_STROKES);
  const long = G.strokes([Array.from({ length: 500 }, (_, i) => [i % 1000, i % 700])]);
  assert.equal(long.length, 1); assert.equal(long[0].length, G.MAX_POINTS_PER_STROKE);
  assert.deepEqual(long[0][0], { x: 0, y: 0 }, 'the ends of a long stroke are kept');
  assert.deepEqual(long[0].at(-1), { x: 499, y: 499 });
});

test('a drag is filled in so no step is long', () => {
  const line = G.interpolate([{ x: 0, y: 0 }, { x: 300, y: 400 }], 10);
  assert.equal(line.length, 51, '500 units in steps of 10, plus the start');
  assert.deepEqual(line[0], { x: 0, y: 0 });
  near(line.at(-1).x, 300, 1e-4); near(line.at(-1).y, 400, 1e-4);
  for (let i = 1; i < line.length; i++) assert.ok(Math.hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y) < 10.0001);
  const corner = G.interpolate([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], 25);
  assert.ok(corner.some((p) => p.x === 100 && p.y === 0), 'the corner itself is kept');
  assert.deepEqual(G.interpolate([{ x: 5, y: 5 }], 10), [{ x: 5, y: 5 }]);
  assert.equal(G.interpolate([{ x: 5, y: 5 }, { x: 5, y: 5 }], 10).length, 2, 'a dot stays a dot');
});

test('a stroke becomes screen pixels, through a zoomed view, in small steps', () => {
  const screen = { left: 0, top: 0, width: 2000, height: 1000 };
  const px = G.strokePixels([{ x: 0, y: 0 }, { x: 1000, y: 1000 }], G.FULL, screen);
  assert.deepEqual(px[0], [0, 0]); assert.deepEqual(px.at(-1), [2000, 1000]);
  assert.ok(px.length <= 302 && px.length > 100, `about 300 steps, got ${px.length}`);
  const zoomed = G.strokePixels([{ x: 0, y: 0 }, { x: 1000, y: 1000 }], { x0: 500, y0: 500, x1: 750, y1: 750 }, screen);
  assert.deepEqual(zoomed[0], [1000, 500]); assert.deepEqual(zoomed.at(-1), [1500, 750]);
  const short = G.strokePixels([{ x: 100, y: 100 }, { x: 120, y: 100 }], G.FULL, { left: 100, top: 50, width: 1000, height: 1000 });
  assert.deepEqual(short[0], [200, 150], 'the screen offset (a second monitor) is added');
  assert.ok(short.length >= 5 && short.length <= 6, 'a short line still moves in steps of about 4 units');
});
