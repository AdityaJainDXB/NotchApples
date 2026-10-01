// Colour themes, ported from the macOS app's AppTheme.swift so both platforms
// look the same. Each theme sets CSS custom properties on <html>.

export const THEMES = [
  { id: 'notch_purple',       name: 'Notch Purple',        category: 'Classic',
    bg: '#0d0519', surface: 'rgba(255,255,255,.07)', primary: '#9e6bff', secondary: '#c79eff',
    text: '#ffffff', border: 'rgba(255,255,255,.10)', glow: 'rgba(158,107,255,.35)', end: '#38176b' },
  { id: 'oled_obsidian',      name: 'OLED Obsidian',       category: 'Minimal & Premium',
    bg: '#000000', surface: 'rgba(255,255,255,.06)', primary: '#ffffff', secondary: '#8e8e93',
    text: '#ffffff', border: 'rgba(255,255,255,.12)', glow: 'rgba(255,255,255,.15)', end: '#1a1a1a' },
  { id: 'graphite_titanium',  name: 'Graphite & Titanium', category: 'Minimal & Premium',
    bg: '#1e1e24', surface: '#2a2a32', primary: '#007aff', secondary: '#5e5ce6',
    text: '#f2f2f7', border: '#3a3a46', glow: 'rgba(0,122,255,.25)', end: '#23304a' },
  { id: 'tokyo_midnight',     name: 'Tokyo Midnight',      category: 'Cyberpunk & Neon',
    bg: '#0b0c10', surface: '#1f2833', primary: '#66fcf1', secondary: '#45a29e',
    text: '#c5c6c7', border: 'rgba(69,162,158,.4)', glow: 'rgba(255,0,85,.5)', end: '#17403f' },
  { id: 'synthwave_dusk',     name: 'Synthwave Dusk',      category: 'Cyberpunk & Neon',
    bg: '#12092b', surface: '#241442', primary: '#ff71ce', secondary: '#01cdfe',
    text: '#f2ebf9', border: 'rgba(255,113,206,.35)', glow: 'rgba(5,255,161,.4)', end: '#4a2352' },
  { id: 'matrix_green',       name: 'Matrix Green',        category: 'Cyberpunk & Neon',
    bg: '#050b05', surface: '#0d1f0d', primary: '#00ff66', secondary: '#4caf50',
    text: '#e0ffe0', border: '#1b431c', glow: 'rgba(0,255,102,.3)', end: '#0d3a1b' },
  { id: 'nordic_dusk',        name: 'Nordic Dusk',         category: 'Dark & Cozy',
    bg: '#2e3440', surface: '#3b4252', primary: '#88c0d0', secondary: '#ebcb8b',
    text: '#eceff4', border: '#434c5e', glow: 'rgba(136,192,208,.25)', end: '#3c505c' },
  { id: 'dracula_void',       name: 'Dracula Void',        category: 'Dark & Cozy',
    bg: '#282a36', surface: '#343746', primary: '#ff79c6', secondary: '#bd93f9',
    text: '#f8f8f2', border: '#44475a', glow: 'rgba(139,233,253,.3)', end: '#49364a' },
  { id: 'espresso_mocha',     name: 'Espresso & Mocha',    category: 'Dark & Cozy',
    bg: '#1e1e1e', surface: '#2d2a2e', primary: '#ffd866', secondary: '#ff6188',
    text: '#fcfcfa', border: '#403e41', glow: 'rgba(255,216,102,.25)', end: '#4a4330' },
  { id: 'deep_forest',        name: 'Deep Forest',         category: 'Nature & Earthy',
    bg: '#0d1b1e', surface: '#152a2d', primary: '#52b788', secondary: '#b7e4c7',
    text: '#e8f5e9', border: '#2d4a43', glow: 'rgba(231,111,81,.3)', end: '#214438' },
  { id: 'sunset_horizon',     name: 'Sunset Horizon',      category: 'Nature & Earthy',
    bg: '#1a0a13', surface: '#2d1222', primary: '#ff7b54', secondary: '#ffb26b',
    text: '#fff0e6', border: '#4a1d39', glow: 'rgba(255,217,61,.3)', end: '#4e2724' },
  { id: 'oceanic_trench',     name: 'Oceanic Trench',      category: 'Nature & Earthy',
    bg: '#0a192f', surface: '#112240', primary: '#64ffda', secondary: '#57cbde',
    text: '#ccd6f6', border: '#233554', glow: 'rgba(100,255,218,.25)', end: '#1b4a53' },
  { id: 'matcha_cream',       name: 'Matcha & Cream',      category: 'Modern Pastel',
    bg: '#192019', surface: '#253325', primary: '#a8dadc', secondary: '#e2f0d9',
    text: '#f4f9f4', border: '#364a36', glow: 'rgba(244,162,97,.3)', end: '#2f4344' },
  { id: 'lavender_haze',      name: 'Lavender Haze',       category: 'Modern Pastel',
    bg: '#16131e', surface: '#262035', primary: '#c77dff', secondary: '#e0aaff',
    text: '#f3eaff', border: '#3d3054', glow: 'rgba(123,44,191,.35)', end: '#3a2a4e' },
];

const KEY = 'selected_theme_id';

export function themeById(id) {
  return THEMES.find((t) => t.id === id) || THEMES[0];
}

export function currentThemeId() {
  return localStorage.getItem(KEY) || THEMES[0].id;
}

export function applyTheme(id) {
  const t = themeById(id);
  const s = document.documentElement.style;
  s.setProperty('--bg', t.bg);
  s.setProperty('--bg-end', t.end);
  s.setProperty('--surface', t.surface);
  s.setProperty('--accent', t.primary);
  s.setProperty('--accent-bright', t.secondary);
  s.setProperty('--text', t.text);
  s.setProperty('--text-dim', hexToRgba(t.text, 0.74));
  s.setProperty('--border', t.border);
  s.setProperty('--glow', t.glow);
  localStorage.setItem(KEY, id);
  window.dispatchEvent(new CustomEvent('theme-changed', { detail: id }));
}

function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
