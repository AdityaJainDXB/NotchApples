// Now Playing: what's playing on this PC (Spotify, browsers, Media Player…) with
// the cover, a progress bar you can click to seek, controls, and synced lyrics
// (Pro, from lrclib.net). Ported from NowPlayingMonitor.swift / LyricsModel.swift.

import { el, load, save, fmtClock } from '../store.js';
import { canUse } from '../features.js';
import { empty, toggle, select } from '../ui.js';
import { icon } from '../icons.js';
import { proNote } from './activation.js';
import * as M from '../services/media.js';

export function render(root) {
  let alive = true;
  let lines = null, lyricsFor = '';

  const art = el('div', { style: 'width:190px;height:190px;border-radius:24px;flex:none;background:var(--surface);display:grid;place-items:center;font-size:60px;overflow:hidden;box-shadow:0 12px 36px color-mix(in srgb, var(--accent) 35%, transparent)' }, '🎵');
  const title = el('div', { class: 'big ellipsis', style: 'font-size:28px' });
  const artist = el('div', { class: 'dim ellipsis', style: 'font-size:16px' });
  const source = el('div', { class: 'caps ellipsis' });
  const fill = el('i');
  const bar = el('div', { class: 'bar', style: 'height:8px;cursor:pointer' }, fill);
  const pos = el('span', { class: 'small num dim' }), dur = el('span', { class: 'small num dim' });
  const playBtn = el('button', { class: 'icon-btn big solid', title: 'Play or pause', onclick: () => M.control('toggle') }, icon('pause', 22, '⏸'));
  const prevBtn = el('button', { class: 'icon-btn big', title: 'Previous', onclick: () => M.control('previous') }, icon('skip-back', 24, '⏮'));
  const nextBtn = el('button', { class: 'icon-btn big', title: 'Next', onclick: () => M.control('next') }, icon('skip-forward', 24, '⏭'));
  // Sleep timer: pause the music after a while (only if something is playing).
  const sleepNote = el('span', { class: 'tiny dim num' });
  const sleepSel = select([0, 15, 30, 45, 60, 90].map((n) => ({ value: n, label: n ? `Pause in ${n} min` : 'Sleep timer' })), 0, (v) => { Number(v) ? M.startSleepTimer(Number(v)) : M.cancelSleepTimer(); }, { cls: 'auto', title: 'Pause the music after a while' });
  const lyricBox = el('div', { class: 'col scroll', style: 'flex:1;min-height:0;gap:6px;padding-right:4px' });
  const player = el('div', { class: 'card col', style: 'flex:1.7;min-width:0;gap:10px' },
    el('div', { class: 'hstack', style: 'gap:20px;align-items:center;flex:1' }, art,
      el('div', { class: 'col grow', style: 'gap:6px;min-width:0' }, source, title, artist,
        el('div', { style: 'height:8px' }),
        bar, el('div', { class: 'hstack' }, pos, el('div', { class: 'spacer' }), dur),
        el('div', { class: 'hstack', style: 'gap:10px;flex-wrap:wrap' }, prevBtn, playBtn, nextBtn, sleepSel, sleepNote))),
    el('label', { class: 'hstack small dim', style: 'cursor:pointer' },
      toggle(load('media.pill', true), (v) => save('media.pill', v)), 'Show the cover on the closed notch while music plays'));
  const lyricsCard = el('div', { class: 'card col', style: 'flex:1;min-width:0;gap:6px' }, el('div', { class: 'section-title' }, 'Lyrics'), lyricBox);
  // The lyrics panel only appears when lyrics are unlocked (Pro), so Free users get the full-width player, as on the Mac.
  const cards = () => (canUse('lyrics') ? [player, lyricsCard] : [player]);
  const wrap = el('div', { class: 'row fill', style: 'gap:16px' }, ...cards());
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
    if (!wrap.contains(player) || wrap.contains(lyricsCard) !== canUse('lyrics')) wrap.replaceChildren(...cards());
    // Only swap the cover when it changes (this runs twice a second).
    if (art.dataset.src !== (m.art || '')) {
      art.dataset.src = m.art || '';
      art.replaceChildren(m.art ? el('img', { src: m.art, style: 'width:100%;height:100%;object-fit:cover' }) : '🎵');
    }
    const left = M.sleepLeft();
    sleepNote.textContent = left ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : '';
    if (!left && sleepSel.value !== '0') sleepSel.value = '0';
    title.textContent = m.title;
    artist.textContent = [m.artist, m.album].filter(Boolean).join(' — ');
    source.textContent = M.appName(m.app) ? `Now playing · ${M.appName(m.app)}` : 'Now playing';
    const want = m.playing ? 'pause' : 'play';
    if (playBtn.dataset.k !== want) { playBtn.dataset.k = want; playBtn.replaceChildren(icon(want, 22, m.playing ? '⏸' : '▶')); }
    prevBtn.disabled = !m.can_previous; nextBtn.disabled = !m.can_next;
    fill.style.width = m.duration ? `${(m.position / m.duration) * 100}%` : '0%';
    pos.textContent = fmtClock(m.position); dur.textContent = m.duration ? `-${fmtClock(Math.max(0, m.duration - m.position))}` : '';
    loadLyrics(m);
    paintLyrics(m);
  }

  const unsub = M.subscribe(paint);
  const t = setInterval(() => paint(M.now()), 500);
  return () => { alive = false; unsub(); clearInterval(t); };
}
