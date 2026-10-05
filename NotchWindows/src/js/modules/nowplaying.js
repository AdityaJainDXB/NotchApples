// Now Playing: what's playing on this PC (Spotify, browsers, Media Player…) with
// the cover, a progress bar you can click to seek, controls, and synced lyrics
// (Pro, from lrclib.net). Ported from NowPlayingMonitor.swift / LyricsModel.swift.

import { el, load, save, fmtClock } from '../store.js';
import { canUse } from '../features.js';
import { empty, toggle } from '../ui.js';
import { proNote } from './activation.js';
import * as M from '../services/media.js';

export function render(root) {
  let alive = true;
  let lines = null, lyricsFor = '';

  const art = el('div', { style: 'width:150px;height:150px;border-radius:14px;flex:none;background:var(--surface);display:grid;place-items:center;font-size:52px;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,.4)' }, '🎵');
  const title = el('div', { class: 'title ellipsis', style: 'font-size:18px' });
  const artist = el('div', { class: 'dim ellipsis' });
  const source = el('div', { class: 'tiny faint ellipsis' });
  const fill = el('i');
  const bar = el('div', { class: 'bar', style: 'height:6px;cursor:pointer' }, fill);
  const pos = el('span', { class: 'tiny num dim' }), dur = el('span', { class: 'tiny num dim' });
  const playBtn = el('button', { class: 'icon-btn big solid', title: 'Play or pause', onclick: () => M.control('toggle') }, '⏯');
  const prevBtn = el('button', { class: 'icon-btn big', title: 'Previous', onclick: () => M.control('previous') }, '⏮');
  const nextBtn = el('button', { class: 'icon-btn big', title: 'Next', onclick: () => M.control('next') }, '⏭');
  const lyricBox = el('div', { class: 'col scroll', style: 'flex:1;min-height:0;gap:6px;padding-right:4px' });
  const player = el('div', { class: 'card col', style: 'flex:1;min-width:0;gap:10px' },
    el('div', { class: 'hstack', style: 'gap:16px;align-items:flex-start' }, art,
      el('div', { class: 'col grow', style: 'gap:4px;min-width:0' }, title, artist, source,
        el('div', { style: 'flex:1;min-height:30px' }),
        bar, el('div', { class: 'hstack' }, pos, el('div', { class: 'spacer' }), dur),
        el('div', { class: 'hstack', style: 'justify-content:center;gap:14px' }, prevBtn, playBtn, nextBtn))),
    el('label', { class: 'hstack small dim', style: 'cursor:pointer' },
      toggle(load('media.pill', true), (v) => save('media.pill', v)), 'Show the cover on the closed notch while music plays'));
  const lyricsCard = el('div', { class: 'card col', style: 'flex:1;min-width:0;gap:6px' }, el('div', { class: 'section-title' }, 'Lyrics'), lyricBox);
  const wrap = el('div', { class: 'row fill' }, player, lyricsCard);
  root.append(wrap);

  bar.addEventListener('click', (e) => {
    const m = M.now();
    if (!m?.duration) return;
    const r = bar.getBoundingClientRect();
    M.control('seek', ((e.clientX - r.left) / r.width) * m.duration);
  });

  async function loadLyrics(m) {
    const key = `${m.artist}|${m.title}`;
    if (key === lyricsFor) return;
    lyricsFor = key; lines = undefined;
    paintLyrics(m);
    const found = await M.lyrics(m);
    if (!alive || lyricsFor !== key) return;
    lines = found;
    paintLyrics(m);
  }

  let lastIdx = -1;
  function paintLyrics(m) {
    if (!canUse('lyrics')) { lyricBox.replaceChildren(proNote('lyrics', 'Synced lyrics that scroll with the song.')); return; }
    if (lines === undefined) { lyricBox.replaceChildren(el('div', { class: 'small dim' }, 'Looking for lyrics…')); return; }
    if (!lines) { lyricBox.replaceChildren(el('div', { class: 'small dim' }, 'No lyrics found for this song.')); return; }
    const synced = lines[0]?.t !== null;
    const idx = synced ? lines.findLastIndex((l) => l.t <= (m?.position ?? 0) + 0.3) : -1;
    if (lyricBox.childElementCount && idx === lastIdx) return;
    lastIdx = idx;
    lyricBox.replaceChildren(...lines.map((l, i) => el('div', {
      style: `font-size:${i === idx ? 15 : 13}px;font-weight:${i === idx ? 700 : 500};color:${i === idx ? 'var(--text)' : 'var(--text-dim)'};transition:all .2s;${l.t !== null ? 'cursor:pointer' : ''}`,
      onclick: () => l.t !== null && M.control('seek', l.t),
    }, l.line || '♪')));
    const cur = lyricBox.children[idx];
    if (cur) lyricBox.scrollTop = cur.offsetTop - lyricBox.offsetTop - lyricBox.clientHeight / 2 + 20;
  }

  function paint(m) {
    if (!m) {
      wrap.replaceChildren(el('div', { class: 'card', style: 'flex:1' }, empty('🎵', 'Nothing playing', 'Play something in Spotify, a browser, Media Player or any music app and it appears here, with controls.')));
      lyricsFor = '';
      return;
    }
    if (!wrap.contains(player)) wrap.replaceChildren(player, lyricsCard);
    // Only swap the cover when it changes (this runs twice a second).
    if (art.dataset.src !== (m.art || '')) {
      art.dataset.src = m.art || '';
      art.replaceChildren(m.art ? el('img', { src: m.art, style: 'width:100%;height:100%;object-fit:cover' }) : '🎵');
    }
    title.textContent = m.title;
    artist.textContent = [m.artist, m.album].filter(Boolean).join(' — ');
    source.textContent = M.appName(m.app) ? `Playing in ${M.appName(m.app)}` : '';
    playBtn.textContent = m.playing ? '⏸' : '▶';
    prevBtn.disabled = !m.can_previous; nextBtn.disabled = !m.can_next;
    fill.style.width = m.duration ? `${(m.position / m.duration) * 100}%` : '0%';
    pos.textContent = fmtClock(m.position); dur.textContent = m.duration ? fmtClock(m.duration) : '';
    loadLyrics(m);
    paintLyrics(m);
  }

  const unsub = M.subscribe(paint);
  const t = setInterval(() => paint(M.now()), 500);
  return () => { alive = false; unsub(); clearInterval(t); };
}
