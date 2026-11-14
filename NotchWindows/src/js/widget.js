// The page inside one desktop widget window ("widget.html?kind=clock|todo|nowplaying"). It only draws what the main
// window sends it (the to-do list and the song), and the clock draws itself. Nothing is fetched; nothing is sent anywhere.

import { nowPlayingText, todoLines } from './services/desktopwidgetlogic.js';

const kind = new URLSearchParams(location.search).get('kind') || 'clock';
const card = document.getElementById('card');
const T = window.__TAURI__;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function drawClock() {
  const d = new Date();
  card.innerHTML = `<div class="big">${esc(d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}</div><div class="small dim">${esc(d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }))}</div>`;
}
function drawTodo(items) {
  const r = todoLines(items);
  card.innerHTML = `<div class="small dim">To-do</div>${r.shown.length ? r.shown.map((t) => `<div class="t">\u25cb ${esc(t.text)}</div>`).join('') : '<div class="t">All done</div>'}${r.more ? `<div class="small dim">+${r.more} more</div>` : ''}`;
}
function drawNow(m) {
  const t = nowPlayingText(m?.title, m?.artist, !!m?.playing);
  card.innerHTML = `<div class="np"><div style="font-size:22px" class="dim">\u266a</div><div style="min-width:0"><div class="a">${esc(t.line1)}</div>${t.line2 ? `<div class="small dim t">${esc(t.line2)}</div>` : ''}</div></div>`;
}

if (kind === 'clock') { drawClock(); setInterval(drawClock, 1000); }
else if (kind === 'todo') { drawTodo([]); }
else { drawNow(null); }

if (T) {
  T.event.listen('widget-data', (e) => {
    const p = e.payload || {};
    if (kind === 'todo' && p.todo) drawTodo(p.todo);
    if (kind === 'nowplaying' && 'media' in p) drawNow(p.media);
  });
  // The main window answers with the current state, so a new widget never starts blank.
  T.event.emit('widget-ready', { kind }).catch(() => {});
}
