// Flight Radar: you in the middle of a round scope, north up, with every aircraft around you as a little plane
// pointing the way it is flying, coloured by height. Click one (on the scope or in the list) for its details.
// Data and rules: services/radar.js and services/radarlogic.js.

import { el } from '../store.js';
import { segmented, iconBtn, toggle, empty } from '../ui.js';
import * as R from '../services/radar.js';
import * as L from '../services/radarlogic.js';

const COLOURS = { ground: '#9aa0a8', low: '#3ddc84', mid: '#ffd84a', high: '#4fd6ff' };

export function render(root) {
  let selected = null;
  const canvas = el('canvas', { style: 'width:100%;height:100%;display:block;cursor:crosshair' });
  const title = el('div', { class: 'small dim' }, 'Looking for aircraft…');
  const list = el('div', { class: 'col', style: 'gap:4px;overflow:auto;flex:1;min-height:0' });
  const status = el('div', { class: 'small faint' });
  const err = el('div', { class: 'small warn' });
  const box = el('div', { style: 'flex:1;min-height:0;position:relative' }, canvas);
  const visible = () => R.get().aircraft.filter((a) => R.showGround() || !a.onGround);

  const left = el('div', { class: 'card col', style: 'flex:1.6;min-width:0;gap:8px;padding:12px 14px' },
    el('div', { class: 'hstack' },
      el('div', { class: 'grow' }, el('div', { style: 'font-weight:800;font-size:15px' }, '✈️ Flight Radar'), title),
      segmented(L.RANGES.map((v) => ({ value: v, label: `${v} nm` })), R.range(), (v) => { R.setRange(v); R.refresh(); }),
      iconBtn('⟳', 'Refresh', () => R.refresh())),
    box,
    el('div', { class: 'hstack small' },
      ...[['low', 'under 5,000 ft'], ['mid', 'to FL180'], ['high', 'above']].map(([k, t]) => el('span', {}, el('span', { style: `color:${COLOURS[k]}` }, '● '), t)),
      el('div', { class: 'spacer' }), el('span', { class: 'dim' }, 'On the ground'), toggle(R.showGround(), (v) => { R.setShowGround(v); draw(); paintList(); })),
    err);
  const right = el('div', { class: 'card col', style: 'flex:1;min-width:0;gap:6px;padding:12px 14px' },
    el('div', { class: 'hstack' }, el('div', { class: 'grow', style: 'font-weight:700' }, 'Nearby'), status), list);
  root.append(el('div', { class: 'row fill' }, left, right));

  function colour(a) { return COLOURS[L.band(a.altitudeFt, a.onGround)]; }
  function geometry() {
    const r = canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const side = Math.min(r.width, r.height), radius = side / 2 - 14;
    return { ctx: canvas.getContext('2d'), dpr, cx: r.width / 2, cy: r.height / 2, radius, w: r.width, h: r.height };
  }
  const screen = (g, a) => { const p = L.position(a.distanceNM, a.bearing, R.range()); return { x: g.cx + p.x * g.radius, y: g.cy + p.y * g.radius }; };

  function draw() {
    const g = geometry(), { ctx } = g;
    ctx.setTransform(g.dpr, 0, 0, g.dpr, 0, 0); ctx.clearRect(0, 0, g.w, g.h);
    ctx.lineWidth = 1; ctx.font = '10px system-ui'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for (const f of [1 / 3, 2 / 3, 1]) {
      ctx.strokeStyle = `rgba(255,255,255,${f === 1 ? 0.35 : 0.15})`; ctx.beginPath(); ctx.arc(g.cx, g.cy, g.radius * f, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.4)'; ctx.fillText(`${Math.round(R.range() * f)} nm`, g.cx + 4, g.cy - g.radius * f + 7);
    }
    ctx.strokeStyle = 'rgba(255,255,255,.1)'; ctx.beginPath(); ctx.moveTo(g.cx - g.radius, g.cy); ctx.lineTo(g.cx + g.radius, g.cy); ctx.moveTo(g.cx, g.cy - g.radius); ctx.lineTo(g.cx, g.cy + g.radius); ctx.stroke();
    ctx.fillStyle = '#b79cff'; ctx.font = '700 11px system-ui'; ctx.textAlign = 'center'; ctx.fillText('N', g.cx, g.cy - g.radius - 7);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(g.cx, g.cy, 4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.beginPath(); ctx.arc(g.cx, g.cy, 8, 0, Math.PI * 2); ctx.stroke();
    for (const a of [...visible()].reverse()) {
      const p = screen(g, a), sel = selected === a.id, k = sel ? 1.5 : 1;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(a.track * Math.PI / 180); ctx.scale(k, k);
      ctx.fillStyle = colour(a); ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6); ctx.closePath(); ctx.fill(); ctx.restore();
      if (sel) {
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.x, p.y, 12, 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 1;
        ctx.fillStyle = '#fff'; ctx.font = '700 11px system-ui'; ctx.textAlign = 'center'; ctx.fillText(a.callsign, p.x, p.y - 21);
      }
    }
  }

  canvas.onclick = (e) => {
    const g = geometry(), r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    let best = null, bd = 22;
    for (const a of visible()) { const p = screen(g, a), d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = a; } }
    selected = best ? best.id : null; draw(); paintList();
  };

  function paintList() {
    const items = visible();
    if (!items.length) {
      const s = R.get();
      list.replaceChildren(empty('🛫', s.loading || !s.updated ? 'Looking for aircraft…' : `No aircraft within ${R.range()} nm`,
        'Try a bigger range. Your position is rounded to about 1 km before it is sent to adsb.lol.'));
      return;
    }
    list.replaceChildren(...items.map((a) => {
      const on = selected === a.id;
      return el('button', { class: `list-row${on ? ' active' : ''}`, style: `text-align:left;display:block;border-radius:8px;padding:5px 8px;border:0;color:inherit;background:${on ? 'rgba(158,107,255,.3)' : 'rgba(255,255,255,.06)'}`,
        onclick: () => { selected = on ? null : a.id; draw(); paintList(); } },
        el('div', { class: 'hstack' }, el('b', { class: 'grow', style: 'font-size:12px' }, a.callsign), el('span', { style: `font-weight:600;color:${colour(a)}` }, L.altitudeLabel(a.altitudeFt, a.onGround))),
        el('div', { class: 'small dim' }, `${L.typeName(a.type)} · ${a.speedKt} kt · ${Math.round(a.distanceNM)} nm ${L.compass(a.bearing)}`),
        on ? el('div', { class: 'small' }, `${a.registration || '—'} · heading ${Math.round(a.track)}° ${L.compass(a.track)} · ${a.climbFpm === 0 ? 'level' : a.climbFpm > 0 ? `climbing ${a.climbFpm} fpm` : `descending ${-a.climbFpm} fpm`}`) : null);
    }));
  }

  const stop = R.watch((s) => {
    const p = s.place;
    title.textContent = p ? `Near ${p.name || 'you'} · ${visible().length} aircraft` : 'Looking for aircraft…';
    status.textContent = s.loading ? 'Updating…' : s.updated ? `Updated ${new Date(s.updated).toLocaleTimeString()}` : '';
    err.textContent = s.error || '';
    draw(); paintList();
  });
  const onResize = () => draw();
  window.addEventListener('resize', onResize);
  setTimeout(draw, 50);
  return () => { stop(); window.removeEventListener('resize', onResize); };
}
