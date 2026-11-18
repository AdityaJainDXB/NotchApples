// The page inside a Voxel Wall window ("voxel.html?mode=saver|wallpaper"): draws the scene and the lyrics the main window sends
// ('voxel-state' events). In the screensaver, any key, click or real mouse move asks the main window to close it.
import { startScene } from './games/voxelwall-gl.js';
import { PALETTES, simulatedLevels, easeBands } from './services/voxelwalllogic.js';

const mode = new URLSearchParams(location.search).get('mode') || 'saver';
const T = window.__TAURI__;
let st = { scene: 0, palette: 'ocean', intensity: 1, speed: 1, playing: false, words: [], lyricMode: 'words', title: '', artist: '' };
let bands = [0, 0, 0, 0];
let live = null;   // the real sound's four bands from the main window (WASAPI loopback), or null
const verse = document.getElementById('verse'), np = document.getElementById('np'), hint = document.getElementById('hint');
const rgb = (a) => `rgb(${a.map((x) => Math.round(x * 255)).join(',')})`;

startScene(document.getElementById('c'), (t) => {
  bands = easeBands(bands, live && !st.energySaver ? live : simulatedLevels(t, st.playing || st.energySaver));
  return { scene: st.scene, palette: (PALETTES[st.palette] || PALETTES.ocean).colours, bands, intensity: st.intensity, speed: st.speed };
});

function paint() {
  const accent = rgb((PALETTES[st.palette] || PALETTES.ocean).colours[1]);
  verse.className = st.lyricMode === 'lines' ? 'lines' : '';
  const words = st.lyricMode === 'off' ? [] : st.words;
  verse.replaceChildren(...words.map((w, i) => {
    const s = document.createElement('span'); s.textContent = w; s.className = i === words.length - 1 ? 'new' : 'old';
    s.style.color = accent; s.style.textShadow = `0 0 30px ${accent}`; return s;
  }));
  np.innerHTML = '';
  if (st.title) { const b = document.createElement('b'); b.textContent = st.title; const a = document.createElement('span'); a.textContent = st.artist || ''; np.append(b, a); }
}

if (T) {
  T.event.listen('voxel-state', (e) => { st = { ...st, ...(e.payload || {}) }; paint(); });
  T.event.listen('voxel-levels', (e) => { live = e.payload?.live ? e.payload.bands : null; });
  T.event.emit('voxel-ready', { mode }).catch(() => {});
}
if (mode === 'saver') {
  hint.textContent = 'Press any key or move the mouse to exit';
  setTimeout(() => { hint.style.opacity = 0; }, 3000);
  const started = Date.now();
  let moved = 0;
  const exit = () => { if (Date.now() - started > 1000 && T) T.event.emit('voxel-exit', {}).catch(() => {}); };
  addEventListener('keydown', exit); addEventListener('mousedown', exit); addEventListener('wheel', exit);
  addEventListener('mousemove', (e) => { moved += Math.abs(e.movementX) + Math.abs(e.movementY); if (moved > 12) exit(); });
}
