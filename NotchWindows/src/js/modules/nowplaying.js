// Now Playing: what's playing on this PC (Spotify, browsers, Media Player…) with
// the cover, a progress bar you can click to seek, controls, a left/right speaker
// balance, and synced lyrics (Pro, from lrclib.net). Click the song for a
// Spotify-style lyrics view with the cover and progress. Ported from
// NowPlayingMonitor.swift / LyricsModel.swift.

import { el, load, save, fmtClock } from '../store.js';
import { canUse } from '../features.js';
import { empty, toggle, select } from '../ui.js';
import { icon } from '../icons.js';
import { proNote } from './activation.js';
import * as M from '../services/media.js';
import { invoke } from '../native.js';

export function render(root) {
  let alive = true;
  let lines = null, lyricsFor = '';

  const art = el('div', { style: 'width:190px;height:190px;border-radius:24px;flex:none;background:var(--surface);display:grid;place-items:center;font-size:60px;overflow:hidden;box-shadow:0 12px 36px color-mix(in srgb, var(--accent) 35%, transparent)' }, '🎵');
  // Clicking the song opens the lyrics view.
  const title = el('div', { class: 'big ellipsis', style: 'font-size:28px;cursor:pointer', title: 'Show the lyrics', onclick: () => setSpot(true) });
  const artist = el('div', { class: 'dim ellipsis', style: 'font-size:16px;cursor:pointer', title: 'Show the lyrics', onclick: () => setSpot(true) });

  // ---- left / right speaker balance (0 all left, 0.5 centre, 1 all right), snapping to the centre
  const balLabel = el('span', { class: 'tiny dim num', style: 'width:64px' });
  const balRange = el('input', { type: 'range', min: 0, max: 100, step: 1, value: 50, style: 'width:150px', title: 'Speaker balance: slide left to send the sound to the left speaker, right for the right' });
  const balCentre = el('button', { class: 'btn small quiet', style: 'display:none', onclick: () => setBalance(0.5) }, 'Centre');
  const balRow = el('div', { class: 'hstack small', style: 'gap:6px;display:none' }, el('span', { class: 'dim', style: 'font-weight:700' }, 'L'), balRange, el('span', { class: 'dim', style: 'font-weight:700' }, 'R'), balLabel, balCentre);
  const balText = (b) => (Math.abs(b - 0.5) < 0.01 ? 'Centre' : b <= 0.005 ? 'All left' : b >= 0.995 ? 'All right' : b < 0.5 ? `${Math.round((0.5 - b) * 200)}% left` : `${Math.round((b - 0.5) * 200)}% right`);
  function showBalance(b) { balRange.value = Math.round(b * 100); balLabel.textContent = balText(b); balCentre.style.display = Math.abs(b - 0.5) > 0.01 ? '' : 'none'; }
  function setBalance(b) { showBalance(b); invoke('audio_set', { what: 'balance', value: b, app: null }).catch(() => {}); }
  balRange.addEventListener('input', () => { let b = balRange.value / 100; if (Math.abs(b - 0.5) < 0.04) b = 0.5; setBalance(b); });
  invoke('audio_state').then((s) => { if (s?.balance_ok) { balRow.style.display = ''; showBalance(s.balance); } }).catch(() => {});
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
        el('div', { class: 'hstack', style: 'gap:10px;flex-wrap:wrap' }, prevBtn, playBtn, nextBtn, sleepSel, sleepNote,
          el('button', { class: 'icon-btn', title: 'Lyrics', onclick: () => setSpot(true) }, '❝')),
        balRow)),
    el('label', { class: 'hstack small dim', style: 'cursor:pointer' },
      toggle(load('media.pill', true), (v) => save('media.pill', v)), 'Show the cover on the closed notch while music plays'));
  // The lyrics can fill the whole notch (like the Mac's full-screen view): big centred lines, the current one in white.
  let big = load('lyrics.big', false);
  const bigBtn = el('button', { class: 'icon-btn', style: 'width:26px;height:26px', onclick: () => { big = !big; save('lyrics.big', big); lastIdx = -2; wrap.replaceChildren(...cards()); bigBtn.title = big ? 'Back to the player' : 'Lyrics fill the notch'; bigBtn.textContent = big ? '⤡' : '⤢'; paintLyrics(M.now()); } }, big ? '⤡' : '⤢');
  bigBtn.title = big ? 'Back to the player' : 'Lyrics fill the notch';
  const lyricsCard = el('div', { class: 'card col', style: 'flex:1;min-width:0;gap:6px' }, el('div', { class: 'hstack' }, el('div', { class: 'section-title grow' }, 'Lyrics'), canUse('lyrics') ? bigBtn : null), lyricBox);
  // ---- the Spotify-style lyrics view: blurred cover behind, the song with progress and controls, big lyrics
  let spot = false;
  const spotBg = el('div', { style: 'position:absolute;inset:-40px;background-size:cover;background-position:center;filter:blur(40px) saturate(1.3);opacity:.55' });
  const spotArt = el('div', { style: 'width:110px;height:110px;border-radius:14px;overflow:hidden;background:var(--surface);display:grid;place-items:center;font-size:40px;box-shadow:0 10px 30px rgba(0,0,0,.4)' }, '🎵');
  const spotTitle = el('div', { style: 'font-size:17px;font-weight:800;line-height:1.2' });
  const spotArtist = el('div', { class: 'small', style: 'opacity:.75' });
  const spotFill = el('i');
  const spotBar = el('div', { class: 'bar', style: 'height:5px;cursor:pointer' }, spotFill);
  const spotPos = el('span', { class: 'tiny num', style: 'opacity:.7' }), spotDur = el('span', { class: 'tiny num', style: 'opacity:.7' });
  const spotPlay = el('button', { class: 'icon-btn solid', title: 'Play or pause', onclick: () => M.control('toggle') }, '⏯');
  const spotLyrics = el('div', { class: 'col', style: 'flex:1;min-width:0;min-height:0;overflow:auto;gap:12px;padding:40px 4px;mask-image:linear-gradient(transparent,#000 18%,#000 82%,transparent)' });
  const spotCard = el('div', { class: 'card', style: 'flex:1;position:relative;overflow:hidden;padding:16px 18px' }, spotBg,
    el('div', { style: 'position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.2),rgba(0,0,0,.55))' }),
    el('div', { class: 'row', style: 'position:relative;height:100%;gap:22px' },
      el('div', { class: 'col', style: 'width:220px;flex:none;gap:6px' },
        el('button', { class: 'btn small quiet', style: 'align-self:flex-start', onclick: () => setSpot(false) }, '‹ Player'),
        spotArt, spotTitle, spotArtist, spotBar, el('div', { class: 'hstack' }, spotPos, el('div', { class: 'spacer' }), spotDur),
        el('div', { class: 'hstack', style: 'gap:6px' },
          el('button', { class: 'icon-btn', title: 'Previous', onclick: () => M.control('previous') }, icon('skip-back', 20, '⏮')), spotPlay,
          el('button', { class: 'icon-btn', title: 'Next', onclick: () => M.control('next') }, icon('skip-forward', 20, '⏭')))),
      spotLyrics));
  spotBar.addEventListener('click', (e) => { const m = M.now(); if (!m?.duration) return; const r = spotBar.getBoundingClientRect(); M.control('seek', ((e.clientX - r.left) / r.width) * m.duration); });
  function setSpot(on) { spot = on; lastIdx = -2; wrap.replaceChildren(...cards()); paint(M.now()); }

  // The lyrics panel only appears when lyrics are unlocked (Pro), so Free users get the full-width player, as on the Mac.
  const cards = () => (spot ? [spotCard] : canUse('lyrics') ? (big ? [lyricsCard] : [player, lyricsCard]) : [player]);
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
    if (spot) { paintSpot(m); return; }
    if (!canUse('lyrics')) { lyricBox.replaceChildren(proNote('lyrics', 'Synced lyrics that scroll with the song.')); return; }
    if (lines === undefined) { lyricBox.replaceChildren(el('div', { class: 'small dim' }, 'Looking for lyrics…')); return; }
    if (!lines) { lyricBox.replaceChildren(el('div', { class: 'small dim' }, 'No lyrics found for this song.')); return; }
    const synced = lines[0]?.t !== null;
    const idx = synced ? lines.findLastIndex((l) => l.t <= (m?.position ?? 0) + 0.3) : -1;
    if (lyricBox.childElementCount && idx === lastIdx) return;
    lastIdx = idx;
    lyricBox.replaceChildren(...lines.map((l, i) => el('div', {
      style: `font-size:${big ? (i === idx ? 30 : 22) : (i === idx ? 15 : 13)}px;font-weight:${i === idx ? 700 : 500};color:${i === idx ? 'var(--text)' : 'var(--text-dim)'};${big ? 'text-align:center;line-height:1.3;' : ''}transition:all .2s;${l.t !== null ? 'cursor:pointer' : ''}`,
      onclick: () => l.t !== null && M.control('seek', l.t),
    }, l.line || '♪')));
    const cur = lyricBox.children[idx];
    if (cur) lyricBox.scrollTop = cur.offsetTop - lyricBox.offsetTop - lyricBox.clientHeight / 2 + 20;
  }

  /// The lyrics side of the Spotify-style view: big bold lines, the current one white, the rest faded.
  function paintSpot(m) {
    const say = (t) => spotLyrics.replaceChildren(el('div', { style: 'font-size:18px;font-weight:800;opacity:.75' }, t));
    if (!canUse('lyrics')) { spotLyrics.replaceChildren(el('div', { style: 'font-size:18px;font-weight:800' }, 'Synced lyrics are part of Pro'), proNote('lyrics', 'They scroll with the song, line by line. The cover, progress and controls here are free.')); lastIdx = -3; return; }
    if (lines === undefined) return say('Looking for lyrics…');
    if (!lines) return say('No lyrics found for this song.');
    const synced = lines[0]?.t !== null;
    const idx = synced ? lines.findLastIndex((l) => l.t <= (m?.position ?? 0) + 0.3) : -1;
    if (spotLyrics.childElementCount && idx === lastIdx) return;
    lastIdx = idx;
    spotLyrics.replaceChildren(...lines.map((l, i) => el('div', {
      style: `font-size:${i === idx ? 24 : 20}px;font-weight:800;line-height:1.25;color:#fff;opacity:${i === idx ? 1 : i < idx ? 0.5 : 0.32};transition:all .25s;${l.t !== null ? 'cursor:pointer' : ''}`,
      onclick: () => l.t !== null && M.control('seek', l.t),
    }, l.line || '♪')));
    const cur = spotLyrics.children[idx];
    if (cur) spotLyrics.scrollTo({ top: cur.offsetTop - spotLyrics.clientHeight / 2 + 20, behavior: 'smooth' });
  }

  function paint(m) {
    if (!m) {
      wrap.replaceChildren(el('div', { class: 'card', style: 'flex:1' }, empty('🎵', 'Nothing playing', 'Play something in Spotify, a browser, Media Player or any music app and it appears here, with controls.')));
      lyricsFor = '';
      return;
    }
    const shown = cards();
    if (shown.length !== wrap.children.length || shown.some((c) => !wrap.contains(c))) wrap.replaceChildren(...shown);
    // Only swap the cover when it changes (this runs twice a second).
    if (art.dataset.src !== (m.art || '')) {
      art.dataset.src = m.art || '';
      art.replaceChildren(m.art ? el('img', { src: m.art, style: 'width:100%;height:100%;object-fit:cover' }) : '🎵');
    }
    if (spot) {
      if (spotArt.dataset.src !== (m.art || '')) {
        spotArt.dataset.src = m.art || '';
        spotArt.replaceChildren(m.art ? el('img', { src: m.art, style: 'width:100%;height:100%;object-fit:cover' }) : '🎵');
        spotBg.style.backgroundImage = m.art ? `url("${m.art}")` : 'linear-gradient(135deg, var(--accent), var(--accent-bright))';
      }
      spotTitle.textContent = m.title; spotArtist.textContent = m.artist || '';
      spotFill.style.width = m.duration ? `${(m.position / m.duration) * 100}%` : '0%';
      spotPos.textContent = fmtClock(m.position); spotDur.textContent = m.duration ? `-${fmtClock(Math.max(0, m.duration - m.position))}` : '';
      spotPlay.textContent = m.playing ? '⏸' : '▶';
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
