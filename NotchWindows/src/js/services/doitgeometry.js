// The geometry behind Do It's pen and magnifier on Windows (Ultimate): reading the pen strokes the AI asks for, filling them in so a
// drawing app sees a smooth drag, and mapping a zoomed-in view back onto the whole screen. A port of the Mac's DoItGeometry.swift, with
// the same limits. Positions are on the 0 to 1000 grid the agent uses (0,0 top left, 1000,1000 bottom right). No screen and no events
// here (and no imports), so it is tested in Node (tests/doitgeometry.test.mjs).

/// Strokes in one action, points in one stroke: enough for a graph or a few handwritten symbols, never a flood of events.
export const MAX_STROKES = 12;
export const MAX_POINTS_PER_STROKE = 80;
/// The smallest part of the view a zoom may ask for (grid units).
export const MIN_ZOOM_SPAN = 40;
export const FULL = Object.freeze({ x0: 0, y0: 0, x1: 1000, y1: 1000 });

const clamp = (v) => Math.min(Math.max(v, 0), 1000);

/// A point on a view (0 to 1000 over `view`) as the same place on the whole screen (0 to 1000).
export function toScreen(p, view = FULL) {
  return { x: view.x0 + (clamp(p.x) / 1000) * (view.x1 - view.x0), y: view.y0 + (clamp(p.y) / 1000) * (view.y1 - view.y0) };
}

/// The part of the whole screen a zoom covers when the AI names two corners on the current view. Null means "show the whole screen
/// again": no box, a box that is not really a box, or one smaller than MIN_ZOOM_SPAN in either direction.
export function zoomRegion(x0, y0, x1, y1, view = FULL) {
  const lowX = clamp(Math.min(x0, x1)), highX = clamp(Math.max(x0, x1)), lowY = clamp(Math.min(y0, y1)), highY = clamp(Math.max(y0, y1));
  if (!(highX - lowX >= MIN_ZOOM_SPAN) || !(highY - lowY >= MIN_ZOOM_SPAN)) return null;
  const a = toScreen({ x: lowX, y: lowY }, view), b = toScreen({ x: highX, y: highY }, view);
  const r = { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
  return r.x0 === 0 && r.y0 === 0 && r.x1 === 1000 && r.y1 === 1000 ? null : r;
}

function number(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') { const d = Number(v.trim()); return Number.isFinite(d) ? d : null; }
  return null;
}

function point(v) {
  if (Array.isArray(v) && v.length >= 2) { const x = number(v[0]), y = number(v[1]); return x === null || y === null ? null : { x: clamp(x), y: clamp(y) }; }
  if (v && typeof v === 'object' && !Array.isArray(v)) { const x = number(v.x), y = number(v.y); return x === null || y === null ? null : { x: clamp(x), y: clamp(y) }; }
  return null;
}

/// Strokes from what the AI sent: a list of strokes [[[x,y],[x,y]],[[x,y],...]], or one stroke [[x,y],[x,y]]. Points may be pairs or
/// {"x":..,"y":..}, numbers or numeric strings; all are kept on the grid. Strokes with fewer than two usable points are dropped, and the
/// counts are capped so one reply cannot flood the machine with mouse events.
export function strokes(raw) {
  if (!Array.isArray(raw) || !raw.length) return [];
  const candidates = point(raw[0]) ? [raw] : raw.filter(Array.isArray);
  const out = [];
  for (const stroke of candidates.slice(0, MAX_STROKES)) {
    let pts = stroke.map(point).filter(Boolean);
    if (pts.length > MAX_POINTS_PER_STROKE) {                                    // keep the shape: sample evenly, keep both ends
      const step = (pts.length - 1) / (MAX_POINTS_PER_STROKE - 1);
      const all = pts;
      pts = Array.from({ length: MAX_POINTS_PER_STROKE }, (_, i) => all[Math.round(i * step)]);
    }
    if (pts.length >= 2) out.push(pts);
  }
  return out;
}

/// Adds points along each segment so no step is longer than maxStep grid units: a drawing app then gets a smooth drag instead of a few
/// jumps (a line from corner to corner becomes dozens of small moves).
export function interpolate(pts, maxStep) {
  if (!pts.length || !(maxStep > 0)) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / maxStep));
    for (let k = 1; k <= n; k++) { const t = k / n; out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }); }
  }
  return out;
}

/// One stroke ready to send: filled in with small steps (about 300 at most, never longer than 4 grid units), and mapped onto the
/// screen in physical pixels. `view` is what the AI is looking at (the whole screen or its zoomed part); `screen` is { left, top, width, height }.
export function strokePixels(stroke, view, screen) {
  let length = 0;
  for (let i = 1; i < stroke.length; i++) length += Math.hypot(stroke[i].x - stroke[i - 1].x, stroke[i].y - stroke[i - 1].y);
  const step = Math.max(4, length / 300);
  return interpolate(stroke, step).map((p) => {
    const w = toScreen(p, view);
    return [Math.round(screen.left + (w.x / 1000) * screen.width), Math.round(screen.top + (w.y / 1000) * screen.height)];
  });
}
